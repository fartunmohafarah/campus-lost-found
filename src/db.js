'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DEFAULT_CATEGORIES = [
  ['ID Cards', 'Student and staff identity cards'],
  ['Electronics', 'Phones, laptops, chargers, earphones'],
  ['Books & Stationery', 'Books, notebooks, calculators, pens'],
  ['Bags & Wallets', 'Bags, wallets, purses'],
  ['Keys', 'Keys and key chains'],
  ['Clothing & Accessories', 'Jackets, watches, spectacles'],
  ['Others', 'Anything that fits no other category']
];
const DEFAULT_LOCATIONS = [
  ['Main Block', 'Ground', 'Reception'],
  ['Main Block', '1', 'Classroom corridor'],
  ['Library', 'Ground', 'Reading hall'],
  ['Computer Lab Block', '2', 'Lab 204'],
  ['Cafeteria', 'Ground', 'Dining area'],
  ['Sports Complex', 'Ground', 'Indoor court'],
  ['Hostel Block A', 'Ground', 'Common room']
];

function nowIso() { return new Date().toISOString(); }

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  return db;
}

function seed(db, { demoUsers = true } = {}) {
  const insCat = db.prepare('INSERT OR IGNORE INTO categories (category_name, description) VALUES (?, ?)');
  DEFAULT_CATEGORIES.forEach((c) => insCat.run(...c));
  const insLoc = db.prepare('INSERT OR IGNORE INTO locations (building, floor, area_name) VALUES (?, ?, ?)');
  DEFAULT_LOCATIONS.forEach((l) => insLoc.run(...l));
  if (!demoUsers) return;
  const insUser = db.prepare(
    'INSERT OR IGNORE INTO users (name, email, password_hash, role, department, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const adminPw = process.env.ADMIN_PASSWORD || 'Admin@123';
  const officerPw = process.env.OFFICER_PASSWORD || 'Officer@123';
  insUser.run('Campus Administrator', 'admin@sru.edu.in', bcrypt.hashSync(adminPw, 10), 'admin', 'Administration', 'active', nowIso());
  insUser.run('Lost & Found Officer', 'officer@sru.edu.in', bcrypt.hashSync(officerPw, 10), 'officer', 'Security Office', 'active', nowIso());
}

function audit(db, actorId, action, entityType, entityId, detail) {
  db.prepare('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actorId ?? null, action, entityType, entityId ?? null, detail ?? null, nowIso());
}

module.exports = { openDatabase, seed, audit, nowIso };
