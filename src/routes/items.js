'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { requireRole } = require('../auth');
const { wrap, HttpError, tx, str, intId, isoDate, verifyImageSignature, removeFile } = require('../util');
const { audit, nowIso } = require('../db');

const ITEM_SELECT = `
  SELECT i.item_id, i.reference, i.report_type, i.title, i.description, i.report_date, i.status,
         i.category_id, c.category_name, i.location_id, l.building, l.floor, l.area_name,
         i.created_by, i.created_at, i.updated_at,
         (SELECT COUNT(*) FROM item_images im WHERE im.item_id = i.item_id) AS has_image
  FROM items i
  JOIN categories c ON c.category_id = i.category_id
  JOIN locations l ON l.location_id = i.location_id`;

const isStaff = (u) => u.role === 'officer' || u.role === 'admin';

// Public listing view: never exposes reporter identity, custody details or claim data.
function publicItem(row) {
  const { created_by, ...rest } = row;
  return { ...rest, has_image: Boolean(rest.has_image) };
}

function tokens(text) {
  return new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
}

module.exports = function itemRoutes({ db, requireAuth, uploader, uploadDir }) {
  const router = express.Router();
  router.use(requireAuth);

  const runUpload = (req, res) => new Promise((resolve, reject) => {
    uploader(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') return reject(new HttpError(400, 'Image must be 2 MB or smaller.'));
      reject(err instanceof HttpError ? err : new HttpError(400, 'Invalid upload.'));
    });
  });

  // ---- Create a lost / found report (FR-02, FR-03)
  router.post('/', wrap(async (req, res) => {
    await runUpload(req, res);
    const file = req.file;
    try {
      const b = req.body;
      const type = b.report_type;
      if (type !== 'lost' && type !== 'found') throw new HttpError(400, 'Report type must be lost or found.');
      const title = str(b.title, { min: 3, max: 100, field: 'Title' });
      const description = str(b.description, { min: 10, max: 1000, field: 'Description' });
      const categoryId = intId(b.category_id, 'Category');
      const locationId = intId(b.location_id, 'Location');
      const reportDate = isoDate(b.report_date, 'Date');
      const custody = type === 'found' ? str(b.custody, { min: 3, max: 200, field: 'Custody details' }) : null;
      if (!db.prepare('SELECT 1 FROM categories WHERE category_id = ?').get(categoryId)) throw new HttpError(400, 'Choose a valid category.');
      if (!db.prepare('SELECT 1 FROM locations WHERE location_id = ?').get(locationId)) throw new HttpError(400, 'Choose a valid location.');
      if (file) verifyImageSignature(file);

      const itemId = tx(db, () => {
        const ts = nowIso();
        const r = db.prepare(`INSERT INTO items (reference, report_type, title, description, category_id, location_id, report_date, custody, status, created_by, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
          .run('PENDING', type, title, description, categoryId, locationId, reportDate, custody, req.user.user_id, ts, ts);
        const id = Number(r.lastInsertRowid);
        const ref = `LF-${type === 'lost' ? 'L' : 'F'}-${String(id).padStart(5, '0')}`;
        db.prepare('UPDATE items SET reference = ? WHERE item_id = ?').run(ref, id);
        if (file) db.prepare('INSERT INTO item_images (item_id, storage_key, mime_type, uploaded_at) VALUES (?, ?, ?, ?)').run(id, file.filename, file.mimetype, ts);
        audit(db, req.user.user_id, 'CREATE_REPORT', 'item', id, `${type}: ${title}`);
        return id;
      });
      const item = db.prepare('SELECT reference FROM items WHERE item_id = ?').get(itemId);
      res.status(201).json({ item_id: itemId, reference: item.reference });
    } catch (e) {
      if (file) removeFile(uploadDir, file.filename);
      throw e;
    }
  }));

  // ---- Search and filter (FR-04)
  router.get('/', (req, res) => {
    const q = req.query;
    const where = [];
    const params = [];
    if (q.type === 'lost' || q.type === 'found') { where.push('i.report_type = ?'); params.push(q.type); }
    if (q.status && ['open', 'claim_pending', 'returned', 'closed'].includes(q.status)) { where.push('i.status = ?'); params.push(q.status); }
    if (q.category_id) { where.push('i.category_id = ?'); params.push(intId(q.category_id, 'Category')); }
    if (q.location_id) { where.push('i.location_id = ?'); params.push(intId(q.location_id, 'Location')); }
    if (q.from) { where.push('i.report_date >= ?'); params.push(isoDate(q.from, 'From date', { allowFuture: true })); }
    if (q.to) { where.push('i.report_date <= ?'); params.push(isoDate(q.to, 'To date', { allowFuture: true })); }
    if (q.q) {
      const term = String(q.q).trim().slice(0, 80).replace(/[\\%_]/g, (m) => '\\' + m);
      where.push("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR i.reference LIKE ? ESCAPE '\\')");
      params.push(`%${term}%`, `%${term}%`, `%${term}%`);
    }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const sql = `${ITEM_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.report_date DESC, i.item_id DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM items i ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params).n;
    res.json({ items: rows.map(publicItem), total });
  });

  // ---- Own reports
  router.get('/mine', (req, res) => {
    const rows = db.prepare(`${ITEM_SELECT} WHERE i.created_by = ? ORDER BY i.created_at DESC`).all(req.user.user_id);
    res.json({ items: rows.map(publicItem) });
  });

  // ---- Item details
  router.get('/:id', (req, res) => {
    const id = intId(req.params.id, 'Item id');
    const row = db.prepare(`${ITEM_SELECT} WHERE i.item_id = ?`).get(id);
    if (!row) throw new HttpError(404, 'Item not found.');
    const out = publicItem(row);
    const isOwner = row.created_by === req.user.user_id;
    out.is_owner = isOwner;
    if (isOwner || isStaff(req.user)) {
      const extra = db.prepare('SELECT i.custody, u.name AS reporter_name, u.email AS reporter_email FROM items i JOIN users u ON u.user_id = i.created_by WHERE i.item_id = ?').get(id);
      out.custody = extra.custody;
      out.reporter = { name: extra.reporter_name, email: extra.reporter_email };
    }
    out.my_claim = db.prepare("SELECT claim_id, status, officer_note FROM claims WHERE item_id = ? AND claimant_id = ? ORDER BY claim_id DESC LIMIT 1").get(id, req.user.user_id) || null;
    res.json({ item: out });
  });

  // ---- Matching suggestions: opposite report type, same category, keyword overlap
  router.get('/:id/matches', (req, res) => {
    const id = intId(req.params.id, 'Item id');
    const item = db.prepare('SELECT * FROM items WHERE item_id = ?').get(id);
    if (!item) throw new HttpError(404, 'Item not found.');
    if (item.created_by !== req.user.user_id && !isStaff(req.user)) throw new HttpError(403, 'You can only view matches for your own reports.');
    const oppositeType = item.report_type === 'lost' ? 'found' : 'lost';
    const candidates = db.prepare(`${ITEM_SELECT} WHERE i.report_type = ? AND i.category_id = ? AND i.status IN ('open','claim_pending') AND i.item_id != ?`)
      .all(oppositeType, item.category_id, id);
    const base = tokens(`${item.title} ${item.description}`);
    const scored = candidates.map((c) => {
      const t = tokens(`${c.title} ${c.description}`);
      let overlap = 0;
      base.forEach((w) => { if (t.has(w)) overlap += 1; });
      const score = overlap * 10 + 20 + (c.location_id === item.location_id ? 15 : 0); // 20 = same category
      return { ...publicItem(c), match_score: Math.min(score, 100) };
    }).sort((a, b) => b.match_score - a.match_score).slice(0, 5);
    res.json({ matches: scored });
  });

  // ---- Item image (authenticated)
  router.get('/:id/image', (req, res) => {
    const id = intId(req.params.id, 'Item id');
    const img = db.prepare('SELECT storage_key, mime_type FROM item_images WHERE item_id = ? ORDER BY image_id LIMIT 1').get(id);
    if (!img) throw new HttpError(404, 'No image for this item.');
    const file = path.join(req.app.locals.uploadDir, path.basename(img.storage_key));
    if (!fs.existsSync(file)) throw new HttpError(404, 'Image file is missing.');
    res.setHeader('Content-Type', img.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(file);
  });

  // ---- Status update: owner may close/return own lost report; staff may update any (FR-07)
  router.patch('/:id/status', (req, res) => {
    const id = intId(req.params.id, 'Item id');
    const status = req.body.status;
    if (!['open', 'closed', 'returned'].includes(status)) throw new HttpError(400, 'Status must be open, closed or returned.');
    const item = db.prepare('SELECT * FROM items WHERE item_id = ?').get(id);
    if (!item) throw new HttpError(404, 'Item not found.');
    const owner = item.created_by === req.user.user_id;
    if (!isStaff(req.user)) {
      if (!owner || item.report_type !== 'lost' || !['closed', 'returned'].includes(status)) {
        throw new HttpError(403, 'You can only close or mark your own lost-item report as returned.');
      }
    }
    if (item.report_type === 'found' && status === 'returned') throw new HttpError(400, 'Found items are returned through an approved claim handover.');
    const activeClaims = db.prepare("SELECT COUNT(*) AS n FROM claims WHERE item_id = ? AND status IN ('pending','more_info','approved')").get(id).n;
    if (item.report_type === 'found' && status !== 'open' && activeClaims > 0) throw new HttpError(409, 'Resolve the active claims on this item first.');
    if (item.status === 'returned' && status !== 'returned') throw new HttpError(409, 'A returned item cannot be reopened.');
    db.prepare('UPDATE items SET status = ?, updated_at = ? WHERE item_id = ?').run(status, nowIso(), id);
    audit(db, req.user.user_id, 'UPDATE_ITEM_STATUS', 'item', id, `${item.status} -> ${status}`);
    res.json({ status });
  });

  return router;
};
