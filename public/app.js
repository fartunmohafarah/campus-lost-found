'use strict';
/* Smart Campus Lost & Found – single-page frontend (no inline scripts/styles: CSP-safe). */

const state = { token: sessionStorage.getItem('lf_token'), user: JSON.parse(sessionStorage.getItem('lf_user') || 'null'), meta: null };
const $main = document.getElementById('main');

// ---------- helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const label = (text, control, hint) => h('div', {}, h('label', { for: control.id }, text), control, hint && h('div', { class: 'hint' }, hint));
const badge = (text) => h('span', { class: `badge ${text}` }, String(text).replace('_', ' '));
const fmtDate = (s) => (s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: s.length > 10 ? 'short' : undefined }) : '');
const today = () => new Date().toISOString().slice(0, 10);

let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

async function api(method, path, body, isForm) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let payload;
  if (isForm) payload = body; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 401 && state.token && !path.startsWith('/api/auth/login')) { logout(true); throw new Error('Your session has expired. Please log in again.'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || 'Request failed.');
  return data;
}
async function blobUrl(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
async function download(path, filename) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) return toast('Could not download the report.', true);
  const a = h('a', { href: URL.createObjectURL(await res.blob()), download: filename });
  document.body.append(a); a.click(); a.remove();
}
const showErr = (box, e) => { box.replaceChildren(h('div', { class: 'alert error', role: 'alert' }, e.message)); };
function guard(fn, box) { return async (ev) => { ev?.preventDefault?.(); try { box?.replaceChildren(); await fn(ev); } catch (e) { if (box) showErr(box, e); else toast(e.message, true); } }; }

function setSession(token, user) {
  state.token = token; state.user = user;
  if (token) { sessionStorage.setItem('lf_token', token); sessionStorage.setItem('lf_user', JSON.stringify(user)); }
  else { sessionStorage.removeItem('lf_token'); sessionStorage.removeItem('lf_user'); }
}
function logout(expired) { setSession(null, null); location.hash = '#/login'; if (expired) toast('Session expired. Please log in again.', true); renderChrome(); }

async function loadMeta() { state.meta = await api('GET', '/api/meta'); return state.meta; }
const catSelect = (id, includeAll) => h('select', { id }, includeAll && h('option', { value: '' }, 'All categories'), state.meta.categories.map((c) => h('option', { value: c.category_id }, c.category_name)));
const locSelect = (id, includeAll) => h('select', { id }, includeAll && h('option', { value: '' }, 'All locations'), state.meta.locations.map((l) => h('option', { value: l.location_id }, `${l.building} – ${l.area_name}`)));
const isStaff = () => state.user && ['officer', 'admin'].includes(state.user.role);

// ---------- chrome ----------
function renderChrome() {
  const nav = document.getElementById('nav'); const who = document.getElementById('who');
  nav.replaceChildren(); who.replaceChildren();
  if (!state.user) return;
  const links = [['#/dashboard', 'Dashboard'], ['#/report/lost', 'Report Lost'], ['#/report/found', 'Report Found'], ['#/browse', 'Browse'], ['#/my', 'My Reports & Claims']];
  if (isStaff()) links.push(['#/review', 'Officer Review']);
  if (state.user.role === 'admin') links.push(['#/admin', 'Admin']);
  const cur = location.hash.split('/').slice(0, 2).join('/');
  links.forEach(([href, text]) => nav.append(h('a', { href, 'aria-current': cur === href.split('/').slice(0, 2).join('/') ? 'page' : false }, text)));
  who.append(h('span', {}, state.user.name), h('span', { class: 'role' }, state.user.role), h('button', { class: 'secondary small', onclick: () => logout() }, 'Log out'));
}

// ---------- screen 1: login / registration ----------
function screenLogin() {
  const err = h('div'); let mode = 'login';
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: 8 });
  const name = h('input', { id: 'rname', autocomplete: 'name', minlength: 2, maxlength: 80 });
  const dept = h('input', { id: 'rdept', maxlength: 80 });
  const extra = h('div', { hidden: true }, label('Full name', name), label('Department / programme', dept));
  const submit = h('button', { type: 'submit' }, 'Log in');
  const toggle = h('button', { type: 'button', class: 'secondary' }, 'Create an account');
  const title = h('h2', {}, 'Log in');
  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    extra.hidden = mode === 'login'; title.textContent = mode === 'login' ? 'Log in' : 'Register as Student / Staff';
    submit.textContent = mode === 'login' ? 'Log in' : 'Register'; toggle.textContent = mode === 'login' ? 'Create an account' : 'I already have an account';
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password'; err.replaceChildren();
  });
  const form = h('form', { class: 'card auth', onsubmit: guard(async () => {
    if (mode === 'register') {
      await api('POST', '/api/auth/register', { name: name.value, email: email.value, password: password.value, department: dept.value });
      toast('Account created. Logging you in…');
    }
    const r = await api('POST', '/api/auth/login', { email: email.value, password: password.value });
    setSession(r.token, r.user); renderChrome(); location.hash = '#/dashboard';
  }, err) },
  title, extra, label('Email', email), label('Password', password, 'At least 8 characters with a letter and a number.'), err, h('div', { class: 'actions' }, submit, toggle));
  $main.replaceChildren(h('h1', {}, 'Smart Campus Lost & Found'), h('p', { class: 'sub' }, 'Report, search and reclaim lost belongings across the SR University campus.'), form);
}

// ---------- screen 2: dashboard ----------
const CARD_LABELS = { my_reports: 'My reports', my_open_reports: 'My open reports', my_claims: 'My claims', claims_need_info: 'Claims needing my reply', open_found_items: 'Found items on hold', open_lost_reports: 'Open lost reports', pending_claims: 'Claims awaiting review', awaiting_handover: 'Approved – awaiting handover', returned_items: 'Items returned', active_users: 'Active users' };
async function screenDashboard() {
  const d = await api('GET', '/api/reports/dashboard');
  const cards = Object.entries(d.cards).map(([k, v]) => h('div', { class: 'card stat' }, h('div', { class: 'n' }, v), h('div', { class: 'l' }, CARD_LABELS[k] || k)));
  const quick = h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/report/lost' }, 'Report a lost item'), h('a', { class: 'btn secondary', href: '#/report/found' }, 'Report a found item'), h('a', { class: 'btn secondary', href: '#/browse' }, 'Browse items'),
    isStaff() && h('a', { class: 'btn secondary', href: '#/review' }, 'Review claims'));
  const recent = d.recent && h('div', { class: 'card' }, h('h2', {}, 'Recent activity'), d.recent.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'Action', 'Detail'].map((t) => h('th', {}, t)))),
    h('tbody', {}, d.recent.map((r) => h('tr', {}, h('td', {}, fmtDate(r.timestamp)), h('td', {}, r.actor || '—'), h('td', {}, r.action.replaceAll('_', ' ').toLowerCase()), h('td', {}, r.detail || '')))))) : h('p', { class: 'empty' }, 'No activity yet.'));
  $main.replaceChildren(h('h1', {}, `Welcome, ${state.user.name.split(' ')[0]}`), h('p', { class: 'sub' }, `Signed in as ${state.user.role}.`), h('div', { class: 'grid cards' }, cards), h('div', { class: 'card' }, h('h2', {}, 'Quick actions'), quick), ...(recent ? [recent] : []));
}

// ---------- screens 3 & 4: report lost / found ----------
async function screenReport(type) {
  await loadMeta(); const err = h('div');
  const title = h('input', { id: 'title', required: true, minlength: 3, maxlength: 100 });
  const desc = h('textarea', { id: 'desc', required: true, minlength: 10, maxlength: 1000 });
  const cat = catSelect('cat'); const loc = locSelect('loc');
  const date = h('input', { id: 'date', type: 'date', required: true, max: today(), value: today() });
  const custody = type === 'found' ? h('input', { id: 'custody', required: true, minlength: 3, maxlength: 200 }) : null;
  const image = h('input', { id: 'image', type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const form = h('form', { class: 'card', novalidate: true, onsubmit: guard(async () => {
    const f = new FormData();
    f.append('report_type', type); f.append('title', title.value); f.append('description', desc.value); f.append('category_id', cat.value); f.append('location_id', loc.value); f.append('report_date', date.value);
    if (custody) f.append('custody', custody.value);
    if (image.files[0]) f.append('image', image.files[0]);
    const r = await api('POST', '/api/items', f, true);
    toast(`Report ${r.reference} submitted.`); location.hash = `#/item/${r.item_id}`;
  }, err) },
  label(type === 'lost' ? 'What did you lose?' : 'What did you find?', title), label('Description', desc, type === 'lost' ? 'Colour, brand, marks. Avoid sharing private numbers.' : 'Describe it, but keep one identifying detail back so officers can verify the real owner.'),
  h('div', { class: 'row' }, label('Category', cat), label('Campus location', loc), label(type === 'lost' ? 'Date lost' : 'Date found', date)),
  custody && label('Where is it now (custody)?', custody, 'e.g. Handed to Library desk, kept at Security Office.'), label('Photo (optional)', image, 'JPEG, PNG or WebP, up to 2 MB.'), err, h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Submit report')));
  $main.replaceChildren(h('h1', {}, type === 'lost' ? 'Report a lost item' : 'Report a found item'), h('p', { class: 'sub' }, 'You will get a reference ID to track the report.'), form);
}

// ---------- screen 5: browse & search ----------
async function screenBrowse() {
  await loadMeta(); const results = h('div');
  const q = h('input', { id: 'q', type: 'search', placeholder: 'Search title, description or ID' });
  const type = h('select', { id: 'type' }, h('option', { value: '' }, 'Lost & found'), h('option', { value: 'lost' }, 'Lost only'), h('option', { value: 'found' }, 'Found only'));
  const cat = catSelect('fcat', true); const loc = locSelect('floc', true);
  const status = h('select', { id: 'fstatus' }, ['', 'open', 'claim_pending', 'returned', 'closed'].map((s) => h('option', { value: s }, s ? s.replace('_', ' ') : 'Any status')));
  const from = h('input', { id: 'from', type: 'date' }); const to = h('input', { id: 'to', type: 'date' });
  async function run() {
    const p = new URLSearchParams(); [['q', q], ['type', type], ['category_id', cat], ['location_id', loc], ['status', status], ['from', from], ['to', to]].forEach(([k, el]) => el.value && p.set(k, el.value));
    const d = await api('GET', `/api/items?${p}`);
    results.replaceChildren(h('p', { class: 'sub', 'aria-live': 'polite' }, `${d.total} item${d.total === 1 ? '' : 's'} found`), d.items.length ? h('div', { class: 'grid cards' }, d.items.map(itemCard)) : h('div', { class: 'card empty' }, 'No matching reports. Try widening your filters.'));
  }
  const form = h('form', { class: 'card', onsubmit: guard(run) }, h('div', { class: 'row' }, label('Search', q), label('Type', type), label('Category', cat), label('Location', loc)),
    h('div', { class: 'row' }, label('Status', status), label('From date', from), label('To date', to), h('div', {}, h('button', { type: 'submit' }, 'Search'))));
  $main.replaceChildren(h('h1', {}, 'Browse and search'), h('p', { class: 'sub' }, 'Contact details and claim evidence are never shown here.'), form, results);
  await run();
}
const itemCard = (i) => h('div', { class: 'card item' }, h('div', {}, badge(i.report_type), ' ', badge(i.status)),
  h('a', { href: `#/item/${i.item_id}` }, h('h3', {}, i.title)), h('div', { class: 'meta' }, `${i.reference} · ${i.category_name}`), h('div', { class: 'meta' }, `${i.building} – ${i.area_name} · ${fmtDate(i.report_date)}`));

// ---------- screen 6: item details + claim ----------
async function screenItem(id) {
  const { item } = await api('GET', `/api/items/${id}`);
  const err = h('div'); const panels = [];
  const imgBox = h('div');
  if (item.has_image) blobUrl(`/api/items/${id}/image`).then((u) => u && imgBox.append(h('img', { class: 'thumb', src: u, alt: `Photo of ${item.title}` })));
  const details = h('div', { class: 'card' }, h('div', {}, badge(item.report_type), ' ', badge(item.status)), h('h1', {}, item.title), imgBox,
    h('p', { class: 'pre' }, item.description),
    h('dl', { class: 'kv' }, h('dt', {}, 'Reference'), h('dd', {}, item.reference), h('dt', {}, 'Category'), h('dd', {}, item.category_name), h('dt', {}, 'Location'), h('dd', {}, `${item.building}${item.floor ? ', floor ' + item.floor : ''} – ${item.area_name}`),
      h('dt', {}, item.report_type === 'lost' ? 'Date lost' : 'Date found'), h('dd', {}, fmtDate(item.report_date)),
      item.custody && [h('dt', {}, 'Custody'), h('dd', {}, item.custody)], item.reporter && [h('dt', {}, 'Reported by'), h('dd', {}, `${item.reporter.name} (${item.reporter.email})`)]));
  panels.push(details);

  const canClaim = item.report_type === 'found' && ['open', 'claim_pending'].includes(item.status) && !item.is_owner && !(item.my_claim && ['pending', 'more_info', 'approved'].includes(item.my_claim.status));
  if (canClaim) {
    const d = h('textarea', { id: 'claimdesc', required: true, minlength: 15, maxlength: 1000 }); const ev = h('input', { id: 'evidence', type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    panels.push(h('form', { class: 'card', onsubmit: guard(async () => {
      const f = new FormData(); f.append('claim_description', d.value); if (ev.files[0]) f.append('image', ev.files[0]);
      await api('POST', `/api/items/${id}/claims`, f, true); toast('Claim submitted for officer review.'); location.hash = '#/my';
    }, err) }, h('h2', {}, 'This is mine – submit a claim'), h('p', { class: 'hint' }, 'Describe something only the owner would know (marks, contents, serial number). This is visible only to you and the officer.'),
    label('Ownership details', d), label('Evidence photo (optional)', ev, 'Receipt, matching photo, etc.'), err, h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Submit claim'))));
  } else if (item.my_claim) {
    panels.push(h('div', { class: 'card' }, h('h2', {}, 'Your claim'), badge(item.my_claim.status), item.my_claim.officer_note && h('p', {}, `Officer note: ${item.my_claim.officer_note}`)));
  }
  if (item.is_owner || isStaff()) {
    const box = h('div', { class: 'card' }, h('h2', {}, 'Possible matches'), h('p', { class: 'hint' }, 'Opposite-type reports in the same category, ranked by shared keywords and location.'));
    panels.push(box);
    api('GET', `/api/items/${id}/matches`).then((m) => box.append(m.matches.length ? h('div', { class: 'grid cards' }, m.matches.map((x) => h('div', {}, itemCard(x), h('div', { class: 'score' }, `Match score ${x.match_score}%`)))) : h('p', { class: 'empty' }, 'No likely matches yet.'))).catch(() => {});
  }
  const canStatus = (item.is_owner && item.report_type === 'lost') || isStaff();
  if (canStatus && !['returned'].includes(item.status)) {
    const opts = item.report_type === 'lost' ? [['returned', 'Mark as found / returned'], ['closed', 'Close report']] : [['closed', 'Close report'], ['open', 'Re-open']];
    panels.push(h('div', { class: 'card' }, h('h2', {}, 'Update status'), err, h('div', { class: 'actions' }, opts.filter(([s]) => s !== item.status).map(([s, t]) => h('button', { class: 'secondary', onclick: guard(async () => { await api('PATCH', `/api/items/${id}/status`, { status: s }); toast('Status updated.'); route(); }, err) }, t)))));
  }
  $main.replaceChildren(h('p', {}, h('a', { href: '#/browse' }, '← Back to browse')), ...panels);
}

// ---------- screen 7: my reports and claims ----------
async function screenMy() {
  const [items, claims] = await Promise.all([api('GET', '/api/items/mine'), api('GET', '/api/claims/mine')]);
  const reports = items.items.length ? h('div', { class: 'grid cards' }, items.items.map(itemCard)) : h('div', { class: 'card empty' }, 'You have not reported anything yet.');
  const claimCards = claims.claims.length ? claims.claims.map((c) => {
    const err = h('div'); const extra = h('textarea', { id: `extra${c.claim_id}`, minlength: 5, maxlength: 800 });
    return h('div', { class: 'card' }, h('div', {}, badge(c.status), ' ', h('strong', {}, c.title), ` (${c.reference})`), h('p', { class: 'hint' }, `Submitted ${fmtDate(c.created_at)} · ${c.building} – ${c.area_name}`),
      c.officer_note && h('div', { class: 'alert info' }, `Officer note: ${c.officer_note}`),
      c.status === 'more_info' && h('form', { onsubmit: guard(async () => { await api('PATCH', `/api/claims/${c.claim_id}/respond`, { additional_details: extra.value }); toast('Details sent to the officer.'); route(); }, err) }, label('Your reply to the officer', extra), err, h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Send details'))),
      c.status === 'approved' && h('div', { class: 'alert info' }, 'Approved! Visit the Lost & Found office with your campus ID to collect the item.'));
  }) : [h('div', { class: 'card empty' }, 'No claims yet. Open a found item and choose “This is mine”.')];
  $main.replaceChildren(h('h1', {}, 'My reports and claims'), h('h2', {}, 'My reports'), reports, h('h2', {}, 'My claims'), ...claimCards);
}

// ---------- screen 8: officer review panel ----------
async function screenReview() {
  if (!isStaff()) throw new Error('Officer access required.');
  const filter = h('select', { id: 'qstatus' }, [['pending', 'Pending'], ['more_info', 'Awaiting claimant'], ['approved', 'Approved – handover'], ['rejected', 'Rejected'], ['completed', 'Completed'], ['', 'All']].map(([v, t]) => h('option', { value: v }, t)));
  const list = h('div');
  async function load() {
    const d = await api('GET', `/api/claims${filter.value ? '?status=' + filter.value : ''}`);
    list.replaceChildren(...(d.claims.length ? d.claims.map(claimReviewCard) : [h('div', { class: 'card empty' }, 'Nothing in this queue.')]));
  }
  function claimReviewCard(c) {
    const err = h('div'); const note = h('input', { id: `note${c.claim_id}`, maxlength: 500, placeholder: 'Note (required to reject or request info)' }); const recv = h('input', { id: `recv${c.claim_id}`, maxlength: 80, placeholder: 'Received by (name)' });
    const evBox = h('div');
    const act = (decision) => guard(async () => { await api('PATCH', `/api/claims/${c.claim_id}/review`, { decision, note: note.value }); toast('Claim updated.'); load(); }, err);
    const actions = [];
    if (['pending', 'more_info'].includes(c.status)) actions.push(h('button', { class: 'ok', onclick: act('approve') }, 'Approve'), h('button', { class: 'secondary', onclick: act('more_info') }, 'Request more info'), h('button', { class: 'danger', onclick: act('reject') }, 'Reject'));
    if (c.status === 'approved') actions.push(h('button', { class: 'ok', onclick: guard(async () => { await api('POST', `/api/claims/${c.claim_id}/handover`, { received_by: recv.value }); toast('Handover recorded.'); load(); }, err) }, 'Record handover'));
    return h('div', { class: 'card' }, h('div', {}, badge(c.status), ' ', h('strong', {}, c.title), ` (${c.reference}) `, badge(c.item_status)),
      h('p', { class: 'hint' }, `Claimant: ${c.claimant_name} <${c.claimant_email}> · ${fmtDate(c.created_at)}`), h('p', { class: 'pre' }, c.claim_description), evBox,
      c.has_evidence && h('button', { class: 'secondary small', onclick: async (e) => { const u = await blobUrl(`/api/claims/${c.claim_id}/evidence`); if (u) { evBox.replaceChildren(h('img', { class: 'thumb', src: u, alt: 'Claim evidence' })); e.target.remove(); } } }, 'Show evidence photo'),
      h('p', {}, h('a', { href: `#/item/${c.item_id}` }, 'View item report')), c.officer_note && h('div', { class: 'alert info' }, `Note: ${c.officer_note}`),
      ['pending', 'more_info'].includes(c.status) && label('Officer note', note), c.status === 'approved' && label('Handover', recv), err, h('div', { class: 'actions' }, actions));
  }
  filter.addEventListener('change', guard(load));
  $main.replaceChildren(h('h1', {}, 'Officer review panel'), h('p', { class: 'sub' }, 'Verify ownership evidence, update claim status and arrange handover.'), h('div', { class: 'card' }, label('Queue', filter)), list);
  await load();
}

// ---------- screen 9: admin management & reports ----------
async function screenAdmin() {
  if (!isStaff()) throw new Error('Staff access required.');
  await loadMeta();
  const tabs = [['reports', 'Reports'], ...(state.user.role === 'admin' ? [['users', 'Users'], ['setup', 'Categories & locations'], ['audit', 'Audit log']] : [])];
  const body = h('div'); let current = 'reports';
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const views = { reports: viewReports, users: viewUsers, setup: viewSetup, audit: viewAudit };
  function drawTabs() { bar.replaceChildren(...tabs.map(([k, t]) => h('button', { class: 'secondary', role: 'tab', 'aria-selected': k === current ? 'true' : 'false', onclick: () => { current = k; drawTabs(); show(); } }, t))); }
  const show = guard(async () => { body.replaceChildren(await views[current]()); });
  drawTabs();
  $main.replaceChildren(h('h1', {}, state.user.role === 'admin' ? 'Admin management and reports' : 'Reports'), bar, body);
  await show();
}
const table = (cols, rows) => h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(([, t]) => h('th', {}, t)))), h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, cols.map(([k]) => h('td', {}, typeof k === 'function' ? k(r) : r[k] ?? '')))) : h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, 'No records.')))));
function barRows(rows) { const max = Math.max(1, ...rows.map((r) => r.total)); return table([['label', 'Name'], ['lost', 'Lost'], ['found', 'Found'], ['total', 'Total'], [(r) => { const b = h('div', { class: 'bar' }, h('span')); b.firstChild.style.width = `${Math.round((r.total / max) * 100)}%`; return b; }, '']], rows); }

async function viewReports() {
  const s = await api('GET', '/api/reports/summary'); const err = h('div');
  const type = h('select', { id: 'rtype' }, h('option', { value: '' }, 'Lost & found'), h('option', { value: 'lost' }, 'Lost'), h('option', { value: 'found' }, 'Found'));
  const cat = catSelect('rcat', true); const loc = locSelect('rloc', true);
  const status = h('select', { id: 'rstatus' }, ['', 'open', 'claim_pending', 'returned', 'closed'].map((v) => h('option', { value: v }, v ? v.replace('_', ' ') : 'Any status')));
  const from = h('input', { id: 'rfrom', type: 'date' }); const to = h('input', { id: 'rto', type: 'date' }); const out = h('div');
  const params = () => { const p = new URLSearchParams(); [['type', type], ['category_id', cat], ['location_id', loc], ['status', status], ['from', from], ['to', to]].forEach(([k, el]) => el.value && p.set(k, el.value)); return p; };
  const itemCols = [['reference', 'Ref'], ['report_type', 'Type'], ['title', 'Title'], ['category', 'Category'], ['location', 'Location'], ['report_date', 'Date'], ['status', 'Status'], ['reported_by', 'Reported by']];
  const run = guard(async () => { const d = await api('GET', `/api/reports/items?${params()}`); out.replaceChildren(h('p', { class: 'hint' }, `${d.rows.length} record(s)`), table(itemCols, d.rows)); }, err);
  const csv = (path, name) => h('button', { class: 'secondary small', onclick: () => download(path, `${name}.csv`) }, 'Export CSV');
  const pending = await api('GET', '/api/reports/pending-claims'); const returned = await api('GET', '/api/reports/returned');
  const t = s.totals;
  const wrap = h('div', {},
    h('div', { class: 'grid cards' }, [['Total reports', t.total], ['Lost', t.lost], ['Found', t.found], ['Returned', t.returned]].map(([l, n]) => h('div', { class: 'card stat' }, h('div', { class: 'n' }, n || 0), h('div', { class: 'l' }, l)))),
    h('div', { class: 'card' }, h('h2', {}, 'Lost and found items report'), h('form', { onsubmit: run }, h('div', { class: 'row' }, label('Type', type), label('Category', cat), label('Location', loc), label('Status', status), label('From', from), label('To', to)),
      h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Run report'), h('button', { type: 'button', class: 'secondary', onclick: () => download(`/api/reports/items?${params()}&format=csv`, 'lost-and-found-items.csv') }, 'Export CSV'))), err, out),
    h('div', { class: 'card' }, h('h2', {}, 'Pending claims report '), csv('/api/reports/pending-claims?format=csv', 'pending-claims'), table([['claim_id', 'Claim'], ['item_reference', 'Item'], ['item_title', 'Title'], ['claimant', 'Claimant'], ['status', 'Status'], [(r) => fmtDate(r.submitted_at), 'Submitted']], pending.rows)),
    h('div', { class: 'card' }, h('h2', {}, 'Returned items report '), csv('/api/reports/returned?format=csv', 'returned-items'), table([['item_reference', 'Item'], ['item_title', 'Title'], ['received_by', 'Received by'], ['handed_over_by', 'Handed over by'], [(r) => fmtDate(r.handover_time), 'When']], returned.rows)),
    h('div', { class: 'grid cols-2' }, h('div', { class: 'card' }, h('h2', {}, 'Category-wise summary'), barRows(s.by_category)), h('div', { class: 'card' }, h('h2', {}, 'Location-wise summary'), barRows(s.by_location))),
    h('div', { class: 'card' }, h('h2', {}, 'Monthly trend'), table([['label', 'Month'], ['total', 'Reports']], s.by_month)));
  run();
  return wrap;
}
async function viewUsers() {
  const { users } = await api('GET', '/api/admin/users'); const err = h('div');
  const row = (u) => {
    const role = h('select', { 'aria-label': `Role for ${u.name}` }, ['student', 'officer', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, r)));
    const status = h('select', { 'aria-label': `Status for ${u.name}` }, ['active', 'disabled'].map((r) => h('option', { value: r, selected: r === u.status }, r)));
    return [u.name, u.email, u.department || '—', role, status, h('button', { class: 'small', onclick: guard(async () => { await api('PATCH', `/api/admin/users/${u.user_id}`, { role: role.value, status: status.value }); toast('User updated.'); }, err) }, 'Save')];
  };
  return h('div', { class: 'card' }, h('h2', {}, 'User management'), err, h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Email', 'Department', 'Role', 'Status', ''].map((t) => h('th', {}, t)))), h('tbody', {}, users.map((u) => h('tr', {}, row(u).map((c) => h('td', {}, c))))))));
}
async function viewSetup() {
  await loadMeta(); const err = h('div');
  const cname = h('input', { id: 'cname', required: true, maxlength: 60 }); const cdesc = h('input', { id: 'cdesc', maxlength: 200 });
  const b = h('input', { id: 'lb', required: true, maxlength: 60 }); const f = h('input', { id: 'lf', maxlength: 20 }); const a = h('input', { id: 'la', required: true, maxlength: 60 });
  const del = (path) => h('button', { class: 'danger small', onclick: guard(async () => { await api('DELETE', path); toast('Deleted.'); screenAdmin(); }, err) }, 'Delete');
  return h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, h('h2', {}, 'Categories'), err, table([['category_name', 'Name'], [(c) => del(`/api/admin/categories/${c.category_id}`), '']], state.meta.categories),
      h('form', { onsubmit: guard(async () => { await api('POST', '/api/admin/categories', { category_name: cname.value, description: cdesc.value }); toast('Category added.'); screenAdmin(); }, err) }, label('New category', cname), label('Description', cdesc), h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Add category')))),
    h('div', { class: 'card' }, h('h2', {}, 'Campus locations'), table([[(l) => `${l.building}${l.floor ? ' (floor ' + l.floor + ')' : ''}`, 'Building'], ['area_name', 'Area'], [(l) => del(`/api/admin/locations/${l.location_id}`), '']], state.meta.locations),
      h('form', { onsubmit: guard(async () => { await api('POST', '/api/admin/locations', { building: b.value, floor: f.value, area_name: a.value }); toast('Location added.'); screenAdmin(); }, err) }, label('Building', b), label('Floor', f), label('Area', a), h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Add location')))));
}
async function viewAudit() {
  const { logs } = await api('GET', '/api/admin/audit?limit=100');
  return h('div', { class: 'card' }, h('h2', {}, 'Audit log (latest 100)'), table([[(l) => fmtDate(l.timestamp), 'When'], [(l) => l.actor || '—', 'Actor'], ['action', 'Action'], ['entity_type', 'Entity'], ['entity_id', 'ID'], ['detail', 'Detail']], logs));
}

// ---------- router ----------
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || (state.user ? 'dashboard' : 'login');
  renderChrome();
  if (!state.user && page !== 'login') { location.hash = '#/login'; return; }
  if (state.user && page === 'login') { location.hash = '#/dashboard'; return; }
  try {
    if (page === 'login') screenLogin();
    else if (page === 'dashboard') await screenDashboard();
    else if (page === 'report' && ['lost', 'found'].includes(parts[1])) await screenReport(parts[1]);
    else if (page === 'browse') await screenBrowse();
    else if (page === 'item' && parts[1]) await screenItem(parts[1]);
    else if (page === 'my') await screenMy();
    else if (page === 'review') await screenReview();
    else if (page === 'admin') await screenAdmin();
    else $main.replaceChildren(h('div', { class: 'card empty' }, 'Page not found. ', h('a', { href: '#/dashboard' }, 'Go to dashboard')));
  } catch (e) { $main.replaceChildren(h('div', { class: 'alert error', role: 'alert' }, e.message)); }
  $main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();
