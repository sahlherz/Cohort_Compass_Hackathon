// End-to-end smoke test of core (scripted LLM mode). Run: npm test
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createCore } from '../core/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'cc-'));
execFileSync(process.execPath, [join(ROOT, 'scripts', 'seed.js')], { env: { ...process.env, CC_DATA_DIR: dir } });
const core = createCore({ env: { CC_DATA_DIR: dir, CC_LLM_MODE: 'scripted', CC_NOW: '2026-11-18T15:00:00Z' } });
const ok = (m) => console.log('  ✓', m);

// 1. resume → profile
const resume = readFileSync(join(ROOT, 'data/seed/resumes/daniel_fictional.txt'), 'utf8');
const parsed = await core.parse_resume({ text: resume });
assert.equal(parsed.profile_draft.display_name, 'Daniel K.');
assert.ok(parsed.pii_removed >= 3, 'contact details stripped');
assert.ok(!JSON.stringify(parsed).includes('555-0142'), 'no phone in draft');
assert.equal(parsed.profile_draft.stage, 'alumni');
assert.ok(parsed.profile_draft.experience.length >= 2, 'experience parsed');
const { profile } = await core.upsert_profile({ profile: { ...parsed.profile_draft, consent: { share_reviews: true, share_outcomes_aggregate: true, contact_by_peers: false } } });
ok(`resume → profile ${profile.id} (${profile.experience.length} roles, targets: ${profile.career_targets})`);
const maya = await core.parse_resume({ text: readFileSync(join(ROOT, 'data/seed/resumes/maya_fictional.txt'), 'utf8') });
assert.equal(maya.profile_draft.stage, 'enrolled'); ok('Maya resume → enrolled BBA draft');

// 2. narrative-first review interview, using the real Idea.txt notes
const idea = readFileSync(join(ROOT, 'tests/fixtures/idea_discrete_structures.txt'), 'utf8');
let st = await core.x_interview_start({ kind: 'review', profile_id: profile.id, course_id: 'CS:2210', term: 'Fall 2025', narrative: idea.slice(idea.indexOf('I had no idea what the *structure*')) });
assert.ok(st.extracted.fields.includes('workload_hours_per_week'), 'workload extracted');
assert.equal(st.known.workload_trend, 'front_loaded');
ok(`extractor pulled ${st.extracted.fields.length} fields from Idea.txt: ${st.extracted.fields.join(', ')}`);
const answers = { format: 'in person', grading_mix: 'exams 50, homework 35, discussion 15', difficulty: '4', clarity: '5', feedback_quality: '3', instructor_response_time_hours: '24', group_work_intensity: 'light', cold_calling: 'never', attendance_impact: 'medium', office_hours_value: 'high', topics_covered: 'logic, proofs by induction, Big O, counting (hardest: induction)', skills_gained: 'writing proofs, big O analysis', career_relevance: 'some, useful at work', prerequisites_actually_needed: 'nothing beyond the catalog', would_retake: 'yes', best_for: 'CS majors before Data Structures', avoid_if: 'none', good_to_knows: 'Start the weekly group discussion early; it is short but graded.' };
let turns = 0;
while (st.status !== 'done' && turns++ < 40) {
  let a;
  if (st.field === 'summary') a = 'yes';
  else if (st.field?.startsWith('examples:')) a = 'Every lecture ended with a worked proof that matched the homework format exactly.';
  else a = answers[st.field] ?? 'skip';
  st = await core.x_interview_answer({ interview_id: st.interview_id, answer: a });
}
assert.equal(st.status, 'done'); assert.ok(st.saved.review.id);
assert.ok(st.saved.review.examples.some((e) => e.field === 'clarity'), 'clarity=5 has example');
ok(`review interview done in ${turns} turns → ${st.saved.review.id}, published=${st.saved.published}, gtks=${st.saved.good_to_know_ids.length}`);
const replay = await core.save_review({ review: st.saved.review, idempotency_key: `idem_${st.interview_id}` });
assert.ok(replay.idempotent_replay); ok('idempotent save replay');

// 3. validation failure returns only missing fields
const bad = await core.validate_review({ review: { ...st.saved.review, clarity: 5, examples: [] } });
assert.equal(bad.valid, false); assert.ok(bad.missing_fields.includes('examples[field=clarity]'));
ok('validate_review flags missing evidence for extreme rating');

// 4. course insights gating
const ins = await core.get_course_insights({ course_id: 'MBA:8180' });
assert.ok(ins.min_n_met && ins.aggregates.n >= 5); ok(`MBA:8180 insights n=${ins.n}, median ${ins.aggregates.workload_hours_per_week.median}h/wk`);
const thin = await core.get_course_insights({ course_id: 'MBA:9130' });
assert.equal(thin.min_n_met, false); assert.equal(thin.aggregates, null); ok('MBA:9130 aggregates hidden (n<5)');

// 5. recommendations
const rec = await core.recommend_events_resources({ profile_id: 'pro_daniel' });
assert.ok(rec.items.length >= 3); assert.ok(rec.items.every((i) => i.why_this_matches_you));
ok(`Daniel top picks: ${rec.items.slice(0, 3).map((i) => i.title.slice(0, 40)).join(' | ')}`);
const recM = await core.recommend_events_resources({ profile_id: 'pro_maya' });
ok(`Maya top picks: ${recM.items.slice(0, 3).map((i) => i.title.slice(0, 40)).join(' | ')}`);

// 6. outcome interview
let o = await core.x_interview_start({ kind: 'outcome', profile_id: 'pro_daniel', outcome_seed: { type: 'promotion', role: 'FP&A Manager', org_type: 'private_company', industry: 'insurance', season: 'Spring 2027' } });
assert.match(o.message, /single biggest factor/i);
const oa = { 'biggest_factor.description': 'An alum I met on a Career Connect Call referred me to the VP of finance.', supporting_factors: 'my reforecast model, MGMT:9120 development plan', channel: 'alumni referral', 'timeline.weeks_total': '8', people_roles_that_helped: 'an alum, my manager', courses_that_helped: 'FIN:9200', events_attended: 'Career Connect Call', do_differently: 'Ask for the title sooner.', advice_for_next_cohort: 'Use Career Connect Calls to meet people one level above you.' };
turns = 0;
while (o.status !== 'done' && turns++ < 30) o = await core.x_interview_answer({ interview_id: o.interview_id, answer: o.field === 'summary' ? 'yes' : oa[o.field] ?? 'skip' });
assert.equal(o.status, 'done'); assert.equal(o.saved.outcome.biggest_factor.category, 'networking_referral');
ok(`outcome interview → ${o.saved.outcome.id}; path n=${o.saved.path_insight.n}`);

// 7. path insights
const pi = await core.get_path_insights({ target: 'finance_leadership' });
assert.ok(pi.min_n_met); ok(`finance_leadership: n=${pi.n}, top factor ${pi.factor_distribution[0].category}`);
const piThin = await core.get_path_insights({ target: 'marketing' });
assert.equal(piThin.min_n_met, false); ok('marketing path gated (n=2)');

// 8. ask the cohort
const a1 = await core.ask_cohort({ question: 'How heavy is Managerial Finance and are office hours worth it?' });
assert.ok(a1.cited_ids.length > 0); assert.ok(!a1.not_enough_data);
ok('ask: ' + a1.answer.split('\n')[0].slice(0, 120) + '…');
const a2 = await core.ask_cohort({ question: 'What did it take to get into finance leadership?' });
assert.ok(a2.cited_ids.includes('agg:path:finance_leadership')); ok('ask path: cites agg:path:finance_leadership');
const a3 = await core.ask_cohort({ question: 'Is Leadership Communication & Story worth it?' });
assert.ok(a3.not_enough_data); ok('ask thin course → "Not enough data yet"');
const a4 = await core.ask_cohort({ question: 'I am worried about my visa status after graduation' });
assert.ok(a4.routed_to_staff); ok('sensitive question routed to GPP staff');

// 9. posts + moderation
const p1 = await core.create_post({ profile_id: 'pro_maya', text: 'Tip for ACCT:2100: do the practice problems on paper, exams are not open-note.' });
assert.ok(p1.post.tags.includes('acct:2100')); ok(`post structured: type=${p1.post.type}, tags=${p1.post.tags}, promoted=${!!p1.post.promoted_good_to_know_id}`);
const p2 = await core.create_post({ text: 'The MBA:8150 prof is an idiot and dresses badly' });
assert.equal(p2.moderation.status, 'pending'); ok(`abusive post held for staff: flags=${p2.moderation.flags}`);
const q = await core.x_moderation_queue(); assert.ok(q.pending.length >= 2);

// 10. passport round trip
const { passport } = await core.export_profile({ profile_id: 'pro_daniel' });
assert.equal(passport.checksum_sha256.length, 64);
const imp = await core.import_profile({ passport });
assert.ok(imp.id_remapped); ok(`career passport export/import (outcomes=${passport.outcomes.length}, remapped id ${imp.profile_id})`);
let threw = false; try { await core.import_profile({ passport: { ...passport, outcomes: [] } }); } catch (e) { threw = e.code === 'VALIDATION_FAILED'; }
assert.ok(threw); ok('tampered passport rejected (checksum)');

const adm = await core.x_admin_overview();
assert.ok(adm.courses.every((c) => c.n >= adm.min_n)); ok(`admin: ${adm.courses.length} courses shown, ${adm.hidden_courses_below_min_n} hidden <n, ${adm.path_targets.length} targets`);
console.log(`\nsmoke: all passed (${core.trace.length} traced tool calls)`);
