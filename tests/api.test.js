'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let app, server, base;
const tokens = {};

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

function reportForm(fields, withImage = false) {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  if (withImage) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    f.append('image', new Blob([png], { type: 'image/png' }), 'item.png');
  }
  return f;
}
const today = () => new Date().toISOString().slice(0, 10);
const lostFields = (o = {}) => ({ report_type: 'lost', title: 'Black laptop charger', description: 'Dell 65W charger with a blue cable tie', category_id: 2, location_id: 3, report_date: today(), ...o });
const foundFields = (o = {}) => ({ report_type: 'found', title: 'Laptop charger', description: 'Black Dell charger found on a library table', category_id: 2, location_id: 3, report_date: today(), custody: 'Handed to library desk', ...o });

before(async () => {
  app = createApp({ dataDir: ':memory:', jwtSecret: 'test-secret', silent: true });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [name, email] of [['Asha Student', 'asha@sru.edu.in'], ['Ravi Student', 'ravi@sru.edu.in']]) {
    const r = await call('POST', '/api/auth/register', { body: { name, email, password: 'Passw0rdOK', department: 'CSE' } });
    assert.equal(r.status, 201);
    tokens[name.split(' ')[0].toLowerCase()] = (await call('POST', '/api/auth/login', { body: { email, password: 'Passw0rdOK' } })).data.token;
  }
  tokens.officer = (await call('POST', '/api/auth/login', { body: { email: 'officer@sru.edu.in', password: 'Officer@123' } })).data.token;
  tokens.admin = (await call('POST', '/api/auth/login', { body: { email: 'admin@sru.edu.in', password: 'Admin@123' } })).data.token;
});
after(() => { server.closeAllConnections(); server.close(); app.close(); });

test('TC-01 login with valid credentials returns token and role', async () => {
  const r = await call('POST', '/api/auth/login', { body: { email: 'officer@sru.edu.in', password: 'Officer@123' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'officer');
  assert.ok(r.data.token);
});

test('login rejects wrong password and weak registration password', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { email: 'officer@sru.edu.in', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const weak = await call('POST', '/api/auth/register', { body: { name: 'Weak User', email: 'weak@sru.edu.in', password: 'short' } });
  assert.equal(weak.status, 400);
  const dup = await call('POST', '/api/auth/register', { body: { name: 'Asha Again', email: 'asha@sru.edu.in', password: 'Passw0rdOK' } });
  assert.equal(dup.status, 409);
});

test('protected endpoints require a token', async () => {
  assert.equal((await call('GET', '/api/items')).status, 401);
  assert.equal((await call('GET', '/api/items', { token: 'garbage' })).status, 401);
});

test('TC-02 submit lost-item report with valid data (and image) creates reference ID', async () => {
  const r = await call('POST', '/api/items', { token: tokens.asha, form: reportForm(lostFields(), true) });
  assert.equal(r.status, 201);
  assert.match(r.data.reference, /^LF-L-\d{5}$/);
  const img = await fetch(`${base}/api/items/${r.data.item_id}/image`, { headers: { Authorization: `Bearer ${tokens.ravi}` } });
  assert.equal(img.status, 200);
  assert.equal((await fetch(`${base}/api/items/${r.data.item_id}/image`)).status, 401);
});

test('TC-03 report with missing/invalid fields is rejected and not stored', async () => {
  const before = (await call('GET', '/api/items', { token: tokens.asha })).data.total;
  assert.equal((await call('POST', '/api/items', { token: tokens.asha, form: reportForm(lostFields({ title: '' })) })).status, 400);
  assert.equal((await call('POST', '/api/items', { token: tokens.asha, form: reportForm(foundFields({ custody: '' })) })).status, 400);
  assert.equal((await call('POST', '/api/items', { token: tokens.asha, form: reportForm(lostFields({ report_date: '2999-01-01' })) })).status, 400);
  assert.equal((await call('GET', '/api/items', { token: tokens.asha })).data.total, before);
});

test('fake image (wrong signature) is rejected', async () => {
  const f = reportForm(lostFields());
  f.append('image', new Blob([Buffer.from('not really a png')], { type: 'image/png' }), 'x.png');
  const r = await call('POST', '/api/items', { token: tokens.asha, form: f });
  assert.equal(r.status, 400);
});

let foundId, claimId;
test('TC-06 search by category and location returns only matching records', async () => {
  const f = await call('POST', '/api/items', { token: tokens.ravi, form: reportForm(foundFields()) });
  assert.equal(f.status, 201);
  foundId = f.data.item_id;
  await call('POST', '/api/items', { token: tokens.ravi, form: reportForm(foundFields({ title: 'Blue water bottle', description: 'Steel bottle left in the cafeteria', category_id: 7, location_id: 5 })) });
  const r = await call('GET', '/api/items?type=found&category_id=2&location_id=3', { token: tokens.asha });
  assert.equal(r.status, 200);
  assert.ok(r.data.items.length >= 1);
  assert.ok(r.data.items.every((i) => i.category_id === 2 && i.location_id === 3 && i.report_type === 'found'));
  const search = await call('GET', '/api/items?q=bottle', { token: tokens.asha });
  assert.ok(search.data.items.every((i) => /bottle/i.test(i.title + i.description)));
});

test('privacy: public item view hides reporter identity and custody; owner and officer see it', async () => {
  const pub = (await call('GET', `/api/items/${foundId}`, { token: tokens.asha })).data.item;
  assert.equal(pub.reporter, undefined);
  assert.equal(pub.custody, undefined);
  assert.equal(pub.created_by, undefined);
  const off = (await call('GET', `/api/items/${foundId}`, { token: tokens.officer })).data.item;
  assert.equal(off.reporter.name, 'Ravi Student');
});

test('matching suggests the found charger for the lost charger', async () => {
  const mine = (await call('GET', '/api/items/mine', { token: tokens.asha })).data.items;
  const lost = mine.find((i) => i.report_type === 'lost');
  const m = await call('GET', `/api/items/${lost.item_id}/matches`, { token: tokens.asha });
  assert.equal(m.status, 200);
  assert.ok(m.data.matches.some((x) => x.item_id === foundId));
  assert.equal((await call('GET', `/api/items/${lost.item_id}/matches`, { token: tokens.ravi })).status, 403);
});

test('claim rules: cannot claim own item, lost items, or duplicate', async () => {
  assert.equal((await call('POST', `/api/items/${foundId}/claims`, { token: tokens.ravi, form: reportForm({ claim_description: 'This is my own report really' }) })).status, 400);
  const mineLost = (await call('GET', '/api/items/mine', { token: tokens.asha })).data.items.find((i) => i.report_type === 'lost');
  assert.equal((await call('POST', `/api/items/${mineLost.item_id}/claims`, { token: tokens.ravi, form: reportForm({ claim_description: 'Trying to claim a lost item report' }) })).status, 400);
  const ok = await call('POST', `/api/items/${foundId}/claims`, { token: tokens.asha, form: reportForm({ claim_description: 'Black Dell 65W charger with blue cable tie on the cord' }, true) });
  assert.equal(ok.status, 201);
  claimId = ok.data.claim_id;
  assert.equal((await call('POST', `/api/items/${foundId}/claims`, { token: tokens.asha, form: reportForm({ claim_description: 'Second attempt on the same item' }) })).status, 409);
  assert.equal((await call('GET', `/api/items/${foundId}`, { token: tokens.asha })).data.item.status, 'claim_pending');
});

test('TC-04 student cannot access officer-only endpoints (server-side RBAC)', async () => {
  assert.equal((await call('PATCH', `/api/claims/${claimId}/review`, { token: tokens.asha, body: { decision: 'approve' } })).status, 403);
  assert.equal((await call('GET', '/api/claims', { token: tokens.asha })).status, 403);
  assert.equal((await call('GET', '/api/reports/summary', { token: tokens.asha })).status, 403);
  assert.equal((await call('GET', '/api/admin/users', { token: tokens.officer })).status, 403);
  assert.equal((await call('POST', '/api/admin/categories', { token: tokens.officer, body: { category_name: 'Hack' } })).status, 403);
});

test('claim evidence is private to claimant and staff', async () => {
  const get = (t) => fetch(`${base}/api/claims/${claimId}/evidence`, { headers: { Authorization: `Bearer ${t}` } });
  assert.equal((await get(tokens.asha)).status, 200);
  assert.equal((await get(tokens.officer)).status, 200);
  assert.equal((await get(tokens.ravi)).status, 403);
});

test('more-info workflow: officer requests info, claimant responds, status returns to pending', async () => {
  assert.equal((await call('PATCH', `/api/claims/${claimId}/review`, { token: tokens.officer, body: { decision: 'more_info' } })).status, 400); // note required
  assert.equal((await call('PATCH', `/api/claims/${claimId}/review`, { token: tokens.officer, body: { decision: 'more_info', note: 'Which brand is the charger?' } })).data.status, 'more_info');
  assert.equal((await call('PATCH', `/api/claims/${claimId}/respond`, { token: tokens.ravi, body: { additional_details: 'not mine' } })).status, 404);
  assert.equal((await call('PATCH', `/api/claims/${claimId}/respond`, { token: tokens.asha, body: { additional_details: 'It is a Dell, serial ends 4821' } })).data.status, 'pending');
});

test('TC-05 officer approves claim, hands over; status, handover and audit are recorded', async () => {
  assert.equal((await call('POST', `/api/claims/${claimId}/handover`, { token: tokens.officer, body: { received_by: 'Asha Student' } })).status, 409); // not approved yet
  assert.equal((await call('PATCH', `/api/claims/${claimId}/review`, { token: tokens.officer, body: { decision: 'approve' } })).data.status, 'approved');
  assert.equal((await call('PATCH', `/api/claims/${claimId}/review`, { token: tokens.officer, body: { decision: 'reject', note: 'again' } })).status, 409);
  assert.equal((await call('POST', `/api/claims/${claimId}/handover`, { token: tokens.officer, body: { received_by: 'Asha Student' } })).data.status, 'completed');
  assert.equal((await call('GET', `/api/items/${foundId}`, { token: tokens.asha })).data.item.status, 'returned');
  const logs = (await call('GET', '/api/admin/audit', { token: tokens.admin })).data.logs.map((l) => l.action);
  assert.ok(logs.includes('HANDOVER') && logs.includes('CLAIM_APPROVED') && logs.includes('SUBMIT_CLAIM'));
  assert.equal((await call('POST', `/api/items/${foundId}/claims`, { token: tokens.ravi, form: reportForm({ claim_description: 'Late claim on a returned item' }) })).status, 409);
});

test('reject returns item to open when no other active claims remain', async () => {
  const f = await call('POST', '/api/items', { token: tokens.ravi, form: reportForm(foundFields({ title: 'Silver key ring', description: 'Three keys on a silver ring', category_id: 5 })) });
  const c = await call('POST', `/api/items/${f.data.item_id}/claims`, { token: tokens.asha, form: reportForm({ claim_description: 'Three keys with a red tag from my hostel room' }) });
  assert.equal((await call('PATCH', `/api/claims/${c.data.claim_id}/review`, { token: tokens.officer, body: { decision: 'reject', note: 'Description does not match' } })).data.status, 'rejected');
  assert.equal((await call('GET', `/api/items/${f.data.item_id}`, { token: tokens.asha })).data.item.status, 'open');
});

test('TC-07 pending claims report lists claims awaiting action; returned report lists handovers', async () => {
  const f = await call('POST', '/api/items', { token: tokens.ravi, form: reportForm(foundFields({ title: 'Scientific calculator', description: 'Casio fx-991 calculator', category_id: 3 })) });
  const c = await call('POST', `/api/items/${f.data.item_id}/claims`, { token: tokens.asha, form: reportForm({ claim_description: 'Casio calculator with my initials scratched on the back' }) });
  const pending = await call('GET', '/api/reports/pending-claims', { token: tokens.officer });
  assert.ok(pending.data.rows.some((r) => r.claim_id === c.data.claim_id && r.status === 'pending'));
  const returned = await call('GET', '/api/reports/returned', { token: tokens.officer });
  assert.equal(returned.data.rows.length, 1);
  const csv = await call('GET', '/api/reports/items?format=csv', { token: tokens.admin });
  assert.equal(csv.status, 200);
  assert.match(csv.data, /^reference,report_type,title/);
  const summary = (await call('GET', '/api/reports/summary', { token: tokens.officer })).data;
  assert.ok(summary.by_category.length > 0 && summary.by_location.length > 0 && summary.totals.total >= 5);
});

test('admin manages users, categories and locations; guards apply', async () => {
  const users = (await call('GET', '/api/admin/users', { token: tokens.admin })).data.users;
  const ravi = users.find((u) => u.email === 'ravi@sru.edu.in');
  const admin = users.find((u) => u.email === 'admin@sru.edu.in');
  assert.equal((await call('PATCH', `/api/admin/users/${admin.user_id}`, { token: tokens.admin, body: { role: 'student' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/users/${ravi.user_id}`, { token: tokens.admin, body: { status: 'disabled' } })).status, 200);
  assert.equal((await call('GET', '/api/items', { token: tokens.ravi })).status, 401); // disabled applies immediately
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ravi@sru.edu.in', password: 'Passw0rdOK' } })).status, 401);
  const cat = await call('POST', '/api/admin/categories', { token: tokens.admin, body: { category_name: 'Sports Gear' } });
  assert.equal(cat.status, 201);
  assert.equal((await call('POST', '/api/admin/categories', { token: tokens.admin, body: { category_name: 'sports gear' } })).status, 409);
  assert.equal((await call('DELETE', `/api/admin/categories/${cat.data.category_id}`, { token: tokens.admin })).status, 200);
  assert.equal((await call('DELETE', '/api/admin/categories/2', { token: tokens.admin })).status, 409); // in use
});

test('dashboards are role specific; health and metrics respond; unknown routes 404', async () => {
  assert.ok('my_reports' in (await call('GET', '/api/reports/dashboard', { token: tokens.asha })).data.cards);
  assert.ok('pending_claims' in (await call('GET', '/api/reports/dashboard', { token: tokens.officer })).data.cards);
  assert.ok('active_users' in (await call('GET', '/api/reports/dashboard', { token: tokens.admin })).data.cards);
  assert.equal((await call('GET', '/api/health')).data.status, 'ok');
  assert.match((await call('GET', '/api/metrics')).data, /lostfound_requests_total/);
  assert.equal((await call('GET', '/api/nope', { token: tokens.admin })).status, 404);
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
});

test('login is rate limited after repeated failures', async () => {
  let last;
  for (let i = 0; i < 12; i += 1) last = await call('POST', '/api/auth/login', { body: { email: 'victim@sru.edu.in', password: 'nope' } });
  assert.equal(last.status, 429);
});
