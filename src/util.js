'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Express 4 does not catch rejected promises from async handlers; forward them to the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function str(v, { min = 0, max = 500, field = 'Field' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new HttpError(400, `${field} must be between ${min} and ${max} characters.`);
  return s;
}

function intId(v, field = 'Id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${field} is invalid.`);
  return n;
}

function isoDate(v, field = 'Date', { allowFuture = false } = {}) {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `${field} must be a valid date (YYYY-MM-DD).`);
  }
  if (!allowFuture && v > new Date().toISOString().slice(0, 10)) throw new HttpError(400, `${field} cannot be in the future.`);
  return v;
}

function makeUploader(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + (MIME_EXT[file.mimetype] || '.bin'))
  });
  return multer({
    storage,
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 12 },
    fileFilter: (req, file, cb) => {
      if (!MIME_EXT[file.mimetype]) return cb(new HttpError(400, 'Only JPEG, PNG or WebP images are allowed.'));
      cb(null, true);
    }
  }).single('image');
}

// Verifies the real file signature, not just the declared MIME type.
function verifyImageSignature(file) {
  const fd = fs.openSync(file.path, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const ok =
    (file.mimetype === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
    (file.mimetype === 'image/png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (file.mimetype === 'image/webp' && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP');
  if (!ok) { fs.rmSync(file.path, { force: true }); throw new HttpError(400, 'The uploaded file is not a valid image.'); }
}

function removeFile(uploadDir, key) {
  if (key) fs.rmSync(path.join(uploadDir, path.basename(key)), { force: true });
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

module.exports = { wrap, EMAIL_RE, HttpError, tx, str, intId, isoDate, makeUploader, verifyImageSignature, removeFile, toCsv, MIME_EXT };
