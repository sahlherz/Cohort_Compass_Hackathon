// Interview engine. The ENGINE owns the plan (what's missing, what's valid, when to stop);
// the LLM only (a) phrases the next question naturally and (b) extracts extra fields from long answers.
// "LLM proposes, schema disposes" → works fully scripted when no model is available.
import { parseNumber, parseScale, parseBool, parseChoice, parseList, parseGradingMix, isSkip } from './text.js';
import { extractReview, inferFactorCategory } from './extract.js';
import { loadPrompt } from './llm.js';
import { validate } from './validate.js';

const opt = (values, labels = {}, syn = {}) => values.map((v) => ({ value: v, label: labels[v] || v.replace(/_/g, ' '), syn: syn[v] || [] }));

export const REVIEW_PLAN = [
  { field: 'format', type: 'choice', q: 'How was it delivered?', options: opt(['in_person', 'online_sync', 'online_async', 'hybrid', 'evening_weekend'], { online_sync: 'online, live (Zoom)', online_async: 'online, self-paced' }, { online_sync: ['zoom', 'live online'], online_async: ['self paced', 'recorded', 'async'], in_person: ['in person', 'on campus'] }) },
  { field: 'workload_hours_per_week', type: 'number', q: 'Roughly how many hours a week outside class did it take? A range is fine.', options: ['2–4', '5–7', '8–10', '11–15', '15+'] },
  { field: 'workload_trend', type: 'choice', q: 'Was that steady, or did it pile up at one end?', options: opt(['steady', 'front_loaded', 'back_loaded', 'spiky'], { front_loaded: 'heavier early', back_loaded: 'heavier late', spiky: 'spiky (big weeks)' }, { front_loaded: ['early', 'beginning', 'start'], back_loaded: ['end', 'late', 'finals'], spiky: ['spike', 'deadline'] }) },
  { field: 'grading_mix', type: 'grading', q: 'How was the grade split? e.g. "exams 40, cases 30, group project 30".' },
  { field: 'difficulty', type: 'scale', q: 'Difficulty, 1 (very easy) to 5 (very hard)?', options: ['1', '2', '3', '4', '5'] },
  { field: 'clarity', type: 'scale', q: 'How clear were lectures and expectations? 1 (very unclear) to 5 (very clear).', options: ['1', '2', '3', '4', '5'] },
  { field: 'feedback_quality', type: 'scale', q: 'Feedback on your work: 1 (little or late) to 5 (specific and timely)?', options: ['1', '2', '3', '4', '5'] },
  { field: 'instructor_response_time_hours', type: 'number', q: 'About how long did emails or questions take to get answered, in hours?', options: ['< 12', '24', '48', '72+'], optional: true },
  { field: 'group_work_intensity', type: 'choice', q: 'How much group work?', options: opt(['none', 'light', 'moderate', 'heavy']) },
  { field: 'cold_calling', type: 'choice', q: 'Any cold calling?', options: opt(['never', 'occasional', 'frequent']), optional: true },
  { field: 'attendance_impact', type: 'choice', q: 'How much did actually showing up (live) change what you got out of it?', options: opt(['low', 'medium', 'high']) },
  { field: 'office_hours_value', type: 'choice', q: 'Did you use office hours? How much did they help?', options: opt(['not_used', 'low', 'medium', 'high'], { not_used: "didn't go" }, { not_used: ['never', "didn't", 'did not'] }) },
  { field: 'topics_covered', type: 'topics', q: 'What were the main topics, and which one was hardest? e.g. "NPV, WACC, capital structure (hardest: WACC)".' },
  { field: 'skills_gained', type: 'list', q: 'What can you do now that you couldn\'t before? List 2 or 3 skills.' },
  { field: 'career_relevance', type: 'career', q: 'Has it come up in recruiting or at work? Which roles does it help with?', options: ['Yes, came up in interviews', 'Some, useful at work', 'Not yet'] },
  { field: 'prerequisites_actually_needed', type: 'list', q: 'What did you actually need to know going in, versus what the catalog says?', options: ['Nothing beyond the catalog', 'Excel basics', 'Intro stats', 'Accounting basics'] },
  { field: 'would_retake', type: 'bool', q: 'Knowing what you know now, would you take it again?', options: ['Yes', 'No'] },
  { field: 'best_for', type: 'list', q: 'Who is this course best for?', optional: true },
  { field: 'avoid_if', type: 'list', q: 'Who should wait or skip it? (Say "none" if no one.)', optional: true, options: ['none'] },
  { field: 'good_to_knows', type: 'gtk', q: 'Anything a future student should know that isn\'t in the syllabus? One tip per line.', options: ['none'] },
];

export const OUTCOME_PLAN = [
  { field: 'biggest_factor.description', type: 'text', q: 'What was the single biggest factor in getting this?' },
  { field: 'biggest_factor.category', type: 'choice', q: 'Which bucket fits that best?', options: opt(['coursework_skill', 'project_portfolio', 'networking_referral', 'prior_experience', 'certification', 'interview_prep', 'event_attended', 'mentor_sponsor', 'other']) },
  { field: 'supporting_factors', type: 'ranked', q: 'What else helped? Rank your top 2 or 3, one per line or comma-separated.' },
  { field: 'channel', type: 'choice', q: 'How did it start?', options: opt(['on_campus_recruiting', 'alumni_referral', 'internal_promotion', 'cold_outreach', 'job_board', 'recruiter_inbound', 'other'], {}, { alumni_referral: ['alum', 'referral', 'referred'], internal_promotion: ['internal', 'promot', 'same company'], cold_outreach: ['cold', 'reached out'], job_board: ['linkedin', 'indeed', 'posting', 'applied online'], recruiter_inbound: ['recruiter'] }) },
  { field: 'timeline.weeks_total', type: 'number', q: 'About how many weeks from first contact to offer?', options: ['< 4', '4–8', '8–12', '12+'] },
  { field: 'people_roles_that_helped', type: 'people', q: 'Who helped, by role? e.g. "an alum, my manager, a GPP career coach".', options: ['alum', 'manager', 'career_coach', 'professor', 'peer', 'mentor'] },
  { field: 'courses_that_helped', type: 'courses', q: 'Did any courses help? Pick from yours or type codes.' },
  { field: 'events_attended', type: 'events', q: 'Any events that mattered (career fair, Career Connect Call, a trek)?', options: ['none'] },
  { field: 'do_differently', type: 'text', q: 'One thing you\'d do differently?', optional: true },
  { field: 'advice_for_next_cohort', type: 'text', q: 'One sentence of advice for the next cohort?' },
];
const BACKFILL_FIELDS = new Set(['biggest_factor.description', 'biggest_factor.category', 'supporting_factors', 'channel', 'advice_for_next_cohort']);

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let cur = o; ks.slice(0, -1).forEach((k) => (cur = cur[k] ??= {})); cur[ks.at(-1)] = v; };
const hasVal = (v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0 && false);
const RATINGS = new Set(['pace', 'difficulty', 'clarity', 'feedback_quality']);

function parseFor(spec, answer, ctx) {
  const a = String(answer).trim();
  switch (spec.type) {
    case 'number': { const n = /\+/.test(a) && parseNumber(a) ? parseNumber(a) + 2 : /^</.test(a) ? Math.max(1, parseNumber(a) - 1) : parseNumber(a); return n; }
    case 'scale': return parseScale(a);
    case 'bool': return parseBool(a);
    case 'choice': return parseChoice(a, spec.options);
    case 'grading': return parseGradingMix(a);
    case 'list': return /^none$/i.test(a) ? [] : parseList(a).slice(0, 8);
    case 'gtk': return /^none$/i.test(a) ? [] : a.split(/\n|(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length >= 10).slice(0, 5);
    case 'topics': {
      const hard = (a.match(/hardest:?\s*([^)\n,.]+)/i) || [])[1]?.trim().toLowerCase();
      return parseList(a.replace(/\(?hardest:?[^)\n]*\)?/i, '')).slice(0, 12).map((topic) => ({ topic, depth: 'working', ...(hard && topic.toLowerCase().includes(hard) ? { hardest: true, depth: 'deep' } : {}) }))
        .concat(hard && !parseList(a).some((t) => t.toLowerCase().includes(hard) && !/hardest/i.test(t)) ? [{ topic: hard, depth: 'deep', hardest: true }] : []);
    }
    case 'career': {
      const signal = /interview|recruit|strong/i.test(a) ? 'strong' : /not yet|no\b|none/i.test(a) ? 'none' : 'some';
      const roles = parseList(a.replace(/yes|came up in interviews|some|useful at work|not yet|,?\s*for\s+/gi, ',')).filter((r) => r.length > 3).slice(0, 4);
      return { recruiter_signal: signal, target_roles: roles };
    }
    case 'ranked': return parseList(a).slice(0, 5).map((d, i) => ({ rank: i + 1, category: inferFactorCategory(d), description: d }));
    case 'people': return parseList(a).slice(0, 5).map((p) => ({ role: (p.match(/alum|professor|career[_ ]coach|coach|peer|manager|recruiter|mentor/i)?.[0] || 'other').toLowerCase().replace(' ', '_').replace(/^coach$/, 'career_coach'), how: p }));
    case 'courses': {
      const codes = [...a.toUpperCase().matchAll(/\b([A-Z]{2,5})\s?:?\s?(\d{4})\b/g)].map((m) => `${m[1]}:${m[2]}`);
      return /none|no\b/i.test(a) && !codes.length ? [] : codes.map((course_id) => ({ course_id, how: a.length < 240 ? a : undefined })).map((c) => (c.how ? c : { course_id: c.course_id }));
    }
    case 'events': return /^none$/i.test(a) ? [] : parseList(a).slice(0, 6).map((title) => ({ title }));
    case 'text': return a.length >= 3 ? a.slice(0, 500) : null;
    default: return a;
  }
}

function ack(field, v) {
  if (v == null) return '';
  if (field === 'workload_hours_per_week') return `Got it, ~${v} h/week. `;
  if (RATINGS.has(field)) return `${v}/5, noted. `;
  if (field === 'biggest_factor.description') return 'That\'s useful. ';
  return 'Thanks. ';
}

export function createInterviewEngine({ store, llm, newId, now }) {
  const plans = { review: REVIEW_PLAN, outcome: OUTCOME_PLAN };

  function nextSpec(iv) {
    if (iv.pending_example) return { field: `examples:${iv.pending_example}`, type: 'example', q: iv.pending_example === 'avoid_if' ? 'Can you give one concrete example of why someone should wait? (What happened?)' : `You gave ${iv.pending_example.replace(/_/g, ' ')} a ${getPath(iv.known, iv.pending_example)}. What's one concrete example that made it a ${getPath(iv.known, iv.pending_example)}?` };
    if (iv.repair?.length) {
      const f = iv.repair[0];
      return plans[iv.kind].find((s) => s.field === f || f.startsWith(s.field)) || { field: f, type: 'text', q: `I still need "${f}". Can you add it?` };
    }
    return plans[iv.kind].find((s) => {
      if (iv.backfill && !BACKFILL_FIELDS.has(s.field)) return false;
      return getPath(iv.known, s.field) === undefined && !iv.skipped.includes(s.field);
    }) || null;
  }

  function progress(iv) {
    const plan = plans[iv.kind].filter((s) => !iv.backfill || BACKFILL_FIELDS.has(s.field));
    const filled = plan.filter((s) => getPath(iv.known, s.field) !== undefined || iv.skipped.includes(s.field)).length;
    return { filled, total: plan.length };
  }

  function summary(iv) {
    const k = iv.known;
    if (iv.kind === 'review') {
      const b = [];
      b.push(`${iv.context.course_id} ${iv.context.course_title || ''} (${k.term || iv.context.term}, ${String(k.format || '').replace(/_/g, ' ')})`);
      if (k.workload_hours_per_week != null) b.push(`~${k.workload_hours_per_week} h/week${k.workload_trend ? `, ${k.workload_trend.replace('_', '-')}` : ''}; group work: ${k.group_work_intensity || 'n/a'}`);
      b.push(`Difficulty ${k.difficulty ?? '?'}/5 · Clarity ${k.clarity ?? '?'}/5 · Feedback ${k.feedback_quality ?? '?'}/5`);
      if (k.grading_mix) b.push('Grading: ' + k.grading_mix.map((g) => `${g.type.replace(/_/g, ' ')} ${g.percent}%`).join(', '));
      if (k.topics_covered?.length) b.push('Topics: ' + k.topics_covered.map((t) => t.topic + (t.hardest ? ' (hardest)' : '')).join(', '));
      if (k.skills_gained?.length) b.push('Skills: ' + k.skills_gained.join(', '));
      b.push(`Would retake: ${k.would_retake === true ? 'yes' : k.would_retake === false ? 'no' : '?'}${k.office_hours_value ? ` · Office hours: ${k.office_hours_value.replace('_', ' ')}` : ''}`);
      if (iv.gtk_texts.length) b.push(`${iv.gtk_texts.length} good-to-know tip(s) will be posted after moderation`);
      return b;
    }
    const b = [`${iv.context.role} (${iv.context.type.replace('_', ' ')}${iv.backfill ? ', backfill' : ''})`];
    if (k.biggest_factor?.description) b.push(`Biggest factor (${(k.biggest_factor.category || '?').replace(/_/g, ' ')}): "${k.biggest_factor.description}"`);
    if (k.supporting_factors?.length) b.push('Also helped: ' + k.supporting_factors.map((s) => `${s.rank}. ${s.description}`).join('; '));
    if (k.channel) b.push(`Channel: ${k.channel.replace(/_/g, ' ')}${k.timeline?.weeks_total ? `, ~${k.timeline.weeks_total} weeks` : ''}`);
    if (k.courses_that_helped?.length) b.push('Courses: ' + k.courses_that_helped.map((c) => c.course_id).join(', '));
    if (k.advice_for_next_cohort) b.push(`Advice: "${k.advice_for_next_cohort}"`);
    return b;
  }

  async function phrase(iv, spec, lastAnswer, prefix) {
    const fallback = `${prefix}${spec.q}`;
    if (!llm.live) return fallback;
    const promptName = iv.kind === 'review' ? 'review_interview' : 'outcome_interview';
    const sys = loadPrompt(promptName, { campus_name: 'University of Iowa', program_name: 'Tippie', course_id: iv.context.course_id, course_title: iv.context.course_title, term: iv.known.term || iv.context.term, reviewer_stage: iv.context.stage || 'student', role: iv.context.role, org_type: iv.context.org_type, type: iv.context.type, backfill: iv.backfill });
    const out = await llm.call('strong', sys, JSON.stringify({ KNOWN_FIELDS: iv.known, NEXT_FIELD: { name: spec.field, type: spec.type, default_question: spec.q, options: (spec.options || []).map((o) => o.label || o) }, LAST_ANSWER: lastAnswer || null, VALIDATION_ERRORS: iv.repair?.length ? iv.repair : undefined }), { maxTokens: 300 });
    return out?.message && out.message.length < 400 ? out.message : fallback;
  }

  function buildRecord(iv) {
    return { ...iv.known };
  }

  /** Advance one turn. Returns a client-facing step object. */
  async function step(iv, answer) {
    const trace = [];
    let prefix = '';
    if (answer != null && String(answer).trim() !== '') {
      iv.transcript.push({ role: 'user', text: String(answer), at: now() });
      if (iv.status === 'summary') {
        if (/^(y|yes|yep|correct|looks good|save|confirm)/i.test(answer)) {
          iv.status = 'validating';
        } else {
          // "fix X" → re-ask that field
          const plan = plans[iv.kind];
          const target = plan.find((s) => String(answer).toLowerCase().includes(s.field.split('.')[0].replace(/_/g, ' ')));
          if (target) { setPath(iv.known, target.field, undefined); delete iv.known[target.field]; iv.status = 'active'; prefix = 'Sure, let\'s fix that. '; }
          else return { ...base(iv), message: 'Which part should I fix? Tap one.', options: plan.map((s) => s.field.split('.')[0].replace(/_/g, ' ')).filter((v, i, a) => a.indexOf(v) === i), field: 'fix' };
        }
      } else {
        const spec = nextSpec(iv);
        if (spec) {
          if (isSkip(answer)) {
            if (spec.type === 'example') {
              const f = iv.pending_example;
              if (RATINGS.has(f)) { const v = iv.known[f]; (iv.known.extensions ||= {}).x_unconfirmed_ratings = { ...(iv.known.extensions?.x_unconfirmed_ratings || {}), [f]: v }; iv.known[f] = v === 5 ? 4 : 2; }
              if (f === 'avoid_if') delete iv.known.avoid_if;
              iv.pending_example = null;
              prefix = 'No problem. I\'ll mark that rating as unconfirmed. ';
            } else { iv.skipped.push(spec.field); iv.repair = (iv.repair || []).filter((x) => x !== spec.field); prefix = 'Skipped. '; }
          } else if (spec.type === 'example') {
            const f = iv.pending_example;
            if (String(answer).trim().length < 20 && !iv._example_nudged) { iv._example_nudged = true; return { ...base(iv), message: 'Could you add a little more detail, like what happened and when? (or "skip")', options: ['skip'], field: spec.field }; }
            (iv.known.examples ||= []).push({ claim: `${f}=${JSON.stringify(getPath(iv.known, f))}`.slice(0, 200), evidence: String(answer).trim().padEnd(20, '.').slice(0, 600), field: f });
            iv.pending_example = null; iv._example_nudged = false; prefix = 'Perfect, that\'s the kind of detail that helps. ';
          } else {
            let v = parseFor(spec, answer, iv.context);
            // Long answers: let the extractor fill additional fields (and this one if the parser missed).
            if (iv.kind === 'review' && String(answer).split(/\s+/).length > 14) {
              const ex = await extractReview(llm, answer, iv.context);
              trace.push({ step: 'extract', via: ex.via, fields: Object.keys(ex.fields) });
              for (const [k2, v2] of Object.entries(ex.fields)) if (iv.known[k2] === undefined && k2 !== spec.field) iv.known[k2] = v2;
              if ((v == null || (Array.isArray(v) && !v.length && spec.type !== 'list')) && ex.fields[spec.field] !== undefined) v = ex.fields[spec.field];
              iv.gtk_texts.push(...ex.good_to_knows_text.filter((g) => !iv.gtk_texts.includes(g)));
            }
            if (spec.type === 'gtk') { iv.gtk_texts.push(...(v || [])); v = []; setPath(iv.known, 'good_to_knows', []); }
            if (v == null || (spec.type === 'grading' && !v)) {
              return { ...base(iv), message: spec.type === 'grading' ? 'I couldn\'t read percentages from that. Try "exams 50, cases 30, participation 20" (or "skip").' : `Sorry, I didn't catch that. ${spec.q} (or "skip")`, options: (spec.options || []).map((o) => o.label || o).concat('skip'), field: spec.field };
            }
            if (spec.type !== 'gtk') setPath(iv.known, spec.field, v);
            if (spec.field === 'biggest_factor.description' && !getPath(iv.known, 'biggest_factor.category')) {
              const cat = inferFactorCategory(v);
              if (cat !== 'other') { iv.known.biggest_factor.category = cat; prefix = `That sounds like **${cat.replace(/_/g, ' ')}**; I've tagged it that way (say "fix biggest factor" to change). `; }
            }
            iv.repair = (iv.repair || []).filter((x) => !x.startsWith(spec.field));
            if (RATINGS.has(spec.field) && (v === 1 || v === 5)) iv.pending_example = spec.field;
            if (spec.field === 'avoid_if' && v.length) iv.pending_example = 'avoid_if';
            if (!prefix) prefix = ack(spec.field, v);
          }
        }
      }
    }

    if (iv.status === 'validating') {
      const schemaName = iv.kind === 'review' ? 'course-review' : 'career-outcome';
      let rec = iv.finalize(buildRecord(iv));
      let r = validate(schemaName, rec);
      // A field that fails validation twice is dropped (never loop the user forever).
      iv.repair_attempts ||= {};
      for (const e of r.invalid_fields) {
        const f = e.path.slice(1).split('/')[0];
        iv.repair_attempts[f] = (iv.repair_attempts[f] || 0) + 1;
        if (iv.repair_attempts[f] >= 2 && iv.known[f] !== undefined) { delete iv.known[f]; iv.skipped.push(f); }
      }
      if (!r.valid) { rec = iv.finalize(buildRecord(iv)); r = validate(schemaName, rec); }
      trace.push({ step: 'validate', ...r });
      if (r.valid) { iv.status = 'done'; return { ...base(iv), message: 'Saved. Thank you, this directly helps the next cohort.', options: null, field: null, record: rec, validation: r, trace }; }
      iv.status = 'active';
      iv.repair = [...r.missing_fields.map((m) => m.replace(/^examples\[field=(\w+)\]$/, 'examples:$1')), ...r.invalid_fields.map((e) => e.path.slice(1).split('/')[0])];
      const ex = iv.repair.find((x) => x.startsWith('examples:'));
      if (ex) { iv.pending_example = ex.split(':')[1]; iv.repair = iv.repair.filter((x) => x !== ex); }
      prefix = 'Almost there. I need one more thing. ';
    }

    const spec = nextSpec(iv);
    if (!spec) {
      iv.status = 'summary';
      const bullets = summary(iv);
      return { ...base(iv), message: 'Here\'s what I captured:\n' + bullets.map((b) => '• ' + b).join('\n') + '\n\nDid I get that right?', options: ['Yes, save it', 'Fix something'], field: 'summary', summary: bullets, trace };
    }
    iv.last_field = spec.field;
    const message = await phrase(iv, spec, answer, prefix);
    iv.transcript.push({ role: 'assistant', text: message, at: now() });
    let options = (spec.options || []).map((o) => o.label || o);
    if (spec.type === 'courses') options = (iv.context.courses_taken || []).map((c) => c.course_id).concat('none');
    return { ...base(iv), message, options: options.length ? options.concat(spec.type === 'example' ? [] : ['skip']) : ['skip'], field: spec.field, trace };
  }

  function base(iv) {
    store.put('interviews', strip(iv));
    return { interview_id: iv.id, kind: iv.kind, status: iv.status, progress: progress(iv), known: iv.known, gtk_texts: iv.gtk_texts };
  }
  const strip = (iv) => { const { finalize, ...rest } = iv; return rest; };

  return { step, nextSpec, plans, setPath, getPath };
}
