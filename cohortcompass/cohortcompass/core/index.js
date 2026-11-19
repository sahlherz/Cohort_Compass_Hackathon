// CohortCompass core: transport-agnostic logic. The web demo and the MCP server both call these
// operations; operation names == MCP tool names so every UI action has an exact MCP equivalent.
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCError, notFound, badRequest } from './errors.js';
import { validate, assertValid, SCHEMA_VERSION, SCHEMAS } from './validate.js';
import { createJsonStore } from './store/json.js';
import { createLLM, loadPrompt } from './llm.js';
import { createInterviewEngine } from './interview.js';
import { extractReview, heuristicResume, normalizeTarget, TARGETS, inferFactorCategory } from './extract.js';
import { moderate } from './moderation.js';
import { createIndex, tokenize, stripContact } from './text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createCore(opts = {}) {
  const env = opts.env || process.env;
  const store = opts.store || createJsonStore(env.CC_DATA_DIR || join(ROOT, 'data', 'db'));
  const llm = opts.llm || createLLM(env);
  const now = () => (env.CC_NOW ? new Date(env.CC_NOW) : new Date()).toISOString();
  const today = () => now().slice(0, 10);
  const campus = () => store.get('campus', env.CC_CAMPUS_ID || 'uiowa') || { id: 'uiowa', name: 'University of Iowa', min_n: 5, programs: [] };
  const MIN_N = () => Number(env.CC_MIN_N || campus().min_n || 5);
  let seq = 0;
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${randomUUID().slice(0, 4)}`;
  const trace = [];
  const engine = createInterviewEngine({ store, llm, newId, now });

  // ---------- helpers ----------
  const envelope = (prefix, { program_id, program_type, source = 'user_interview', synthetic = false, interview_id } = {}) => ({
    id: newId(prefix), schema_version: SCHEMA_VERSION, campus_id: campus().id,
    program_id: program_id || 'tippie-mba', program_type: program_type || 'MBA', created_at: now(), updated_at: now(),
    provenance: { source, synthetic, ...(interview_id ? { interview_id } : {}) }, extensions: {},
  });
  const course = (id) => (id ? store.get('courses', `crs_${String(id).replace(':', '')}`) : null);
  const approved = (r) => !r.moderation || r.moderation.status === 'approved';
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const mode = (xs) => { const c = {}; xs.forEach((x) => x != null && (c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  const countBy = (xs) => { const c = {}; xs.forEach((x) => (c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const confidenceOf = (n) => (n < MIN_N() ? 'insufficient' : n < 10 ? 'low' : n < 20 ? 'medium' : 'high');
  const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',')}}` : JSON.stringify(v));
  function bgBucket(p) {
    const ind = (p?.experience || []).map((e) => `${e.industry} ${e.function}`).join(' ');
    if (/financ|insur/.test(ind)) return 'finance';
    if (/account/.test(ind)) return 'accounting';
    if (/engineer|manufactur/.test(ind)) return 'engineering';
    if (/tech|analytics/.test(ind)) return 'tech';
    if (/health/.test(ind)) return 'healthcare';
    if (/arts|creative/.test(ind)) return 'arts_humanities';
    return 'other';
  }

  function gtkConfidence(g) {
    const days = (Date.parse(now()) - Date.parse(g.last_confirmed_at)) / 864e5;
    const decay = Math.pow(0.5, Math.max(0, days) / 180);
    const base = (g.confirmations + 1) / (g.confirmations + (g.disputes || 0) + 2);
    return { confidence: Math.round(base * decay * 100) / 100, stale: decay < 0.5, days_since_confirmed: Math.round(days) };
  }

  // ---------- operations (== MCP tools) ----------
  const ops = {};

  ops.search_courses = ({ query = '', level, limit = 20, cursor } = {}) => {
    const q = tokenize(query);
    const reviews = store.all('reviews').filter(approved);
    const res = store.list('courses', {
      filter: (c) => (!level || c.level === level) && (!q.length || q.every((t) => tokenize(`${c.course_id} ${c.title} ${c.department} ${(c.tags || []).join(' ')}`).some((w) => w.includes(t)))),
      sort: (a, b) => reviews.filter((r) => r.course_id === b.course_id).length - reviews.filter((r) => r.course_id === a.course_id).length || a.course_id.localeCompare(b.course_id),
      limit, cursor,
    });
    return { ...res, items: res.items.map((c) => ({ course_id: c.course_id, title: c.title, level: c.level, department: c.department, terms_seen: c.terms_seen, review_count: reviews.filter((r) => r.course_id === c.course_id).length, source: c.provenance.source, source_url: c.provenance.source_url })) };
  };

  function courseAggregates(rs) {
    const n = rs.length;
    const workloads = rs.map((r) => r.workload_hours_per_week).filter((x) => x != null);
    const gm = {};
    rs.forEach((r) => { const tot = (r.grading_mix || []).reduce((a, g) => a + g.percent, 0) || 100; (r.grading_mix || []).forEach((g) => { (gm[g.type] ||= []).push((g.percent / tot) * 100); }); });
    const gradingCount = rs.filter((r) => r.grading_mix?.length).length;
    const topics = {};
    rs.forEach((r) => (r.topics_covered || []).forEach((t) => { const k = t.topic.toLowerCase(); topics[k] ||= { topic: t.topic, mentions: 0, hardest_votes: 0 }; topics[k].mentions++; if (t.hardest) topics[k].hardest_votes++; }));
    const ohUsed = rs.filter((r) => r.office_hours_value && r.office_hours_value !== 'not_used');
    return {
      n,
      workload_hours_per_week: { median: median(workloads), p25: pct(workloads, 0.25), p75: pct(workloads, 0.75) },
      workload_trend: mode(rs.map((r) => r.workload_trend)),
      difficulty: mean(rs.map((r) => r.difficulty).filter(Boolean)),
      clarity: mean(rs.map((r) => r.clarity).filter(Boolean)),
      feedback_quality: mean(rs.map((r) => r.feedback_quality).filter(Boolean)),
      instructor_response_time_hours: median(rs.map((r) => r.instructor_response_time_hours).filter((x) => x != null)),
      would_retake_share: Math.round((rs.filter((r) => r.would_retake).length / n) * 100) / 100,
      group_work: mode(rs.map((r) => r.group_work_intensity)),
      cold_calling: mode(rs.map((r) => r.cold_calling)),
      attendance_impact: mode(rs.map((r) => r.attendance_impact)),
      office_hours: { used_share: Math.round((ohUsed.length / n) * 100) / 100, high_value_share_of_users: ohUsed.length ? Math.round((ohUsed.filter((r) => r.office_hours_value === 'high').length / ohUsed.length) * 100) / 100 : null, n_used: ohUsed.length },
      grading_mix: gradingCount >= MIN_N() ? Object.entries(gm).map(([type, xs]) => ({ type, percent: Math.round(xs.reduce((a, b) => a + b, 0) / gradingCount) })).filter((g) => g.percent >= 3).sort((a, b) => b.percent - a.percent) : null,
      topics: Object.values(topics).filter((t) => t.mentions >= 2).sort((a, b) => b.mentions - a.mentions).slice(0, 10),
      top_skills: countBy(rs.flatMap((r) => (r.skills_gained || []).map((s) => s.toLowerCase()))).filter(([, c]) => c >= 2).slice(0, 8).map(([skill, count]) => ({ skill, count })),
      recruiter_signal: mode(rs.map((r) => r.career_relevance?.recruiter_signal)),
      best_for: countBy(rs.flatMap((r) => r.best_for || [])).filter(([, c]) => c >= 2).slice(0, 4).map(([text, count]) => ({ text, count })),
      avoid_if: countBy(rs.flatMap((r) => r.avoid_if || [])).filter(([, c]) => c >= 2).slice(0, 4).map(([text, count]) => ({ text, count })),
    };
  }

  ops.get_course_insights = ({ course_id, background_bucket } = {}) => {
    const c = course(course_id);
    if (!c) throw notFound('course', course_id);
    const all = store.all('reviews').filter((r) => r.course_id === course_id && approved(r));
    const minN = MIN_N();
    const agg = all.length >= minN ? courseAggregates(all) : null;
    let like_me = null;
    if (background_bucket) {
      const sub = all.filter((r) => r.reviewer_context?.background_bucket === background_bucket);
      like_me = sub.length >= minN ? { background_bucket, ...courseAggregates(sub) } : { background_bucket, n: sub.length, min_n_met: false };
    }
    // small-cell suppression of reviewer context (k >= 3 per program_year × background combo)
    const combo = (r) => `${r.reviewer_context?.program_year}|${r.reviewer_context?.background_bucket}`;
    const comboCount = countBy(all.map(combo));
    const safeCtx = (r) => ((comboCount.find(([k]) => k === combo(r))?.[1] || 0) >= 3 ? { program_year: r.reviewer_context?.program_year, background_bucket: r.reviewer_context?.background_bucket } : { hidden: 'small group' });
    const gtks = store.all('gtks').filter((g) => g.scope === 'course' && g.scope_ref === course_id && approved(g)).map((g) => ({ id: g.id, category: g.category, text: g.text, example: g.example, confirmations: g.confirmations, ...gtkConfidence(g), synthetic: g.provenance.synthetic })).sort((a, b) => b.confidence - a.confidence);
    return {
      course: { course_id: c.course_id, title: c.title, level: c.level, department: c.department, terms_seen: c.terms_seen, prerequisites_official: c.prerequisites_official, description_short: c.description_short, source: c.provenance.source, source_url: c.provenance.source_url },
      n: all.length, min_n: minN, min_n_met: all.length >= minN, confidence: confidenceOf(all.length),
      aggregates: agg, aggregate_id: `agg:${course_id}`, like_me,
      reviews: all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12).map((r) => ({ id: r.id, term: r.term, format: r.format, workload_hours_per_week: r.workload_hours_per_week, difficulty: r.difficulty, clarity: r.clarity, would_retake: r.would_retake, examples: r.examples, best_for: r.best_for, avoid_if: r.avoid_if, reviewer_context: safeCtx(r), synthetic: r.provenance.synthetic, created_at: r.created_at })),
      good_to_knows: gtks,
      cited_record_ids: all.map((r) => r.id),
    };
  };

  ops.parse_resume = async ({ text } = {}) => {
    if (!text || text.length < 40) throw badRequest('resume text too short', { missing_fields: ['text'] });
    const cleaned = stripContact(text);
    const pii_removed = (cleaned.match(/\[(email|phone|link|address) removed\]/g) || []).length;
    let draft = heuristicResume(text, new Date(now()));
    let via = 'heuristic';
    if (llm.live) {
      const out = await llm.call('cheap', loadPrompt('profile_builder', { campus_name: 'University of Iowa', program_name: 'Tippie' }), `TODAY: ${today()}\nRESUME_TEXT:\n${cleaned}`, { maxTokens: 1500 });
      if (out?.draft) {
        const merged = { ...draft, ...out.draft };
        const probe = { ...envelope('pro'), ...merged, consent: { share_reviews: false, share_outcomes_aggregate: false, contact_by_peers: false } };
        delete probe._goals_text;
        if (validate('profile', probe).valid) { draft = merged; via = 'llm'; }
      }
    }
    delete draft._goals_text;
    const ed = draft.education?.find((e) => /iowa|tippie/i.test(e.institution));
    const program_type = /MBA/i.test(ed?.degree || '') ? 'MBA' : /MSF|Finance/i.test(`${ed?.degree} ${ed?.field}`) && /M/.test(ed?.degree || '') ? 'MSF' : /BBA|BS|BA|Bachelor/i.test(ed?.degree || '') ? 'BBA' : 'other';
    const program_id = { MBA: 'tippie-mba', MSF: 'tippie-msf', BBA: 'tippie-bba' }[program_type] || 'tippie-gpp';
    const profile = {
      ...envelope('pro', { program_id, program_type, source: 'user_form' }),
      ...draft,
      courses_taken: [],
      visibility: { experience: 'cohort', education: 'cohort', skills: 'cohort', career_targets: 'campus_aggregate_only' },
      consent: { share_reviews: false, share_outcomes_aggregate: false, contact_by_peers: false, resume_retention_days: 0 },
      draft: true,
    };
    const v = validate('profile', profile);
    return { profile_draft: profile, validation: v, pii_removed, via, resume_retained: false, backfill_candidates: (profile.experience || []).map((e, i) => ({ index: i, title: e.title, start: e.start, end: e.end })) };
  };

  ops.upsert_profile = ({ profile } = {}) => {
    if (!profile) throw badRequest('profile required', { missing_fields: ['profile'] });
    const existing = profile.id ? store.get('profiles', profile.id) : null;
    const rec = { ...(existing || envelope('pro', { source: 'user_form' })), ...profile, schema_version: SCHEMA_VERSION, updated_at: now(), draft: false };
    if (!rec.created_at) rec.created_at = now();
    assertValid('profile', rec);
    store.put('profiles', rec);
    return { profile: rec, created: !existing };
  };

  ops.validate_review = ({ review } = {}) => validate('course-review', review || {});

  async function persistGTKs(texts, { course_id, review_id, program_id, program_type, synthetic = false }) {
    const ids = [];
    for (const text of texts) {
      const m = await moderate(llm, text);
      const warning = /avoid|warn|careful|don'?t|beware|heads up/i.test(text);
      const g = { ...envelope('gtk', { program_id, program_type, source: 'user_interview', synthetic }), scope: 'course', scope_ref: course_id, category: warning ? 'warning' : /hours|week|workload|front|heavy/i.test(text) ? 'workload' : /grade|exam|curve/i.test(text) ? 'grading' : /recruit|interview|job/i.test(text) ? 'recruiting' : /office hours|tutor|resource/i.test(text) ? 'resource' : 'logistics', text: text.slice(0, 280), ...(warning ? { example: text.slice(0, 400) } : {}), applies_terms: [], confirmations: 1, disputes: 0, last_confirmed_at: now(), source_review_id: review_id, moderation: { status: m.status, flags: m.flags } };
      const v = validate('good-to-know', g);
      if (!v.valid) continue;
      store.put('gtks', g);
      ids.push(g.id);
    }
    return ids;
  }

  ops.save_review = async ({ review, idempotency_key, good_to_knows_text = [] } = {}) => {
    if (!review) throw badRequest('review required', { missing_fields: ['review'] });
    if (idempotency_key) { const prev = store.get('idempotency', idempotency_key); if (prev) return { ...prev.result, idempotent_replay: true }; }
    if (!course(review.course_id)) throw notFound('course', review.course_id);
    const rec = { ...envelope('rev'), ...review, schema_version: SCHEMA_VERSION, updated_at: now() };
    if (!review.id) rec.id = newId('rev');
    const text = [...(rec.examples || []).map((e) => e.evidence), ...(rec.best_for || []), ...(rec.avoid_if || [])].join('\n');
    const m = await moderate(llm, text);
    rec.moderation = { status: m.status, flags: m.flags, reviewed_by: 'auto', reviewed_at: now() };
    assertValid('course-review', rec);
    rec.good_to_knows = await persistGTKs(good_to_knows_text, { course_id: rec.course_id, review_id: rec.id, program_id: rec.program_id, program_type: rec.program_type });
    store.put('reviews', rec);
    const result = { review: rec, moderation: m, published: m.status === 'approved', good_to_know_ids: rec.good_to_knows };
    if (idempotency_key) store.put('idempotency', { id: idempotency_key, result });
    return result;
  };

  ops.create_post = async ({ profile_id, text, type } = {}) => {
    if (!text) throw badRequest('text required', { missing_fields: ['text'] });
    const codes = [...String(text).toUpperCase().matchAll(/\b([A-Z]{2,5})\s?:?\s?(\d{4})\b/g)].map((m) => `${m[1]}:${m[2]}`).filter((c) => course(c));
    const m = await moderate(llm, text);
    let structured = { type: type || (/\?\s*$/.test(text.trim()) ? 'question' : /\b(tip|pro tip|psa|heads up|make sure|don'?t)\b/i.test(text) ? 'tip' : 'story'), scope: codes.length ? 'course' : /recruit|job|offer|interview|career/i.test(text) ? 'career' : 'program', scope_ref: codes[0], tags: [...new Set([...codes.map((c) => c.toLowerCase()), ...tokenize(text).filter((w) => ['workload', 'recruiting', 'networking', 'office', 'exam', 'grading', 'internship', 'alumni', 'excel', 'python', 'finance', 'analytics', 'career'].includes(w))])].slice(0, 6), linked_record_ids: [] };
    const idx = createIndex(store.all('gtks').filter(approved).map((g) => ({ id: g.id, text: g.text })));
    structured.linked_record_ids = idx.search(text, 3).filter((r) => r.score > 1.5).map((r) => r.id);
    if (llm.live) {
      const out = await llm.call('cheap', loadPrompt('post_structurer'), `CANDIDATES: ${JSON.stringify(structured.linked_record_ids)}\nKNOWN_COURSES: ${JSON.stringify(codes)}\nPOST:\n${text}`, { maxTokens: 300 });
      if (out?.type) structured = { ...structured, ...out, linked_record_ids: (out.linked_record_ids || []).filter((id) => structured.linked_record_ids.includes(id)), tags: (out.tags || structured.tags).map((t) => String(t).toLowerCase().replace(/[^a-z0-9_:-]/g, '_')).filter((t) => t.length >= 2).slice(0, 10) };
    }
    const profile = profile_id ? store.get('profiles', profile_id) : null;
    const post = { ...envelope('pst', { program_id: profile?.program_id, program_type: profile?.program_type, source: 'user_form' }), author_profile_id: profile_id, type: structured.type, scope: structured.scope, ...(structured.scope_ref ? { scope_ref: structured.scope_ref } : {}), tags: structured.tags, text: stripContact(text), linked_record_ids: structured.linked_record_ids, escalate_to_staff: m.escalate_to_staff || !!structured.escalate_to_staff, moderation: { status: m.status, flags: m.flags } };
    assertValid('post', post);
    if (post.type === 'tip' && post.scope === 'course' && m.status === 'approved') {
      const [gid] = await persistGTKs([text.slice(0, 280)], { course_id: post.scope_ref, review_id: undefined, program_id: post.program_id, program_type: post.program_type });
      if (gid) post.promoted_good_to_know_id = gid;
    }
    store.put('posts', post);
    return { post, moderation: m, routed_to_staff: post.escalate_to_staff };
  };

  // ---------- recommendations ----------
  const SYN = { finance: ['finance', 'financial', 'fp&a', 'cfo', 'investment', 'msf', 'portfolio', 'fin'], leadership: ['leadership', 'leader', 'manager', 'management', 'director', 'lead'], analytics: ['analytics', 'data', 'python', 'sql', 'tableau', 'ai', 'bi', 'analyst'], ai: ['ai', 'genai', 'artificial', 'machine', 'llm', 'automation'], accounting: ['accounting', 'accountant', 'cpa', 'audit', 'tax', 'acct'], arts: ['art', 'arts', 'design', 'gallery', 'museum', 'creative', 'drawing', 'painting', 'studio', 'media'], entrepreneurship: ['entrepreneur', 'entrepreneurship', 'startup', 'venture', 'innovation', 'business owner'], networking: ['networking', 'network', 'alumni', 'mixer', 'connect'], undecided: ['undecided', 'exploring', 'unsure', 'major'], project_management: ['project', 'program', 'agile', 'pmp', 'scrum'], further_education: ['mba', 'certificate', 'master', 'return', 'more education', 'graduate school'] };
  function profileTags(p) {
    const txt = [...(p.career_targets || []), ...(p.interests || []), ...(p.skills || []), ...(p.experience || []).flatMap((e) => [e.title, e.industry, e.function]), ...(p.education || []).flatMap((e) => [e.field, e.degree])].join(' ').toLowerCase();
    const tags = new Set();
    for (const [k, ws] of Object.entries(SYN)) if (ws.some((w) => txt.includes(w))) tags.add(k);
    for (const t of p.career_targets || []) tags.add(normalizeTarget(t));
    return tags;
  }
  ops.recommend_events_resources = ({ profile_id, limit = 8, include_past = false } = {}) => {
    const p = store.get('profiles', profile_id);
    if (!p) throw notFound('profile', profile_id);
    const tags = profileTags(p);
    const t0 = today();
    const items = store.all('events').filter((e) => include_past || !e.schedule?.start || e.schedule.recurring || e.schedule.start.slice(0, 10) >= t0).map((e) => {
      let score = 0;
      const why = [];
      const st = e.audience_tags?.stage || [];
      if (st.includes(p.stage)) { score += 3; why.push(p.stage === 'alumni' ? 'open to alumni' : p.stage === 'enrolled' ? 'built for current students' : 'timed for students heading out'); }
      else if (st.length) score -= 4;
      const hit = (e.audience_tags?.interest || []).filter((i) => tags.has(i));
      score += hit.length * 2.5;
      if (hit.length) why.push(`matches your ${hit.map((h) => h.replace(/_/g, ' ')).join(' + ')} interest${hit.length > 1 ? 's' : ''}`);
      const track = (e.audience_tags?.track || []).includes(p.program_type) || (e.audience_tags?.track || []).includes(p.program_id);
      if (track) { score += 1.5; why.push(`for ${p.program_type} students/alumni`); }
      if (e.schedule?.start) { const d = (Date.parse(e.schedule.start) - Date.parse(t0)) / 864e5; if (d >= 0 && d <= 21) { score += 1; why.push(d < 1 ? 'happening today' : `in ${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}`); } }
      if (e.relationship_nudge) { score += 0.5; why.push('a relationship-builder: people you meet here are how most referrals start'); }
      return { id: e.id, type: e.type, title: e.title, description: e.description, schedule: e.schedule, location_or_url: e.location_or_url, source_url: e.source_url, relationship_nudge: !!e.relationship_nudge, score: Math.round(score * 10) / 10, why_this_matches_you: why.length ? `Because it's ${why.slice(0, 3).join(', ')}.`.replace("Because it's matches", 'Because it matches').replace("Because it's for", 'Because it is for').replace("Because it's open", 'Because it is open') : 'General campus resource.', matched_tags: hit };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    // nudges: office hours (evidence-based), give back (review courses), backfill outcomes
    const nudges = [];
    for (const ct of p.courses_taken || []) {
      const rs = store.all('reviews').filter((r) => r.course_id === ct.course_id && approved(r));
      if (!ct.reviewed && nudges.filter((n) => n.kind === 'give_back').length < 2) nudges.push({ kind: 'give_back', course_id: ct.course_id, text: rs.length ? `Give back: review ${ct.course_id} in ~3 minutes. ${rs.length} classmates' reviews are already helping others.` : `Be the first to review ${ct.course_id}. Your review starts the course page for the next cohort.`, action: { tool: 'x_interview_start', arguments: { kind: 'review', profile_id, course_id: ct.course_id } } });
    }
    const target = (p.career_targets || []).map(normalizeTarget).find((t) => t !== 'other');
    if (target) {
      const pi = ops.get_path_insights({ target });
      const topCourse = pi.min_n_met && pi.common_courses[0];
      if (topCourse) {
        const rs = store.all('reviews').filter((r) => r.course_id === topCourse.course_id && approved(r));
        const used = rs.filter((r) => r.office_hours_value && r.office_hours_value !== 'not_used');
        if (used.length >= MIN_N()) nudges.push({ kind: 'office_hours', course_id: topCourse.course_id, text: `${topCourse.course_id} shows up in ${topCourse.count}/${pi.n} "${TARGETS[target]?.label}" paths. ${used.filter((r) => r.office_hours_value === 'high').length}/${used.length} reviewers who went to its office hours rated them high-value.`, cites: [`agg:path:${target}`, `agg:${topCourse.course_id}`] });
      }
    }
    (p.experience || []).forEach((e, i) => { if (!e.outcome_logged && nudges.filter((n) => n.kind === 'backfill').length < 1) nudges.push({ kind: 'backfill', text: `Optional (2 min): what got you the "${e.title}" role? Your answer feeds Path Insights for the next cohort.`, action: { tool: 'x_interview_start', arguments: { kind: 'outcome', profile_id, backfill_index: i } } }); });
    return { profile_id, profile_tags: [...tags], items, nudges };
  };

  ops.log_career_outcome = async ({ outcome, idempotency_key } = {}) => {
    if (!outcome) throw badRequest('outcome required', { missing_fields: ['outcome'] });
    if (idempotency_key) { const prev = store.get('idempotency', idempotency_key); if (prev) return { ...prev.result, idempotent_replay: true }; }
    const p = outcome.profile_id ? store.get('profiles', outcome.profile_id) : null;
    const rec = { ...envelope('out', { program_id: p?.program_id, program_type: p?.program_type }), ...outcome, target: outcome.target || normalizeTarget(outcome.role), schema_version: SCHEMA_VERSION, updated_at: now() };
    if (!outcome.id) rec.id = newId('out');
    assertValid('career-outcome', rec);
    store.put('outcomes', rec);
    if (p && rec.backfill && Number.isInteger(rec.extensions?.x_backfill_index)) { p.experience[rec.extensions.x_backfill_index].outcome_logged = true; store.put('profiles', p); }
    const result = { outcome: rec, path_insight: ops.get_path_insights({ target: rec.target }) };
    if (idempotency_key) store.put('idempotency', { id: idempotency_key, result });
    return result;
  };

  ops.get_path_insights = ({ target } = {}) => {
    if (!target) throw badRequest('target required', { missing_fields: ['target'] });
    const minN = MIN_N();
    const rs = store.all('outcomes').filter((o) => o.target === target);
    const n = rs.length;
    const base = { ...envelope('pin', { source: 'seed' }), provenance: { source: 'seed', synthetic: rs.some((r) => r.provenance.synthetic) }, target, target_label: TARGETS[target]?.label || target, n, min_n: minN, min_n_met: n >= minN, confidence: confidenceOf(n), computed_at: now() };
    if (n < minN) return { ...base, factor_distribution: [], common_courses: [], common_events: [], common_channels: [], cited_record_ids: [], message: `Not enough data yet (${n}/${minN} outcomes). Ask a GPP career coach, or log your own outcome to help.` };
    const suppress = (rows, k = 2) => { const keep = rows.filter((r) => r.count >= k); const other = rows.filter((r) => r.count < k).reduce((a, r) => a + r.count, 0); return other ? [...keep, { ...Object.fromEntries(Object.keys(rows[0]).map((kk) => [kk, kk === 'count' ? other : kk === 'share' ? 0 : 'other (small groups combined)'])), count: other }] : keep; };
    const fd = countBy(rs.map((r) => r.biggest_factor.category)).map(([category, count]) => ({ category, count, share: Math.round((count / n) * 100) / 100 }));
    const cc = countBy(rs.flatMap((r) => (r.courses_that_helped || []).map((c) => c.course_id))).map(([course_id, count]) => ({ course_id, title: course(course_id)?.title || course_id, count }));
    const ev = countBy(rs.flatMap((r) => (r.events_attended || []).map((e) => e.title))).map(([title, count]) => ({ title, count }));
    const ch = countBy(rs.map((r) => r.channel).filter(Boolean)).map(([channel, count]) => ({ channel, count }));
    const weeks = rs.map((r) => r.timeline?.weeks_total).filter((x) => x != null);
    const insight = { ...base, factor_distribution: suppress(fd).map((f) => ({ ...f, share: f.share || Math.round((f.count / n) * 100) / 100 })), common_courses: cc.filter((c) => c.count >= 2).slice(0, 6), common_events: ev.filter((e) => e.count >= 2).slice(0, 5), common_channels: suppress(ch), typical_timeline: weeks.length >= minN ? { median_weeks: median(weeks), p25_weeks: pct(weeks, 0.25), p75_weeks: pct(weeks, 0.75) } : undefined, cited_record_ids: rs.map((r) => r.id) };
    if (!insight.typical_timeline) delete insight.typical_timeline;
    const v = validate('path-insight', insight);
    if (!v.valid) throw new CCError('INTERNAL', 'path insight failed schema', v);
    const advice = rs.filter((r) => r.advice_for_next_cohort).slice(0, 3).map((r) => ({ id: r.id, text: r.advice_for_next_cohort }));
    return { ...insight, sample_advice: advice };
  };

  // ---------- Ask the Cohort ----------
  ops.ask_cohort = async ({ question, profile_id } = {}) => {
    if (!question) throw badRequest('question required', { missing_fields: ['question'] });
    const minN = MIN_N();
    const p = profile_id ? store.get('profiles', profile_id) : null;
    const m = await moderate({ live: false }, question);
    if (m.escalate_to_staff) return { answer: 'That sounds like something a person at Tippie Graduate & Professional Programs should help with directly, and I don\'t want to guess. I\'ve flagged it for GPP staff, and you can also reach Graduate Career Services or your program advisor.', cited_ids: [], confidence: 'insufficient', not_enough_data: true, routed_to_staff: true, filters: {} };
    const qU = question.toUpperCase();
    const courses = store.all('courses');
    let codes = [...qU.matchAll(/\b([A-Z]{2,5})\s?:?\s?(\d{4})\b/g)].map((mm) => `${mm[1]}:${mm[2]}`).filter((c) => course(c));
    if (!codes.length) {
      const ql = question.toLowerCase();
      const byTitle = courses.filter((c) => c.title.length > 6 && ql.includes(c.title.toLowerCase()));
      codes = (byTitle.length ? byTitle : courses.filter((c) => { const tw = tokenize(c.title).filter((w) => w.length > 3); return tw.length >= 2 && tw.filter((w) => ql.includes(w)).length >= Math.min(2, tw.length); })).map((c) => c.course_id).slice(0, 2);
    }
    let target = normalizeTarget(question);
    if (target === 'other' && /\b(i|me|my)\b/i.test(question) && /path|get there|what it took|land|become/i.test(question) && p) target = (p.career_targets || []).map(normalizeTarget).find((t) => t !== 'other') || 'other';
    const likeMe = /like me|my background|people like me|similar/i.test(question) && p ? bgBucket(p) : null;
    const filters = { course_ids: codes, target: target !== 'other' ? target : null, background_bucket: likeMe };

    const records = [];
    const aggregates = [];
    for (const c of codes) {
      const ins = ops.get_course_insights({ course_id: c, background_bucket: likeMe || undefined });
      aggregates.push({ id: `agg:${c}`, course_id: c, title: ins.course.title, n: ins.n, min_n_met: ins.min_n_met, ...(ins.aggregates ? { workload_median: ins.aggregates.workload_hours_per_week.median, workload_trend: ins.aggregates.workload_trend, difficulty: ins.aggregates.difficulty, clarity: ins.aggregates.clarity, feedback_quality: ins.aggregates.feedback_quality, would_retake_share: ins.aggregates.would_retake_share, office_hours: ins.aggregates.office_hours, grading_mix: ins.aggregates.grading_mix, topics: ins.aggregates.topics.slice(0, 4), best_for: ins.aggregates.best_for, avoid_if: ins.aggregates.avoid_if } : {}), like_me: ins.like_me });
      ins.good_to_knows.slice(0, 3).forEach((g) => records.push({ id: g.id, kind: 'good_to_know', course_id: c, text: g.text, confidence: g.confidence, stale: g.stale, synthetic: g.synthetic }));
      ins.reviews.filter((r) => r.examples?.length).slice(0, 3).forEach((r) => records.push({ id: r.id, kind: 'review_example', course_id: c, text: r.examples[0].evidence, claim: r.examples[0].claim, synthetic: r.synthetic }));
    }
    if (filters.target) {
      const pi = ops.get_path_insights({ target: filters.target });
      aggregates.push({ id: `agg:path:${filters.target}`, target: filters.target, label: pi.target_label, n: pi.n, min_n_met: pi.min_n_met, factor_distribution: pi.factor_distribution, common_courses: pi.common_courses, common_channels: pi.common_channels, typical_timeline: pi.typical_timeline });
      (pi.sample_advice || []).forEach((a) => records.push({ id: a.id, kind: 'outcome_advice', text: a.text, synthetic: true }));
    }
    // semantic-ish search over free text second
    const docs = [
      ...store.all('gtks').filter(approved).map((g) => ({ id: g.id, text: g.text, kind: 'good_to_know', synthetic: g.provenance.synthetic })),
      ...store.all('outcomes').map((o) => ({ id: o.id, text: `${o.role} ${o.biggest_factor.description} ${o.advice_for_next_cohort || ''}`, kind: 'outcome', synthetic: o.provenance.synthetic })),
      ...store.all('posts').filter(approved).map((ps) => ({ id: ps.id, text: ps.text, kind: 'post', synthetic: ps.provenance.synthetic })),
    ];
    const seen = new Set(records.map((r) => r.id));
    createIndex(docs).search(question, 6).filter((r) => r.score > 1.2 && !seen.has(r.id)).slice(0, 4).forEach((r) => records.push({ id: r.id, kind: r.kind, text: r.text.slice(0, 300), synthetic: r.synthetic }));

    const allowed = new Set([...records.map((r) => r.id), ...aggregates.map((a) => a.id)]);
    const anyAgg = aggregates.some((a) => a.min_n_met);
    let result = null;
    if (llm.live && (records.length || aggregates.length)) {
      const out = await llm.call('strong', loadPrompt('ask_cohort', { campus_name: 'University of Iowa Tippie', min_n: minN }), JSON.stringify({ QUESTION: question, ASKER: p ? { stage: p.stage, program_type: p.program_type, targets: p.career_targets } : null, AGGREGATES: aggregates, RECORDS: records }), { maxTokens: 500 });
      const cites = [...String(out?.answer || '').matchAll(/\[([^\]]+)\]/g)].flatMap((mm) => mm[1].split(/,\s*/));
      if (out?.answer && cites.length && cites.every((c) => allowed.has(c.trim()))) result = { answer: out.answer, cited_ids: [...new Set(cites.map((c) => c.trim()))], confidence: out.confidence || (anyAgg ? 'medium' : 'low'), not_enough_data: !!out.not_enough_data, via: 'llm' };
    }
    if (!result) result = templateAnswer(question, aggregates, records, minN);
    return { ...result, filters, retrieved: { aggregates: aggregates.map((a) => ({ id: a.id, n: a.n, min_n_met: a.min_n_met })), records: records.map((r) => ({ id: r.id, kind: r.kind })) } };
  };

  function templateAnswer(question, aggregates, records, minN) {
    const parts = [];
    const cited = new Set();
    const ql = question.toLowerCase();
    for (const a of aggregates.filter((x) => x.course_id)) {
      if (!a.min_n_met) { parts.push(`Not enough data yet on ${a.course_id} ${a.title} (${a.n}/${minN} reviews). Try the instructor's office hours or ask in Ask & Share.`); continue; }
      const s = [`**${a.course_id} ${a.title}**: reviewers report a median ~${a.workload_median} h/week${a.workload_trend && a.workload_trend !== 'steady' ? ` (${a.workload_trend.replace('_', '-')})` : ''}, difficulty ${a.difficulty}/5, clarity ${a.clarity}/5, and ${Math.round(a.would_retake_share * 100)}% would retake [${a.id}].`];
      if (/grad|exam|grade/.test(ql) && a.grading_mix) s.push(`Grading is roughly ${a.grading_mix.slice(0, 3).map((g) => `${g.type.replace(/_/g, ' ')} ${g.percent}%`).join(', ')} [${a.id}].`);
      if (a.office_hours?.n_used >= minN) s.push(`${Math.round(a.office_hours.high_value_share_of_users * 100)}% of those who used office hours rated them high-value [${a.id}].`);
      if (a.like_me) s.push(a.like_me.min_n_met === false ? `Not enough reviews from people with your background yet (${a.like_me.n}/${minN}).` : `Reviewers with a ${a.like_me.background_bucket} background report ~${a.like_me.workload_hours_per_week.median} h/week and difficulty ${a.like_me.difficulty}/5 [${a.id}].`);
      if (a.avoid_if?.length) s.push(`Several say to wait if: ${a.avoid_if[0].text.toLowerCase()} [${a.id}].`);
      cited.add(a.id);
      parts.push(s.join(' '));
    }
    for (const a of aggregates.filter((x) => x.target)) {
      if (!a.min_n_met) { parts.push(`Not enough outcome data yet for ${a.label} (${a.n}/${minN}).`); continue; }
      const top = a.factor_distribution[0];
      parts.push(`**${a.label}** (n=${a.n}): the most common single biggest factor was ${top.category.replace(/_/g, ' ')} (${Math.round(top.share * 100)}%)${a.common_courses[0] ? `; ${a.common_courses[0].course_id} ${a.common_courses[0].title} came up most often (${a.common_courses[0].count}/${a.n})` : ''}${a.typical_timeline ? `; median ~${a.typical_timeline.median_weeks} weeks from first contact to offer` : ''} [${a.id}].`);
      cited.add(a.id);
    }
    const tips = records.filter((r) => r.kind === 'good_to_know' && !r.stale).slice(0, 2);
    if (tips.length) { parts.push('Good to know: ' + tips.map((t) => `${t.text} [${t.id}]`).join(' ')); tips.forEach((t) => cited.add(t.id)); }
    const adv = records.filter((r) => r.kind === 'outcome_advice' || r.kind === 'outcome').slice(0, 1);
    if (adv.length && aggregates.some((a) => a.target && a.min_n_met)) { parts.push(`One alum's advice: "${adv[0].text.slice(0, 160)}" [${adv[0].id}]`); cited.add(adv[0].id); }
    if (!parts.length) return { answer: `Not enough data yet to answer that from cohort records. Try naming a course (e.g. "MBA:8180") or a goal (e.g. "finance leadership"), or ask a GPP career coach.`, cited_ids: [], confidence: 'insufficient', not_enough_data: true, via: 'template' };
    const synthetic = [...cited].some((id) => id.startsWith('agg:') || records.find((r) => r.id === id)?.synthetic);
    return { answer: parts.join('\n\n') + (synthetic ? '\n\n_(demo data: synthetic)_' : ''), cited_ids: [...cited], confidence: aggregates.some((a) => a.min_n_met) ? confidenceOf(Math.max(...aggregates.map((a) => a.n))) : 'low', not_enough_data: !aggregates.some((a) => a.min_n_met), via: 'template' };
  }

  // ---------- Career passport ----------
  ops.export_profile = ({ profile_id, scopes = ['profile', 'outcomes'] } = {}) => {
    const p = store.get('profiles', profile_id);
    if (!p) throw notFound('profile', profile_id);
    const outcomes = scopes.includes('outcomes') ? store.all('outcomes').filter((o) => o.profile_id === profile_id) : [];
    const body = { profile: p, outcomes };
    const passport = { passport_version: SCHEMA_VERSION, exported_at: now(), issuer: { campus_id: p.campus_id, program_id: p.program_id, system: 'cohortcompass' }, consent: { scopes, granted_at: now() }, ...body, reviews_authored: scopes.includes('reviews_authored') ? store.all('reviews').filter((r) => r.extensions?.x_author_profile_id === profile_id).map((r) => r.id) : [], checksum_sha256: createHash('sha256').update(canonical(body)).digest('hex'), extensions: {} };
    assertValid('career-passport', passport);
    return { passport };
  };

  ops.import_profile = ({ passport } = {}) => {
    if (!passport) throw badRequest('passport required', { missing_fields: ['passport'] });
    assertValid('career-passport', passport);
    const sum = createHash('sha256').update(canonical({ profile: passport.profile, outcomes: passport.outcomes })).digest('hex');
    if (passport.checksum_sha256 && passport.checksum_sha256 !== sum) throw new CCError('VALIDATION_FAILED', 'checksum mismatch', { invalid_fields: [{ path: '/checksum_sha256', reason: 'does not match profile+outcomes' }] });
    const exists = store.get('profiles', passport.profile.id);
    const profile = { ...passport.profile, id: exists ? newId('pro') : passport.profile.id, provenance: { ...passport.profile.provenance, source: 'import' }, updated_at: now() };
    store.put('profiles', profile);
    const outcomes = passport.outcomes.map((o) => ({ ...o, id: store.get('outcomes', o.id) ? newId('out') : o.id, profile_id: profile.id, provenance: { ...o.provenance, source: 'import' } }));
    outcomes.forEach((o) => store.put('outcomes', o));
    return { profile_id: profile.id, imported_outcomes: outcomes.length, id_remapped: !!exists };
  };

  // ---------- x_ extensions: interviews, moderation, admin ----------
  function attachFinalize(iv) {
    const p = iv.profile_id ? store.get('profiles', iv.profile_id) : null;
    iv.finalize = (known) => {
      if (iv.kind === 'review') {
        const { good_to_knows, ...k } = known;
        return { ...envelope('rev', { program_id: p?.program_id, program_type: p?.program_type, interview_id: iv.id }), id: `rev_${iv.id.slice(4)}`, course_id: iv.context.course_id, term: iv.context.term, instructor_id: iv.context.instructor_id, ...k, reviewer_context: { program_year: p?.stage === 'alumni' ? 'alumni' : 'year_1', background_bucket: bgBucket(p), ...(p?.career_targets?.[0] ? { career_target: p.career_targets[0].slice(0, 60) } : {}), ...(p?.stage ? { stage: p.stage } : {}) }, summary_confirmed: true, extensions: { ...(k.extensions || {}), ...(p ? { x_author_profile_id: p.id } : {}) } };
      }
      const { ...k } = known;
      return { ...envelope('out', { program_id: p?.program_id, program_type: p?.program_type, interview_id: iv.id }), id: `out_${iv.id.slice(4)}`, profile_id: iv.profile_id, type: iv.context.type, role: iv.context.role, org_type: iv.context.org_type, industry: iv.context.industry, function: iv.context.function, season: iv.context.season, target: normalizeTarget(iv.context.role), backfill: !!iv.backfill, ...k, summary_confirmed: true, extensions: { ...(iv.backfill ? { x_backfill_index: iv.context.backfill_index } : {}) } };
    };
    return iv;
  }

  ops.x_interview_start = async ({ kind, profile_id, course_id, term, narrative, outcome_seed = {}, backfill_index } = {}) => {
    if (!['review', 'outcome'].includes(kind)) throw badRequest('kind must be review|outcome', { invalid_fields: [{ path: '/kind', reason: 'enum' }] });
    const p = profile_id ? store.get('profiles', profile_id) : null;
    const iv = { id: newId('int'), kind, status: 'active', profile_id, created_at: now(), known: {}, skipped: [], gtk_texts: [], transcript: [], pending_example: null, repair: [], context: {} };
    const out = { extracted: null };
    if (kind === 'review') {
      const c = course(course_id);
      if (!c) throw notFound('course', course_id);
      const taken = (p?.courses_taken || []).find((x) => x.course_id === course_id);
      iv.context = { course_id, course_title: c.title, term: term || taken?.term || 'Fall 2025', instructor_id: c.instructor_ids?.[0], stage: p?.stage };
      if (narrative) {
        const ex = await extractReview(llm, narrative, iv.context);
        Object.assign(iv.known, ex.fields);
        iv.gtk_texts.push(...ex.good_to_knows_text);
        out.extracted = { via: ex.via, fields: Object.keys(ex.fields), good_to_knows_text: ex.good_to_knows_text };
        iv.transcript.push({ role: 'user', text: narrative, at: now() });
      }
    } else {
      let seed = outcome_seed;
      if (Number.isInteger(backfill_index) && p?.experience?.[backfill_index]) { const e = p.experience[backfill_index]; seed = { type: 'full_time', role: e.title, org_type: e.org_type || 'private_company', industry: e.industry, function: e.function, season: undefined }; iv.backfill = true; }
      if (!seed.role) throw badRequest('outcome_seed.role required', { missing_fields: ['outcome_seed.role'] });
      iv.context = { type: seed.type || 'full_time', role: seed.role, org_type: seed.org_type || 'private_company', industry: seed.industry, function: seed.function, season: seed.season, courses_taken: p?.courses_taken || [], backfill_index };
    }
    attachFinalize(iv);
    const first = await engine.step(iv, null);
    const lead = kind === 'outcome' && !iv.backfill ? `Congratulations on the ${iv.context.role} offer! ` : kind === 'review' && out.extracted ? `I pulled ${out.extracted.fields.length} fields from what you wrote. I'll only ask about the gaps. ` : '';
    return { ...first, message: lead + first.message, extracted: out.extracted };
  };

  ops.x_interview_answer = async ({ interview_id, answer } = {}) => {
    const iv = store.get('interviews', interview_id);
    if (!iv) throw notFound('interview', interview_id);
    if (iv.status === 'done') throw new CCError('CONFLICT', 'interview already completed');
    attachFinalize(iv);
    const step = await engine.step(iv, answer);
    if (step.status === 'done' && step.record) {
      const saved = iv.kind === 'review'
        ? await ops.save_review({ review: step.record, idempotency_key: `idem_${iv.id}`, good_to_knows_text: iv.gtk_texts })
        : await ops.log_career_outcome({ outcome: step.record, idempotency_key: `idem_${iv.id}` });
      if (iv.kind === 'review' && iv.profile_id) { const p = store.get('profiles', iv.profile_id); const ct = p?.courses_taken?.find((c) => c.course_id === iv.context.course_id); if (ct) { ct.reviewed = true; store.put('profiles', p); } }
      return { ...step, saved };
    }
    return step;
  };

  ops.x_confirm_good_to_know = ({ id, dispute = false } = {}) => {
    const g = store.get('gtks', id);
    if (!g) throw notFound('good_to_know', id);
    if (dispute) g.disputes = (g.disputes || 0) + 1; else { g.confirmations++; g.last_confirmed_at = now(); }
    g.updated_at = now();
    store.put('gtks', g);
    return { id, confirmations: g.confirmations, disputes: g.disputes || 0, ...gtkConfidence(g) };
  };

  ops.x_moderation_queue = () => {
    const pend = (c, kind) => store.all(c).filter((r) => r.moderation?.status === 'pending').map((r) => ({ kind, id: r.id, text: r.text || (r.examples || []).map((e) => e.evidence).join(' / '), flags: r.moderation.flags, course_id: r.course_id || r.scope_ref, created_at: r.created_at }));
    const escalations = store.all('posts').filter((p) => p.escalate_to_staff).map((p) => ({ kind: 'post', id: p.id, text: p.text, created_at: p.created_at, handled: !!p.extensions?.x_staff_handled }));
    return { pending: [...pend('reviews', 'review'), ...pend('gtks', 'good_to_know'), ...pend('posts', 'post')], escalations };
  };

  ops.x_moderate = ({ kind, id, decision } = {}) => {
    const c = { review: 'reviews', good_to_know: 'gtks', post: 'posts' }[kind];
    if (!c) throw badRequest('kind must be review|good_to_know|post');
    const r = store.get(c, id);
    if (!r) throw notFound(kind, id);
    if (decision === 'handled') { r.extensions = { ...(r.extensions || {}), x_staff_handled: true }; store.put(c, r); return { id, handled: true }; }
    if (!['approved', 'rejected', 'needs_edit'].includes(decision)) throw badRequest('decision must be approved|rejected|needs_edit|handled');
    r.moderation = { ...r.moderation, status: decision, reviewed_by: 'staff', ...(kind === 'review' ? { reviewed_at: now() } : {}) };
    store.put(c, r);
    return { id, status: decision };
  };

  ops.x_admin_overview = () => {
    const minN = MIN_N();
    const reviews = store.all('reviews').filter(approved);
    const courseRows = store.all('courses').map((c) => { const rs = reviews.filter((r) => r.course_id === c.course_id); const a = rs.length >= minN ? courseAggregates(rs) : null; return { course_id: c.course_id, title: c.title, n: rs.length, min_n_met: !!a, ...(a ? { workload_median: a.workload_hours_per_week.median, difficulty: a.difficulty, clarity: a.clarity, feedback_quality: a.feedback_quality, would_retake_share: a.would_retake_share, office_hours_used_share: a.office_hours.used_share } : {}) }; }).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
    const targets = [...new Set(store.all('outcomes').map((o) => o.target))].map((t) => { const pi = ops.get_path_insights({ target: t }); return { target: t, label: pi.target_label, n: pi.n, min_n_met: pi.min_n_met, top_factor: pi.factor_distribution?.[0] || null, top_course: pi.common_courses?.[0] || null, median_weeks: pi.typical_timeline?.median_weeks }; }).sort((a, b) => b.n - a.n);
    const q = ops.x_moderation_queue();
    const gaps = store.all('courses').filter((c) => { const n = reviews.filter((r) => r.course_id === c.course_id).length; return n > 0 && n < minN; }).map((c) => ({ course_id: c.course_id, title: c.title, n: reviews.filter((r) => r.course_id === c.course_id).length }));
    return { campus: campus(), min_n: minN, totals: { profiles: store.count('profiles'), reviews: reviews.length, good_to_knows: store.count('gtks'), outcomes: store.count('outcomes'), events: store.count('events'), courses: store.count('courses'), posts: store.count('posts') }, courses: courseRows.filter((r) => r.min_n_met), hidden_courses_below_min_n: courseRows.filter((r) => !r.min_n_met).length, data_gaps: gaps, path_targets: targets, moderation: { pending: q.pending.length, escalations: q.escalations.filter((e) => !e.handled).length }, alumni_title_families: campus().alumni_title_families || null, llm: { mode: llm.live ? 'live' : 'scripted', models: llm.models } };
  };

  ops.x_list_profiles = () => ({ items: store.all('profiles').filter((p) => p.extensions?.x_demo_persona).map((p) => ({ id: p.id, display_name: p.display_name, stage: p.stage, program_type: p.program_type, persona: p.extensions.x_demo_persona })) });
  ops.x_get_profile = ({ profile_id }) => { const p = store.get('profiles', profile_id); if (!p) throw notFound('profile', profile_id); return { profile: p }; };

  // ---------- tracing wrapper: every op call is recorded as its MCP equivalent ----------
  const traced = {};
  const READ_ONLY = new Set(['search_courses', 'get_course_insights', 'validate_review', 'recommend_events_resources', 'get_path_insights', 'ask_cohort', 'export_profile', 'parse_resume', 'x_moderation_queue', 'x_admin_overview', 'x_list_profiles', 'x_get_profile']);
  for (const [name, fn] of Object.entries(ops)) {
    traced[name] = async (args = {}) => {
      const t0 = Date.now();
      const llmBefore = llm.log.length;
      try {
        const result = await fn(args);
        trace.push({ at: now(), tool: name, read_only: READ_ONLY.has(name), arguments: args, ok: true, ms: Date.now() - t0, llm_calls: llm.log.slice(llmBefore).map(({ tier, model, ok, ms, reason }) => ({ tier, model, ok, ms, reason })), result });
        return result;
      } catch (e) {
        trace.push({ at: now(), tool: name, read_only: READ_ONLY.has(name), arguments: args, ok: false, ms: Date.now() - t0, error: e.toJSON ? e.toJSON() : { error: { code: 'INTERNAL', message: String(e) } } });
        throw e;
      }
    };
  }
  if (trace.length > 500) trace.splice(0, trace.length - 500);
  return { ...traced, store, llm, trace, READ_ONLY, SCHEMAS, MIN_N, now };
}
