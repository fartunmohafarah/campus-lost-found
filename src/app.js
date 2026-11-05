'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { openDatabase, seed } = require('./db');
const { authMiddleware } = require('./auth');
const { HttpError, makeUploader } = require('./util');

function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const dbFile = options.dbFile || (dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'lostfound.db'));
  const uploadDir = options.uploadDir || process.env.UPLOAD_DIR || path.join(dataDir === ':memory:' ? require('node:os').tmpdir() : dataDir, 'uploads');
  let secret = options.jwtSecret || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production.');
    secret = crypto.randomBytes(32).toString('hex'); // dev only: sessions reset on restart
  }

  const db = openDatabase(dbFile);
  seed(db, { demoUsers: options.demoUsers !== false });
  const requireAuth = authMiddleware(db, secret);
  const uploader = makeUploader(uploadDir);
  const metrics = { requests: 0, errors: 0 };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.uploadDir = uploadDir;
  app.locals.db = db;

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    next();
  });

  // Structured request log (one JSON line per request) for monitoring
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      metrics.requests += 1;
      if (res.statusCode >= 500) metrics.errors += 1;
      if (!options.silent && req.path !== '/api/health') {
        console.log(JSON.stringify({ t: new Date().toISOString(), method: req.method, path: req.path, status: res.statusCode, ms: Number(process.hrtime.bigint() - start) / 1e6 | 0 }));
      }
    });
    next();
  });

  app.use('/api', express.json({ limit: '16kb' }));

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
  });
  app.get('/api/metrics', (req, res) => {
    res.type('text/plain').send(`lostfound_requests_total ${metrics.requests}\nlostfound_server_errors_total ${metrics.errors}\n`);
  });
  app.get('/api/meta', (req, res) => {
    res.json({
      categories: db.prepare('SELECT category_id, category_name, description FROM categories ORDER BY category_name').all(),
      locations: db.prepare('SELECT location_id, building, floor, area_name FROM locations ORDER BY building, area_name').all()
    });
  });

  app.use('/api/auth', require('./routes/auth')({ db, secret, requireAuth }));
  app.use('/api/items', require('./routes/items')({ db, requireAuth, uploader, uploadDir }));
  app.use('/api', require('./routes/claims')({ db, requireAuth, uploader, uploadDir }));
  app.use('/api/admin', require('./routes/admin')({ db, requireAuth }));
  app.use('/api/reports', require('./routes/reports')({ db, requireAuth }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: true }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Request body must be valid JSON.');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Request body is too large.');
    const status = Number.isInteger(err.status) ? err.status : 500;
    if (status === 500) {
      console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', message: err.message }));
    }
    res.status(status).json({ error: status === 500 ? 'The request could not be completed.' : err.message });
  });

  app.close = () => db.close();
  return app;
}

module.exports = { createApp };
