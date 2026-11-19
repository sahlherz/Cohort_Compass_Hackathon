// Generates versioned JSON Schema 2020-12 files into /schemas from compact definitions.
// Field names, $ids and versions are FROZEN for downstream use. Extend only via `extensions` with `x_` keys.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const V = '1.0.0';
const BASE = 'https://schemas.cohortcompass.app';
const id = (name) => `${BASE}/${name}/${V}`;

const str = (extra = {}) => ({ type: 'string', ...extra });
const int = (min, max, extra = {}) => ({ type: 'integer', minimum: min, maximum: max, ...extra });
const num = (min, max, extra = {}) => ({ type: 'number', minimum: min, maximum: max, ...extra });
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
const en = (values, extra = {}) => ({ type: 'string', enum: values, ...extra });
const bool = (extra = {}) => ({ type: 'boolean', ...extra });
const rating = (desc) => int(1, 5, { description: desc });
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });

const STAGE = en(['prospective', 'enrolled', 'heading_out', 'alumni'], { description: 'Lifecycle stage (GPP: while enrolled → heading out → after graduation)' });
const PROGRAM_TYPE = en(['BBA', 'MBA', 'MS', 'MSF', 'MSBA', 'JD', 'PhD', 'certificate', 'other']);

const extensions = {
  type: 'object',
  description: 'Forward-compatible extension point. Keys MUST start with x_.',
  patternProperties: { '^x_[a-z0-9_]+$': {} },
  additionalProperties: false,
  default: {},
};

const provenance = {
  type: 'object',
  required: ['source', 'synthetic'],
  additionalProperties: false,
  properties: {
    source: en(['user_interview', 'user_form', 'import', 'seed', 'catalog', 'syllabus', 'calendar']),
    synthetic: bool({ description: 'TRUE for demo data. Synthetic records must never be presented as real.' }),
    source_url: str({ format: 'uri' }),
    interview_id: str(),
  },
};

// Common envelope on every stored record (multi-tenant + versioning).
const envelope = {
  id: str({ pattern: '^[a-z]{2,4}_[A-Za-z0-9_-]{3,64}$', description: 'Stable, prefixed ID, e.g. rev_0001' }),
  schema_version: { const: V },
  campus_id: str({ pattern: '^[a-z0-9-]+$' }),
  program_id: str({ pattern: '^[a-z0-9-]+$' }),
  program_type: PROGRAM_TYPE,
  created_at: str({ format: 'date-time' }),
  updated_at: str({ format: 'date-time' }),
  provenance,
  extensions,
};
const envelopeRequired = ['id', 'schema_version', 'campus_id', 'program_id', 'program_type', 'created_at', 'provenance'];

function schema(name, title, description, properties, required, extra = {}) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: id(name),
    title,
    description,
    'x-schema-version': V,
    type: 'object',
    additionalProperties: false,
    properties: { ...envelope, ...properties },
    required: [...envelopeRequired, ...required],
    ...extra,
  };
}

const example = {
  type: 'object',
  required: ['claim', 'evidence'],
  additionalProperties: false,
  properties: {
    claim: str({ maxLength: 200, description: 'What the example supports, e.g. "feedback_quality=5"' }),
    evidence: str({ minLength: 20, maxLength: 600, description: 'Concrete, behaviour-focused example' }),
    field: str(),
  },
};

const S = {};

S['course-review'] = schema('course-review', 'CourseReview',
  'Validated, structured course/instructor review produced by the Structured Review Interview. Behaviour and course design only, never personal attributes.',
  {
    course_id: str({ pattern: '^[A-Z]{2,5}:[0-9]{4}$', description: 'Registrar course code, e.g. MBA:8180' }),
    instructor_id: str({ pattern: '^ins_[a-z0-9_-]+$', description: 'Pseudonymous instructor ID; real names only via campus-approved mapping' }),
    term: str({ pattern: '^(Spring|Summer|Fall|Winter) [0-9]{4}$' }),
    format: en(['in_person', 'online_sync', 'online_async', 'hybrid', 'evening_weekend']),
    reviewer_context: {
      type: 'object', additionalProperties: false,
      description: 'Anonymized, bucketed context only. No names, no exact employers.',
      properties: {
        program_year: en(['year_1', 'year_2', 'year_3_plus', 'part_time', 'alumni']),
        concentration: str({ maxLength: 60 }),
        background_bucket: en(['finance', 'accounting', 'engineering', 'tech', 'healthcare', 'operations', 'marketing_sales', 'arts_humanities', 'public_nonprofit', 'other']),
        career_target: str({ maxLength: 60 }),
        stage: STAGE,
      },
    },
    workload_hours_per_week: num(0, 60),
    workload_trend: en(['front_loaded', 'steady', 'back_loaded', 'spiky']),
    pace: rating('1 = very slow, 5 = very fast'),
    difficulty: rating('1 = very easy, 5 = very hard'),
    clarity: rating('1 = very unclear, 5 = very clear'),
    feedback_quality: rating('1 = little/late feedback, 5 = specific & timely'),
    grading_mix: {
      type: 'array', description: 'Percent of grade by assessment type; should sum to ~100',
      items: { type: 'object', required: ['type', 'percent'], additionalProperties: false, properties: { type: en(['exams', 'quizzes', 'problem_sets', 'case_writeups', 'group_project', 'individual_project', 'participation', 'presentations', 'discussion_posts', 'other']), percent: num(0, 100) } },
    },
    group_work_intensity: en(['none', 'light', 'moderate', 'heavy']),
    cold_calling: en(['never', 'occasional', 'frequent']),
    attendance_policy: en(['required_graded', 'required_ungraded', 'optional', 'recorded_async']),
    attendance_impact: en(['low', 'medium', 'high'], { description: 'How much attending changed outcomes/learning' }),
    office_hours_value: en(['not_used', 'low', 'medium', 'high']),
    instructor_response_time_hours: num(0, 336),
    skills_gained: arr(str({ maxLength: 60 }), { maxItems: 12 }),
    career_relevance: {
      type: 'object', additionalProperties: false,
      properties: { target_roles: arr(str({ maxLength: 60 }), { maxItems: 8 }), recruiter_signal: en(['none', 'some', 'strong']) },
    },
    prerequisites_actually_needed: arr(str({ maxLength: 80 }), { maxItems: 8 }),
    topics_covered: arr({ type: 'object', required: ['topic'], additionalProperties: false, properties: { topic: str({ maxLength: 80 }), depth: en(['intro', 'working', 'deep']), hardest: bool() } }, { maxItems: 15 }),
    would_retake: bool(),
    best_for: arr(str({ maxLength: 100 }), { maxItems: 6 }),
    avoid_if: arr(str({ maxLength: 100 }), { maxItems: 6 }),
    examples: arr(example, { maxItems: 10, description: 'Required for any 1 or 5 rating and for any warning' }),
    good_to_knows: arr(str({ pattern: '^gtk_' }), { description: 'IDs of GoodToKnow records created from this review' }),
    summary_confirmed: bool({ description: 'User confirmed the plain-language summary' }),
    moderation: {
      type: 'object', additionalProperties: false,
      properties: { status: en(['pending', 'approved', 'rejected', 'needs_edit']), flags: arr(str()), reviewed_by: en(['auto', 'staff']), reviewed_at: str({ format: 'date-time' }) },
    },
  },
  ['course_id', 'term', 'workload_hours_per_week', 'difficulty', 'clarity', 'would_retake'],
  {
    allOf: [
      // Evidence rule: extreme ratings need at least one example (enforced semantically in core/validate.js too).
      { if: { anyOf: ['pace', 'difficulty', 'clarity', 'feedback_quality'].flatMap((f) => [{ properties: { [f]: { enum: [1, 5] } }, required: [f] }]) }, then: { required: ['examples'], properties: { examples: { minItems: 1 } } } },
    ],
  });

S['good-to-know'] = schema('good-to-know', 'GoodToKnow',
  'Short, tagged tip about a course, instructor, program or campus. Confirmations raise confidence; stale tips decay.',
  {
    scope: en(['course', 'instructor', 'program', 'campus']),
    scope_ref: str({ description: 'course_id, instructor_id, program_id or campus_id the tip is about' }),
    category: en(['logistics', 'workload', 'grading', 'recruiting', 'community', 'resource', 'hidden_gem', 'warning']),
    text: str({ minLength: 10, maxLength: 280 }),
    example: str({ maxLength: 400, description: 'Required when category = warning' }),
    applies_terms: arr(str()),
    confirmations: int(0, 100000),
    disputes: int(0, 100000),
    last_confirmed_at: str({ format: 'date-time' }),
    confidence: num(0, 1, { description: 'Derived: confirmations vs disputes with time decay' }),
    source_review_id: str(),
    source_post_id: str(),
    moderation: { $ref: '#/$defs/moderation' },
  },
  ['scope', 'scope_ref', 'category', 'text', 'confirmations', 'last_confirmed_at'],
  {
    $defs: { moderation: { type: 'object', additionalProperties: false, properties: { status: en(['pending', 'approved', 'rejected', 'needs_edit']), flags: arr(str()) } } },
    allOf: [{ if: { properties: { category: { const: 'warning' } }, required: ['category'] }, then: { required: ['example'] } }],
  });

S['post'] = schema('post', 'Post',
  '"Ask & Share" post, lightly structured by AI so colloquial knowledge stays searchable. Tips can be promoted to GoodToKnow.',
  {
    author_profile_id: str(),
    type: en(['question', 'tip', 'story']),
    scope: en(['course', 'instructor', 'program', 'campus', 'career']),
    scope_ref: str(),
    tags: arr(str({ pattern: '^[a-z0-9_:-]{2,40}$' }), { maxItems: 10 }),
    text: str({ minLength: 5, maxLength: 4000 }),
    linked_record_ids: arr(str()),
    promoted_good_to_know_id: str(),
    escalate_to_staff: bool({ description: 'Sensitive topic (e.g. visa, finances, wellbeing) → route to GPP staff, not the AI' }),
    moderation: { type: 'object', additionalProperties: false, properties: { status: en(['pending', 'approved', 'rejected', 'needs_edit']), flags: arr(str()) } },
  },
  ['type', 'scope', 'tags', 'text']);

S['event-resource'] = schema('event-resource', 'EventResource',
  'Campus/program event, club, office or resource. Real items must carry source_url.',
  {
    type: en(['event', 'career_fair', 'networking', 'workshop', 'speaker', 'trek', 'club', 'office', 'resource', 'certificate', 'degree_program', 'office_hours']),
    title: str({ maxLength: 200 }),
    description: str({ maxLength: 600 }),
    schedule: {
      type: 'object', additionalProperties: false,
      properties: { start: str({ description: 'ISO 8601 date or date-time' }), end: str(), recurring: str({ maxLength: 80 }), timezone: str() },
    },
    location_or_url: str({ maxLength: 300 }),
    audience_tags: {
      type: 'object', additionalProperties: false,
      properties: { stage: arr(STAGE), track: arr(str()), interest: arr(str()) },
    },
    source: en(['ICS', 'RSS', 'manual', 'catalog', 'scrape']),
    source_url: str({ format: 'uri' }),
    relationship_nudge: bool({ description: 'Builds relationships (office hours, mixers, coffee chats)' }),
    relevance_reasons: arr(str({ maxLength: 160 }), { description: 'Filled per-profile at recommendation time' }),
    verified_at: str({ format: 'date' }),
  },
  ['type', 'title', 'audience_tags', 'source']);

S['profile'] = schema('profile', 'Profile',
  'User profile from resume + confirmation. Per-field visibility and consent. Contact details stripped by default.',
  {
    display_name: str({ maxLength: 60, description: 'Pseudonym or first name + initial' }),
    stage: STAGE,
    grad_year: int(1950, 2100),
    education: arr({ type: 'object', required: ['institution'], additionalProperties: false, properties: { institution: str(), degree: str(), field: str(), start_year: int(1950, 2100), end_year: int(1950, 2100) } }),
    experience: arr({ type: 'object', required: ['title'], additionalProperties: false, properties: { title: str(), org_type: str(), industry: str(), function: str(), start: str(), end: str(), highlights: arr(str({ maxLength: 240 })), outcome_logged: bool() } }),
    skills: arr(str({ maxLength: 60 })),
    interests: arr(str({ maxLength: 60 })),
    career_targets: arr(str({ maxLength: 80 })),
    courses_taken: arr({ type: 'object', required: ['course_id'], additionalProperties: false, properties: { course_id: str(), term: str(), reviewed: bool() } }),
    visibility: {
      type: 'object', description: 'Per-field visibility', additionalProperties: en(['private', 'cohort', 'campus_aggregate_only', 'public']),
    },
    consent: {
      type: 'object', additionalProperties: false, required: ['share_reviews', 'share_outcomes_aggregate', 'contact_by_peers'],
      properties: { share_reviews: bool(), share_outcomes_aggregate: bool(), contact_by_peers: bool(), named_in_outcomes: bool(), resume_retention_days: int(0, 365) },
    },
    draft: bool({ description: 'TRUE for a ProfileDraft awaiting user confirmation' }),
  },
  ['display_name', 'stage', 'consent']);

S['career-outcome'] = schema('career-outcome', 'CareerOutcome',
  'Structured record from the Career Outcome Interview. Always captures the single biggest factor.',
  {
    profile_id: str(),
    type: en(['internship', 'full_time', 'promotion', 'fellowship', 'startup', 'other']),
    org_type: en(['public_company', 'private_company', 'startup', 'nonprofit', 'government', 'university', 'self']),
    industry: str({ maxLength: 60 }),
    function: str({ maxLength: 60 }),
    role: str({ maxLength: 80 }),
    target: str({ pattern: '^[a-z0-9_]+$', description: 'Normalized path target for aggregation, e.g. finance_leadership' }),
    season: str({ pattern: '^(Spring|Summer|Fall|Winter) [0-9]{4}$' }),
    channel: en(['on_campus_recruiting', 'alumni_referral', 'internal_promotion', 'cold_outreach', 'job_board', 'recruiter_inbound', 'other']),
    timeline: { type: 'object', additionalProperties: false, properties: { first_touch: str(), offer: str(), weeks_total: num(0, 520) } },
    biggest_factor: {
      type: 'object', required: ['category', 'description'], additionalProperties: false,
      properties: {
        category: en(['coursework_skill', 'project_portfolio', 'networking_referral', 'prior_experience', 'certification', 'interview_prep', 'event_attended', 'mentor_sponsor', 'other']),
        description: str({ minLength: 15, maxLength: 500 }),
      },
    },
    supporting_factors: arr({ type: 'object', required: ['rank', 'category', 'description'], additionalProperties: false, properties: { rank: int(1, 10), category: str(), description: str({ maxLength: 300 }) } }, { maxItems: 6 }),
    courses_that_helped: arr({ type: 'object', required: ['course_id'], additionalProperties: false, properties: { course_id: str(), how: str({ maxLength: 240 }) } }),
    people_roles_that_helped: arr({ type: 'object', required: ['role'], additionalProperties: false, properties: { role: en(['alum', 'professor', 'career_coach', 'peer', 'manager', 'recruiter', 'mentor', 'other']), how: str({ maxLength: 240 }), name_with_consent: str() } }),
    events_attended: arr({ type: 'object', required: ['title'], additionalProperties: false, properties: { event_id: str(), title: str(), how: str({ maxLength: 240 }) } }),
    resources_used: arr(str({ maxLength: 120 })),
    do_differently: str({ maxLength: 500 }),
    advice_for_next_cohort: str({ maxLength: 500 }),
    backfill: bool({ description: 'TRUE when captured retroactively for a past resume role' }),
    summary_confirmed: bool(),
  },
  ['type', 'role', 'target', 'biggest_factor']);

S['path-insight'] = schema('path-insight', 'PathInsight',
  'Aggregate "what it took to get X". Only shown when min_n_met. Never re-identifying.',
  {
    target: str({ pattern: '^[a-z0-9_]+$' }),
    target_label: str(),
    n: int(0, 1000000),
    min_n: int(1, 1000),
    min_n_met: bool(),
    factor_distribution: arr({ type: 'object', required: ['category', 'count', 'share'], additionalProperties: false, properties: { category: str(), count: int(0, 1000000), share: num(0, 1) } }),
    common_courses: arr({ type: 'object', required: ['course_id', 'count'], additionalProperties: false, properties: { course_id: str(), title: str(), count: int(0, 1000000) } }),
    common_events: arr({ type: 'object', required: ['title', 'count'], additionalProperties: false, properties: { title: str(), count: int(0, 1000000) } }),
    common_channels: arr({ type: 'object', required: ['channel', 'count'], additionalProperties: false, properties: { channel: str(), count: int(0, 1000000) } }),
    typical_timeline: { type: 'object', additionalProperties: false, properties: { median_weeks: num(0, 520), p25_weeks: num(0, 520), p75_weeks: num(0, 520) } },
    confidence: en(['insufficient', 'low', 'medium', 'high']),
    cited_record_ids: arr(str()),
    computed_at: str({ format: 'date-time' }),
  },
  ['target', 'n', 'min_n', 'min_n_met', 'confidence', 'computed_at']);

S['course'] = schema('course', 'Course',
  'Catalog course. Real courses only; source_url or syllabus provenance required.',
  {
    course_id: str({ pattern: '^[A-Z]{2,5}:[0-9]{4}$' }),
    title: str(),
    level: en(['undergraduate', 'graduate']),
    credits: str(),
    department: str(),
    terms_seen: arr(str()),
    prerequisites_official: str({ maxLength: 300 }),
    description_short: str({ maxLength: 500 }),
    tags: arr(str()),
    instructor_ids: arr(str({ pattern: '^ins_' })),
  },
  ['course_id', 'title', 'level']);

S['career-passport'] = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: id('career-passport'),
  title: 'CareerPassport',
  description: 'Portable, consented bundle of profile + outcomes for export/import between MCP hosts and servers.',
  'x-schema-version': V,
  type: 'object',
  additionalProperties: false,
  required: ['passport_version', 'exported_at', 'issuer', 'consent', 'profile', 'outcomes'],
  properties: {
    passport_version: { const: V },
    exported_at: str({ format: 'date-time' }),
    issuer: { type: 'object', required: ['campus_id', 'system'], additionalProperties: false, properties: { campus_id: str(), program_id: str(), system: str() } },
    consent: { type: 'object', required: ['scopes', 'granted_at'], additionalProperties: false, properties: { scopes: arr(en(['profile', 'outcomes', 'reviews_authored'])), granted_at: str({ format: 'date-time' }), expires_at: str({ format: 'date-time' }) } },
    profile: { $ref: id('profile') },
    outcomes: arr({ $ref: id('career-outcome') }),
    reviews_authored: arr(str(), { description: 'IDs only; review content stays with the campus' }),
    checksum_sha256: str({ pattern: '^[a-f0-9]{64}$' }),
    extensions,
  },
};

S['error'] = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: id('error'),
  title: 'Error',
  description: 'The one error shape used by core, HTTP API and MCP tool results.',
  'x-schema-version': V,
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object', additionalProperties: false, required: ['code', 'message'],
      properties: {
        code: en(['VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT', 'INSUFFICIENT_DATA', 'CONSENT_REQUIRED', 'MODERATION_BLOCKED', 'LLM_UNAVAILABLE', 'BAD_REQUEST', 'INTERNAL']),
        message: str(),
        missing_fields: arr(str()),
        invalid_fields: arr({ type: 'object', required: ['path', 'reason'], properties: { path: str(), reason: str() } }),
        retryable: bool(),
        details: { type: 'object' },
      },
    },
  },
};

mkdirSync(join(ROOT, 'schemas'), { recursive: true });
const index = [];
for (const [name, s] of Object.entries(S)) {
  const file = join(ROOT, 'schemas', `${name}.schema.json`);
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  index.push({ name, title: s.title, $id: s.$id, version: V, file: `schemas/${name}.schema.json` });
}
writeFileSync(join(ROOT, 'schemas', 'index.json'), JSON.stringify({ schema_set_version: V, schemas: index }, null, 2) + '\n');
console.log(`wrote ${index.length} schemas (v${V})`);
