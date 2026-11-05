'use strict';
// Loads realistic demo data through the public API (used for screenshots / demos).
// Usage: BASE_URL=http://localhost:3000 node scripts/seed-demo.js [path-to-sample-image.png]
const fs = require('node:fs');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const image = process.argv[2] && fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2]) : null;

async function call(method, path, token, body, form) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.error || ''}`);
  return data;
}
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
function form(o, withImage) {
  const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.append(k, v));
  if (withImage && image) f.append('image', new Blob([image], { type: 'image/png' }), 'photo.png');
  return f;
}
async function login(email, password) { return (await call('POST', '/api/auth/login', null, { email, password })).token; }

(async () => {
  for (const [name, email, dept] of [['Fartun Mohamed', 'fartun@sru.edu.in', 'CSE (Cybersecurity)'], ['Ravi Kumar', 'ravi@sru.edu.in', 'ECE'], ['Anjali Rao', 'anjali@sru.edu.in', 'CSE']]) {
    await call('POST', '/api/auth/register', null, { name, email, password: 'Student@123', department: dept }).catch(() => {});
  }
  const fartun = await login('fartun@sru.edu.in', 'Student@123');
  const ravi = await login('ravi@sru.edu.in', 'Student@123');
  const anjali = await login('anjali@sru.edu.in', 'Student@123');
  const officer = await login('officer@sru.edu.in', process.env.OFFICER_PASSWORD || 'Officer@123');

  const lost = await call('POST', '/api/items', fartun, null, form({ report_type: 'lost', title: 'Blue steel water bottle', description: 'Blue steel bottle with a white SRU sticker on the lid, left after the afternoon lab session.', category_id: 7, location_id: 4, report_date: day(2) }, true));
  await call('POST', '/api/items', fartun, null, form({ report_type: 'lost', title: 'Casio fx-991 calculator', description: 'Grey scientific calculator with a cracked corner and initials FMF on the back.', category_id: 3, location_id: 2, report_date: day(5) }));
  const f1 = await call('POST', '/api/items', ravi, null, form({ report_type: 'found', title: 'Blue water bottle', description: 'Steel water bottle with a sticker on the lid found on a bench in the lab block.', category_id: 7, location_id: 4, report_date: day(1), custody: 'Handed over to Security Office' }, true));
  const f2 = await call('POST', '/api/items', ravi, null, form({ report_type: 'found', title: 'Black laptop charger', description: 'Dell 65W charger with a velcro strap, found on a library reading table.', category_id: 2, location_id: 3, report_date: day(3), custody: 'Library help desk' }));
  const f3 = await call('POST', '/api/items', anjali, null, form({ report_type: 'found', title: 'Hostel room keys', description: 'Three keys on a red lanyard found in the hostel common room.', category_id: 5, location_id: 7, report_date: day(4), custody: 'Warden office' }));
  await call('POST', '/api/items', anjali, null, form({ report_type: 'found', title: 'Student ID card', description: 'SRU student ID card found near the cafeteria billing counter.', category_id: 1, location_id: 5, report_date: day(6), custody: 'Security Office' }));
  await call('POST', '/api/items', ravi, null, form({ report_type: 'lost', title: 'Black umbrella', description: 'Large black folding umbrella with a wooden handle, lost in the sports complex.', category_id: 6, location_id: 6, report_date: day(8) }));

  const c1 = await call('POST', `/api/items/${f1.item_id}/claims`, fartun, null, form({ claim_description: 'This is my bottle. The white SRU sticker is slightly peeled at one corner and there is a dent near the base.' }, true));
  await call('PATCH', `/api/claims/${c1.claim_id}/review`, officer, { decision: 'approve', note: 'Details match the item.' }, null);
  const c2 = await call('POST', `/api/items/${f3.item_id}/claims`, fartun, null, form({ claim_description: 'Keys are my hostel room keys; the lanyard has a small Hyderabad Metro tag on it.' }));
  await call('PATCH', `/api/claims/${c2.claim_id}/review`, officer, { decision: 'more_info', note: 'Which room number do the keys belong to?' }, null);
  await call('POST', `/api/items/${f2.item_id}/claims`, anjali, null, form({ claim_description: 'My Dell 65W charger; the cable has a blue cable tie near the plug and 4821 on the label.' }));
  console.log('Demo data loaded. Lost item ref:', lost.reference);
})().catch((e) => { console.error(e.message); process.exit(1); });
