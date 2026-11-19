// Narrative → structured fields. LLM (cheap tier) first; deterministic heuristics as fallback.
// The heuristics are tuned on real student writing (see tests/fixtures/idea_discrete_structures.txt).
import { loadPrompt } from './llm.js';
import { SCHEMAS, validate } from './validate.js';
import { parseGradingMix, stripContact, parseList } from './text.js';

const reviewProps = SCHEMAS['course-review'].properties;
const ENUM_HINT = Object.fromEntries(Object.entries(reviewProps).filter(([, v]) => v.enum).map(([k, v]) => [k, v.enum]));

// ---------- course review narrative ----------
export function heuristicReviewExtract(text) {
  const t = String(text || '');
  const low = t.toLowerCase();
  const f = {};
  const gtk = [];
  const hours = [...low.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(?:h|hrs?|hours?)\s*(?:\/|per|a|each)\s*(?:wk|week)/g)].map((m) => (m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1])));
  if (hours.length) {
    // weight the early/mid/late phases equally → typical weekly load
    f.workload_hours_per_week = Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10;
    if (hours.length === 1 && /steady|consistent|same every week/.test(low)) f.workload_trend = 'steady';
    if (hours.length >= 2) {
      const first = hours[0];
      const last = hours[hours.length - 1];
      f.workload_trend = first > last * 1.4 ? 'front_loaded' : last > first * 1.4 ? 'back_loaded' : 'steady';
    }
  }
  if (/no group( work)?|no team/.test(low)) f.group_work_intensity = 'none';
  else if (/group|team/.test(low)) f.group_work_intensity = /heavy|lots of group|every week.*group|mostly group/.test(low) ? 'heavy' : /manageable|small|wasn'?t too long|light/.test(low) ? 'light' : 'moderate';
  if (/cold[- ]call/.test(low)) f.cold_calling = /never|no cold/.test(low) ? 'never' : /constant|every class|frequent/.test(low) ? 'frequent' : 'occasional';
  const gm = parseGradingMix(low);
  if (gm && gm.reduce((a, g) => a + g.percent, 0) >= 90) f.grading_mix = gm;
  // topics: "we went over / covered / learned X, Y and Z"
  const topicM = t.match(/(?:went over|covered|learned|topics (?:were|included)|we did)\s+([^.\n]{10,300})/i);
  const hardest = (t.match(/hardest (?:part|thing|topic)[^.\n]*?(?:was|were)\s+([^.\n]{3,80})/i) || [])[1];
  if (topicM) {
    const topics = parseList(topicM[1].replace(/\b(especially|for example|like|some topics like|stuff like|basic|then|also)\b/gi, ','))
      .map((x) => x.replace(/^(we |some |topics? )/i, '').trim())
      .filter((x) => x.length > 2 && x.length < 60 && !/\{|blah|hardest/i.test(x))
      .slice(0, 10);
    if (topics.length) f.topics_covered = topics.map((topic) => ({ topic, depth: 'working', ...(hardest && hardest.toLowerCase().includes(topic.toLowerCase().split(' ')[0]) ? { hardest: true } : {}) }));
  }
  if (hardest && !/\{|\bY\b/.test(hardest) && f.topics_covered && !f.topics_covered.some((x) => x.hardest)) f.topics_covered.push({ topic: hardest.trim(), depth: 'deep', hardest: true });
  // usefulness → skills & career relevance
  const useful = t.match(/(?:skills? (?:in it )?(?:ended up being )?useful for|(?:ended up being |were |was )useful for)\s+([^.\n]{5,160})/i);
  if (useful) f.skills_gained = parseList(useful[1]).slice(0, 4);
  if (/(not|haven'?t|hasn'?t) (been )?useful (yet )?for (any )?(personal|real|work)/i.test(t)) f.career_relevance = { recruiter_signal: 'none', target_roles: [] };
  else if (/interview|recruit|job|internship|work/.test(low) && /useful|helped|came up/.test(low)) f.career_relevance = { recruiter_signal: 'some', target_roles: [] };
  // prerequisites "recommended to take X together/before... didn't find much overlap except for Y"
  const pre = t.match(/except (?:for )?([^.\n]{2,60})/i);
  if (/recommended to take|prereq/i.test(t)) f.prerequisites_actually_needed = pre ? [pre[1].trim()] : [];
  if (/office hours/.test(low)) f.office_hours_value = /office hours (were|was) (a )?(life|game|huge|super|really)|went to office hours.*(helped|saved)/.test(low) ? 'high' : /never went|didn'?t go/.test(low) ? 'not_used' : 'medium';
  if (/would (definitely )?(re)?take|recommend (it|this)/.test(low)) f.would_retake = true;
  if (/would(n'?t| not) (re)?take|avoid/.test(low)) f.would_retake = false;
  if (/no idea what .* (taught|was about) until|catalog .* (vague|wordy|brief)/i.test(t)) gtk.push('The catalog description undersells what this covers. Look at the topics list here before registering.');
  const recommendTogether = t.match(/recommended to take ([^.\n]{3,80})/i);
  if (recommendTogether) gtk.push(`Official advice is to take ${recommendTogether[1].trim()}. Reviewers say the actual overlap is small.`.replace(/\s+/g, ' '));
  if (f.workload_trend === 'front_loaded') gtk.push(`Front-loaded: the first weeks run ~${Math.max(...hours)}h/week and taper to ~${Math.min(...hours)}h/week. Plan your semester around that.`);
  return { fields: f, good_to_knows_text: gtk, unsure: [] };
}

export async function extractReview(llm, text, ctx = {}) {
  const sys = loadPrompt('review_extractor');
  const out = await llm.call('cheap', sys, `SCHEMA_ENUMS: ${JSON.stringify(ENUM_HINT)}\nCOURSE: ${ctx.course_id || ''} ${ctx.course_title || ''}\nTEXT:\n${stripContact(text)}`);
  const h = heuristicReviewExtract(text);
  if (!out?.fields) return { ...h, via: 'heuristic' };
  // Keep only schema-valid fields from the LLM; fill holes with heuristics.
  const merged = { ...h.fields };
  for (const [k, v] of Object.entries(out.fields)) {
    if (!reviewProps[k] || k === 'id') continue;
    const probe = { ...stubReview(), [k]: v };
    const r = validate('course-review', probe);
    if (!r.invalid_fields.some((e) => e.path.startsWith('/' + k))) merged[k] = v;
  }
  return { fields: merged, good_to_knows_text: [...new Set([...(out.good_to_knows_text || []), ...h.good_to_knows_text])].slice(0, 5), unsure: out.unsure || [], via: 'llm' };
}
function stubReview() {
  return { id: 'rev_probe', schema_version: '1.0.0', campus_id: 'x', program_id: 'x', program_type: 'MBA', created_at: new Date().toISOString(), provenance: { source: 'user_interview', synthetic: false }, course_id: 'MBA:8180', term: 'Fall 2025', workload_hours_per_week: 1, difficulty: 3, clarity: 3, would_retake: true };
}

// ---------- outcome factor category ----------
const FACTOR_RULES = [
  ['networking_referral', /referr|network|alum|coffee chat|knew someone|connection|introduc/],
  ['mentor_sponsor', /mentor|sponsor|manager (pushed|advocated|recommended)|boss/],
  ['coursework_skill', /course|class|mba:|fin:|bais:|mgmt:|acct:|learned in|skill/],
  ['project_portfolio', /project|portfolio|capstone|built|github|case competition/],
  ['certification', /certif|cfa|cpa|pmp|license/],
  ['interview_prep', /interview|mock|prep|case practice|behavioral/],
  ['event_attended', /career fair|event|trek|mixer|career connect|speaker|conference/],
  ['prior_experience', /experience|years at|track record|prior role|previous job|internal|promot/],
];
export function inferFactorCategory(text) {
  const t = String(text).toLowerCase();
  for (const [cat, rx] of FACTOR_RULES) if (rx.test(t)) return cat;
  return 'other';
}

// ---------- target normalization (role → path target) ----------
export const TARGETS = {
  finance_leadership: { label: 'Finance leadership (FP&A / finance manager)', rx: /finance manager|fp&a|financial planning|controller|director.*finance|cfo|head of finance|finance lead|vp.*finance|senior financial analyst/ },
  business_analytics: { label: 'Business / data analytics', rx: /analytic|data (analyst|scien)|business intelligence|\bbi\b|insights|quantitative/ },
  project_program_mgmt: { label: 'Project / program management', rx: /project manag|program manag|pmo|scrum|agile|delivery manager|product manag/ },
  accounting: { label: 'Accounting', rx: /account(ant|ing)|audit|tax|cpa/ },
  operations_leadership: { label: 'Operations leadership', rx: /operations manager|director of operations|plant manager|supply chain manager|ops manager/ },
};
export function normalizeTarget(role = '') {
  const r = role.toLowerCase();
  for (const [k, v] of Object.entries(TARGETS)) if (v.rx.test(r)) return k;
  return 'other';
}

// ---------- resume ----------
const DEG = /\b(B\.?B\.?A|B\.?S|B\.?A|M\.?B\.?A|M\.?S\.?|MSF|M\.?Fin|Master(?:'s)?(?: of)?|Bachelor(?:'s)?(?: of)?|Ph\.?D|J\.?D|Certificate)\b/i;
export function heuristicResume(raw, now = new Date()) {
  const text = stripContact(raw);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nameLine = lines.find((l) => /^[A-Z][a-z]+(\s+[A-Z]\.?)?(\s+[A-Z][a-z'-]+)+$/.test(l)) || 'New Student';
  const parts = nameLine.split(/\s+/);
  const display_name = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  const sections = {};
  let cur = 'header';
  for (const l of lines) {
    const h = l.replace(/[:\s]+$/, '').toUpperCase();
    if (/^(EDUCATION|EXPERIENCE|WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|SKILLS|INTERESTS|ACTIVITIES|LEADERSHIP|OBJECTIVE|SUMMARY|GOALS|CAREER GOALS|PROJECTS|CERTIFICATIONS)$/.test(h)) { cur = h; sections[cur] = []; continue; }
    (sections[cur] ||= []).push(l);
  }
  const yearNow = now.getFullYear();
  const education = [];
  for (const l of sections.EDUCATION || []) {
    if (/^[•*-]/.test(l)) continue;
    const inst = (l.match(/(University of [A-Z][\w ]+|[A-Z][\w.]+ (?:University|College)|Tippie[\w ]*)/) || [])[1];
    const deg = (l.match(DEG) || [])[0];
    const years = [...l.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    if (inst || deg) {
      const fieldM = deg ? l.slice(l.indexOf(deg) + deg.length).match(/^\s+(?:in|of)\s+([A-Z][A-Za-z &]+?)(?:,|\s+[-–(]|\s+\d|$)/) : null;
      education.push({ institution: (inst || 'Unknown').trim(), ...(deg ? { degree: deg.replace(/\./g, '') } : {}), ...(fieldM ? { field: fieldM[1].trim() } : {}), ...(years.length > 1 ? { start_year: years[0] } : {}), ...(years.length ? { end_year: years[years.length - 1] } : {}) });
    }
  }
  const experience = [];
  const expLines = [...(sections.EXPERIENCE || []), ...(sections['WORK EXPERIENCE'] || []), ...(sections['PROFESSIONAL EXPERIENCE'] || [])];
  for (const l of expLines) {
    if (/^[•*-]/.test(l)) { experience.at(-1)?.highlights.push(l.replace(/^[•*-]\s*/, '').slice(0, 240)); continue; }
    const m = l.match(/^(.+?)\s*(?:,|—|–|-|\|| at )\s*(.+?)\s*(?:[(|,–—-]\s*)?((?:[A-Z][a-z]{2}\.? )?\d{4})\s*(?:-|–|—|to)\s*((?:[A-Z][a-z]{2}\.? )?\d{4}|Present|Current)\)?$/i);
    if (m) experience.push({ title: m[1].trim(), org_type: orgType(m[2]), industry: industryOf(m[2] + ' ' + m[1]), function: functionOf(m[1]), start: m[3], end: m[4], highlights: [] });
  }
  const listOf = (k) => (sections[k] || []).flatMap((l) => parseList(l.replace(/^[A-Za-z ]+:\s*/, '')));
  const goals = [...(sections.OBJECTIVE || []), ...(sections.GOALS || []), ...(sections['CAREER GOALS'] || []), ...(sections.SUMMARY || [])].join(' ');
  const career_targets = [];
  const tm = goals.match(/(?:aiming for|seeking|toward|targeting|goal(?: is)? (?:to (?:become|move into|reach))?|interested in)\s+(?:a |an )?([^.;]{4,80})/i);
  const interested = goals.match(/interested in (?:both )?([^.;]+?)(?:\s+and unsure|\s+but|\s+while|[.;]|$)/i);
  const extraInterests = interested ? parseList(interested[1]) : [];
  if (tm && !/^both /i.test(tm[1]) && !interested) career_targets.push(tm[1].trim());
  else if (extraInterests.length) career_targets.push(`explore: ${extraInterests.join(' + ')}`);
  else if (tm) career_targets.push(tm[1].trim());
  const lastEnd = Math.max(0, ...education.map((e) => e.end_year || 0));
  const expected = /expected|anticipated|candidate/i.test((sections.EDUCATION || []).join(' '));
  const stage = expected || lastEnd > yearNow ? (lastEnd && lastEnd - yearNow < 1 ? 'heading_out' : 'enrolled') : education.length ? 'alumni' : 'prospective';
  return {
    display_name,
    stage,
    ...(lastEnd ? { grad_year: lastEnd } : {}),
    education,
    experience,
    skills: listOf('SKILLS').slice(0, 15),
    interests: [...new Set([...extraInterests, ...listOf('INTERESTS'), ...listOf('ACTIVITIES')])].slice(0, 10),
    career_targets,
    _goals_text: goals,
  };
}
function orgType(s) { const t = s.toLowerCase(); if (/university|college/.test(t)) return 'university'; if (/county|state of|city of|department|agency/.test(t)) return 'government'; if (/foundation|nonprofit|museum|gallery|arts council/.test(t)) return 'nonprofit'; if (/startup|labs|ventures/.test(t)) return 'startup'; return 'private_company'; }
function industryOf(s) { const t = s.toLowerCase(); if (/insur/.test(t)) return 'insurance'; if (/bank|financial|capital|credit|invest/.test(t)) return 'financial_services'; if (/health|hospital|clinic/.test(t)) return 'healthcare'; if (/museum|gallery|art|studio|design/.test(t)) return 'arts'; if (/manufactur|industrial|deere|equipment/.test(t)) return 'manufacturing'; if (/software|tech|data/.test(t)) return 'technology'; if (/coffee|cafe|retail|store/.test(t)) return 'retail_food'; return 'other'; }
function functionOf(s) { const t = s.toLowerCase(); if (/financ|fp&a|analyst/.test(t)) return 'finance'; if (/account|audit|book/.test(t)) return 'accounting'; if (/market/.test(t)) return 'marketing'; if (/project|program/.test(t)) return 'project_management'; if (/data|analytic/.test(t)) return 'analytics'; if (/design|art|gallery/.test(t)) return 'creative'; return 'other'; }
