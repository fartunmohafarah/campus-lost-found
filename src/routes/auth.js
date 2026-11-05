'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken } = require('../auth');
const { HttpError, str, EMAIL_RE } = require('../util');
const { audit, nowIso } = require('../db');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

module.exports = function authRoutes({ db, secret, requireAuth }) {
  const router = express.Router();
  const attempts = new Map(); // key -> { count, resetAt }
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_ATTEMPTS = 10;

  function checkLimit(key) {
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || rec.resetAt < now) return;
    if (rec.count >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many failed login attempts. Try again in a few minutes.');
  }
  function recordFailure(key) {
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || rec.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    else rec.count += 1;
  }

  router.post('/register', (req, res) => {
    const name = str(req.body.name, { min: 2, max: 80, field: 'Name' });
    const email = str(req.body.email, { min: 3, max: 254, field: 'Email' }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const department = str(req.body.department || '', { max: 80, field: 'Department' });
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new HttpError(400, 'Password must be 8–72 characters and include a letter and a number.');
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists.');
    const hash = bcrypt.hashSync(password, 10);
    // Self-registration always creates a student/staff account; elevated roles are admin-assigned.
    const r = db.prepare('INSERT INTO users (name, email, password_hash, role, department, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, email, hash, 'student', department || null, 'active', nowIso());
    audit(db, r.lastInsertRowid, 'REGISTER', 'user', r.lastInsertRowid);
    res.status(201).json({ status: 'registered' });
  });

  router.post('/login', (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${email}`;
    checkLimit(key);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok || user.status !== 'active') {
      recordFailure(key);
      throw new HttpError(401, 'Invalid email or password.');
    }
    attempts.delete(key);
    audit(db, user.user_id, 'LOGIN', 'user', user.user_id);
    res.json({
      token: signToken(user, secret),
      user: { user_id: user.user_id, name: user.name, email: user.email, role: user.role, department: user.department }
    });
  });

  router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
  return router;
};
