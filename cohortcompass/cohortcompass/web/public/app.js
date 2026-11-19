// CohortCompass web demo (vanilla JS). Every action calls /api/tool/<mcp_tool_name>.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_\((.+?)\)_/g, '<i class="muted">($1)</i>');
const toast = (m) => { const t = h('div', { class: 'toast' }, m); document.body.append(t); setTimeout(() => t.remove(), 2600); };
const pctf = (x) => `${Math.round((x || 0) * 100)}%`;
const label = (s) => String(s || '').replace(/_/g, ' ');

const S = { state: null, profileId: null, profile: null, view: 'home', hood: [], hoodOpen: false, courseCache: null };

async function api(name, args = {}, { quiet = false } = {}) {
  const r = await fetch(`/api/tool/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }).then((x) => x.json());
  S.hood.unshift({ name, ...r, at: new Date() });
  renderHood();
  if (!r.ok) { if (!quiet) toast(`${r.error.code}: ${r.error.message}`); throw Object.assign(new Error(r.error.message), r.error); }
  return r.result;
}

// ---------------- Under the hood ----------------
function renderHood() {
  const list = $('#hoodList');
  list.innerHTML = '';
  S.hood.slice(0, 40).forEach((c, i) => {
    const llm = (c.llm_calls || []);
    const body = h('div', { class: i === 0 ? '' : 'hidden' },
      h('div', { class: 'lbl' }, 'MCP request (JSON-RPC)'), h('pre', {}, JSON.stringify(c.mcp || { note: 'local record lookup' }, null, 2)),
      llm.length ? [h('div', { class: 'lbl' }, 'model calls'), h('pre', {}, llm.map((l) => `${l.tier.padEnd(6)} ${l.model}  ${l.ok ? `ok ${l.ms}ms` : `fallback → ${l.reason}`}`).join('\n'))] : null,
      h('div', { class: 'lbl' }, c.ok === false ? 'error' : 'structured result'), h('pre', {}, JSON.stringify(c.ok === false ? { error: c.error } : c.result, null, 2).slice(0, 9000)));
    list.append(h('div', { class: 'call' },
      h('div', { class: 'call-h', onclick: () => body.classList.toggle('hidden') }, h('b', {}, c.name), h('span', { class: `tag ${c.read_only === false ? 'w' : ''}` }, c.read_only === false ? 'write' : 'read'), c.ok === false ? h('span', { class: 'tag err' }, c.error?.code) : null, llm.length ? h('span', { class: 'tag llm' }, llm.every((l) => l.ok) ? `${llm.length} live model call${llm.length > 1 ? 's' : ''}` : 'scripted fallback') : null, h('span', { class: 'muted tiny', style: { marginLeft: 'auto' } }, c.ms != null ? `${c.ms} ms` : '')),
      body));
  });
}
$('#toggleHood').onclick = () => { S.hoodOpen = !S.hoodOpen; $('#hood').classList.toggle('hidden', !S.hoodOpen); $('.layout').classList.toggle('with-hood', S.hoodOpen); };
$('#clearHood').onclick = () => { S.hood = []; renderHood(); };
async function showRecord(id) {
  if (!S.hoodOpen) $('#toggleHood').click();
  if (id.startsWith('agg:path:')) return api('get_path_insights', { target: id.slice(9) });
  if (id.startsWith('agg:')) return api('get_course_insights', { course_id: id.slice(4) });
  const r = await fetch(`/api/record?id=${encodeURIComponent(id)}`).then((x) => x.json());
  S.hood.unshift({ name: `record ${id}`, ok: true, read_only: true, result: r, mcp: { jsonrpc: '2.0', method: 'resources/read', params: { uri: `record://${id}` } } });
  renderHood();
}

// ---------------- nav + personas ----------------
const NAV = [
  ['Start', [['home', '★', 'How it works']]],
  ['While enrolled', [['profile', 1, 'Profile from resume'], ['courses', 2, 'Course pages'], ['review', 3, 'Review a course (AI interview)']]],
  ['Heading out', [['foryou', 4, 'Events & resources for you'], ['outcome', 5, 'Report an offer']]],
  ['For the next cohort', [['paths', 6, 'Path insights'], ['ask', 7, 'Ask the Cohort'], ['share', 8, 'Ask & Share']]],
  ['Human in the loop', [['admin', 9, 'Campus admin (GPP)']]],
];
function renderNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  for (const [g, items] of NAV) { nav.append(h('div', { class: 'group' }, g)); for (const [id, n, t] of items) nav.append(h('button', { class: S.view === id ? 'on' : '', onclick: () => go(id) }, h('span', { class: 'num' }, n), t)); }
}
function renderPersonas() {
  const el = $('#persona'); el.innerHTML = '';
  for (const p of S.state.personas) el.append(h('button', { class: S.profileId === p.id ? 'on' : '', title: p.persona, onclick: () => setPersona(p.id) }, p.display_name));
  el.append(h('button', { class: S.profileId && !S.state.personas.some((p) => p.id === S.profileId) ? 'on' : '', title: 'Mystery student: start from any resume', onclick: () => { S.profileId = null; S.profile = null; renderPersonas(); go('profile'); } }, S.profileId && !S.state.personas.some((p) => p.id === S.profileId) ? (S.profile?.display_name || 'New') : '+ New student'));
}
async function setPersona(id) {
  S.profileId = id;
  S.profile = id ? (await api('x_get_profile', { profile_id: id })).profile : null;
  renderPersonas(); render();
}
const go = (v, arg) => { S.view = v; S.arg = arg; renderNav(); render(); window.scrollTo(0, 0); };
const needProfile = () => { if (S.profile) return false; $('#main').replaceChildren(h('div', { class: 'card gate' }, h('h3', {}, 'Pick a student first'), h('p', {}, 'Choose Maya or Daniel at the top, or build a new profile from a resume.'), h('button', { class: 'btn', onclick: () => go('profile') }, 'Build a profile from a resume'))); return true; };

async function render() {
  const m = $('#main');
  m.replaceChildren(h('div', { class: 'muted' }, 'Loading…'));
  try { await (VIEWS[S.view] || VIEWS.home)(m); } catch (e) { console.error(e); m.append(h('div', { class: 'card gate' }, `Something went wrong: ${e.message}`)); }
}

// ---------------- views ----------------
const VIEWS = {};

VIEWS.home = (m) => {
  m.replaceChildren(
    h('div', { class: 'hero' },
      h('div', { class: 'card' },
        h('h1', {}, 'What you know becomes what the next student needs.'),
        h('p', { class: 'muted' }, 'Rate-My-Professor collects vague text. CohortCompass interviews students and alumni, one question at a time, and turns what they know into structured, evidence-backed records. Those records power course pages, matched events, "what it took" career paths and a Q&A that always cites its sources.'),
        h('div', { class: 'steps', style: { marginTop: '14px' } },
          h('div', {}, h('span', {}, h('b', {}, 'Resume → profile.'), ' Contact details are stripped and you confirm everything.')),
          h('div', {}, h('span', {}, h('b', {}, 'Tell it like you\'d tell a friend.'), ' The AI extracts fields from your story, then asks only for the gaps. A 1 or 5 needs an example.')),
          h('div', {}, h('span', {}, h('b', {}, 'Got an offer?'), ' The first question is always "What was the single biggest factor?"')),
          h('div', {}, h('span', {}, h('b', {}, 'Ask the Cohort.'), ' Answers cite record IDs or say "not enough data". Aggregates appear only at n ≥ ' + S.state.min_n + '.')),
          h('div', {}, h('span', {}, h('b', {}, 'GPP stays in charge.'), ' Moderation, escalations and campus aggregates sit with staff, not the AI.'))),
        h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn gold', onclick: () => setPersona('pro_maya').then(() => go('profile')) }, 'Demo as Maya (undergrad)'), h('button', { class: 'btn', onclick: () => setPersona('pro_daniel').then(() => go('foryou')) }, 'Demo as Daniel (alum)'), h('button', { class: 'btn light', onclick: () => { S.profileId = null; S.profile = null; renderPersonas(); go('profile'); } }, 'Mystery student →'))),
      h('div', { class: 'card' },
        h('h3', {}, 'One agent, three stages'),
        h('div', { class: 'col small' },
          h('div', {}, h('span', { class: 'chip gold' }, 'While enrolled'), ' Profile, course pages, structured reviews and good-to-knows.'),
          h('div', {}, h('span', { class: 'chip gold' }, 'Heading out'), ' Real events and resources ranked for you, plus nudges toward office hours, mixers and alumni chats.'),
          h('div', {}, h('span', { class: 'chip gold' }, 'After graduation'), ' Outcome interviews feed Path Insights. Return-to-Iowa options like certificates and the part-time MBA/MSF.')),
        h('hr', { style: { border: 0, borderTop: '1px solid var(--line)', margin: '14px 0' } }),
        h('h3', {}, 'Portable by design'),
        h('p', { class: 'small muted' }, 'The same core runs this page and an MCP server (13 tools, 4 resource templates, 3 prompts). Open "Under the hood" to see the exact tools/call behind every click, or export a Career Passport any MCP host can import.'),
        h('p', { class: 'small' }, 'AI mode: ', h('b', {}, S.state.llm.live ? `live (${S.state.llm.models.strong} for interviews/insight, ${S.state.llm.models.cheap} for parsing)` : 'scripted fallback (no API key), so the demo never dead-ends')))));
};

// ---- 1. Profile ----
VIEWS.profile = async (m) => {
  const persona = S.state.personas.find((p) => p.id === S.profileId);
  const key = S.profileId === 'pro_daniel' ? 'daniel' : S.profileId === 'pro_maya' ? 'maya' : null;
  const ta = h('textarea', { placeholder: 'Paste any resume (the mystery student works too)…', style: { minHeight: '240px', fontFamily: 'var(--mono)', fontSize: '12.5px' } });
  if (key) ta.value = await fetch(`/api/resume/${key}`).then((r) => r.text());
  const out = h('div');
  m.replaceChildren(
    h('h1', {}, 'Profile from resume'),
    h('p', { class: 'muted' }, 'Paste a resume, review the draft, choose what to share, then confirm. Nothing is published without your OK, and the resume itself is not kept.'),
    S.profile ? h('div', { class: 'card tight row between' }, h('div', {}, h('b', {}, S.profile.display_name), ' · ', label(S.profile.stage), ' · ', S.profile.program_type, persona ? h('span', { class: 'chip syn', style: { marginLeft: '8px' } }, 'synthetic persona') : null, h('div', { class: 'small muted' }, `Targets: ${(S.profile.career_targets || []).join('; ') || '-'} · Interests: ${(S.profile.interests || []).join(', ')}`)), h('div', { class: 'row' }, h('button', { class: 'btn light sm', onclick: () => go('foryou') }, 'See matches →'), h('button', { class: 'btn light sm', onclick: exportPassport }, 'Export Career Passport'))) : null,
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', {}, 'Resume'), h('div', { class: 'row' }, h('button', { class: 'btn light sm', onclick: async () => (ta.value = await fetch('/api/resume/maya').then((r) => r.text())) }, 'sample: Maya'), h('button', { class: 'btn light sm', onclick: async () => (ta.value = await fetch('/api/resume/daniel').then((r) => r.text())) }, 'sample: Daniel'))), ta,
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn gold', onclick: async (e) => { e.target.disabled = true; try { draftView(out, await api('parse_resume', { text: ta.value })); } finally { e.target.disabled = false; } } }, 'Parse resume → ProfileDraft'), h('span', { class: 'small muted' }, 'tool: parse_resume'))),
      out));
};
function draftView(out, r) {
  const d = r.profile_draft;
  const inp = (v) => h('input', { value: v ?? '' });
  const f = { display_name: inp(d.display_name), targets: inp((d.career_targets || []).join('; ')), interests: inp((d.interests || []).join(', ')), skills: inp((d.skills || []).join(', ')) };
  const stage = h('select', {}, ...['prospective', 'enrolled', 'heading_out', 'alumni'].map((s) => h('option', { value: s, selected: s === d.stage }, label(s))));
  const consent = { share_reviews: h('input', { type: 'checkbox', checked: true, style: { width: 'auto' } }), share_outcomes_aggregate: h('input', { type: 'checkbox', checked: true, style: { width: 'auto' } }), contact_by_peers: h('input', { type: 'checkbox', style: { width: 'auto' } }) };
  out.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h3', {}, 'ProfileDraft'), h('span', { class: 'chip real' }, `${r.pii_removed} contact details stripped · resume not retained · via ${r.via}`)),
    h('div', { class: 'grid g2' }, h('label', { class: 'f' }, 'Display name', f.display_name), h('label', { class: 'f' }, 'Stage', stage)),
    h('label', { class: 'f', style: { marginTop: '8px' } }, 'Career targets (; separated)', f.targets),
    h('label', { class: 'f', style: { marginTop: '8px' } }, 'Interests', f.interests),
    h('label', { class: 'f', style: { marginTop: '8px' } }, 'Skills', f.skills),
    h('div', { class: 'small', style: { marginTop: '10px' } }, h('b', {}, 'Education: '), (d.education || []).map((e) => `${e.degree || ''} ${e.field || ''}, ${e.institution} ${e.end_year || ''}`).join(' · ') || '-'),
    h('div', { class: 'small' }, h('b', {}, 'Experience: '), (d.experience || []).map((e) => `${e.title} (${e.start}–${e.end})`).join(' · ') || '-'),
    h('div', { class: 'col small', style: { marginTop: '10px' } }, h('b', {}, 'Sharing (opt-in)'), h('label', { class: 'row' }, consent.share_reviews, 'Publish my reviews (anonymized)'), h('label', { class: 'row' }, consent.share_outcomes_aggregate, 'Include my outcomes in aggregates (n ≥ 5 only)'), h('label', { class: 'row' }, consent.contact_by_peers, 'Let peers contact me')),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: async () => {
      const profile = { ...d, display_name: f.display_name.value, stage: stage.value, career_targets: f.targets.value.split(';').map((s) => s.trim()).filter(Boolean), interests: f.interests.value.split(',').map((s) => s.trim()).filter(Boolean), skills: f.skills.value.split(',').map((s) => s.trim()).filter(Boolean), consent: { share_reviews: consent.share_reviews.checked, share_outcomes_aggregate: consent.share_outcomes_aggregate.checked, contact_by_peers: consent.contact_by_peers.checked, resume_retention_days: 0 } };
      if (S.profileId && S.state.personas.some((p) => p.id === S.profileId)) { profile.id = S.profileId; profile.courses_taken = S.profile.courses_taken; profile.extensions = S.profile.extensions; }
      const res = await api('upsert_profile', { profile });
      S.profileId = res.profile.id; S.profile = res.profile; renderPersonas(); toast('Profile confirmed');
      out.append(backfillCard(res.profile));
    } }, 'Confirm profile'), h('span', { class: 'small muted' }, 'tool: upsert_profile'))));
}
function backfillCard(p) {
  return h('div', { class: 'card' }, h('h3', {}, 'Optional: backfill your past roles'), h('p', { class: 'small muted' }, 'This fixes cold start. Two minutes per role on what got you the job. One at a time, skip any.'),
    ...(p.experience || []).map((e, i) => h('div', { class: 'row between', style: { padding: '6px 0', borderTop: '1px solid var(--line)' } }, h('span', {}, h('b', {}, e.title), h('span', { class: 'muted small' }, ` ${e.start || ''}–${e.end || ''}`)), e.outcome_logged ? h('span', { class: 'chip real' }, 'logged') : h('button', { class: 'btn light sm', onclick: () => go('outcome', { backfill_index: i }) }, 'What got you this role? →'))));
}
async function exportPassport() {
  const { passport } = await api('export_profile', { profile_id: S.profileId });
  const blob = new Blob([JSON.stringify(passport, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `career-passport-${S.profile.display_name.replace(/\W+/g, '_')}.json` }); a.click();
  toast('Career Passport exported (schema-validated, SHA-256 checksummed)');
}

// ---- 2. Courses ----
VIEWS.courses = async (m) => {
  if (S.arg?.course_id) return coursePage(m, S.arg.course_id);
  const q = h('input', { placeholder: 'Search real courses: "finance", "MBA:8180", "python"…', value: S.arg?.q || '' });
  const list = h('div');
  const run = async () => { const r = await api('search_courses', { query: q.value, limit: 60 }); list.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'Course'), h('th', {}, 'Level'), h('th', {}, 'Source'), h('th', {}, 'Reviews')), ...r.items.map((c) => h('tr', { style: { cursor: 'pointer' }, onclick: () => go('courses', { course_id: c.course_id }) }, h('td', {}, h('b', {}, c.course_id), ' ', c.title), h('td', { class: 'small' }, c.level), h('td', {}, h('span', { class: 'chip real' }, c.source === 'syllabus' ? 'real · syllabus' : 'real · catalog')), h('td', {}, c.review_count >= S.state.min_n ? h('b', {}, c.review_count) : h('span', { class: 'muted' }, c.review_count)))))); };
  q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(run, 200); });
  m.replaceChildren(h('h1', {}, 'Course pages'), h('p', { class: 'muted' }, `${'Real Tippie and UI courses. Aggregates unlock at n ≥ '}${S.state.min_n} approved reviews.`), h('div', { class: 'card' }, q, h('div', { style: { marginTop: '10px' } }, list)));
  run();
};
async function coursePage(m, course_id, opts = {}) {
  const bg = opts.bg;
  const r = await api('get_course_insights', { course_id, ...(bg ? { background_bucket: bg } : {}) });
  const c = r.course; const a = r.aggregates;
  const myBg = S.profile ? ({ finance: 'finance', insurance: 'finance', arts: 'arts_humanities' }[S.profile.experience?.[0]?.industry] || 'other') : null;
  const meter = (v, max = 5, cls = '') => h('div', { class: `meter ${cls}` }, h('i', { style: { width: `${(v / max) * 100}%` } }));
  const COLORS = ['#161616', '#2c5d8f', '#b3412e', '#2f7d4f', '#6b4fa0', '#a07a10', '#555'];
  m.replaceChildren(
    h('div', { class: 'row between' }, h('button', { class: 'btn light sm', onclick: () => go('courses') }, '← all courses'), h('button', { class: 'btn gold', onclick: () => go('review', { course_id }) }, `Review ${course_id}`)),
    h('div', { class: 'card', style: { marginTop: '12px' } },
      h('div', { class: 'row between' }, h('div', {}, h('h1', { style: { marginBottom: '2px' } }, `${c.course_id} ${c.title}`), h('div', { class: 'small muted' }, `${c.department} · ${c.level} · seen: ${(c.terms_seen || []).join(', ') || 'see catalog'}`)), h('div', { class: 'col', style: { alignItems: 'flex-end' } }, h('span', { class: 'chip real' }, `real course · ${c.source}`), c.source_url ? h('a', { class: 'tiny', href: c.source_url, target: '_blank' }, 'source') : null)),
      c.description_short ? h('p', {}, c.description_short) : null,
      h('div', { class: 'small' }, h('b', {}, 'Official prerequisites: '), c.prerequisites_official)),
    !a ? h('div', { class: 'gate' }, h('b', {}, `Not enough data yet: ${r.n}/${r.min_n} reviews.`), ' Aggregates stay hidden until there are enough reviewers, so a few people can\'t be identified or skew the picture. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('review', { course_id }); } }, 'Be one of them →'))
      : h('div', {},
        h('div', { class: 'row between', style: { margin: '6px 0 10px' } }, h('div', { class: 'row' }, h('span', { class: 'chip syn' }, `${r.n} synthetic reviews`), h('span', { class: 'chip blue' }, `confidence: ${r.confidence}`), h('span', { class: 'chip link', onclick: () => showRecord(r.aggregate_id) }, r.aggregate_id)), myBg ? h('label', { class: 'row small' }, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: !!bg, onchange: (e) => coursePage(m, course_id, { bg: e.target.checked ? myBg : null }) }), `Students like me (${label(myBg)} background)`) : null),
        bg && r.like_me ? (r.like_me.min_n_met === false ? h('div', { class: 'gate', style: { marginBottom: '12px' } }, `Not enough reviewers with a ${label(bg)} background yet (${r.like_me.n}/${r.min_n}).`) : h('div', { class: 'card tight', style: { background: 'var(--gold-soft)' } }, h('b', {}, `Reviewers like you (n=${r.like_me.n}): `), `~${r.like_me.workload_hours_per_week.median} h/week · difficulty ${r.like_me.difficulty}/5 · ${pctf(r.like_me.would_retake_share)} would retake`)) : null,
        h('div', { class: 'grid g4' },
          h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, `${a.workload_hours_per_week.median}h`), h('div', { class: 'kpi-l' }, `per week, median (IQR ${a.workload_hours_per_week.p25}–${a.workload_hours_per_week.p75})`), h('div', { class: 'range' }, h('div', { class: 'track' }), h('div', { class: 'iqr', style: { left: `${(a.workload_hours_per_week.p25 / 20) * 100}%`, width: `${((a.workload_hours_per_week.p75 - a.workload_hours_per_week.p25) / 20) * 100}%` } }), h('div', { class: 'med', style: { left: `${(a.workload_hours_per_week.median / 20) * 100}%` } })), h('div', { class: 'tiny muted' }, `trend: ${label(a.workload_trend)}`)),
          h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, pctf(a.would_retake_share)), h('div', { class: 'kpi-l' }, 'would take it again')),
          h('div', { class: 'card tight col' }, ...[['difficulty', a.difficulty], ['clarity', a.clarity], ['feedback', a.feedback_quality]].map(([k, v]) => h('div', {}, h('div', { class: 'row between small' }, h('span', {}, k), h('b', {}, `${v}/5`)), meter(v)))),
          h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, a.office_hours.high_value_share_of_users != null ? pctf(a.office_hours.high_value_share_of_users) : '–'), h('div', { class: 'kpi-l' }, `of office-hours users rated them high-value (${pctf(a.office_hours.used_share)} went)`), a.instructor_response_time_hours ? h('div', { class: 'tiny muted' }, `median reply ~${a.instructor_response_time_hours}h`) : null)),
        h('div', { class: 'grid g2' },
          h('div', { class: 'card' }, h('h3', {}, 'How the grade is built'), a.grading_mix ? h('div', { class: 'stack' }, ...a.grading_mix.map((g, i) => h('span', { style: { width: `${g.percent}%`, background: COLORS[i % COLORS.length] }, title: `${label(g.type)} ${g.percent}%` }, `${label(g.type)} ${g.percent}%`))) : h('div', { class: 'muted small' }, 'not enough grading data'),
            h('div', { class: 'small', style: { marginTop: '10px' } }, `Group work: ${label(a.group_work)} · Cold calling: ${label(a.cold_calling)} · Attendance impact: ${label(a.attendance_impact)} · Recruiter signal: ${label(a.recruiter_signal)}`),
            h('h3', { style: { marginTop: '14px' } }, 'What it actually covers'), h('div', { class: 'bars' }, ...a.topics.map((t) => h('div', { class: 'b' }, h('span', {}, t.topic, t.hardest_votes ? h('span', { class: 'chip warn', style: { marginLeft: '6px' } }, `hardest ×${t.hardest_votes}`) : null), meter(t.mentions, r.n, 'gold'), h('span', { class: 'small muted' }, `${t.mentions}/${r.n}`))))),
          h('div', { class: 'card' }, h('h3', {}, 'Skills people walk away with'), h('div', { class: 'row' }, ...a.top_skills.map((s) => h('span', { class: 'chip' }, `${s.skill} ×${s.count}`))),
            a.best_for.length ? [h('h3', { style: { marginTop: '14px' } }, 'Best for'), ...a.best_for.map((b) => h('div', { class: 'small' }, `✓ ${b.text} (${b.count})`))] : null,
            a.avoid_if.length ? [h('h3', { style: { marginTop: '14px' } }, 'Wait if…'), ...a.avoid_if.map((b) => h('div', { class: 'small' }, `⚠ ${b.text} (${b.count})`))] : null))),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', {}, 'Good to know'), h('span', { class: 'small muted' }, 'confirmations raise confidence · stale tips decay (half-life 180 days)')),
      r.good_to_knows.length ? r.good_to_knows.map((g) => h('div', { class: 'tip' }, h('div', {}, h('span', { class: `chip ${g.category === 'warning' ? 'warn' : ''}` }, label(g.category)), ' ', g.text, g.stale ? h('span', { class: 'chip gold', style: { marginLeft: '6px' } }, `may be outdated · ${g.days_since_confirmed}d`) : null, h('span', { class: 'chip link', style: { marginLeft: '6px' }, onclick: () => showRecord(g.id) }, g.id)),
        h('div', { class: 'col' }, h('div', { class: 'row between tiny muted' }, h('span', {}, `confidence ${Math.round(g.confidence * 100)}%`), h('span', {}, `✓${g.confirmations}`)), meter(g.confidence, 1, 'gold'), h('div', { class: 'row' }, h('button', { class: 'btn light sm', onclick: async () => { await api('x_confirm_good_to_know', { id: g.id }); coursePage(m, course_id, opts); } }, 'Still true'), h('button', { class: 'btn light sm', onclick: async () => { await api('x_confirm_good_to_know', { id: g.id, dispute: true }); coursePage(m, course_id, opts); } }, 'Not anymore'))))) : h('div', { class: 'muted small' }, 'No tips yet.')),
    r.reviews.length ? h('div', { class: 'card' }, h('h3', {}, 'Evidence from reviews'), ...(() => { const seen = new Set(); return r.reviews.filter((x) => x.examples?.length).map((x) => ({ ...x, examples: x.examples.filter((e) => !seen.has(e.evidence) && seen.add(e.evidence)) })).filter((x) => x.examples.length); })().slice(0, 6).map((x) => h('div', { class: 'tip', style: { gridTemplateColumns: '1fr auto' } }, h('div', { class: 'small' }, ...x.examples.map((e) => h('div', {}, h('span', { class: 'chip' }, label(e.field || e.claim)), ' "', e.evidence, '"'))), h('div', { class: 'col tiny muted', style: { alignItems: 'flex-end' } }, h('span', { class: 'chip link', onclick: () => showRecord(x.id) }, x.id), `${x.term} · ${x.reviewer_context.hidden ? 'context hidden (small group)' : `${label(x.reviewer_context.program_year)} · ${label(x.reviewer_context.background_bucket)}`}`, x.synthetic ? h('span', { class: 'chip syn' }, 'synthetic') : null)))) : null);
}

// ---- chat component (review + outcome interviews) ----
const REVIEW_FIELDS = ['format', 'workload_hours_per_week', 'workload_trend', 'grading_mix', 'difficulty', 'clarity', 'feedback_quality', 'instructor_response_time_hours', 'group_work_intensity', 'cold_calling', 'attendance_impact', 'office_hours_value', 'topics_covered', 'skills_gained', 'career_relevance', 'prerequisites_actually_needed', 'would_retake', 'best_for', 'avoid_if', 'examples'];
const OUTCOME_FIELDS = ['biggest_factor', 'supporting_factors', 'channel', 'timeline', 'people_roles_that_helped', 'courses_that_helped', 'events_attended', 'do_differently', 'advice_for_next_cohort'];
function chat(container, first, { fields, onDone }) {
  const log = h('div', { class: 'chat' });
  const quick = h('div', { class: 'quick' });
  const input = h('input', { placeholder: 'Type an answer, tap an option, or "skip"…' });
  const prog = h('i', { style: { width: '0%' } });
  const fieldEl = h('div', { class: 'fields' });
  const json = h('pre', { style: { maxHeight: '320px', overflow: 'auto', background: '#121212', color: '#ddd', padding: '10px', borderRadius: '8px', margin: 0 } });
  let state = first; let prevKnown = new Set();
  const say = (who, text) => { log.append(h('div', { class: `msg ${who}`, html: md(text) })); log.scrollTop = log.scrollHeight; };
  const paint = () => {
    prog.style.width = `${(state.progress.filled / state.progress.total) * 100}%`;
    const known = new Set(Object.keys(state.known || {}).filter((k) => state.known[k] !== undefined));
    fieldEl.replaceChildren(...fields.map((f) => h('span', { class: `chip ${known.has(f) ? 'on' : ''} ${known.has(f) && !prevKnown.has(f) ? 'new' : ''}` }, label(f))), ...(state.gtk_texts?.length ? [h('span', { class: 'chip gold' }, `${state.gtk_texts.length} tip${state.gtk_texts.length > 1 ? 's' : ''} queued`)] : []));
    prevKnown = known;
    json.textContent = JSON.stringify(state.known, null, 2);
    quick.replaceChildren(...(state.options || []).map((o) => h('button', { onclick: () => send(o) }, o)));
  };
  const send = async (text) => {
    if (!text || state.status === 'done') return;
    say('me', text); input.value = ''; quick.replaceChildren(h('span', { class: 'muted small' }, 'thinking…'));
    try {
      state = await api('x_interview_answer', { interview_id: state.interview_id, answer: text });
    } catch { quick.replaceChildren(); return; }
    say('ai', state.message); paint();
    if (state.status === 'done') { quick.replaceChildren(); input.disabled = true; onDone?.(state); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(input.value.trim()); });
  container.replaceChildren(h('div', { class: 'grid', style: { gridTemplateColumns: '1.4fr 1fr' } },
    h('div', { class: 'card' }, h('div', { class: 'progress', style: { marginBottom: '10px' } }, prog), log, quick, h('div', { class: 'row', style: { marginTop: '8px' } }, input, h('button', { class: 'btn', onclick: () => send(input.value.trim()) }, 'Send'))),
    h('div', { class: 'col' }, h('div', { class: 'card tight' }, h('div', { class: 'small', style: { marginBottom: '6px' } }, h('b', {}, 'Fields captured'), h('span', { class: 'muted' }, ' · the schema decides when we\'re done')), fieldEl), h('div', { class: 'card tight' }, h('div', { class: 'small', style: { marginBottom: '6px' } }, h('b', {}, 'Structured record so far')), json))));
  if (first.extracted) say('me', '(shared a free-form description)');
  say('ai', first.message); paint();
}

// ---- 3. Review ----
const DEMO_NARRATIVE = {
  'MBA:8180': 'Managerial Finance was about 12 hours per week at the start and closer to 6 hours per week by the end once the problem sets got familiar. We covered time value of money, NPV, WACC and capital structure, and the hardest part was WACC. Grading was exams 50%, problem sets 30%, case write-ups 20%. Group work was moderate, about one case per module. Office hours were a lifesaver before the midterm. The valuation skills ended up being useful for interviews. Would definitely take it again.',
  'ACCT:2100': 'Intro to Financial Accounting was around 6 hours per week, pretty steady. We went over the accounting equation, journal entries, adjusting entries and inventory, and the hardest part was adjusting entries. Exams 65%, quizzes 15%, homework 20%. No group work. I went to office hours twice and it helped with adjusting entries. Would take it again; it made me think accounting could work with art.',
};
VIEWS.review = async (m) => {
  if (needProfile()) return;
  const taken = (S.profile.courses_taken || []).map((c) => c.course_id);
  const cs = h('select', {}, ...[...new Set([S.arg?.course_id, ...taken, 'MBA:8180', 'ACCT:2100', 'MBA:8150', 'BAIS:6070', 'MBA:9130', 'CS:2210'].filter(Boolean))].map((c) => h('option', { value: c }, c)));
  const term = h('select', {}, ...['Fall 2026', 'Spring 2026', 'Fall 2025', 'Summer 2026', 'Spring 2022', 'Fall 2021'].map((t) => h('option', {}, t)));
  const narrative = h('textarea', { placeholder: 'Optional but recommended: describe the course like you would to a friend: hours per week, what you covered, hardest part, grading, office hours… The AI pulls out the structure and asks only for the gaps.' });
  const box = h('div');
  m.replaceChildren(h('h1', {}, 'Review a course'), h('p', { class: 'muted' }, 'This isn\'t free text. An AI-led interview produces a validated CourseReview record: one question at a time, quick-select buttons, measurable answers, and an example required for any 1 or 5.'),
    h('div', { class: 'card' }, h('div', { class: 'grid g3' }, h('label', { class: 'f' }, 'Course', cs), h('label', { class: 'f' }, 'Term', term), h('div', { class: 'col', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn light sm', onclick: () => (narrative.value = DEMO_NARRATIVE[cs.value] || DEMO_NARRATIVE['MBA:8180']) }, 'Fill demo narrative'))),
      h('label', { class: 'f', style: { marginTop: '10px' } }, 'Tell it your way (optional)', narrative),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn gold', onclick: async (e) => { e.target.disabled = true; try { const first = await api('x_interview_start', { kind: 'review', profile_id: S.profileId, course_id: cs.value, term: term.value, narrative: narrative.value.trim() || undefined }); chat(box, first, { fields: REVIEW_FIELDS, onDone: (st) => box.prepend(h('div', { class: 'card', style: { background: 'var(--green-soft)' } }, h('b', {}, st.saved.published ? 'Published.' : 'Saved and held for staff moderation.'), ` Review ${st.saved.review.id} + ${st.saved.good_to_know_ids.length} good-to-know(s). `, h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); go('courses', { course_id: cs.value }); } }, `See the updated ${cs.value} page →`))) }); } finally { e.target.disabled = false; } } }, 'Start interview'), h('span', { class: 'small muted' }, 'tools: x_interview_start → x_interview_answer → validate → save_review'))),
    box);
  if (S.arg?.course_id) cs.value = S.arg.course_id;
};

// ---- 4. For you ----
VIEWS.foryou = async (m) => {
  if (needProfile()) return;
  const r = await api('recommend_events_resources', { profile_id: S.profileId, limit: 10 });
  const dt = (s) => { if (!s) return null; const d = new Date(s.length === 10 ? s + 'T12:00:00-06:00' : s); const tz = { timeZone: 'America/Chicago' }; return { m: d.toLocaleString('en-US', { month: 'short', ...tz }), d: d.toLocaleString('en-US', { day: 'numeric', ...tz }), t: s.length > 10 ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...tz }) + ' CT' : '' }; };
  m.replaceChildren(h('div', { class: 'row between' }, h('div', {}, h('h1', {}, `For you, ${S.profile.display_name.split(' ')[0]}`), h('p', { class: 'muted' }, `Real events and resources, ranked for a ${label(S.profile.stage)} ${S.profile.program_type} profile. Matched on: ${r.profile_tags.map(label).join(', ')}.`)), h('a', { class: 'btn light', href: `/api/events.ics?profile_id=${S.profileId}` }, '⤓ Add all to calendar (.ics)')),
    r.nudges.length ? h('div', { class: 'card' }, h('h3', {}, 'Nudges'), ...r.nudges.map((n) => h('div', { class: 'nudge row between' }, h('span', {}, n.text, ...(n.cites || []).map((c) => h('span', { class: 'chip link', style: { marginLeft: '6px' }, onclick: () => showRecord(c) }, c))), n.action ? h('button', { class: 'btn light sm', onclick: () => (n.kind === 'give_back' ? go('review', { course_id: n.course_id }) : go('outcome', { backfill_index: n.action.arguments.backfill_index })) }, n.kind === 'give_back' ? 'Review →' : 'Backfill →') : null))) : null,
    ...r.items.map((e) => { const d = dt(e.schedule?.start); return h('div', { class: 'card ev' }, d ? h('div', { class: 'date' }, h('div', { class: 'm' }, d.m), h('div', { class: 'd' }, d.d), h('div', { class: 'tiny muted' }, d.t)) : h('div', { class: 'date' }, h('div', { class: 'm', style: { color: 'var(--blue)' } }, label(e.type).slice(0, 9)), h('div', { class: 'tiny muted', style: { padding: '0 4px' } }, e.schedule?.recurring || 'ongoing')),
      h('div', {}, h('div', { class: 'row between' }, h('b', {}, e.title), h('div', { class: 'row' }, e.relationship_nudge ? h('span', { class: 'chip gold' }, 'relationship-builder') : null, h('span', { class: 'chip real' }, 'real'), e.source_url ? h('a', { class: 'tiny', href: e.source_url, target: '_blank' }, 'source') : null)), h('div', { class: 'small muted' }, `${e.location_or_url || ''}`), h('div', { class: 'small' }, e.description), h('div', { class: 'why' }, e.why_this_matches_you))); }));
};

// ---- 5. Outcome ----
VIEWS.outcome = async (m) => {
  if (needProfile()) return;
  const box = h('div');
  const backfill = S.arg && Number.isInteger(S.arg.backfill_index);
  const f = { role: h('input', { placeholder: 'e.g. FP&A Manager, Data Analyst, Staff Accountant', value: S.profileId === 'pro_daniel' ? 'FP&A Manager' : S.profileId === 'pro_maya' ? 'Accounting Intern' : '' }), type: h('select', {}, ...['full_time', 'internship', 'promotion', 'fellowship', 'startup', 'other'].map((t) => h('option', { value: t, selected: (S.profileId === 'pro_daniel' && t === 'promotion') || (S.profileId === 'pro_maya' && t === 'internship') }, label(t)))), org: h('select', {}, ...['private_company', 'public_company', 'nonprofit', 'government', 'startup', 'university'].map((t) => h('option', { value: t }, label(t)))), season: h('input', { value: 'Spring 2027' }) };
  const done = async (st) => { const pi = st.saved.path_insight; box.prepend(h('div', { class: 'card', style: { background: 'var(--green-soft)' } }, h('b', {}, `Logged ${st.saved.outcome.id}. `), `It now counts toward "${pi.target_label}" (n=${pi.n}${pi.min_n_met ? '' : `, needs ${pi.min_n}`}). `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('paths', { target: st.saved.outcome.target }); } }, 'See Path Insights →'))); };
  const start = async (args) => chat(box, await api('x_interview_start', { kind: 'outcome', profile_id: S.profileId, ...args }), { fields: OUTCOME_FIELDS, onDone: done });
  m.replaceChildren(h('h1', {}, backfill ? 'Backfill a past role' : 'Report a new offer or role'), h('p', { class: 'muted' }, 'The Career Outcome Interview always starts with one question: "What was the single biggest factor in getting this?" Then ranked supporting factors, people (by role), courses, events, and advice for the next cohort.'),
    backfill ? null : h('div', { class: 'card' }, h('div', { class: 'grid g4' }, h('label', { class: 'f' }, 'Role / title', f.role), h('label', { class: 'f' }, 'Type', f.type), h('label', { class: 'f' }, 'Organization', f.org), h('label', { class: 'f' }, 'Season', f.season)), h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn gold', onclick: () => start({ outcome_seed: { role: f.role.value, type: f.type.value, org_type: f.org.value, season: f.season.value } }) }, '🎉 I got it: start the interview'))),
    box);
  if (backfill) start({ backfill_index: S.arg.backfill_index });
};

// ---- 6. Paths ----
VIEWS.paths = async (m) => {
  const targets = [['finance_leadership', 'Finance leadership'], ['business_analytics', 'Business / data analytics'], ['project_program_mgmt', 'Project / program mgmt'], ['marketing', 'Marketing (thin data)']];
  const sel = S.arg?.target || 'finance_leadership';
  const r = await api('get_path_insights', { target: sel });
  const bar = (lbl, v, n, extra) => h('div', { class: 'b' }, h('span', {}, lbl, extra), h('div', { class: 'meter gold' }, h('i', { style: { width: `${(v / n) * 100}%` } })), h('span', { class: 'small muted' }, `${v}/${n}`));
  m.replaceChildren(h('h1', {}, 'What it took'), h('p', { class: 'muted' }, `Aggregated from Career Outcome Interviews. Shown only at n ≥ ${r.min_n}; small groups are merged so nobody can be singled out.`),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, ...targets.map(([t, l]) => h('button', { class: `btn ${t === sel ? '' : 'light'} sm`, onclick: () => go('paths', { target: t }) }, l))),
    !r.min_n_met ? h('div', { class: 'gate' }, h('b', {}, `Not enough data yet (${r.n}/${r.min_n}).`), ' ', r.message)
      : h('div', {},
        h('div', { class: 'grid g4' }, h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, r.n), h('div', { class: 'kpi-l' }, 'outcomes (synthetic)')), h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, label(r.factor_distribution[0].category)), h('div', { class: 'kpi-l' }, `#1 "single biggest factor" (${pctf(r.factor_distribution[0].share)})`)), h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, r.typical_timeline ? `${r.typical_timeline.median_weeks} wks` : '–'), h('div', { class: 'kpi-l' }, r.typical_timeline ? `median first contact → offer (IQR ${r.typical_timeline.p25_weeks}–${r.typical_timeline.p75_weeks})` : 'timeline')), h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, r.confidence), h('div', { class: 'kpi-l' }, h('span', { class: 'chip link', onclick: () => showRecord(`agg:path:${sel}`) }, `agg:path:${sel}`)))),
        h('div', { class: 'grid g2' },
          h('div', { class: 'card' }, h('h3', {}, 'Single biggest factor'), h('div', { class: 'bars' }, ...r.factor_distribution.map((f) => bar(label(f.category), f.count, r.n))), h('h3', { style: { marginTop: '14px' } }, 'How it started'), h('div', { class: 'bars' }, ...r.common_channels.map((c) => bar(label(c.channel), c.count, r.n)))),
          h('div', { class: 'card' }, h('h3', {}, 'Courses that helped (real courses)'), h('div', { class: 'bars' }, ...r.common_courses.map((c) => bar(`${c.course_id}`, c.count, r.n, h('div', { class: 'tiny muted' }, c.title)))), h('h3', { style: { marginTop: '14px' } }, 'Events that mattered'), h('div', { class: 'bars' }, ...r.common_events.map((e) => bar(e.title.replace('Tippie Graduate Career Services: ', ''), e.count, r.n))))),
        h('div', { class: 'card' }, h('h3', {}, 'Advice for the next cohort'), ...(r.sample_advice || []).map((a) => h('div', { class: 'nudge' }, `"${a.text}" `, h('span', { class: 'chip link', onclick: () => showRecord(a.id) }, a.id))))));
};

// ---- 7. Ask ----
VIEWS.ask = async (m) => {
  const q = h('input', { placeholder: 'Ask anything about courses, paths, events…' });
  const out = h('div');
  const SUG = ['How heavy is Managerial Finance and are office hours worth it?', 'What did it take to get into finance leadership?', 'Is BAIS:6070 Data Science manageable for people like me?', 'How is MBA:8150 graded?', 'Is Leadership Communication & Story worth it?', 'I\'m worried about my visa after graduation'];
  const ask = async (text) => {
    q.value = text; out.replaceChildren(h('div', { class: 'muted' }, 'Retrieving records → computing aggregates → composing a cited answer…'));
    const r = await api('ask_cohort', { question: text, profile_id: S.profileId || undefined });
    const html = md(r.answer).replace(/\[([a-z]{2,4}_[\w-]+|agg:[\w:]+)(?:,\s*([^\]]+))?\]/g, (all) => all.slice(1, -1).split(/,\s*/).map((id) => `<span class="cite" data-id="${esc(id)}">${esc(id)}</span>`).join(' '));
    const ans = h('div', { class: 'answer', html });
    ans.querySelectorAll('.cite').forEach((c) => (c.onclick = () => showRecord(c.dataset.id)));
    out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'row', style: { marginBottom: '10px' } }, h('span', { class: `chip ${r.not_enough_data ? 'gold' : 'blue'}` }, `confidence: ${r.confidence}`), r.routed_to_staff ? h('span', { class: 'chip warn' }, 'routed to GPP staff') : null, h('span', { class: 'chip' }, `filters: ${Object.entries(r.filters || {}).filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k, v]) => `${k}=${v}`).join(' · ') || 'none'}`), h('span', { class: 'chip' }, `via ${r.via || 'staff routing'}`)), ans,
      r.retrieved ? h('div', { class: 'small muted', style: { marginTop: '12px' } }, `Retrieved: ${r.retrieved.aggregates.map((a) => `${a.id} (n=${a.n}${a.min_n_met ? '' : ', below min'})`).join(', ') || 'no aggregates'} + ${r.retrieved.records.length} records. Every claim must cite one of these IDs or the answer is rejected and rebuilt from a template.`) : null));
  };
  q.addEventListener('keydown', (e) => e.key === 'Enter' && ask(q.value));
  m.replaceChildren(h('h1', {}, 'Ask the Cohort'), h('p', { class: 'muted' }, 'Structured filters first (course, target role, "people like me"), text search second. The model can only cite retrieved IDs, and says "not enough data" when the evidence is thin.'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, q, h('button', { class: 'btn gold', onclick: () => ask(q.value) }, 'Ask')), h('div', { class: 'quick', style: { marginTop: '10px' } }, ...SUG.map((s) => h('button', { onclick: () => ask(s) }, s)))), out);
};

// ---- 8. Share ----
VIEWS.share = async (m) => {
  const ta = h('textarea', { placeholder: 'Share a tip, a story, or ask a question. e.g. "Tip for MBA:8180: do the Excel warm-up before week 1"', style: { minHeight: '90px' } });
  const out = h('div');
  m.replaceChildren(h('h1', {}, 'Ask & Share'), h('p', { class: 'muted' }, 'Write casually. The AI adds structure (type, scope, tags, linked records) so it stays searchable. Course tips are promoted to good-to-knows, and anything flagged goes to GPP staff.'),
    h('div', { class: 'card' }, ta, h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn gold', onclick: async () => { const r = await api('create_post', { text: ta.value, profile_id: S.profileId || undefined }); const p = r.post; out.prepend(h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'chip blue' }, p.type), h('span', { class: 'chip' }, `scope: ${p.scope}${p.scope_ref ? ' ' + p.scope_ref : ''}`), ...p.tags.map((t) => h('span', { class: 'chip' }, '#' + t)), h('span', { class: `chip ${p.moderation.status === 'approved' ? 'real' : 'warn'}` }, p.moderation.status === 'approved' ? 'published' : `held: ${p.moderation.flags.join(', ')}`), p.escalate_to_staff ? h('span', { class: 'chip warn' }, 'escalated to staff') : null, p.promoted_good_to_know_id ? h('span', { class: 'chip gold' }, `promoted → ${p.promoted_good_to_know_id}`) : null), h('p', {}, p.text), p.linked_record_ids.length ? h('div', { class: 'small' }, 'Linked: ', ...p.linked_record_ids.map((id) => h('span', { class: 'chip link', onclick: () => showRecord(id) }, id))) : null)); ta.value = ''; } }, 'Post'),
      h('button', { class: 'btn light sm', onclick: () => (ta.value = 'Tip for ACCT:2100: do the practice problems on paper, exams are not open-note.') }, 'example tip'), h('button', { class: 'btn light sm', onclick: () => (ta.value = 'The MBA:8150 prof is an idiot and dresses badly lol') }, 'example: gets moderated'), h('button', { class: 'btn light sm', onclick: () => (ta.value = 'Does anyone know if CPT works for a spring internship? Worried about my visa.') }, 'example: escalates'))), out);
};

// ---- 9. Admin ----
VIEWS.admin = async (m) => {
  const a = await api('x_admin_overview');
  const q = await api('x_moderation_queue', {}, { quiet: true });
  const fam = a.alumni_title_families;
  const maxF = Math.max(...(fam?.families || [{ n: 1 }]).map((f) => f.n));
  m.replaceChildren(h('h1', {}, 'Campus admin · Tippie GPP'), h('p', { class: 'muted' }, `Aggregate and anonymized only. Every number respects n ≥ ${a.min_n}. This is where people, not the AI, make the calls.`),
    h('div', { class: 'grid g4' }, ...[['reviews', a.totals.reviews], ['outcomes', a.totals.outcomes], ['good-to-knows', a.totals.good_to_knows], ['pending moderation', a.moderation.pending]].map(([l, v]) => h('div', { class: 'card tight' }, h('div', { class: 'kpi' }, v), h('div', { class: 'kpi-l' }, l)))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h3', {}, 'Moderation queue (human decision)'), q.pending.length ? q.pending.map((p) => h('div', { class: 'tip', style: { gridTemplateColumns: '1fr auto' } }, h('div', { class: 'small' }, h('span', { class: 'chip warn' }, p.flags.join(', ')), ' ', h('span', { class: 'chip' }, `${p.kind} · ${p.course_id || ''}`), h('div', {}, `"${p.text}"`)), h('div', { class: 'row' }, h('button', { class: 'btn light sm', onclick: async () => { await api('x_moderate', { kind: p.kind, id: p.id, decision: 'approved' }); render(); } }, 'Approve'), h('button', { class: 'btn sm', onclick: async () => { await api('x_moderate', { kind: p.kind, id: p.id, decision: 'rejected' }); render(); } }, 'Reject')))) : h('div', { class: 'muted small' }, 'Queue is clear.'),
        h('h3', { style: { marginTop: '16px' } }, 'Escalations → GPP staff'), q.escalations.filter((e) => !e.handled).length ? q.escalations.filter((e) => !e.handled).map((e) => h('div', { class: 'tip', style: { gridTemplateColumns: '1fr auto' } }, h('div', { class: 'small' }, `"${e.text}"`), h('button', { class: 'btn light sm', onclick: async () => { await api('x_moderate', { kind: 'post', id: e.id, decision: 'handled' }); render(); } }, 'Mark handled'))) : h('div', { class: 'muted small' }, 'None open. Sensitive topics (visa, finances, wellbeing, discrimination) route here automatically.')),
      h('div', { class: 'card' }, h('h3', {}, 'What stays in human hands'), h('div', { class: 'col small' }, ...['Publishing anything flagged, and every rejection', 'Visa/immigration, financial hardship, wellbeing, discrimination, academic integrity', 'Mapping pseudonymous instructor IDs to real names (campus-approved only)', 'Changing min-n, taxonomies and event sources (config, not code)', 'Any integration with student records (FERPA review first)'].map((t) => h('div', {}, '• ', t))),
        h('h3', { style: { marginTop: '16px' } }, 'Where GPP alumni work'), fam ? [h('div', { class: 'tiny muted' }, `${fam.total} people · ${fam.distinct_titles} distinct titles · ${fam.source}`), h('div', { class: 'bars' }, ...fam.families.slice(0, 9).map((f) => h('div', { class: 'b' }, h('span', { class: 'small' }, f.family), h('div', { class: 'meter' }, h('i', { style: { width: `${(f.n / maxF) * 100}%` } })), h('span', { class: 'small muted' }, f.n))))] : null)),
    h('div', { class: 'card' }, h('h3', {}, 'Courses (n ≥ min only)'), h('table', {}, h('tr', {}, ...['Course', 'n', 'h/wk', 'difficulty', 'clarity', 'feedback', 'retake', 'used office hrs'].map((t) => h('th', {}, t))), ...a.courses.map((c) => h('tr', {}, h('td', {}, h('b', {}, c.course_id), ' ', c.title), h('td', {}, c.n), h('td', {}, c.workload_median), h('td', {}, c.difficulty), h('td', {}, c.clarity), h('td', { style: { color: c.feedback_quality < 3.5 ? 'var(--red)' : '' } }, c.feedback_quality), h('td', {}, pctf(c.would_retake_share)), h('td', {}, pctf(c.office_hours_used_share))))), h('div', { class: 'small muted', style: { marginTop: '8px' } }, `${a.hidden_courses_below_min_n} course(s) hidden below n=${a.min_n}. Data gaps to ask students about: ${a.data_gaps.map((g) => `${g.course_id} (${g.n})`).join(', ') || 'none'}.`)),
    h('div', { class: 'card' }, h('h3', {}, 'Career paths'), h('table', {}, h('tr', {}, ...['Target', 'n', '#1 biggest factor', 'top course', 'median weeks'].map((t) => h('th', {}, t))), ...a.path_targets.map((t) => h('tr', {}, h('td', {}, t.label), h('td', {}, t.n), t.min_n_met ? [h('td', {}, `${label(t.top_factor?.category)} (${pctf(t.top_factor?.share)})`), h('td', {}, t.top_course?.course_id || '–'), h('td', {}, t.median_weeks ?? '–')] : h('td', { colspan: 3, class: 'muted' }, 'hidden (n below minimum)'))))),
    h('div', { class: 'row' }, h('button', { class: 'btn light sm', onclick: async () => { await fetch('/api/reset', { method: 'POST' }); toast('Demo data reset'); location.reload(); } }, 'Reset demo data')));
};

// ---------------- boot ----------------
S.state = await fetch('/api/state').then((r) => r.json());
$('#mode').textContent = S.state.llm.live ? `● live AI · ${S.state.llm.models.strong}` : '○ scripted fallback';
$('#mode').classList.toggle('live', S.state.llm.live);
renderPersonas(); renderNav(); render();
