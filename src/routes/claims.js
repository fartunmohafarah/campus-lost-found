'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { requireRole } = require('../auth');
const { wrap, HttpError, tx, str, intId, verifyImageSignature, removeFile } = require('../util');
const { audit, nowIso } = require('../db');

const CLAIM_SELECT = `
  SELECT cl.claim_id, cl.item_id, cl.status, cl.claim_description, cl.officer_note, cl.reviewed_at, cl.created_at, cl.updated_at,
         (cl.evidence_reference IS NOT NULL) AS has_evidence,
         i.reference, i.title, i.report_type, i.status AS item_status,
         cat.category_name, loc.building, loc.area_name
  FROM claims cl
  JOIN items i ON i.item_id = cl.item_id
  JOIN categories cat ON cat.category_id = i.category_id
  JOIN locations loc ON loc.location_id = i.location_id`;

const ACTIVE = "('pending','more_info','approved')";

module.exports = function claimRoutes({ db, requireAuth, uploader, uploadDir }) {
  const router = express.Router();
  router.use(requireAuth);
  const officer = requireRole('officer', 'admin');

  const runUpload = (req, res) => new Promise((resolve, reject) => {
    uploader(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') return reject(new HttpError(400, 'Evidence image must be 2 MB or smaller.'));
      reject(err instanceof HttpError ? err : new HttpError(400, 'Invalid upload.'));
    });
  });

  // ---- Submit a claim (FR-05). Evidence is private: only claimant and staff can see it.
  router.post('/items/:id/claims', wrap(async (req, res) => {
    await runUpload(req, res);
    const file = req.file;
    try {
      const itemId = intId(req.params.id, 'Item id');
      const description = str(req.body.claim_description, { min: 15, max: 1000, field: 'Ownership details' });
      const item = db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId);
      if (!item) throw new HttpError(404, 'Item not found.');
      if (item.report_type !== 'found') throw new HttpError(400, 'Claims can only be submitted for found items.');
      if (!['open', 'claim_pending'].includes(item.status)) throw new HttpError(409, 'This item is no longer available for claims.');
      if (item.created_by === req.user.user_id) throw new HttpError(400, 'You cannot claim an item you reported.');
      if (db.prepare(`SELECT 1 FROM claims WHERE item_id = ? AND claimant_id = ? AND status IN ${ACTIVE}`).get(itemId, req.user.user_id)) {
        throw new HttpError(409, 'You already have an active claim on this item.');
      }
      if (file) verifyImageSignature(file);
      const claimId = tx(db, () => {
        const ts = nowIso();
        const r = db.prepare(`INSERT INTO claims (item_id, claimant_id, claim_description, evidence_reference, evidence_mime, status, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .run(itemId, req.user.user_id, description, file ? file.filename : null, file ? file.mimetype : null, ts, ts);
        db.prepare("UPDATE items SET status = 'claim_pending', updated_at = ? WHERE item_id = ?").run(ts, itemId);
        audit(db, req.user.user_id, 'SUBMIT_CLAIM', 'claim', Number(r.lastInsertRowid), `item ${item.reference}`);
        return Number(r.lastInsertRowid);
      });
      res.status(201).json({ claim_id: claimId, status: 'pending' });
    } catch (e) {
      if (file) removeFile(uploadDir, file.filename);
      throw e;
    }
  }));

  // ---- My claims
  router.get('/claims/mine', (req, res) => {
    const rows = db.prepare(`${CLAIM_SELECT} WHERE cl.claimant_id = ? ORDER BY cl.created_at DESC`).all(req.user.user_id);
    res.json({ claims: rows.map((r) => ({ ...r, has_evidence: Boolean(r.has_evidence) })) });
  });

  // ---- Officer queue (supports status filter)
  router.get('/claims', officer, (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status) {
      if (!['pending', 'more_info', 'approved', 'rejected', 'completed'].includes(req.query.status)) throw new HttpError(400, 'Invalid status filter.');
      where.push('cl.status = ?'); params.push(req.query.status);
    }
    const sql = `${CLAIM_SELECT.replace('SELECT cl.claim_id', 'SELECT u.name AS claimant_name, u.email AS claimant_email, cl.claim_id')
      .replace('JOIN items i', 'JOIN users u ON u.user_id = cl.claimant_id JOIN items i')}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cl.created_at ASC`;
    const rows = db.prepare(sql).all(...params);
    res.json({ claims: rows.map((r) => ({ ...r, has_evidence: Boolean(r.has_evidence) })) });
  });

  // ---- Evidence file: claimant or staff only
  router.get('/claims/:id/evidence', (req, res) => {
    const id = intId(req.params.id, 'Claim id');
    const c = db.prepare('SELECT claimant_id, evidence_reference, evidence_mime FROM claims WHERE claim_id = ?').get(id);
    if (!c || !c.evidence_reference) throw new HttpError(404, 'No evidence found.');
    if (c.claimant_id !== req.user.user_id && !['officer', 'admin'].includes(req.user.role)) throw new HttpError(403, 'You do not have access to this evidence.');
    const file = path.join(req.app.locals.uploadDir, path.basename(c.evidence_reference));
    if (!fs.existsSync(file)) throw new HttpError(404, 'Evidence file is missing.');
    res.setHeader('Content-Type', c.evidence_mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file);
  });

  // ---- Officer review (FR-06): approve / reject / more_info
  router.patch('/claims/:id/review', officer, (req, res) => {
    const id = intId(req.params.id, 'Claim id');
    const decision = req.body.decision;
    if (!['approve', 'reject', 'more_info'].includes(decision)) throw new HttpError(400, 'Decision must be approve, reject or more_info.');
    const note = str(req.body.note || '', { max: 500, field: 'Note' });
    if (decision !== 'approve' && note.length < 3) throw new HttpError(400, 'Add a note explaining the decision.');
    const result = tx(db, () => {
      const claim = db.prepare('SELECT * FROM claims WHERE claim_id = ?').get(id);
      if (!claim) throw new HttpError(404, 'Claim not found.');
      if (!['pending', 'more_info'].includes(claim.status)) throw new HttpError(409, `A ${claim.status} claim cannot be reviewed again.`);
      if (decision === 'approve' && db.prepare("SELECT 1 FROM claims WHERE item_id = ? AND status = 'approved'").get(claim.item_id)) {
        throw new HttpError(409, 'Another claim for this item is already approved.');
      }
      const newStatus = { approve: 'approved', reject: 'rejected', more_info: 'more_info' }[decision];
      const ts = nowIso();
      db.prepare('UPDATE claims SET status = ?, officer_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE claim_id = ?')
        .run(newStatus, note || null, req.user.user_id, ts, ts, id);
      if (decision === 'reject') {
        const remaining = db.prepare(`SELECT COUNT(*) AS n FROM claims WHERE item_id = ? AND status IN ${ACTIVE}`).get(claim.item_id).n;
        if (remaining === 0) db.prepare("UPDATE items SET status = 'open', updated_at = ? WHERE item_id = ?").run(ts, claim.item_id);
      }
      audit(db, req.user.user_id, `CLAIM_${newStatus.toUpperCase()}`, 'claim', id, note || null);
      return newStatus;
    });
    res.json({ status: result });
  });

  // ---- Claimant answers an officer's information request
  router.patch('/claims/:id/respond', (req, res) => {
    const id = intId(req.params.id, 'Claim id');
    const extra = str(req.body.additional_details, { min: 5, max: 800, field: 'Additional details' });
    const claim = db.prepare('SELECT * FROM claims WHERE claim_id = ?').get(id);
    if (!claim || claim.claimant_id !== req.user.user_id) throw new HttpError(404, 'Claim not found.');
    if (claim.status !== 'more_info') throw new HttpError(409, 'This claim is not waiting for more information.');
    const merged = `${claim.claim_description}\n\nAdditional details (${nowIso().slice(0, 10)}): ${extra}`.slice(0, 2500);
    db.prepare("UPDATE claims SET claim_description = ?, status = 'pending', updated_at = ? WHERE claim_id = ?").run(merged, nowIso(), id);
    audit(db, req.user.user_id, 'CLAIM_RESPONDED', 'claim', id);
    res.json({ status: 'pending' });
  });

  // ---- Handover: closes the item as returned and records who received it
  router.post('/claims/:id/handover', officer, (req, res) => {
    const id = intId(req.params.id, 'Claim id');
    const receivedBy = str(req.body.received_by, { min: 2, max: 80, field: 'Received by' });
    tx(db, () => {
      const claim = db.prepare('SELECT * FROM claims WHERE claim_id = ?').get(id);
      if (!claim) throw new HttpError(404, 'Claim not found.');
      if (claim.status !== 'approved') throw new HttpError(409, 'Only approved claims can be handed over.');
      const ts = nowIso();
      db.prepare("UPDATE claims SET status = 'completed', updated_at = ? WHERE claim_id = ?").run(ts, id);
      db.prepare("UPDATE items SET status = 'returned', updated_at = ? WHERE item_id = ?").run(ts, claim.item_id);
      db.prepare("UPDATE claims SET status = 'rejected', officer_note = 'Item was returned to another verified claimant.', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE item_id = ? AND claim_id != ? AND status IN ('pending','more_info')")
        .run(req.user.user_id, ts, ts, claim.item_id, id);
      db.prepare('INSERT INTO handover_records (item_id, claim_id, handed_over_by, received_by, handover_time) VALUES (?, ?, ?, ?, ?)')
        .run(claim.item_id, id, req.user.user_id, receivedBy, ts);
      audit(db, req.user.user_id, 'HANDOVER', 'claim', id, `received by ${receivedBy}`);
    });
    res.json({ status: 'completed' });
  });

  return router;
};
