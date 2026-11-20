// Cohort Compass frontend. Vanilla JS, hash router, no build step.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const DIMS = {
  workload: 'Workload', structure_over_time: 'How it changes over time', difficulty_hardest_part: 'Hardest part',
  career_impact: 'Career impact', networking: 'Networking / access to people', who_should_take: 'Who it\'s for',
  prep_prereqs: 'What to know first', hidden_value: 'Not in the official listing',
};
const QBANK = {
  workload: 'Roughly how many hours a week did {x} take, and did that change over time?',
  structure_over_time: 'How did {x} change from the first few weeks to the end?',
  difficulty_hardest_part: 'What was the hardest part of {x}, and what would have made it easier?',
  career_impact: 'Has {x} actually led to anything since: a job, a skill you use, a person you met?',
  networking: 'Who did you meet through {x}, and how easy was it to actually talk to them?',
  who_should_take: 'Who should do {x}, and who should skip it?',
  prep_prereqs: 'What should someone know or do before starting {x}?',
  hidden_value: "What's one thing about {x} you'd never learn from the official description?",
};
const PERSONAS = [
  { id: 'maya', name: 'Maya R.', tag: 'First-year business undergrad, undecided', text: 'I am Maya, a first-year business undergrad at Iowa, undecided. I am interested in both accounting and art and unsure how to combine them. I need help choosing a major and planning next semester.', resume: 'data/maya_fictional.txt' },
  { id: 'daniel', name: 'Daniel K.', tag: "MS Finance alum ('22), financial analyst", text: 'I am Daniel, MS Finance alum (2022), now a senior financial analyst in insurance FP&A. I want to move into a finance leadership role (FP&A manager). Open to coming back to Iowa for more education if it helps.', resume: 'data/daniel_fictional.txt' },
  { id: 'marcus', name: 'Marcus H.', tag: "Executive MBA '14, just relocated to Memphis", text: "I am Marcus Hale, Regional Operations Manager, Executive MBA '14. I just relocated to Memphis, Tennessee and don't know anyone. I want to build a strong professional network as quickly as possible and build skills to become an operations executive at my company or another.", resume: '' },
];

const DEV = () => localStorage.getItem('cc_dev') === '1';
document.body.classList.toggle('dev', DEV());
const S = { items: [], byId: {}, people: {}, threads: [], subs: [], log: [], live: false,
  gate: JSON.parse(localStorage.getItem('cc_gate') ?? 'false'), unlocked: localStorage.getItem('cc_unlocked') === '1' };

// ---------- data ----------
async function load() {
  const [items, com] = await Promise.all([fetch('data/items.json').then((r) => r.json()), fetch('data/community.json').then((r) => r.json())]);
  S.items = items; items.forEach((i) => (S.byId[i.id] = i));
  com.people.forEach((p) => (S.people[p.id] = p));
  S.threads = com.threads.map((t) => ({ ...t, source: 'seed' }));
  await refreshSubs();
  try { const st = await fetch('api/status').then((r) => r.json()); S.live = st.live; } catch { S.live = false; }
  const pill = $('#aiStatus'); pill.textContent = S.live ? 'AI: live' : 'AI: scripted fallback'; pill.className = 'pill devonly ' + (S.live ? 'live' : 'off');
  buildIndex();
}
async function refreshSubs() {
  try { S.subs = await fetch('api/submissions').then((r) => r.json()); } catch { S.subs = []; }
  // Published submissions become threads (human moderation is the gate)
  S.threads = S.threads.filter((t) => t.source === 'seed');
  for (const s of S.subs.filter((x) => x.status === 'published')) {
    const pid = 'u_' + s.id; S.people[pid] = { ...s.person, id: pid };
    S.threads.push({ id: s.id, item: s.item, person: pid, mode: s.mode, date: s.received?.slice(0, 10), turns: s.turns, source: 'community' });
  }
  buildIndex();
}
const threadsFor = (id) => S.threads.filter((t) => t.item === id);
const humanText = (t) => t.turns.filter((x) => x.r === 'h').map((x) => x.t).join(' ');

// ---------- retrieval (TF-IDF over items + threads) ----------
let IDX = null;
const STOP = new Set('a an the and or of to in for on at by with from is are was were be been i im me my we our you your it its this that as but if so not do did have has had can will would just like about into how what who when where which there their they them he she his her very really more most also than then too up out'.split(' '));
const tok = (s) => String(s).toLowerCase().replace(/[^a-z0-9:&+ ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(ing|ers|er|es|s)$/, '') || w);
function buildIndex() {
  const docs = [];
  for (const i of S.items) docs.push({ kind: 'item', id: i.id, text: [i.title, i.short, i.dept, i.type, (i.tags || []).join(' '), i.official?.description || '', i.official?.prereqs || ''].join(' ') });
  for (const t of S.threads) { const it = S.byId[t.item]; const p = S.people[t.person]; docs.push({ kind: 'thread', id: t.id, item: t.item, text: [it?.title, humanText(t), p?.headline, p?.biggest_factor].join(' ') }); }
  const df = {}; docs.forEach((d) => { d.tf = {}; tok(d.text).forEach((w) => (d.tf[w] = (d.tf[w] || 0) + 1)); Object.keys(d.tf).forEach((w) => (df[w] = (df[w] || 0) + 1)); });
  const N = docs.length; docs.forEach((d) => { d.vec = {}; let n = 0; for (const [w, c] of Object.entries(d.tf)) { const v = (1 + Math.log(c)) * Math.log(1 + N / df[w]); d.vec[w] = v; n += v * v; } d.norm = Math.sqrt(n) || 1; });
  IDX = { docs, df, N };
}
function retrieve(query) {
  const q = {}; tok(query).forEach((w) => (q[w] = (q[w] || 0) + 1));
  const qv = {}; let qn = 0; for (const [w, c] of Object.entries(q)) { if (!IDX.df[w]) continue; const v = c * Math.log(1 + IDX.N / IDX.df[w]); qv[w] = v; qn += v * v; } qn = Math.sqrt(qn) || 1;
  const scored = IDX.docs.map((d) => { let s = 0; for (const [w, v] of Object.entries(qv)) if (d.vec[w]) s += v * d.vec[w]; return { d, s: s / (qn * d.norm) }; }).filter((x) => x.s > 0);
  const itemScore = {};
  for (const { d, s } of scored) { const id = d.kind === 'item' ? d.id : d.item; itemScore[id] = (itemScore[id] || 0) + s * (d.kind === 'thread' ? 0.8 : 1); }
  const items = Object.entries(itemScore).sort((a, b) => b[1] - a[1]).map(([id, s]) => ({ item: S.byId[id], s })).filter((x) => x.item);
  const threads = scored.filter((x) => x.d.kind === 'thread').sort((a, b) => b.s - a.s).map((x) => S.threads.find((t) => t.id === x.d.id));
  return { items, threads };
}

// ---------- AI calls (server holds key + prompts) ----------
async function ai(task, payload, note = '') {
  const entry = { at: new Date().toLocaleTimeString(), task, note, payload, pending: true };
  S.log.unshift(entry); renderHood();
  let res;
  try { res = await fetch('api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, payload }) }).then((r) => r.json()); }
  catch (e) { res = { data: null, meta: { fallback: true, reason: 'network: ' + e.message } }; }
  Object.assign(entry, { pending: false, meta: res.meta || {}, data: res.data });
  renderHood();
  return res.data;
}
function renderHood() {
  $('#hoodCount').textContent = S.log.length;
  $('#hoodList').innerHTML = S.log.map((l) => `<div class="log"><div class="row between"><b>${esc(l.task)}</b><span>${l.at}</span></div>
    ${l.pending ? '<span class="spinner"></span> calling…' : `<div>${l.meta.fallback ? `<span class="fb">fallback: ${esc(l.meta.reason || '')}</span>` : `<span class="ok">live</span> · ${esc(l.meta.model)} · ${l.meta.ms} ms`}${l.meta.dropped_citations ? ` · <span class="fb">grounding check removed ${l.meta.dropped_citations} unsupported citation(s)</span>` : ''}</div>`}
    ${l.note ? `<div class="small">${esc(l.note)}</div>` : ''}
    <details><summary>request</summary><pre>${esc(JSON.stringify(l.payload, null, 1).slice(0, 4000))}</pre></details>
    ${l.data ? `<details><summary>response</summary><pre>${esc(JSON.stringify(l.data, null, 1))}</pre></details>` : ''}</div>`).join('') || '<p class="small">No calls yet.</p>';
}
$('#hoodBtn').onclick = () => { const h = $('#hood'); h.hidden = !h.hidden; $('#hoodBtn').setAttribute('aria-expanded', String(!h.hidden)); };
$('#hoodClose').onclick = () => { $('#hood').hidden = true; };

// ---------- shared bits ----------
const badgeText = (i) => (i.type === 'course' ? i.id.split(':')[0] : ({ networking: 'NET', speaker: 'TALK', workshop: 'WKSP', trek: 'TREK', resource: 'RES', office: 'HELP', certificate: 'CERT', degree_program: 'DEG', office_hours: 'OH', 'talk series': 'TALK', opportunity: 'OPP' }[i.type] || 'EVT'));
const itemLink = (id) => { const i = S.byId[id]; return i ? `<a class="chip" href="#/item/${encodeURIComponent(id)}">${esc(i.type === 'course' ? i.id + ' ' + i.short : i.short)}</a>` : ''; };
const fmtDate = (s) => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (s.length > 10 ? ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''); };
function resultRow(i) {
  const n = threadsFor(i.id).length;
  const sub = i.type === 'course' ? `${esc(i.dept)} · ${esc((i.official.terms || []).join(', ') || i.level)}` : `${esc(i.type.replace('_', ' '))}${i.official.start ? ' · ' + fmtDate(i.official.start) : ''}`;
  return `<a class="result" href="#/item/${encodeURIComponent(i.id)}"><div class="badge">${badgeText(i)}</div><div><div class="type">${esc(i.type.replace('_', ' '))}</div><b>${esc(i.title)}</b><div class="small">${sub}</div></div><div class="count" style="margin-left:auto">${n ? `${n} experience${n > 1 ? 's' : ''}` : 'no experiences yet'}</div></a>`;
}
function whoBlock(p, small = false) {
  if (!p) return '';
  return `<div class="row between wrap"><a class="who" href="#/person/${encodeURIComponent(p.id)}"><span class="av">${esc(p.avatar || (p.name || '?').slice(0, 2))}</span><span><b>${esc(p.name)}</b> <span class="small">${esc(p.stage === 'alum' ? 'alum ' + (p.grad_year || '') : 'student')}</span><br><span class="small">${esc(p.headline)}</span></span></a>
  ${!small && p.resume_public && p.resume ? `<button class="chip" data-resume="${esc(p.id)}">Resume ↗</button>` : ''}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-resume]'); if (!b) return;
  const p = S.people[b.dataset.resume]; if (!p) return;
  const url = URL.createObjectURL(new Blob([p.resume], { type: 'text/plain' })); window.open(url, '_blank');
});
function bubbles(turns) { return `<div class="bubbles">${turns.map((x) => `<div class="b ${x.r === 'ai' ? 'ai' : 'h'}">${esc(x.t)}</div>`).join('')}</div>`; }
function coverage(id) {
  const c = Object.fromEntries(Object.keys(DIMS).map((d) => [d, 0]));
  for (const t of threadsFor(id)) { const seen = new Set(); t.turns.forEach((x) => x.dim && c[x.dim] !== undefined && seen.add(x.dim)); seen.forEach((d) => c[d]++); }
  return c;
}
const thinDims = (id) => { const c = coverage(id); return Object.keys(DIMS).sort((a, b) => c[a] - c[b]).filter((d) => c[d] <= 1); };

// ---------- views ----------
function home() {
  const discussed = [...new Set(S.threads.map((t) => t.item))].map((id) => S.byId[id]).filter(Boolean).sort((a, b) => threadsFor(b.id).length - threadsFor(a.id).length).slice(0, 8);
  const now = Date.now();
  const upcoming = S.items.filter((i) => i.official.start && new Date(i.official.start) > now - 864e5).sort((a, b) => new Date(a.official.start) - new Date(b.official.start)).slice(0, 5);
  const depts = [...new Set(S.items.map((i) => i.dept))].filter(Boolean);
  view.innerHTML = `
  <section class="hero"><h1>The course listing tells you what it covers. <em>The cohort tells you what it was like.</em></h1>
  <p>Students and alumni share what classes, events, clubs, and labs were actually like, by talking, not filling out forms. The Compass turns that into advice for whoever comes next, from first semester through your career.</p>
  <form class="big-search" id="bigSearch"><input id="bq" placeholder="Try “Discrete Structures”, “networking after relocating”, “FP&A leadership”"><button class="btn dark">Search</button></form></section>
  <div class="grid g3" style="margin:22px 0 34px">
    <a class="card entry" href="#/compass"><div class="ico">🧭</div><h3>Ask the Compass</h3><p class="small">Tell it where you are and where you're going. Get a plan built from what people like you actually did, with every step cited.</p></a>
    <a class="card entry" href="#/contribute"><div class="ico">🎙️</div><h3>Share what it was like</h3><p class="small">Talk for two minutes. An AI interviewer asks follow-ups about what nobody has told us yet. Stop whenever you want.</p></a>
    <a class="card entry" href="#/search?q="><div class="ico">🔎</div><h3>Browse everything</h3><p class="small">${S.items.length} real UIowa courses, events, certificates, and opportunities.</p></a>
  </div>
  <div class="split"><section><h2>Most discussed</h2>${discussed.map(resultRow).join('')}</section>
  <section><h2>Coming up</h2><p class="small">Real events from Tippie and University of Iowa calendars.</p>${upcoming.map(resultRow).join('')}
  <h3 style="margin-top:24px">Browse by area</h3><div class="chips">${depts.map((d) => `<a class="chip" href="#/search?dept=${encodeURIComponent(d)}">${esc(d)}</a>`).join('')}</div></section></div>`;
  $('#bigSearch').onsubmit = (e) => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent($('#bq').value); };
}

function search(params) {
  const q = params.get('q') || '', dept = params.get('dept') || '', type = params.get('type') || '';
  let list = q.trim() ? retrieve(q).items.map((x) => x.item) : [...S.items].sort((a, b) => threadsFor(b.id).length - threadsFor(a.id).length);
  if (dept) list = list.filter((i) => i.dept === dept);
  if (type) list = list.filter((i) => (type === 'course' ? i.type === 'course' : i.type !== 'course'));
  const qs = (o) => '#/search?' + new URLSearchParams({ q, dept, type, ...o }).toString();
  view.innerHTML = `<h1>${q ? `Results for “${esc(q)}”` : dept ? esc(dept) : 'Everything'}</h1>
  <div class="chips" style="margin-bottom:10px"><a class="chip ${!type ? 'on' : ''}" href="${qs({ type: '' })}">All</a><a class="chip ${type === 'course' ? 'on' : ''}" href="${qs({ type: 'course' })}">Courses</a><a class="chip ${type === 'other' ? 'on' : ''}" href="${qs({ type: 'other' })}">Events & opportunities</a></div>
  ${q ? `<p class="small devonly">Ranked by TF-IDF match over official listings <i>and</i> what contributors said, so “relocated, need a network” finds I-Clubs even though the listing never says “relocated”.</p>` : ''}
  ${list.map(resultRow).join('') || '<p>No matches. Try different words.</p>'}`;
}

async function itemPage(id, params) {
  const i = S.byId[id]; if (!i) { view.innerHTML = '<p>Not found.</p>'; return; }
  const ts = threadsFor(id); const cov = coverage(id); const maxc = Math.max(1, ...Object.values(cov)); const thin = thinDims(id);
  const locked = S.gate && !S.unlocked;
  const off = i.official;
  view.innerHTML = `<div class="type">${esc(i.type.replace('_', ' '))} · ${esc(i.dept)}</div><h1>${esc(i.title)}</h1>
  <div class="row wrap" style="margin-bottom:18px"><a class="btn" href="#/contribute?item=${encodeURIComponent(id)}">🎙️ Share your experience with this</a>${i.url ? `<a class="btn ghost" href="${esc(i.url)}" target="_blank" rel="noopener">Official listing ↗</a>` : ''}</div>
  <div class="split">
   <div>
    <div class="card official"><b>What the official listing says</b><dl>
     ${i.type === 'course' ? `${off.description ? `<dt>Catalog description</dt><dd>${esc(off.description)}</dd>` : ''}${(off.terms || []).length ? `<dt>Terms offered (from syllabi)</dt><dd>${esc(off.terms.join(', '))}</dd>` : ''}<dt>Prerequisites</dt><dd>${esc(off.prereqs)}</dd><dt>Level</dt><dd>${esc(i.level)}</dd>` : `<dt>Description</dt><dd>${esc(off.description || 'n/a')}</dd>${off.start ? `<dt>When</dt><dd>${fmtDate(off.start)}</dd>` : ''}`}
     ${(i.tags || []).length ? `<dt>Tags</dt><dd>${esc(i.tags.join(', '))}</dd>` : ''}</dl>
     </div>
    <div class="card" style="margin-top:16px" id="sumCard"><b>What the cohort says</b> <span class="small">(AI summary of the experiences, with sources)</span><div id="sum" style="margin-top:8px"></div></div>
    <div class="card devonly" style="margin-top:16px"><b>What we still don't know</b><p class="small">Coverage by topic across ${ts.length} experience${ts.length === 1 ? '' : 's'}. The interviewer asks the next contributor about the thin ones first.</p>
     <div class="cov">${Object.entries(DIMS).map(([d, label]) => `<span class="${cov[d] <= 1 ? 'thin' : ''}">${label}</span><span class="bar"><i style="width:${(cov[d] / maxc) * 100}%"></i></span><span>${cov[d]}</span>`).join('')}</div>
     ${ts.length < 5 ? `<p class="small">Numeric averages (like typical hours per week) only appear once 5+ people have contributed, to protect contributors' anonymity.</p>` : ''}</div>
   </div>
   <div><h2>Experiences (${ts.length})</h2>
    ${ts.length ? ts.map((t, k) => threadCard(t, locked && k > 0)).join('') : `<div class="card"><p>Nobody has shared this one yet. You could be first. The interviewer will start with: <i>“${esc(QBANK[thin[0] || 'hidden_value'].replace('{x}', i.short))}”</i></p></div>`}
   </div></div>`;
  const hl = params.get('t'); if (hl) { const el = document.getElementById('th_' + hl); if (el) { el.classList.add('hl'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
  renderSummary(i, ts);
}
function threadCard(t, locked) {
  const p = S.people[t.person];
  const placeholder = [{ r: 'ai', t: 'Locked question placeholder text here.' }, { r: 'h', t: 'Locked answer placeholder. The real text is not in the page until you unlock.' }];
  return `<div class="card thread ${locked ? 'locked' : ''}" id="th_${esc(t.id)}">${whoBlock(p)}
   <div class="small" style="margin-top:6px">${esc({ interview: 'AI-led interview', rant: 'Free-form, then AI follow-ups', template: 'Structured template' }[t.mode] || t.mode)} · ${esc(t.date || '')}${t.source === 'community' ? ' · approved by staff' : ''}</div>
   ${bubbles(locked ? placeholder : t.turns)}
   ${locked ? `<div class="gate"><div class="card"><b>Share one experience to unlock the rest</b><p class="small">Give-to-get keeps this full of real info. Any course, event, club, or job counts.</p><a class="btn" href="#/contribute">Share yours (2 min)</a></div></div>` : ''}</div>`;
}
const sumCache = {};
async function renderSummary(i, ts) {
  const el = $('#sum'); if (!el) return;
  if (!ts.length) { el.innerHTML = '<p class="small">No experiences yet.</p>'; return; }
  const key = i.id + ':' + ts.map((t) => t.id).join(',');
  let out = sumCache[key];
  if (!out) {
    el.innerHTML = '<span class="spinner"></span> reading the threads…';
    const payload = { item: { id: i.id, title: i.title }, threads: ts.map((t) => ({ id: t.id, contributor: S.people[t.person]?.headline, text: t.turns.map((x) => (x.r === 'ai' ? 'Q: ' : 'A: ') + x.t).join('\n') })) };
    out = await ai('summarize', payload, `${ts.length} thread(s) about ${i.id}`);
    if (!out || !(out.claims || []).length) out = scriptedSummary(ts);
    sumCache[key] = out;
  }
  if (!$('#sum')) return;
  const cite = (tid) => `<a class="cite" href="#/item/${encodeURIComponent(i.id)}?t=${tid}">${esc(S.people[S.threads.find((t) => t.id === tid)?.person]?.name || tid)}</a>`;
  $('#sum').innerHTML = `<ul class="claims">${out.claims.map((c) => `<li><span class="dim">${esc(DIMS[c.dimension] || c.dimension || '')}</span>${esc(c.text)} ${c.threads.map(cite).join('')}</li>`).join('')}</ul>
   ${out.best_for ? `<p><b>Best for:</b> ${esc(out.best_for)}</p>` : ''}${out.watch_out ? `<p><b>Watch out:</b> ${esc(out.watch_out)}</p>` : ''}`;
}
function scriptedSummary(ts) {
  const claims = [];
  for (const t of ts) for (let k = 0; k < t.turns.length - 1; k++) {
    const q = t.turns[k], a = t.turns[k + 1];
    if (q.r === 'ai' && a.r === 'h' && claims.length < 6) claims.push({ dimension: q.dim === 'open' ? 'hidden_value' : q.dim, text: a.t.split(/(?<=[.!?])\s/)[0].slice(0, 160), threads: [t.id] });
  }
  return { claims };
}

function personPage(id) {
  const p = S.people[id]; if (!p) { view.innerHTML = '<p>Not found.</p>'; return; }
  const ts = S.threads.filter((t) => t.person === id);
  view.innerHTML = `<div class="split"><div class="card">${whoBlock(p)}<p class="small" style="margin-top:10px">${esc(p.program || '')}</p>
    ${p.biggest_factor ? `<div class="notice"><b>Biggest factor in my path:</b> ${esc(p.biggest_factor)}</div>` : ''}
    ${(p.path || []).length ? `<h3 style="margin-top:16px">Path</h3><div class="timeline">${p.path.map((x) => `<div><b>${esc(x.when)}</b> ${esc(x.what)}</div>`).join('')}</div>` : ''}
    <p class="small" style="margin-top:14px">${p.resume_public ? 'Resume is public (contact info removed).' : 'Resume kept private: used only to tailor interview questions.'}</p></div>
   <div><h2>Shared about ${ts.length} thing${ts.length === 1 ? '' : 's'}</h2>${ts.map((t) => `<div class="card thread"><div class="row between"><div>${itemLink(t.item)}</div><a class="small" href="#/item/${encodeURIComponent(t.item)}?t=${t.id}">open thread →</a></div>${bubbles(t.turns.slice(0, 2))}</div>`).join('')}</div></div>`;
}

// ---------- Compass (advisor) ----------
let compassSel = null;
function meText(me) {
  const took = (me.shared || []).map((id) => S.byId[id]?.title).filter(Boolean);
  return `I am ${me.name}, ${me.headline} (${me.stage === 'alum' ? 'alum' : 'current student'}).` + (took.length ? ` I already took: ${took.join('; ')}, so don't recommend those again.` : '') + (me.said?.length ? ` What I said about it: "${me.said.join(' ').slice(0, 600)}"` : '') + (me.resume ? `\nMy resume (contact info removed):\n${me.resume.slice(0, 1800)}` : '') + `\nWhat should I do next, in classes and outside them?`;
}
function compass(params = new URLSearchParams()) {
  const me = getMe();
  view.innerHTML = `<h1>Ask the Compass</h1><p class="muted">Tell it where you are and where you want to go. You'll get a plan built from what people like you actually did.</p>
  <div class="grid g3">${me ? `<button class="card persona" data-p="me" style="border:2px solid var(--ink)"><div class="type">Your profile</div><b>${esc(me.name)}</b><div class="small">${esc(me.headline)}${(me.shared || []).length ? ` · shared ${me.shared.length}` : ''}</div></button>` : ''}${PERSONAS.map((p) => `<button class="card persona" data-p="${p.id}"><div class="type">Fictional test profile</div><b>${esc(p.name)}</b><div class="small">${esc(p.tag)}</div></button>`).join('')}</div>
  <textarea class="plain" id="cq" rows="4" style="margin-top:14px" placeholder="Or describe your situation and goal…"></textarea>
  <div class="row" style="margin-top:10px"><button class="btn dark" id="cgo">Build my plan</button><span class="small devonly" id="cinfo"></span></div>
  <div id="cout" style="margin-top:22px"></div>`;
  view.querySelectorAll('.persona').forEach((b) => (b.onclick = () => { view.querySelectorAll('.persona').forEach((x) => x.classList.remove('on')); b.classList.add('on'); compassSel = b.dataset.p === 'me' ? { text: meText(me) } : PERSONAS.find((p) => p.id === b.dataset.p); $('#cq').value = compassSel.text; }));
  $('#cgo').onclick = runCompass;
  if (me && params.get('me')) { view.querySelector('[data-p=me]').click(); runCompass(); }
}
async function runCompass() {
  const q = $('#cq').value.trim(); if (!q) return;
  const out = $('#cout'); out.innerHTML = '<span class="spinner"></span> retrieving and planning…';
  const r = retrieve(q);
  const items = r.items.slice(0, 10).map((x) => x.item);
  const tset = new Map(); r.threads.slice(0, 8).forEach((t) => tset.set(t.id, t)); items.slice(0, 6).forEach((i) => threadsFor(i.id).slice(0, 2).forEach((t) => tset.set(t.id, t)));
  const threads = [...tset.values()].slice(0, 14);
  threads.forEach((t) => { if (!items.includes(S.byId[t.item])) items.push(S.byId[t.item]); });
  $('#cinfo').textContent = `retrieved ${items.length} items and ${threads.length} threads`;
  const ctx = {
    items: items.map((i) => ({ id: i.id, title: i.title, type: i.type, level: i.level, official: i.official.description || `prereqs: ${i.official.prereqs || 'none'}; terms: ${(i.official.terms || []).join(', ')}`, when: i.official.start || null })),
    threads: threads.map((t) => ({ id: t.id, item_id: t.item, person_id: t.person, contributor: S.people[t.person]?.headline, contributor_path: (S.people[t.person]?.path || []).map((x) => x.what).join(' → '), text: humanText(t) })),
  };
  let plan = await ai('advise', { profile_and_question: q, today: new Date().toISOString().slice(0, 10), context: ctx }, `retrieved ${items.length} items / ${threads.length} threads by TF-IDF`);
  let scripted = false;
  if (!plan || !(plan.steps || []).length) { scripted = true; const top = r.items[0]?.s || 0; plan = scriptedPlan(r.items.filter((x) => !q.includes('already took: ' ) || !q.split('already took:')[1]?.split('so don')[0].includes(x.item.id)).filter((x) => x.s >= top * 0.6).slice(0, 3).map((x) => x.item), threads); }
  const tlink = (tid) => { const t = S.threads.find((x) => x.id === tid); if (!t) return ''; return `<a class="cite" href="#/item/${encodeURIComponent(t.item)}?t=${tid}">${esc(S.people[t.person]?.name)} on ${esc(S.byId[t.item]?.short)}</a>`; };
  out.innerHTML = `<div class="card"><h2>${esc(plan.headline || 'Your plan')}</h2>${scripted ? '<p class="small devonly">(scripted fallback: AI unavailable, steps chosen by retrieval only)</p>' : ''}
   <div class="steps">${plan.steps.map((s) => `<div class="step"><b>${esc(s.title)}</b><div>${esc(s.why)}</div><div class="chips" style="margin-top:6px">${(s.items || []).map(itemLink).join('')}</div><div style="margin-top:4px">${(s.threads || []).map(tlink).join(' ')}</div></div>`).join('')}</div>
   ${(plan.people || []).length ? `<h3>People whose path looks like yours</h3><div class="grid g2">${plan.people.map((pid) => `<div class="card">${whoBlock(S.people[pid], true)}<p class="small">${esc(S.people[pid]?.biggest_factor || '')}</p></div>`).join('')}</div>` : ''}
   ${plan.human_handoff ? `<div class="notice" style="margin-top:14px"><b>Talk to a human:</b> ${esc(plan.human_handoff)}</div>` : ''}
   ${plan.gaps ? `<p class="small" style="margin-top:12px"><b>What the community hasn't told us yet:</b> ${esc(plan.gaps)}. If you know, <a href="#/contribute">share it</a>.</p>` : ''}</div>`;
}
function scriptedPlan(items, threads) {
  const steps = items.slice(0, 3).map((i) => { const t = threads.find((x) => x.item === i.id); return { title: 'Look into ' + i.short, why: t ? humanText(t).split(/(?<=[.!?])\s/).slice(0, 2).join(' ') : (i.official.description || i.title), items: [i.id], threads: t ? [t.id] : [] }; });
  return { headline: 'Starting points from the community', steps, people: [...new Set(threads.slice(0, 3).map((t) => t.person))] };
}

// ---------- Contribute ----------
const getMe = () => { try { return JSON.parse(localStorage.getItem('cc_me') || 'null'); } catch { return null; } };
const saveMe = (p) => { try { localStorage.setItem('cc_me', JSON.stringify(p)); } catch {} };
const C = { person: null, item: null, mode: null, turns: [], extracted: [], step: 1 };
const redact = (s) => s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email removed]').replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[phone removed]')
  .replace(/(https?:\/\/)?(www\.)?linkedin\.com\/\S+/gi, '[link removed]').replace(/\b\d{2,6}\s+[A-Z][\w ]{2,30}\b(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Blvd|Court|Ct)\b\.?[^\n]*/g, '[address removed]');
function contribute(params) {
  const pre = params.get('item');
  Object.assign(C, { item: pre && S.byId[pre] ? pre : null, mode: null, turns: [], extracted: [] });
  if (C.person && !params.get('new')) return pickItem();
  view.innerHTML = `<h1>Share what it was actually like</h1><p class="muted">Two minutes. Talk or type. Stop whenever you want and we keep whatever you gave.</p>
  <div class="notice">Use a test profile below, or create your own. Only share what you're comfortable having shown (anonymized) to other students.</div>
  <h3 style="margin-top:20px">1. Who's sharing?</h3><p class="small">Test profiles (fictional):</p>
  <div class="grid g3">${Object.values(S.people).filter((p) => !p.id.startsWith('u_')).slice(0, 3).map((p) => `<button class="card persona" data-pid="${p.id}"><b>${esc(p.name)}</b><div class="small">${esc(p.headline)}</div></button>`).join('')}
   <button class="card persona" data-new="1"><b>+ Create my profile</b><div class="small">Add a resume so the AI knows what to ask you about</div></button></div>
  <div id="newp" hidden style="margin-top:16px" class="card">
   <div class="grid g2"><div><label>Display name (initials are fine)<input class="plain" id="np_name" placeholder="e.g. Alex P."></label>
    <label style="display:block;margin-top:8px">Where are you now?<select class="plain" id="np_stage"><option value="enrolled">Current student</option><option value="alum">Alum</option></select></label>
    <label style="display:block;margin-top:8px">Paste a resume or upload one below (optional) <span class="small">or <a href="#" id="loadMaya">load Maya's</a> / <a href="#" id="loadDaniel">Daniel's</a></span><textarea class="plain" id="np_resume" rows="8" placeholder="Paste resume text…"></textarea></label>
    <label class="small" style="display:block;margin-top:6px">Or upload a resume (PDF or .txt): <input type="file" id="np_file" accept=".pdf,.txt,.md,application/pdf"></label></div>
    <div><div class="notice">For your privacy, remove your name and contact details before uploading. We also strip emails, phone numbers, links, and street addresses automatically. This preview is exactly what anyone else could see:</div>
    <pre class="resume" id="np_prev">(nothing yet)</pre><label class="row"><input type="checkbox" id="np_public"> Show this redacted resume on my public profile</label>
    <p class="small">Unchecked: the resume is only used privately to tailor your interview.</p></div></div>
   <button class="btn dark" id="np_go" style="margin-top:12px">Continue</button></div>`;
  view.querySelectorAll('[data-pid]').forEach((b) => (b.onclick = () => { C.person = S.people[b.dataset.pid]; C.suggest = null; pickItem(); }));
  view.querySelector('[data-new]').onclick = () => { $('#newp').hidden = false; $('#np_name').focus(); };
  const upd = () => { $('#np_prev').textContent = redact($('#np_resume').value) || '(nothing yet)'; };
  $('#np_resume').oninput = upd;
  $('#np_file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#np_prev').textContent = 'Reading ' + f.name + '…';
    try { $('#np_resume').value = await readResumeFile(f); } catch (err) { $('#np_prev').textContent = "Couldn't read that file (" + err.message + '). Try pasting the text instead.'; return; }
    upd();
  };
  const loadR = (path, name) => async (e) => { e.preventDefault(); $('#np_resume').value = await fetch(path).then((r) => r.text()); $('#np_name').value = name; upd(); };
  $('#loadMaya').onclick = loadR('data/maya_fictional.txt', 'Maya R.'); $('#loadDaniel').onclick = loadR('data/daniel_fictional.txt', 'Daniel K.');
  $('#np_go').onclick = async () => {
    const name = $('#np_name').value.trim() || 'Anonymous'; const resume = redact($('#np_resume').value.trim());
    C.person = { id: 'new', name, avatar: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), stage: $('#np_stage').value, headline: '', resume, resume_public: $('#np_public').checked };
    C.suggest = null;
    if (resume) {
      $('#np_go').disabled = true; $('#np_go').innerHTML = '<span class="spinner"></span> reading your resume…';
      const codes = [...new Set((resume.match(/\b[A-Z]{2,5}:\d{4}\b/g) || []))].filter((c) => S.byId[c]);
      const r = await ai('parse_resume', { resume_redacted: resume, catalog_ids: S.items.map((i) => i.id), catalog: S.items.map((i) => `${i.id} | ${i.short}`).join('\n') }, 'contact info was stripped in the browser before this call');
      C.suggest = { items: [...new Set([...(r?.matched_items || []), ...codes])], topics: r?.topics || [] };
      if (r?.headline) C.person.headline = r.headline;
    }
    if (!C.person.headline) C.person.headline = C.person.stage === 'alum' ? 'UIowa alum' : 'UIowa student';
    C.person.shared = []; saveMe(C.person);
    pickItem();
  };
}
// Resume upload: PDF text is extracted in the browser with pdf.js (bundled in /vendor), so the raw file never leaves the device.
async function readResumeFile(f) {
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    const pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, 5); n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      pages.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(''));
    }
    const text = pages.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('no text found; it may be a scanned image');
    return text;
  }
  if (/\.docx$/i.test(f.name)) throw new Error('Word files aren\'t supported yet; save as PDF');
  return f.text();
}
function pickItem() {
  if (C.item) return pickMode();
  // Rank non-course items by relevance to THIS person's profile (TF-IDF over headline + resume + program),
  // then fill with general resources. Degrees/certificates only appear if they actually match the profile.
  const prof = [C.person.headline, C.person.program, C.person.resume, (C.suggest?.topics || []).join(' ')].filter(Boolean).join(' ');
  const alum = C.person.stage === 'alum';
  const grad = alum || /\b(MBA|MS|M\.S\.|master'?s|graduate program|GPP)\b/i.test(prof);
  const okStage = (i) => !(alum && /\(undergraduate\)/i.test(i.title)) && !(!grad && /\bgraduate\b|GPP|MBA/i.test(i.title + ' ' + (i.official?.description || '')));
  const ranked = (prof ? retrieve(prof).items : []).filter((x) => x.item.type !== 'course' && okStage(x.item));
  const topS = ranked[0]?.s || 0;
  const matched = ranked.filter((x) => x.s >= topS * 0.4).slice(0, 6).map((x) => x.item);
  const pref = ['office', 'resource', 'office_hours', 'opportunity', 'talk series', 'workshop', 'speaker', 'networking'];
  const general = S.items.filter((i) => pref.includes(i.type) && okStage(i) && !matched.includes(i)).sort((a, b) => pref.indexOf(a.type) - pref.indexOf(b.type));
  const events = [...matched, ...general].slice(0, 10);
  const sug = (C.suggest?.items || []).filter((id) => S.byId[id]);
  view.innerHTML = `<h1>What do you want to talk about?</h1><div class="card row between wrap" style="margin-bottom:14px">${whoBlock(C.person, true)}<a class="small" href="#/contribute?new=1" id="switchp">switch profile</a></div>
  ${sug.length ? `<h3>From your resume</h3><div class="chips">${sug.map((id) => `<button class="chip" data-i="${esc(id)}">${esc(S.byId[id].title)}</button>`).join('')}</div>` : ''}
  ${(C.suggest?.topics || []).length ? `<p class="small devonly">The AI also thinks you could tell us about: ${C.suggest.topics.map(esc).join(' · ')}</p>` : ''}
  <h3 style="margin-top:18px">Did you go to or use any of these?</h3>
  <div class="chips">${events.map((i) => `<button class="chip" data-i="${esc(i.id)}">${esc(i.short)}</button>`).join('')}</div>
  <h3 style="margin-top:18px">Or find anything</h3><input class="plain" id="pi_q" placeholder="Search a course, event, club…"><div id="pi_res"></div>`;
  const bind = () => view.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { C.item = b.dataset.i; pickMode(); }));
  bind();
  $('#pi_q').oninput = (e) => { const r = e.target.value.trim() ? retrieve(e.target.value).items.slice(0, 8) : []; $('#pi_res').innerHTML = `<div class="chips" style="margin-top:8px">${r.map((x) => `<button class="chip" data-i="${esc(x.item.id)}">${esc(x.item.title)}</button>`).join('')}</div>`; bind(); };
}
function pickMode() {
  const i = S.byId[C.item];
  view.innerHTML = `<div class="type">Sharing about</div><h1>${esc(i.title)}</h1><h3>How do you want to do this?</h3>
  <div class="grid g3">
   <button class="card persona" data-m="interview"><div class="ico">🎙️</div><b>Interview me</b><div class="small">The AI asks short questions, focused on what nobody has told us yet. Answer out loud or type.</div></button>
   <button class="card persona" data-m="rant"><div class="ico">🗣️</div><b>Let me just talk</b><div class="small">One open question, say whatever you want, then a couple of follow-ups.</div></button>
   <button class="card persona" data-m="template"><div class="ico">📝</div><b>Give me a template</b><div class="small">A few fields. Fill what you want, skip the rest.</div></button></div>
  <details style="margin-top:16px"><summary>See a great example answer</summary>${threadCard(S.threads.find((t) => t.id === 't01'), false)}</details>`;
  view.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { C.mode = b.dataset.m; C.mode === 'template' ? templateMode() : chatMode(); }));
}
function templateMode() {
  const i = S.byId[C.item]; const dims = [...thinDims(C.item), ...Object.keys(DIMS)].filter((d, k, a) => a.indexOf(d) === k).slice(0, 5);
  view.innerHTML = `<div class="type">Template</div><h1>${esc(i.title)}</h1><p class="small">Fill any, skip any.</p>
  ${dims.map((d) => `<label style="display:block;margin:12px 0"><b>${DIMS[d]}</b><div class="small">${esc(QBANK[d].replace('{x}', i.short))}</div><textarea class="plain" data-d="${d}" rows="3"></textarea></label>`).join('')}
  <label class="row" style="margin:10px 0"><input type="checkbox" id="consent"> I consent to the University storing this experience and showing it to other students and alumni under my display name, after staff review.</label>
  <button class="btn dark" id="tdone">Submit</button>`;
  $('#tdone').onclick = () => { C.turns = []; view.querySelectorAll('[data-d]').forEach((t) => { if (t.value.trim()) C.turns.push({ r: 'ai', dim: t.dataset.d, t: QBANK[t.dataset.d].replace('{x}', i.short) }, { r: 'h', t: t.value.trim() }); }); finish(); };
}
let rec = null;
function chatMode() {
  const i = S.byId[C.item];
  view.innerHTML = `<div class="row between wrap"><div><div class="type">${C.mode === 'rant' ? 'Free-form + follow-ups' : 'AI interview'}</div><h1 style="margin:0">${esc(i.title)}</h1></div><button class="btn ghost" id="cdone">I'm done, submit</button></div>
  <p class="small">Hit 🎤 and just talk, then ■ when you're done. You'll see the cleaned-up transcript and can edit it before sending.</p>
  <div class="chat" id="chat"></div>
  <div class="composer"><button class="mic" id="mic" title="Speak">🎤</button><textarea id="ans" placeholder="Talk or type your answer…"></textarea><button class="btn dark" id="send">Send</button></div>
  <p class="small" id="micnote"></p><div id="ext"></div>
  <div class="card" style="margin-top:14px"><label class="row"><input type="checkbox" id="consent"> I consent to the University storing this experience and showing it to other students and alumni under my display name, after staff review. I can ask for it to be removed.</label>
  <button class="btn dark" id="cdone" style="margin-top:10px">I'm done, submit</button></div>`;
  $('#cdone').onclick = finish; $('#send').onclick = sendAnswer; $('#mic').onclick = toggleMic;
  $('#ans').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendAnswer(); };
  C.turns = [];
  const first = C.mode === 'rant' ? { r: 'ai', dim: 'open', t: `Tell me anything about ${i.short} you wish you'd known going in. Ramble, it's fine.` } : { r: 'ai', dim: thinDims(C.item)[0] || 'hidden_value', t: QBANK[thinDims(C.item)[0] || 'hidden_value'].replace('{x}', i.short) };
  if (C.mode === 'interview' && S.live) { askNext(); } else { C.turns.push(first); drawChat(); }
}
function drawChat(thinking = false) {
  const el = $('#chat'); if (!el) return;
  el.innerHTML = C.turns.map((x) => `<div class="b ${x.r === 'ai' ? 'ai' : 'h'}">${esc(x.t)}</div>`).join('') + (thinking ? '<div class="b ai"><span class="spinner"></span></div>' : '');
  el.scrollTop = el.scrollHeight;
  $('#ext').innerHTML = C.extracted.length ? `<div class="card" style="margin-top:12px"><b>What the AI pulled out so far</b><ul class="claims">${C.extracted.map((x) => `<li><span class="dim">${esc(DIMS[x.dimension] || x.dimension)}</span>${esc(x.claim)}</li>`).join('')}</ul></div>` : '';
}
async function askNext() {
  const i = S.byId[C.item]; drawChat(true);
  const humans = C.turns.filter((x) => x.r === 'h').length;
  const p = C.person;
  const r = await ai('interview', { item: { id: i.id, title: i.title, type: i.type, official: i.official }, contributor: { headline: p.headline, stage: p.stage, resume_excerpt: (p.resume || '').slice(0, 1200) }, mode: C.mode, thin_dimensions: thinDims(C.item), answers_so_far: humans, transcript: C.turns.map((x) => ({ role: x.r === 'ai' ? 'interviewer' : 'contributor', text: x.t })) }, `thin dimensions: ${thinDims(C.item).join(', ')}`);
  if (r && r.next_question) {
    (r.extracted || []).forEach((x) => C.extracted.push(x));
    if (r.done) { C.turns.push({ r: 'ai', dim: 'open', t: (r.ack ? r.ack + ' ' : '') + "That's really useful. Hit submit whenever you're ready, or add anything else." }); drawChat(); return; }
    C.turns.push({ r: 'ai', dim: r.target_dimension, t: (r.ack ? r.ack + ' ' : '') + r.next_question });
  } else {
    const asked = new Set(C.turns.filter((x) => x.r === 'ai').map((x) => x.dim));
    const order = [...thinDims(C.item), ...Object.keys(DIMS)].filter((d) => !asked.has(d));
    const limit = C.mode === 'rant' ? 3 : 4;
    if (humans >= limit || !order.length) { C.turns.push({ r: 'ai', dim: 'open', t: "That's really useful, thanks. Hit submit whenever you're ready." }); drawChat(); return; }
    const acks = ['Got it.', 'That helps.', 'Makes sense.', 'Useful.'];
    C.turns.push({ r: 'ai', dim: order[0], t: (humans ? acks[humans % acks.length] + ' ' : '') + QBANK[order[0]].replace('{x}', i.short) });
  }
  drawChat();
}
async function sendAnswer() {
  if (rec) await toggleMic();
  const v = $('#ans').value.trim(); if (!v) return;
  C.turns.push({ r: 'h', t: v }); $('#ans').value = ''; drawChat();
  await askNext();
}
// Voice: record with the browser recognizer, but don't show its raw guesses live. When the user stops,
// a cheap model fixes misheard jargon using context (the item, UIowa department codes, campus terms).
let micRaw = '', micBase = '', micDone = null;
async function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('#micnote').textContent = 'Voice input needs Chrome or Edge. Typing works everywhere.'; return; }
  if (rec) { const p = micDone; rec.stop(); return p; }
  rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US';
  micBase = $('#ans').value; micRaw = '';
  $('#mic').classList.add('rec'); $('#mic').textContent = '■'; $('#micnote').textContent = '🎙️ Listening… click ■ when you\'re done talking.';
  $('#ans').disabled = true; $('#send').disabled = true;
  rec.onresult = (e) => { let t = ''; for (const r of e.results) if (r.isFinal) t += r[0].transcript + ' '; micRaw = t.trim(); };
  rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') $('#micnote').textContent = 'Mic error: ' + e.error + '. You can type instead.'; };
  micDone = new Promise((resolve) => {
    rec.onend = async () => {
      rec = null; $('#mic')?.classList.remove('rec'); if ($('#mic')) $('#mic').textContent = '🎤';
      let text = micRaw;
      if (text) {
        $('#micnote').innerHTML = '<span class="spinner"></span> Cleaning up the transcript…';
        const i = S.byId[C.item] || {};
        const r = await ai('clean_transcript', { raw: text, context: { item: i.title, department: i.dept, type: i.type, contributor: C.person?.headline || '' } }, 'speech-to-text cleanup');
        text = (r && typeof r.text === 'string' && r.text.trim()) ? r.text.trim() : text.replace(/\bsiesta\b/gi, 'CS');
      }
      if ($('#ans')) { $('#ans').disabled = false; $('#send').disabled = false; $('#ans').value = (micBase ? micBase + ' ' : '') + text; $('#ans').focus(); }
      if ($('#micnote')) $('#micnote').textContent = text ? 'Check it over, edit anything, then hit Send.' : 'Didn\'t catch anything. Try again or type.';
      resolve();
    };
  });
  rec.start();
}
async function finish() {
  if (rec) await toggleMic();
  const pending = $('#ans')?.value.trim(); if (pending) C.turns.push({ r: 'h', t: pending });
  const humans = C.turns.filter((x) => x.r === 'h');
  if (!humans.length) { alert('Say at least one thing first. Even one sentence helps.'); return; }
  if (!$('#consent')?.checked) { alert('Please tick the consent box first. Nothing is stored without it.'); return; }
  view.innerHTML = '<p><span class="spinner"></span> Screening and sending to the staff review queue…</p>';
  const text = humans.map((x) => x.t).join('\n');
  let mod = await ai('moderate', { item: S.byId[C.item].title, contribution: text }, 'AI pre-screen; a human makes the final call');
  if (!mod) mod = { decision: /(http|www\.|buy now|\b(idiot|stupid)\b)/i.test(text) || text.length < 15 ? 'review' : 'approve', reasons: ['scripted heuristic (AI unavailable)'] };
  const person = { ...C.person, id: undefined, headline: C.person.headline, resume: C.person.resume_public ? C.person.resume : '', path: C.person.path || [] };
  let rec2 = null;
  try { rec2 = await fetch('api/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: C.item, mode: C.mode, turns: C.turns, person, extracted: C.extracted, auto_moderation: mod, consent: { given: true, at: new Date().toISOString() } }) }).then((r) => r.json()); } catch {}
  if (mod.decision !== 'reject') { S.unlocked = true; localStorage.setItem('cc_unlocked', '1'); }
  const me = getMe(); if (me && C.person.id === 'new') { me.shared = [...new Set([...(me.shared || []), C.item])]; me.said = [...(me.said || []), humans.map((x) => x.t).join(' ')].slice(-3); saveMe(me); }
  await refreshSubs();
  view.innerHTML = `<div class="card"><h1>Thanks${C.person.name && C.person.name !== 'Anonymous' ? ', ' + esc(C.person.name.split(' ')[0]) : ''}.</h1>
   <p class="muted">Sent for staff review.${rec2?.id ? '' : ' (Couldn\'t reach the server, so it wasn\'t saved.)'}</p>
   ${C.extracted.length ? `<div class="card" style="margin:12px 0"><b>What the AI pulled out</b><ul class="claims">${C.extracted.map((x) => `<li><span class="dim">${esc(DIMS[x.dimension] || x.dimension)}</span>${esc(x.claim)}</li>`).join('')}</ul></div>` : ''}
   <div class="row wrap">${C.person.id === 'new' ? '<a class="btn dark" href="#/compass?me=1">🧭 See recommendations for me</a>' : ''}<a class="btn ghost" href="#/contribute">Share another</a></div></div>`;
  C.item = null;
}

// ---------- Staff queue ----------
async function staff() {
  await refreshSubs();
  const pin = localStorage.getItem('cc_pin') || '';
  const list = [...S.subs].reverse();
  view.innerHTML = `<h1>Staff review queue</h1><p class="muted">What stays in human hands: nothing goes public without a university staff member approving it. The AI pre-screen sorts the queue; it never publishes.</p>
  <div class="row"><input class="plain" style="max-width:220px" id="pin" placeholder="Staff PIN (if set)" value="${esc(pin)}"><button class="btn ghost" id="refresh">Refresh</button></div>
  ${list.length ? list.map((s) => `<div class="card thread"><div class="row between wrap"><div>${itemLink(s.item)} <span class="small">by ${esc(s.person?.name)} · ${esc(s.mode)} · ${esc((s.received || '').replace('T', ' ').slice(0, 16))}</span></div>
     <div>AI: <span class="status ${esc(s.auto_moderation?.decision)}">${esc(s.auto_moderation?.decision)}</span> · Status: <span class="status ${esc(s.status)}">${esc(s.status)}</span></div></div>
     <div class="small">${esc((s.auto_moderation?.reasons || []).join('; '))}</div>${bubbles(s.turns || [])}
     <div class="row" style="margin-top:10px"><button class="btn" data-dec="published" data-id="${s.id}">Approve & publish</button><button class="btn ghost" data-dec="rejected" data-id="${s.id}">Reject</button></div></div>`).join('') : '<div class="card"><p>Queue is empty. Contributions show up here.</p></div>'}`;
  $('#refresh').onclick = staff;
  view.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = async () => {
    localStorage.setItem('cc_pin', $('#pin').value);
    const r = await fetch(`api/submissions/${b.dataset.id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-staff-pin': $('#pin').value }, body: JSON.stringify({ status: b.dataset.dec }) });
    if (!r.ok) alert('Not allowed: ' + (await r.text())); staff();
  }));
}

// ---------- router ----------
function route() {
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?'); const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  if (!parts.length) return home();
  if (parts[0] === 'search') return search(params);
  if (parts[0] === 'item') return itemPage(parts.slice(1).join('/'), params);
  if (parts[0] === 'person') return personPage(parts[1]);
  if (parts[0] === 'compass') return compass(params);
  if (parts[0] === 'contribute') return contribute(params);
  if (parts[0] === 'staff') return staff();
  if (parts[0] === 'dev' || parts[0] === 'user') { localStorage.setItem('cc_dev', parts[0] === 'dev' ? '1' : '0'); document.body.classList.toggle('dev', parts[0] === 'dev'); location.hash = '#/'; return; }
  home();
}
$('#topSearch').onsubmit = (e) => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent($('#q').value); };
$('#gateToggle').checked = S.gate;
$('#gateToggle').onchange = (e) => { S.gate = e.target.checked; S.unlocked = false; localStorage.setItem('cc_gate', JSON.stringify(S.gate)); localStorage.removeItem('cc_unlocked'); route(); };
window.addEventListener('hashchange', route);
load().then(route);
