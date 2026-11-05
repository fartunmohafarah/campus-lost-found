'use strict';
const express = require('express');
const { requireRole } = require('../auth');
const { HttpError, intId, isoDate, toCsv } = require('../util');

module.exports = function reportRoutes({ db, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);
  const staff = requireRole('officer', 'admin');

  function send(req, res, rows, columns, name) {
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      return res.send(toCsv(rows, columns));
    }
    res.json({ rows });
  }

  // ---- Role-based dashboard counts (screen 2)
  router.get('/dashboard', (req, res) => {
    const u = req.user;
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    if (u.role === 'student') {
      return res.json({
        role: u.role,
        cards: {
          my_reports: one('SELECT COUNT(*) n FROM items WHERE created_by = ?', u.user_id),
          my_open_reports: one("SELECT COUNT(*) n FROM items WHERE created_by = ? AND status IN ('open','claim_pending')", u.user_id),
          my_claims: one('SELECT COUNT(*) n FROM claims WHERE claimant_id = ?', u.user_id),
          claims_need_info: one("SELECT COUNT(*) n FROM claims WHERE claimant_id = ? AND status = 'more_info'", u.user_id)
        }
      });
    }
    const cards = {
      open_found_items: one("SELECT COUNT(*) n FROM items WHERE report_type = 'found' AND status IN ('open','claim_pending')"),
      open_lost_reports: one("SELECT COUNT(*) n FROM items WHERE report_type = 'lost' AND status = 'open'"),
      pending_claims: one("SELECT COUNT(*) n FROM claims WHERE status IN ('pending','more_info')"),
      awaiting_handover: one("SELECT COUNT(*) n FROM claims WHERE status = 'approved'"),
      returned_items: one("SELECT COUNT(*) n FROM items WHERE status = 'returned'")
    };
    if (u.role === 'admin') cards.active_users = one("SELECT COUNT(*) n FROM users WHERE status = 'active'");
    const recent = db.prepare(`SELECT a.action, a.entity_type, a.entity_id, a.detail, a.timestamp, u.name AS actor
                               FROM audit_logs a LEFT JOIN users u ON u.user_id = a.actor_id ORDER BY a.log_id DESC LIMIT 8`).all();
    res.json({ role: u.role, cards, recent });
  });

  // ---- Report 4: category-wise and location-wise summary
  router.get('/summary', staff, (req, res) => {
    const all = (sql) => db.prepare(sql).all();
    res.json({
      totals: db.prepare(`SELECT COUNT(*) AS total,
          SUM(report_type = 'lost') AS lost, SUM(report_type = 'found') AS found,
          SUM(status = 'returned') AS returned FROM items`).get(),
      by_status: all('SELECT status, COUNT(*) AS count FROM items GROUP BY status ORDER BY count DESC'),
      by_category: all(`SELECT c.category_name AS label, SUM(i.report_type='lost') AS lost, SUM(i.report_type='found') AS found, COUNT(*) AS total
                        FROM items i JOIN categories c ON c.category_id = i.category_id GROUP BY c.category_id ORDER BY total DESC`),
      by_location: all(`SELECT l.building || ' – ' || l.area_name AS label, SUM(i.report_type='lost') AS lost, SUM(i.report_type='found') AS found, COUNT(*) AS total
                        FROM items i JOIN locations l ON l.location_id = i.location_id GROUP BY l.location_id ORDER BY total DESC`),
      by_month: all(`SELECT substr(report_date, 1, 7) AS label, COUNT(*) AS total FROM items GROUP BY label ORDER BY label DESC LIMIT 12`)
    });
  });

  // ---- Report 1: Lost and Found Items Report (date/category/location/status filters)
  router.get('/items', staff, (req, res) => {
    const q = req.query;
    const where = []; const p = [];
    if (q.type === 'lost' || q.type === 'found') { where.push('i.report_type = ?'); p.push(q.type); }
    if (q.status) { where.push('i.status = ?'); p.push(String(q.status)); }
    if (q.category_id) { where.push('i.category_id = ?'); p.push(intId(q.category_id, 'Category')); }
    if (q.location_id) { where.push('i.location_id = ?'); p.push(intId(q.location_id, 'Location')); }
    if (q.from) { where.push('i.report_date >= ?'); p.push(isoDate(q.from, 'From date', { allowFuture: true })); }
    if (q.to) { where.push('i.report_date <= ?'); p.push(isoDate(q.to, 'To date', { allowFuture: true })); }
    const rows = db.prepare(`SELECT i.reference, i.report_type, i.title, c.category_name AS category, l.building || ' – ' || l.area_name AS location,
        i.report_date, i.status, u.name AS reported_by
        FROM items i JOIN categories c ON c.category_id = i.category_id JOIN locations l ON l.location_id = i.location_id
        JOIN users u ON u.user_id = i.created_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.report_date DESC, i.item_id DESC`).all(...p);
    send(req, res, rows, ['reference', 'report_type', 'title', 'category', 'location', 'report_date', 'status', 'reported_by'], 'lost-and-found-items');
  });

  // ---- Report 2: Pending Claims Report
  router.get('/pending-claims', staff, (req, res) => {
    const rows = db.prepare(`SELECT cl.claim_id, i.reference AS item_reference, i.title AS item_title, u.name AS claimant, cl.status, cl.created_at AS submitted_at
        FROM claims cl JOIN items i ON i.item_id = cl.item_id JOIN users u ON u.user_id = cl.claimant_id
        WHERE cl.status IN ('pending','more_info','approved') ORDER BY cl.created_at`).all();
    send(req, res, rows, ['claim_id', 'item_reference', 'item_title', 'claimant', 'status', 'submitted_at'], 'pending-claims');
  });

  // ---- Report 3: Returned Items Report
  router.get('/returned', staff, (req, res) => {
    const rows = db.prepare(`SELECT i.reference AS item_reference, i.title AS item_title, h.received_by, o.name AS handed_over_by, h.handover_time
        FROM handover_records h JOIN items i ON i.item_id = h.item_id JOIN users o ON o.user_id = h.handed_over_by ORDER BY h.handover_time DESC`).all();
    send(req, res, rows, ['item_reference', 'item_title', 'received_by', 'handed_over_by', 'handover_time'], 'returned-items');
  });

  return router;
};
