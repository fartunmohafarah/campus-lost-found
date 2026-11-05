'use strict';
const express = require('express');
const { requireRole } = require('../auth');
const { HttpError, str, intId } = require('../util');
const { audit } = require('../db');

module.exports = function adminRoutes({ db, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/users', (req, res) => {
    res.json({ users: db.prepare('SELECT user_id, name, email, role, department, status, created_at FROM users ORDER BY user_id').all() });
  });

  router.patch('/users/:id', (req, res) => {
    const id = intId(req.params.id, 'User id');
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(id);
    if (!user) throw new HttpError(404, 'User not found.');
    const role = req.body.role ?? user.role;
    const status = req.body.status ?? user.status;
    if (!['student', 'officer', 'admin'].includes(role)) throw new HttpError(400, 'Invalid role.');
    if (!['active', 'disabled'].includes(status)) throw new HttpError(400, 'Invalid status.');
    if (id === req.user.user_id && (role !== 'admin' || status !== 'active')) throw new HttpError(400, 'You cannot demote or disable your own account.');
    db.prepare('UPDATE users SET role = ?, status = ? WHERE user_id = ?').run(role, status, id);
    audit(db, req.user.user_id, 'UPDATE_USER', 'user', id, `role=${role}, status=${status}`);
    res.json({ user_id: id, role, status });
  });

  router.post('/categories', (req, res) => {
    const name = str(req.body.category_name, { min: 2, max: 60, field: 'Category name' });
    const description = str(req.body.description || '', { max: 200, field: 'Description' });
    if (db.prepare('SELECT 1 FROM categories WHERE category_name = ? COLLATE NOCASE').get(name)) throw new HttpError(409, 'This category already exists.');
    const r = db.prepare('INSERT INTO categories (category_name, description) VALUES (?, ?)').run(name, description || null);
    audit(db, req.user.user_id, 'CREATE_CATEGORY', 'category', Number(r.lastInsertRowid), name);
    res.status(201).json({ category_id: Number(r.lastInsertRowid) });
  });

  router.delete('/categories/:id', (req, res) => {
    const id = intId(req.params.id, 'Category id');
    if (db.prepare('SELECT 1 FROM items WHERE category_id = ? LIMIT 1').get(id)) throw new HttpError(409, 'This category is used by existing reports and cannot be deleted.');
    const r = db.prepare('DELETE FROM categories WHERE category_id = ?').run(id);
    if (!r.changes) throw new HttpError(404, 'Category not found.');
    audit(db, req.user.user_id, 'DELETE_CATEGORY', 'category', id);
    res.json({ status: 'deleted' });
  });

  router.post('/locations', (req, res) => {
    const building = str(req.body.building, { min: 2, max: 60, field: 'Building' });
    const floor = str(req.body.floor || '', { max: 20, field: 'Floor' });
    const area = str(req.body.area_name, { min: 2, max: 60, field: 'Area' });
    if (db.prepare('SELECT 1 FROM locations WHERE building = ? AND floor IS ? AND area_name = ?').get(building, floor || null, area)) throw new HttpError(409, 'This location already exists.');
    const r = db.prepare('INSERT INTO locations (building, floor, area_name) VALUES (?, ?, ?)').run(building, floor || null, area);
    audit(db, req.user.user_id, 'CREATE_LOCATION', 'location', Number(r.lastInsertRowid), `${building} / ${area}`);
    res.status(201).json({ location_id: Number(r.lastInsertRowid) });
  });

  router.delete('/locations/:id', (req, res) => {
    const id = intId(req.params.id, 'Location id');
    if (db.prepare('SELECT 1 FROM items WHERE location_id = ? LIMIT 1').get(id)) throw new HttpError(409, 'This location is used by existing reports and cannot be deleted.');
    const r = db.prepare('DELETE FROM locations WHERE location_id = ?').run(id);
    if (!r.changes) throw new HttpError(404, 'Location not found.');
    audit(db, req.user.user_id, 'DELETE_LOCATION', 'location', id);
    res.json({ status: 'deleted' });
  });

  router.get('/audit', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = db.prepare(`SELECT a.log_id, a.action, a.entity_type, a.entity_id, a.detail, a.timestamp, u.name AS actor
                             FROM audit_logs a LEFT JOIN users u ON u.user_id = a.actor_id ORDER BY a.log_id DESC LIMIT ?`).all(limit);
    res.json({ logs: rows });
  });

  return router;
};
