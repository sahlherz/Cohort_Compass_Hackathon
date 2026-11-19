// Seeds the demo store.
//   REAL (sourced): Tippie courses parsed from the GPP-provided syllabi (Fall 2025 / Spring 2026 / Summer 2026),
//                   undergrad courses + programs checked against catalog.registrar.uiowa.edu,
//                   events from the Tippie, Pomerantz and UICA calendars (verified 2026-11-18),
//                   alumni job-title counts from GPP's data.csv (aggregate only).
//   SYNTHETIC (labeled provenance.synthetic=true): every person, review, tip, post and outcome.
//   Instructors are pseudonymous ("Instructor A"); synthetic reviews are never attached to real faculty names.
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonStore } from '../core/store/json.js';
import { validate } from '../core/validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.CC_DATA_DIR || join(ROOT, 'data', 'db');
rmSync(DB, { recursive: true, force: true });
mkdirSync(DB, { recursive: true });
const store = createJsonStore(DB);

// deterministic PRNG so the demo is reproducible
let s = 20261119;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const around = (m, sd = 0.8) => Math.round(clamp(m + (rnd() + rnd() + rnd() - 1.5) * sd * 1.6, 1, 5));
const pad = (n, w = 4) => String(n).padStart(w, '0');
const V = '1.0.0';
const CAMPUS = 'uiowa';
const env = (id, { program_id = 'tippie-mba', program_type = 'MBA', source = 'seed', synthetic = true, source_url, created_at } = {}) => ({
  id, schema_version: V, campus_id: CAMPUS, program_id, program_type, created_at: created_at || '2026-11-01T12:00:00.000Z', updated_at: created_at || '2026-11-01T12:00:00.000Z',
  provenance: { source, synthetic, ...(source_url ? { source_url } : {}) }, extensions: {},
});
const errors = [];
const put = (coll, schema, rec) => { const v = validate(schema, rec); if (!v.valid) errors.push({ id: rec.id, ...v }); store.put(coll, rec); return rec; };

// ---------- campus + real alumni title families (GPP data.csv) ----------
const csv = readFileSync(join(ROOT, 'data', 'real', 'gpp_alumni_titles.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((l) => { const i = l.lastIndexOf(','); return { title: l.slice(0, i).replace(/^"|"$/g, '').trim(), n: Number(l.slice(i + 1)) }; });
const FAM = [
  ['Finance', /financ|fp&a|credit|portfolio|actuar|investment|wealth|treasur|controller|cfo|banker|loan|underwrit/i],
  ['Accounting & audit', /account|audit|tax|bookkeep|cpa/i],
  ['Project / program mgmt', /project|program|pmo|scrum|product owner/i],
  ['Analytics & data', /analyt|data|business intelligence|\bbi\b|insight|statistic|research analyst/i],
  ['Software & IT', /software|developer|it |systems|architect|devops|cyber|network|application|cloud|ai /i],
  ['Engineering', /engineer/i],
  ['Operations & supply chain', /operation|supply|plant|production|manufactur|logistic|procure|buyer|material|quality|process|maintenance/i],
  ['Sales & marketing', /sales|account (executive|manager)|marketing|territory|brand|customer|business development/i],
  ['HR & people', /human resources|\bhr\b|talent|recruit|people/i],
  ['Healthcare', /nurse|clinical|pharmac|physician|health|medical|therap/i],
  ['Executive & general mgmt', /chief|president|vice president|vp|director|general manager|owner|partner|executive/i],
];
const famCount = {};
let csvTotal = 0;
for (const r of csv) { if (!r.n) continue; csvTotal += r.n; const f = r.title ? (FAM.find(([, rx]) => rx.test(r.title))?.[0] || 'Other titles') : 'Not reported'; famCount[f] = (famCount[f] || 0) + r.n; }
store.put('campus', { id: CAMPUS, name: 'University of Iowa', college: 'Tippie College of Business', min_n: 5, programs: [
  { program_id: 'tippie-mba', program_type: 'MBA', name: 'Iowa MBA (Professional / part-time)' },
  { program_id: 'tippie-msf', program_type: 'MSF', name: 'Master of Finance' },
  { program_id: 'tippie-msba', program_type: 'MSBA', name: 'Master of Business Analytics' },
  { program_id: 'tippie-bba', program_type: 'BBA', name: 'Tippie undergraduate (BBA)' },
], taxonomy_version: '1.0.0', alumni_title_families: { source: 'GPP data.csv (provided to hackathon teams): job title × count, aggregate only', total: csvTotal, distinct_titles: csv.length, families: Object.entries(famCount).sort((a, b) => b[1] - a[1]).map(([family, n]) => ({ family, n })) } });

// ---------- REAL courses ----------
const SYL = 'syllabus';
const T = (...t) => t;
const COURSES = [
  ['ACCT:9020', 'Strategic Cost Analysis', 'graduate', 'Accounting', T('Fall 2025', 'Spring 2026'), 'MBA:8140 Corporate Financial Reporting', ['accounting', 'cost', 'decision making']],
  ['ACCT:9040', 'Financial Statement Analysis and Forecasting', 'graduate', 'Accounting', T('Spring 2026'), 'MBA:8140 Corporate Financial Reporting', ['accounting', 'finance', 'valuation', 'forecasting']],
  ['BAIS:6040', 'Data Programming in Python', 'graduate', 'Business Analytics', T('Fall 2025', 'Spring 2026'), '', ['python', 'analytics', 'programming']],
  ['BAIS:6050', 'Data Management', 'graduate', 'Business Analytics', T('Fall 2025', 'Spring 2026'), 'None', ['sql', 'databases', 'analytics']],
  ['BAIS:6070', 'Data Science', 'graduate', 'Business Analytics', T('Fall 2025', 'Spring 2026', 'Summer 2026'), 'BAIS:9100 (or MBA:8150), and BAIS:6040', ['python', 'machine learning', 'analytics', 'ai']],
  ['BAIS:6140', 'Visual Analytics', 'graduate', 'Business Analytics', T('Fall 2025'), '', ['tableau', 'visualization', 'analytics']],
  ['BAIS:6250', 'Applied Deep Learning', 'graduate', 'Business Analytics', T('Fall 2025'), 'BAIS:6040 and BAIS:6070', ['deep learning', 'ai', 'python']],
  ['BAIS:6260', 'Generative Artificial Intelligence', 'graduate', 'Business Analytics', T('Spring 2026'), '(MBA:8150 or BAIS:9100) and BAIS:6040 and BAIS:6070; coreq BAIS:6250', ['genai', 'ai', 'llm']],
  ['BAIS:6280', 'Cybersecurity', 'graduate', 'Business Analytics', T('Spring 2026'), '', ['security', 'it']],
  ['BAIS:9110', 'Advanced Analytics', 'graduate', 'Business Analytics', T('Summer 2025', 'Spring 2026'), 'MBA:8150 or BAIS:9100', ['analytics', 'optimization', 'modeling']],
  ['BAIS:9140', 'Agile Project Management', 'graduate', 'Business Analytics', T('Fall 2025', 'Spring 2026', 'Summer 2026'), 'None', ['project management', 'agile', 'scrum']],
  ['ENTR:9100', 'Entrepreneurship and Innovation', 'graduate', 'Entrepreneurship', T('Fall 2025'), 'None', ['entrepreneurship', 'innovation']],
  ['ENTR:9200', 'Entrepreneurial Finance', 'graduate', 'Entrepreneurship', T('Spring 2026'), '', ['entrepreneurship', 'finance', 'venture']],
  ['ENTR:9450', 'Strategic Management of Technology and Innovation', 'graduate', 'Entrepreneurship', T('Fall 2025'), 'None', ['innovation', 'strategy', 'technology']],
  ['FIN:9130', 'Corporate Risk Management and Insurance', 'graduate', 'Finance', T('Spring 2026'), '', ['finance', 'risk', 'insurance']],
  ['FIN:9140', 'Enterprise Risk Management', 'graduate', 'Finance', T('Fall 2025'), '', ['finance', 'risk']],
  ['FIN:9200', 'Portfolio Management', 'graduate', 'Finance', T('Spring 2026'), 'MBA:8180 Managerial Finance', ['finance', 'investments', 'portfolio']],
  ['FIN:9210', 'Derivatives', 'graduate', 'Finance', T('Spring 2026'), 'MBA:8180 Managerial Finance; FIN:9200 Portfolio Management', ['finance', 'derivatives', 'options']],
  ['FIN:9230', 'Real Estate Finance and Investments', 'graduate', 'Finance', T('Fall 2025'), 'MBA:8180', ['finance', 'real estate']],
  ['FIN:9300', 'Corporate Finance', 'graduate', 'Finance', T('Fall 2025'), 'MBA:8180', ['finance', 'corporate finance', 'valuation']],
  ['FIN:9310', 'Corporate Financial Strategy', 'graduate', 'Finance', T('Spring 2026'), 'None', ['finance', 'strategy', 'leadership']],
  ['FIN:9350', 'Wealth Management', 'graduate', 'Finance', T('Fall 2025'), 'MBA:8180', ['finance', 'wealth']],
  ['MBA:8110', 'Marketing Management', 'graduate', 'MBA Core', T('Fall 2025'), 'None', ['marketing']],
  ['MBA:8120', 'Management in Organizations', 'graduate', 'MBA Core', T('Fall 2025', 'Spring 2026'), 'None', ['management', 'leadership', 'organizations']],
  ['MBA:8130', 'Business Communication', 'graduate', 'MBA Core', T('Spring 2026'), 'None', ['communication']],
  ['MBA:8140', 'Corporate Financial Reporting', 'graduate', 'MBA Core', T('Fall 2025', 'Spring 2026', 'Summer 2026'), 'None', ['accounting', 'financial statements']],
  ['MBA:8150', 'Data & Decisions', 'graduate', 'MBA Core', T('Fall 2025', 'Summer 2026'), '', ['statistics', 'analytics', 'excel', 'regression']],
  ['MBA:8160', 'Managerial Economics', 'graduate', 'MBA Core', T('Fall 2025', 'Summer 2026'), 'None', ['economics']],
  ['MBA:8180', 'Managerial Finance', 'graduate', 'MBA Core', T('Fall 2025', 'Spring 2026', 'Summer 2026'), 'None', ['finance', 'valuation', 'capital budgeting']],
  ['MBA:8240', 'Operations and Supply Chain Management', 'graduate', 'MBA Core', T('Fall 2025', 'Spring 2026'), '', ['operations', 'supply chain']],
  ['MBA:8300', 'Foundations in Strategy', 'graduate', 'MBA Core', T('Fall 2025'), '', ['strategy']],
  ['MBA:8320', 'Strategic Business Growth', 'graduate', 'MBA Core', T('Fall 2025', 'Summer 2026'), 'Five MBA core courses including MBA:8110', ['strategy', 'growth', 'innovation']],
  ['MBA:9130', 'Leadership Communication & Story', 'graduate', 'MBA', T('Fall 2025', 'Spring 2026', 'Summer 2026'), 'None', ['communication', 'leadership', 'storytelling']],
  ['MBA:9300', 'Strategy in Action', 'graduate', 'MBA', T('Fall 2025', 'Spring 2026'), 'MBA:8300 Foundations in Strategy plus four core courses', ['strategy', 'capstone']],
  ['MGMT:9110', 'Dynamics of Negotiation', 'graduate', 'Management', T('Fall 2025', 'Spring 2026'), 'None', ['negotiation', 'leadership']],
  ['MGMT:9120', 'Leadership and Personal Development', 'graduate', 'Management', T('Fall 2025'), 'None', ['leadership', 'personal development', 'management']],
  ['MGMT:9170', 'HR Analytics', 'graduate', 'Management', T('Fall 2025'), 'Data and Decisions (MBA:8150 / BAIS:9100)', ['hr', 'analytics']],
  ['MGMT:9220', 'Maximizing Team Performance', 'graduate', 'Management', T('Fall 2025', 'Spring 2026'), 'None', ['teams', 'leadership', 'project management']],
  ['MGMT:9230', 'Managing and Preventing Conflict', 'graduate', 'Management', T('Fall 2025', 'Spring 2026'), 'None', ['conflict', 'leadership']],
  ['MGMT:9240', 'Inclusive Leadership', 'graduate', 'Management', T('Spring 2026'), '', ['leadership']],
  ['MGMT:9250', 'Managing Employee Performance', 'graduate', 'Management', T('Spring 2026'), 'None', ['management', 'hr', 'leadership']],
  ['MKTG:9015', 'Social Media Marketing', 'graduate', 'Marketing', T('Spring 2026'), 'None', ['marketing', 'social media']],
  ['MKTG:9320', 'Strategic Brand Positioning', 'graduate', 'Marketing', T('Spring 2026'), 'Principles of Marketing', ['marketing', 'brand']],
  ['MKTG:9370', 'Customer Experience', 'graduate', 'Marketing', T('Spring 2026'), '', ['marketing', 'customer experience']],
];
const UG = [
  ['ACCT:2100', 'Introduction to Financial Accounting', 'Accounting', '3 s.h.', '', ['accounting', 'financial statements'], 'https://catalog.registrar.uiowa.edu/courses/acct'],
  ['ACCT:3020', 'Financial Accounting and Reporting', 'Accounting', '3 s.h.', 'ACCT:2100', ['accounting'], 'https://catalog.registrar.uiowa.edu/courses/acct'],
  ['ENTR:2000', 'Entrepreneurship and Innovation', 'Entrepreneurship', '3 s.h.', '', ['entrepreneurship', 'innovation'], 'https://catalog.registrar.uiowa.edu/tippie-business/management-entrepreneurship/entrepreneurial-management-certificate/'],
  ['ENTR:4510', 'Arts Leadership Seminar', 'Entrepreneurship', '3 s.h.', '', ['arts', 'entrepreneurship', 'leadership'], 'https://catalog.registrar.uiowa.edu/tippie-business/management-entrepreneurship/entrepreneurial-management-certificate/'],
  ['THTR:3510', 'Introduction to Arts Management', 'Theatre Arts', '3 s.h.', '', ['arts', 'management'], 'https://catalog.registrar.uiowa.edu/liberal-arts-sciences/event-management/event-management-certificate'],
  ['ARTH:1060', 'From Mona Lisa to Modernism: Survey of Western Art II', 'Art History', '3 s.h.', '', ['arts', 'art history'], 'https://catalog.registrar.uiowa.edu/liberal-arts-sciences/division-interdisciplinary-programs/interdepartmental-studies-ba/'],
  ['CS:2210', 'Discrete Structures', 'Computer Science', '3 s.h.', '', ['cs', 'proofs', 'math'], 'https://catalog.registrar.uiowa.edu/courses/cs'],
  ['CS:2230', 'Computer Science II: Data Structures', 'Computer Science', '4 s.h.', '', ['cs', 'programming'], 'https://catalog.registrar.uiowa.edu/courses/cs'],
];
const DESC = {
  'MBA:8180': 'Core finance: time value of money, valuation, capital budgeting and the cost of capital, applied to managerial decisions.',
  'MBA:8150': 'Core analytics: probability, sampling, hypothesis testing and regression for business decisions, mostly in Excel.',
  'MBA:8140': 'Core accounting: reading and interpreting the three financial statements from a manager\'s and investor\'s view.',
  'MGMT:9120': 'Leadership self-assessment and development planning; feedback, coaching and personal leadership practice.',
  'FIN:9200': 'Investment analysis: risk/return, portfolio construction, asset pricing models and performance evaluation.',
  'BAIS:6070': 'Applied data science in Python: data preparation, supervised learning, model evaluation and communication of results.',
  'ACCT:2100': 'Accounting and financial reporting procedures used by business and not-for-profit entities.',
  'MBA:9130': 'Communicating as a leader through narrative and storytelling.',
};
const insId = (code, k = 'a') => `ins_${code.toLowerCase().replace(':', '')}_${k}`;
for (const [course_id, title, level, department, terms, pre, tags] of COURSES) {
  put('courses', 'course', { ...env(`crs_${course_id.replace(':', '')}`, { program_id: 'tippie-gpp', program_type: 'MBA', source: SYL, synthetic: false }), course_id, title, level, department, terms_seen: terms, prerequisites_official: pre && pre !== 'None' ? pre : 'None listed', ...(DESC[course_id] ? { description_short: DESC[course_id] } : {}), tags, instructor_ids: [insId(course_id)] });
}
for (const [course_id, title, department, credits, pre, tags, url] of UG) {
  put('courses', 'course', { ...env(`crs_${course_id.replace(':', '')}`, { program_id: 'tippie-bba', program_type: 'BBA', source: 'catalog', synthetic: false, source_url: url }), course_id, title, level: 'undergraduate', department, credits, terms_seen: [], prerequisites_official: pre || 'See catalog', ...(DESC[course_id] ? { description_short: DESC[course_id] } : {}), tags, instructor_ids: [insId(course_id)] });
}
for (const c of store.all('courses')) store.put('instructors', { id: c.instructor_ids[0], label: 'Instructor A', course_id: c.course_id, note: 'Pseudonymous in demo. Real names only via a campus-approved mapping.' });

// ---------- REAL events & resources (verified 2026-11-18) ----------
const TIPPIE_CAL = 'https://apps.biz.uiowa.edu/EventsCalendar/Calendar';
const CAREERS = 'https://careers.uiowa.edu/upcoming-events';
const ev = (n, { program_id = 'tippie-gpp', program_type = 'MBA', src = 'scrape', ...o }) => put('events', 'event-resource', { ...env(`evt_${pad(n)}`, { program_id, program_type, source: src === 'catalog' ? 'catalog' : 'calendar', synthetic: false, source_url: o.source_url }), verified_at: '2026-11-18', source: src, ...o });
const GPP = ['MBA', 'MSF', 'MSBA', 'certificate', 'tippie-mba', 'tippie-msf', 'tippie-msba'];
ev(1, { type: 'speaker', title: 'Knapp Speaker Series featuring George Rosenthal (Tippie GPP)', description: 'Keynote on applying AI in practice, including AI agents for productivity and automation. Registration required.', schedule: { start: '2026-11-19T18:00:00-06:00', end: '2026-11-19T19:00:00-06:00', timezone: 'America/Chicago' }, location_or_url: 'Online via Zoom', audience_tags: { stage: ['enrolled', 'heading_out', 'alumni'], track: GPP, interest: ['ai', 'analytics', 'leadership'] }, source_url: TIPPIE_CAL });
ev(2, { type: 'networking', title: 'Tippie Graduate Career Services: November Career Connect Call', description: 'Monthly one-hour networking call for Iowa MBA, part-time MBA in Business Analytics, part-time Master of Finance and certificate students. No RSVP required.', schedule: { start: '2026-11-20T12:00:00-06:00', end: '2026-11-20T13:00:00-06:00', recurring: 'monthly', timezone: 'America/Chicago' }, location_or_url: 'Online via Zoom', audience_tags: { stage: ['enrolled', 'heading_out', 'alumni'], track: GPP, interest: ['networking', 'finance', 'leadership', 'analytics', 'project_management'] }, relationship_nudge: true, source_url: TIPPIE_CAL });
ev(3, { type: 'networking', title: 'UI Center for Advancement: Illinois Football Hawkeye Huddle (Champaign, IL)', description: 'Free pregame rally before Iowa vs. Illinois. Registration required.', schedule: { start: '2026-11-21T09:00:00-06:00', end: '2026-11-21T21:00:00-06:00', timezone: 'America/Chicago' }, location_or_url: '1900 1st St, Champaign, IL 61820', audience_tags: { stage: ['alumni'], track: [], interest: ['networking'] }, relationship_nudge: true, source_url: TIPPIE_CAL });
ev(4, { type: 'workshop', title: 'Tippie Applied AI Community of Practice: December Meeting', description: 'Monthly lab meeting on how AI can solve business problems.', schedule: { start: '2026-12-11T12:00:00-06:00', end: '2026-12-11T12:55:00-06:00', recurring: 'monthly', timezone: 'America/Chicago' }, location_or_url: 'Online via Teams', audience_tags: { stage: ['enrolled', 'heading_out', 'alumni'], track: GPP, interest: ['ai', 'analytics'] }, relationship_nudge: true, source_url: TIPPIE_CAL });
ev(5, { type: 'networking', title: 'Tippie Graduate Career Services: December Career Connect Call', description: 'Monthly networking call for Graduate & Professional Programs students. No RSVP required.', schedule: { start: '2026-12-18T12:00:00-06:00', end: '2026-12-18T13:00:00-06:00', recurring: 'monthly', timezone: 'America/Chicago' }, location_or_url: 'Online via Zoom', audience_tags: { stage: ['enrolled', 'heading_out', 'alumni'], track: GPP, interest: ['networking', 'finance', 'leadership'] }, relationship_nudge: true, source_url: TIPPIE_CAL });
ev(6, { type: 'networking', title: 'Tippie Graduate & Professional Programs Basketball Bash', description: 'Family-friendly pregame reception before Iowa vs. Minnesota men\'s basketball (game ticket required).', schedule: { start: '2027-02-27T11:30:00-06:00', end: '2027-02-27T12:45:00-06:00', timezone: 'America/Chicago' }, location_or_url: 'Carver-Hawkeye Arena, Iowa City', audience_tags: { stage: ['enrolled', 'alumni'], track: GPP, interest: ['networking'] }, relationship_nudge: true, source_url: TIPPIE_CAL });
ev(7, { type: 'networking', title: 'Hawkeye Day 2027', description: 'A day for alumni, friends, fans and students to connect and explore campus.', schedule: { start: '2027-04-24T08:00:00-05:00', end: '2027-04-24T20:00:00-05:00', timezone: 'America/Chicago' }, location_or_url: 'Iowa City', audience_tags: { stage: ['alumni', 'enrolled'], track: [], interest: ['networking', 'further_education'] }, relationship_nudge: true, source_url: TIPPIE_CAL });
ev(8, { type: 'trek', title: 'Arts, Media, and Entertainment Career Trek (Chicago)', description: 'Overnight Pomerantz Career Center trek to arts, media and entertainment employers in Chicago.', schedule: { start: '2026-12-03', end: '2026-12-04', timezone: 'America/Chicago' }, location_or_url: 'Overnight trek to Chicago, IL', audience_tags: { stage: ['enrolled'], track: ['BBA', 'tippie-bba'], interest: ['arts', 'undecided', 'networking'] }, relationship_nudge: true, source_url: 'https://careers.uiowa.edu/career-treks' });
ev(9, { type: 'resource', title: 'Mock Interviews (Pomerantz Career Center)', description: 'Practice interviews with feedback; virtual and in-person options, offered in multi-day blocks each semester.', schedule: { recurring: 'several blocks per semester' }, location_or_url: 'https://careers.uiowa.edu/mocks', audience_tags: { stage: ['enrolled', 'heading_out'], track: ['BBA', 'tippie-bba'], interest: ['accounting', 'finance', 'undecided'] }, source_url: 'https://careers.uiowa.edu/mocks' });
ev(10, { type: 'office', title: 'Pomerantz Career Center: career advising', description: 'Undergraduate career exploration and advising, career fairs, treks and HawkShadows job shadows.', schedule: { recurring: 'ongoing' }, location_or_url: 'Pomerantz Center, 213 N Clinton St, Iowa City', audience_tags: { stage: ['enrolled', 'heading_out'], track: ['BBA', 'tippie-bba'], interest: ['undecided', 'accounting', 'arts', 'networking'] }, relationship_nudge: true, source_url: CAREERS });
ev(11, { type: 'office', title: 'Tippie Graduate Career Services coaching', description: 'Career coaching for GPP students and alumni (virtual and in Des Moines/Iowa City).', schedule: { recurring: 'by appointment' }, location_or_url: 'https://students.tippie.uiowa.edu', audience_tags: { stage: ['enrolled', 'heading_out', 'alumni'], track: GPP, interest: ['finance', 'leadership', 'analytics', 'project_management', 'further_education'] }, relationship_nudge: true, source_url: 'https://students.tippie.uiowa.edu' });
ev(12, { type: 'certificate', title: 'Certificate in Entrepreneurial Management (undergraduate)', description: 'Open to all UI undergraduates; starts with ENTR:2000 and includes options such as ENTR:4510 Arts Leadership Seminar.', schedule: { recurring: 'declare anytime' }, location_or_url: 'catalog.registrar.uiowa.edu', audience_tags: { stage: ['enrolled'], track: ['BBA', 'tippie-bba'], interest: ['entrepreneurship', 'arts', 'undecided'] }, source_url: 'https://catalog.registrar.uiowa.edu/tippie-business/management-entrepreneurship/entrepreneurial-management-certificate/', src: 'catalog' });
ev(13, { type: 'certificate', title: 'Certificate in Event Management (undergraduate)', description: 'Includes THTR:3510 Introduction to Arts Management among approved courses.', schedule: { recurring: 'declare anytime' }, location_or_url: 'catalog.registrar.uiowa.edu', audience_tags: { stage: ['enrolled'], track: ['BBA', 'tippie-bba'], interest: ['arts', 'undecided'] }, source_url: 'https://catalog.registrar.uiowa.edu/liberal-arts-sciences/event-management/event-management-certificate', src: 'catalog' });
ev(14, { type: 'degree_program', title: 'Art minor (School of Art, Art History, and Design)', description: 'A minor in Art can pair with a BBA such as Accounting.', schedule: { recurring: 'declare anytime' }, location_or_url: 'admissions.uiowa.edu/academics/undergraduate-areas-of-study', audience_tags: { stage: ['enrolled'], track: ['BBA', 'tippie-bba'], interest: ['arts', 'undecided'] }, source_url: 'https://admissions.uiowa.edu/academics/undergraduate-areas-of-study', src: 'catalog' });
ev(15, { type: 'degree_program', title: 'Accounting, BBA', description: 'Tippie BBA major in Accounting; ACCT:2100 is the entry course.', schedule: { recurring: 'declare anytime' }, location_or_url: 'catalog.registrar.uiowa.edu', audience_tags: { stage: ['enrolled'], track: ['BBA', 'tippie-bba'], interest: ['accounting', 'undecided'] }, source_url: 'https://catalog.registrar.uiowa.edu/tippie-business/accounting/', src: 'catalog' });
ev(16, { type: 'certificate', title: 'Professional Certificate in Innovation (12 s.h., Tippie graduate)', description: 'Graduate certificate drawing on Management & Entrepreneurship and Iowa JPEC; includes MBA:8320 Strategic Business Growth. A low-commitment way back to Iowa.', schedule: { recurring: 'admission summer, fall or spring' }, location_or_url: 'catalog.registrar.uiowa.edu', audience_tags: { stage: ['alumni', 'heading_out'], track: GPP, interest: ['further_education', 'leadership', 'entrepreneurship'] }, source_url: 'https://catalog.registrar.uiowa.edu/tippie-business/master-of-business-administration/innovation-certificate/', src: 'catalog' });
ev(17, { type: 'degree_program', title: 'Iowa MBA, part-time (Tippie GPP)', description: 'Part-time MBA for working professionals; core includes MBA:8180, MGMT leadership electives and FIN electives. Certificate-only admission also available.', schedule: { recurring: 'rolling admission' }, location_or_url: 'https://tippie.uiowa.edu/lifelong-learning/certificates/cert-only-admissions/', audience_tags: { stage: ['alumni'], track: GPP, interest: ['further_education', 'leadership', 'finance'] }, source_url: 'https://tippie.uiowa.edu/lifelong-learning/certificates/cert-only-admissions/', src: 'catalog' });
ev(18, { type: 'networking', title: 'UI Center for Advancement I-Clubs (alumni networks by city)', description: 'Local University of Iowa alumni clubs and their events.', schedule: { recurring: 'ongoing' }, location_or_url: 'https://www.foriowa.org/networks/locations.php', audience_tags: { stage: ['alumni'], track: [], interest: ['networking'] }, relationship_nudge: true, source_url: 'https://www.foriowa.org/networks/locations.php' });
ev(19, { type: 'office_hours', title: 'Instructor office hours (listed on each ICON course site)', description: 'The highest-leverage 15 minutes in most courses. See the course ICON page for times.', schedule: { recurring: 'weekly' }, location_or_url: 'ICON course site', audience_tags: { stage: ['enrolled'], track: [], interest: ['accounting', 'finance', 'analytics', 'undecided'] }, relationship_nudge: true, source_url: 'https://students.tippie.uiowa.edu', src: 'manual' });
ev(20, { type: 'resource', title: 'Hawkeye Experience Grant (undergraduate)', description: 'Funding for undergraduates doing applied learning outside the classroom (e.g. unpaid internships). Help sessions at Pomerantz.', schedule: { recurring: 'application cycles each term' }, location_or_url: CAREERS, audience_tags: { stage: ['enrolled'], track: ['BBA', 'tippie-bba'], interest: ['arts', 'undecided', 'accounting'] }, source_url: CAREERS });

// ---------- SYNTHETIC reviews (concentrated so aggregates clear min_n=5) ----------
const PROFILES_REVIEW = {
  'MBA:8180': { n: 10, wl: [6, 11], diff: 3.8, clar: 4.2, fb: 3.6, fmt: ['online_sync', 'evening_weekend'], grading: [['exams', 50], ['problem_sets', 25], ['case_writeups', 15], ['participation', 10]], group: 'moderate', trend: 'back_loaded', oh: [0.55, 0.3, 0.15], topics: ['time value of money', 'NPV and capital budgeting', 'WACC', 'capital structure', 'valuation multiples'], hardest: 'WACC', skills: ['dcf modeling', 'excel', 'capital budgeting', 'reading a 10-k'], roles: ['FP&A', 'finance manager', 'corporate development'], retake: 0.85, best: ['anyone targeting finance leadership', 'career switchers into finance'], avoid: ['you have zero Excel practice and a heavy work quarter'], ex: { clarity: 'Each session started from a real company decision and built the spreadsheet live, so the formulas always had a purpose.', feedback_quality: 'Problem sets came back with worked solutions within a week, but individual comments were short.', avoid_if: 'Two people in my group had never built an Excel model and spent 15+ hours on the first problem set.' }, gtk: ['Do the posted Excel warm-up before week 1. The first problem set assumes you can already build an NPV model.', 'Office hours the week before the midterm were basically a review session. Go.', 'Second half (WACC, capital structure) is heavier than the first; front-load your reading in weeks 4–6.'] },
  'MBA:8150': { n: 8, wl: [5, 9], diff: 3.3, clar: 3.9, fb: 3.8, fmt: ['online_sync', 'online_async'], grading: [['exams', 40], ['problem_sets', 30], ['individual_project', 20], ['participation', 10]], group: 'light', trend: 'steady', oh: [0.4, 0.4, 0.2], topics: ['probability', 'sampling distributions', 'hypothesis testing', 'regression', 'decision trees'], hardest: 'regression', skills: ['regression in excel', 'hypothesis testing', 'excel'], roles: ['business analyst', 'data analyst'], retake: 0.75, best: ['people who want to read data claims critically'], avoid: ['you already did a stats-heavy undergrad'], ex: { clarity: 'Every regression example used the same housing dataset all term, so you could focus on interpretation instead of new data.', avoid_if: 'If you took econometrics in undergrad, the first five weeks are review and you will be bored.' }, gtk: ['Install the Analysis ToolPak before the first session. Mac users need the alternative add-in.', 'The individual project is graded more on interpretation than on fancy models.'] },
  'MBA:8140': { n: 6, wl: [5, 8], diff: 3.0, clar: 4.0, fb: 3.4, fmt: ['online_sync', 'evening_weekend'], grading: [['exams', 60], ['quizzes', 20], ['case_writeups', 20]], group: 'light', trend: 'front_loaded', oh: [0.5, 0.35, 0.15], topics: ['balance sheet', 'income statement', 'cash flow statement', 'accruals', 'ratio analysis'], hardest: 'cash flow statement', skills: ['reading financial statements', 'ratio analysis'], roles: ['financial analyst', 'consultant'], retake: 0.8, best: ['non-accountants who need to speak finance'], avoid: [], ex: { clarity: 'The instructor tied every journal entry back to a real annual report we had open in another tab.' }, gtk: ['Weekly quizzes are open-note but timed; do the reading first or you will run out of time.'] },
  'MGMT:9120': { n: 6, wl: [3, 6], diff: 2.2, clar: 4.3, fb: 4.4, fmt: ['online_sync', 'hybrid'], grading: [['participation', 30], ['individual_project', 40], ['presentations', 15], ['discussion_posts', 15]], group: 'light', trend: 'steady', oh: [0.35, 0.45, 0.2], topics: ['360 feedback', 'leadership identity', 'coaching', 'development plan'], hardest: 'development plan', skills: ['giving feedback', 'coaching conversations', 'self-assessment'], roles: ['finance manager', 'people manager'], retake: 0.9, best: ['new or soon-to-be managers'], avoid: [], ex: { feedback_quality: 'My development plan came back with two pages of specific comments and a follow-up question for each goal.', clarity: 'Rubrics for every reflection were posted on day one and matched how we were graded.' }, gtk: ['Pick a real, current work problem for your development plan; it makes the course pay off at work immediately.'] },
  'FIN:9200': { n: 5, wl: [7, 12], diff: 4.0, clar: 3.7, fb: 3.4, fmt: ['online_sync', 'in_person'], grading: [['exams', 45], ['problem_sets', 25], ['group_project', 30]], group: 'moderate', trend: 'spiky', oh: [0.5, 0.3, 0.2], topics: ['risk and return', 'CAPM', 'factor models', 'portfolio optimization', 'performance evaluation'], hardest: 'portfolio optimization', skills: ['portfolio optimization', 'excel solver', 'performance attribution'], roles: ['portfolio analyst', 'investment analyst', 'finance manager'], retake: 0.8, best: ['investment-track MSF/MBA students'], avoid: ['you have not taken MBA:8180 or equivalent'], ex: { avoid_if: 'The first problem set assumed comfort with CAPM and discounting from Managerial Finance; two classmates without it dropped.' }, gtk: ['The group project weeks are the spike; agree on roles in week one.'] },
  'BAIS:6070': { n: 6, wl: [8, 13], diff: 4.1, clar: 3.8, fb: 3.9, fmt: ['online_sync', 'online_async'], grading: [['problem_sets', 40], ['individual_project', 30], ['exams', 20], ['participation', 10]], group: 'light', trend: 'back_loaded', oh: [0.45, 0.35, 0.2], topics: ['pandas', 'classification', 'model evaluation', 'cross-validation', 'clustering'], hardest: 'model evaluation', skills: ['python', 'scikit-learn', 'model evaluation', 'pandas'], roles: ['data analyst', 'business analyst', 'analytics manager'], retake: 0.85, best: ['analysts who want to move from Excel to Python'], avoid: ['you skipped BAIS:6040'], ex: { avoid_if: 'Without BAIS:6040 the pandas notebooks in week 2 took me 14 hours.' }, gtk: ['Use the course\'s Colab templates; local installs cost people a full weekend.', 'The final project can use your own work data if you anonymize it; that\'s what made it portfolio-worthy.'] },
  'ACCT:2100': { n: 6, wl: [4, 8], diff: 3.2, clar: 3.9, fb: 3.5, fmt: ['in_person'], grading: [['exams', 65], ['quizzes', 15], ['problem_sets', 20]], group: 'none', trend: 'steady', oh: [0.4, 0.4, 0.2], topics: ['accounting equation', 'journal entries', 'adjusting entries', 'inventory', 'financial statements'], hardest: 'adjusting entries', skills: ['journal entries', 'reading financial statements'], roles: ['accountant', 'auditor'], retake: 0.75, best: ['anyone deciding whether accounting is for them'], avoid: [], ex: { clarity: 'Each chapter had a short video walking through one full worked problem before class, which made lectures easy to follow.' }, gtk: ['Do the practice problems by hand; exams are paper-based and not open-note.', 'Tutoring through the Tippie Learning Center saved me before the second exam.'] },
  'MBA:9130': { n: 3, wl: [3, 5], diff: 2.0, clar: 4.4, fb: 4.6, fmt: ['online_sync'], grading: [['presentations', 50], ['participation', 30], ['individual_project', 20]], group: 'light', trend: 'steady', oh: [0.3, 0.4, 0.3], topics: ['narrative structure', 'executive presence', 'data storytelling'], hardest: 'executive presence', skills: ['storytelling', 'presenting'], roles: ['manager'], retake: 1, best: ['anyone who presents to executives'], avoid: [], ex: { feedback_quality: 'Every presentation got a recorded video critique with timestamps for each suggestion.' }, gtk: ['Record yourself before each presentation; it\'s required anyway and it\'s the most useful part.'] },
};
const BGS = ['finance', 'finance', 'accounting', 'engineering', 'tech', 'operations', 'healthcare', 'marketing_sales', 'arts_humanities'];
let rv = 0, gk = 0;
for (const [course_id, P] of Object.entries(PROFILES_REVIEW)) {
  const c = store.get('courses', `crs_${course_id.replace(':', '')}`);
  const ug = c.level === 'undergraduate';
  for (let i = 0; i < P.n; i++) {
    rv++;
    const id = `rev_${pad(rv)}`;
    const ratings = { pace: around(3.4), difficulty: around(P.diff), clarity: around(P.clar), feedback_quality: around(P.fb) };
    const examples = [];
    for (const [f, v] of Object.entries(ratings)) if (v === 1 || v === 5) examples.push({ claim: `${f}=${v}`, field: f, evidence: P.ex[f] || (v === 5 ? `Specific, consistent ${f.replace('_', ' ')}: the same structure every week made it easy to plan around.` : `The ${f.replace('_', ' ')} was a problem: two assignments came back after the next one was already due.`) });
    if (examples.length === 0 && P.ex.clarity && rnd() < 0.4) examples.push({ claim: 'clarity', field: 'clarity', evidence: P.ex.clarity });
    const avoid = P.avoid.length && rnd() < 0.6 ? [...P.avoid] : [];
    if (avoid.length) examples.push({ claim: 'avoid_if', field: 'avoid_if', evidence: P.ex.avoid_if || 'Saw classmates struggle for exactly this reason in the first three weeks.' });
    const r = rnd();
    const oh = r < P.oh[0] ? 'high' : r < P.oh[0] + P.oh[1] ? 'medium' : rnd() < 0.5 ? 'low' : 'not_used';
    const jitter = P.grading.map(([type, pc]) => ({ type, percent: pc }));
    const rec = {
      ...env(id, { program_id: ug ? 'tippie-bba' : course_id.startsWith('FIN') && rnd() < 0.6 ? 'tippie-msf' : course_id.startsWith('BAIS') ? 'tippie-msba' : 'tippie-mba', program_type: ug ? 'BBA' : course_id.startsWith('FIN') ? 'MSF' : course_id.startsWith('BAIS') ? 'MSBA' : 'MBA', created_at: new Date(Date.parse('2025-12-15') + rnd() * 300 * 864e5).toISOString() }),
      course_id, instructor_id: insId(course_id), term: pick(c.terms_seen.length ? c.terms_seen.filter((t) => /^(Spring|Summer|Fall|Winter) \d{4}$/.test(t)) : ['Fall 2025', 'Spring 2026']), format: pick(P.fmt),
      reviewer_context: { program_year: ug ? pick(['year_1', 'year_2']) : pick(['part_time', 'part_time', 'year_1', 'year_2']), background_bucket: ug ? pick(['other', 'arts_humanities', 'finance']) : pick(BGS), career_target: pick(P.roles), stage: rnd() < 0.2 && !ug ? 'alumni' : 'enrolled' },
      workload_hours_per_week: Math.round(between(P.wl[0], P.wl[1])), workload_trend: rnd() < 0.7 ? P.trend : pick(['steady', 'front_loaded', 'back_loaded', 'spiky']),
      ...ratings, grading_mix: jitter, group_work_intensity: rnd() < 0.75 ? P.group : pick(['none', 'light', 'moderate', 'heavy']), cold_calling: pick(['never', 'occasional', 'occasional']), attendance_policy: pick(['required_ungraded', 'required_graded', 'recorded_async']), attendance_impact: pick(['medium', 'high', 'high', 'low']), office_hours_value: oh, instructor_response_time_hours: Math.round(between(6, 48)),
      skills_gained: P.skills.filter(() => rnd() < 0.65).slice(0, 3), career_relevance: { target_roles: [pick(P.roles)], recruiter_signal: pick(['some', 'some', 'strong', 'none']) },
      prerequisites_actually_needed: rnd() < 0.5 ? ['Excel basics'] : [], topics_covered: P.topics.filter(() => rnd() < 0.75).map((t) => ({ topic: t, depth: 'working', ...(t === P.hardest && rnd() < 0.8 ? { hardest: true, depth: 'deep' } : {}) })),
      would_retake: rnd() < P.retake, best_for: rnd() < 0.7 ? [P.best[0]] : [], avoid_if: avoid, examples, good_to_knows: [], summary_confirmed: true,
      moderation: { status: 'approved', flags: [], reviewed_by: 'auto', reviewed_at: '2026-11-01T12:00:00.000Z' },
    };
    if (!rec.topics_covered.length) rec.topics_covered = [{ topic: P.topics[0], depth: 'working' }];
    put('reviews', 'course-review', rec);
  }
  // good-to-knows with varied confirmations and freshness (to show decay)
  P.gtk.forEach((text, j) => {
    gk++;
    const old = j === 2 || (course_id === 'ACCT:2100' && j === 1);
    const warning = /assume|heavier|skip|dropped/i.test(text) && j > 0;
    put('gtks', 'good-to-know', { ...env(`gtk_${pad(gk)}`, { program_id: ug ? 'tippie-bba' : 'tippie-mba', program_type: ug ? 'BBA' : 'MBA' }), scope: 'course', scope_ref: course_id, category: /office hours|tutor|colab|toolpak/i.test(text) ? 'resource' : /hours|week|heav|front|spike/i.test(text) ? 'workload' : /graded|exam|quiz/i.test(text) ? 'grading' : 'logistics', text, ...(warning ? { category: 'warning', example: 'Reported by multiple reviewers in the term it applied.' } : {}), applies_terms: [], confirmations: Math.round(between(2, 14)), disputes: Math.round(between(0, 2)), last_confirmed_at: old ? '2025-09-01T12:00:00.000Z' : '2026-10-' + pad(Math.round(between(1, 28)), 2) + 'T12:00:00.000Z', moderation: { status: 'approved', flags: [] } });
  });
}
// one pending item so the moderation queue isn't empty in the demo
gk++;
put('gtks', 'good-to-know', { ...env(`gtk_${pad(gk)}`), scope: 'course', scope_ref: 'MBA:8150', category: 'warning', text: 'The instructor is too old to understand modern data tools, so don\'t bother asking about Python.', example: 'Said Python questions were out of scope.', applies_terms: [], confirmations: 1, disputes: 0, last_confirmed_at: '2026-11-10T12:00:00.000Z', moderation: { status: 'pending', flags: ['protected_attribute'] } });

// ---------- SYNTHETIC career outcomes (3 concentrated targets) ----------
const OUT = {
  finance_leadership: { n: 12, roles: ['Finance Manager', 'FP&A Manager', 'Senior Financial Analyst', 'Director of Financial Planning', 'Controller'], industries: ['insurance', 'manufacturing', 'financial_services', 'healthcare', 'agribusiness'], factors: [['networking_referral', 'An alum I met on a Career Connect Call referred me to the hiring manager and vouched for my modeling work.'], ['prior_experience', 'Three years running the monthly forecast meant I already did half of the job; I just had to ask for the title.'], ['mentor_sponsor', 'My manager sponsored me for the role after I led the budget redesign.'], ['coursework_skill', 'The valuation model I built in Managerial Finance became the template I presented in the final interview.'], ['networking_referral', 'Coffee chats with two alumni at the company told me exactly what the leadership team cared about.']], channels: ['internal_promotion', 'alumni_referral', 'alumni_referral', 'job_board'], courses: [['MBA:8180', 'Built the DCF/valuation skills interviewers tested'], ['MGMT:9120', 'Development plan gave me language for leading a team'], ['FIN:9200', 'Portfolio work helped in treasury conversations'], ['MBA:9130', 'Storytelling for the exec presentation']], events: ['Tippie Graduate Career Services: Career Connect Call', 'Hawkeye Huddle (alumni pregame)', 'Tippie Graduate Career Services coaching'], weeks: [6, 16], advice: ['Tell your manager the title you want a year before you want it, and ask what evidence they would need.', 'Use Career Connect Calls to find two alumni one level above your target role; ask what they would do differently.', 'Build one model you can screen-share in an interview; it beats any bullet point.'] },
  business_analytics: { n: 11, roles: ['Business Analyst', 'Data Analyst', 'Senior Business Intelligence Analyst', 'Analytics Manager', 'Data Scientist'], industries: ['technology', 'financial_services', 'healthcare', 'manufacturing', 'retail_food'], factors: [['project_portfolio', 'My BAIS:6070 final project on churn using anonymized work data was the whole conversation in the second interview.'], ['coursework_skill', 'Python and SQL from BAIS:6040/6050 let me pass the technical screen that filtered most candidates.'], ['project_portfolio', 'A Tableau dashboard I built for my current team became my portfolio piece.'], ['networking_referral', 'A classmate referred me after we worked on the same group project.'], ['interview_prep', 'Practicing take-home case problems with a career coach.']], channels: ['job_board', 'alumni_referral', 'internal_promotion', 'recruiter_inbound'], courses: [['BAIS:6070', 'Portfolio project and model evaluation'], ['MBA:8150', 'Regression interpretation'], ['BAIS:6050', 'SQL for the technical screen'], ['BAIS:6140', 'Dashboards']], events: ['Tippie Applied AI Community of Practice', 'Tippie Graduate Career Services coaching'], weeks: [5, 12], advice: ['Pick a final project you can talk about with real business impact numbers.', 'Do the SQL practice before you think you are ready; every screen had it.', 'Join the Applied AI Community of Practice; the people there were hiring.'] },
  project_program_mgmt: { n: 10, roles: ['Project Manager', 'Program Manager', 'Senior Project Manager', 'Agile Delivery Manager', 'PMO Lead'], industries: ['manufacturing', 'technology', 'healthcare', 'insurance', 'government'], factors: [['certification', 'Getting my PMP while finishing the Agile course made recruiters call me instead of the reverse.'], ['prior_experience', 'I had already been running cross-functional projects without the title; I documented them as case studies.'], ['coursework_skill', 'Scrum artifacts from Agile Project Management matched what the team used day to day.'], ['mentor_sponsor', 'A senior PM I met through work took me onto her program as deputy.'], ['networking_referral', 'An alum on the PMO team referred me.']], channels: ['internal_promotion', 'job_board', 'alumni_referral', 'recruiter_inbound'], courses: [['BAIS:9140', 'Agile/Scrum practice used daily'], ['MGMT:9220', 'Team performance frameworks'], ['MGMT:9110', 'Negotiating scope with stakeholders']], events: ['Tippie Graduate Career Services: Career Connect Call', 'Tippie Graduate Career Services coaching'], weeks: [4, 14], advice: ['Write up two projects you ran as one-page case studies with outcomes.', 'Take Agile Project Management the same term you study for the PMP.', 'Ask to shadow a program review meeting before you apply.'] },
};
let on = 0;
for (const [target, P] of Object.entries(OUT)) {
  for (let i = 0; i < P.n; i++) {
    on++;
    const [cat, desc] = P.factors[i % P.factors.length];
    const courses = P.courses.filter((_, j) => j === 0 ? rnd() < 0.75 : rnd() < 0.4).map(([course_id, how]) => ({ course_id, how }));
    const evts = P.events.filter((_, j) => rnd() < (j === 0 ? 0.6 : 0.35)).map((title) => ({ title }));
    const sup = P.factors.filter(([c2]) => c2 !== cat).slice(0, 2).map(([c2, d2], k) => ({ rank: k + 1, category: c2, description: d2.slice(0, 120) }));
    put('outcomes', 'career-outcome', { ...env(`out_${pad(on)}`, { program_id: pick(['tippie-mba', 'tippie-mba', 'tippie-msf', 'tippie-msba']), program_type: pick(['MBA', 'MBA', 'MSF', 'MSBA']), created_at: new Date(Date.parse('2024-01-15') + rnd() * 900 * 864e5).toISOString() }), type: pick(['full_time', 'full_time', 'promotion']), org_type: pick(['public_company', 'private_company', 'private_company', 'nonprofit']), industry: pick(P.industries), function: target === 'business_analytics' ? 'analytics' : target === 'finance_leadership' ? 'finance' : 'project_management', role: pick(P.roles), target, season: `${pick(['Spring', 'Summer', 'Fall'])} ${pick([2024, 2025, 2026])}`, channel: pick(P.channels), timeline: { weeks_total: Math.round(between(P.weeks[0], P.weeks[1])) }, biggest_factor: { category: cat, description: desc }, supporting_factors: sup, courses_that_helped: courses, people_roles_that_helped: [{ role: pick(['alum', 'manager', 'career_coach', 'peer', 'mentor']), how: 'Gave specific feedback on my approach' }], events_attended: evts, resources_used: rnd() < 0.5 ? ['Tippie Graduate Career Services coaching'] : [], do_differently: 'Start the conversations earlier.', advice_for_next_cohort: pick(P.advice), backfill: rnd() < 0.3, summary_confirmed: true });
  }
}
// two outcomes in a thin target (shows "not enough data")
for (const role of ['Brand Manager', 'Marketing Manager']) { on++; put('outcomes', 'career-outcome', { ...env(`out_${pad(on)}`), type: 'full_time', org_type: 'private_company', industry: 'retail_food', function: 'marketing', role, target: 'marketing', biggest_factor: { category: 'networking_referral', description: 'A referral from a classmate who already worked on the brand team.' }, channel: 'alumni_referral', advice_for_next_cohort: 'Talk to people on the team before applying.' }); }

// ---------- SYNTHETIC demo personas (from the GPP kickoff deck) + sample resumes ----------
const RESUMES = {
  daniel: `Daniel Kowalczyk
daniel.k.fictional@example.com | (319) 555-0142 | linkedin.com/in/fictional-daniel | 1200 Prairie Street, Des Moines, IA

SUMMARY
Financial analyst with four years in insurance FP&A, aiming for a finance leadership role (FP&A manager). Open to returning to Iowa for more education if it helps.

EDUCATION
University of Iowa, Tippie College of Business, MS in Finance, 2021 - 2022
Iowa State University, BS in Economics, 2017 - 2021

EXPERIENCE
Senior Financial Analyst, Cedar Ridge Insurance Group, Jan 2025 - Present
• Own the monthly reforecast for a $310M commercial lines portfolio
• Built a driver-based expense model adopted by three business units
Financial Analyst, Cedar Ridge Insurance Group, Jul 2022 - Dec 2024
• Automated variance reporting in Excel/Power Query, cutting close prep from 4 days to 1
Finance Intern, Heartland Agri Cooperative, May 2021 - Aug 2021
• Supported capital budgeting analysis for a grain storage expansion

SKILLS
Excel modeling, Power BI, SQL, forecasting, variance analysis, presenting to executives

INTERESTS
Leadership, mentoring, Hawkeye football, data visualization`,
  maya: `Maya Rodriguez
maya.r.fictional@example.com | 319-555-0187

GOALS
First-year business student, undecided. Interested in both accounting and art and unsure how to combine them. Seeking a major and a plan for next semester.

EDUCATION
University of Iowa, Tippie College of Business, BBA (Expected 2030)
Coursework: ACCT:2100 Introduction to Financial Accounting (in progress), ARTH:1060 Survey of Western Art II (in progress)

EXPERIENCE
Gallery Assistant, Riverside Student Art Collective, Sep 2026 - Present
• Track sales and consignment payouts for 25 student artists in a shared spreadsheet
Barista, Riverbend Coffee, Jun 2024 - Aug 2026
• Trained 4 new hires; handled end-of-day cash reconciliation

SKILLS
Excel, Procreate, Adobe Illustrator, customer service

INTERESTS
Drawing, museum visits, small business, art markets`,
};
mkdirSync(join(ROOT, 'data', 'seed', 'resumes'), { recursive: true });
for (const [k, v] of Object.entries(RESUMES)) writeFileSync(join(ROOT, 'data', 'seed', 'resumes', `${k}_fictional.txt`), v + '\n');

put('profiles', 'profile', { ...env('pro_daniel', { program_id: 'tippie-msf', program_type: 'MSF' }), display_name: 'Daniel K.', stage: 'alumni', grad_year: 2022, education: [{ institution: 'University of Iowa', degree: 'MS', field: 'Finance', start_year: 2021, end_year: 2022 }, { institution: 'Iowa State University', degree: 'BS', field: 'Economics', start_year: 2017, end_year: 2021 }], experience: [{ title: 'Senior Financial Analyst', org_type: 'private_company', industry: 'insurance', function: 'finance', start: 'Jan 2025', end: 'Present', highlights: ['Own monthly reforecast for a $310M portfolio'], outcome_logged: false }, { title: 'Financial Analyst', org_type: 'private_company', industry: 'insurance', function: 'finance', start: 'Jul 2022', end: 'Dec 2024', highlights: ['Cut close prep from 4 days to 1'], outcome_logged: false }], skills: ['Excel modeling', 'Power BI', 'SQL', 'forecasting'], interests: ['leadership', 'mentoring', 'data visualization'], career_targets: ['FP&A manager (finance leadership)'], courses_taken: [{ course_id: 'FIN:9200', term: 'Spring 2022', reviewed: false }, { course_id: 'FIN:9210', term: 'Spring 2022', reviewed: false }, { course_id: 'FIN:9310', term: 'Fall 2021', reviewed: false }], visibility: { experience: 'cohort', career_targets: 'campus_aggregate_only' }, consent: { share_reviews: true, share_outcomes_aggregate: true, contact_by_peers: false, resume_retention_days: 0 }, draft: false, extensions: { x_demo_persona: 'Post-grad · Class of \'22 · MS Finance alum' } });
put('profiles', 'profile', { ...env('pro_maya', { program_id: 'tippie-bba', program_type: 'BBA' }), display_name: 'Maya R.', stage: 'enrolled', grad_year: 2030, education: [{ institution: 'University of Iowa', degree: 'BBA', field: 'Undecided', start_year: 2026, end_year: 2030 }], experience: [{ title: 'Gallery Assistant', org_type: 'nonprofit', industry: 'arts', function: 'accounting', start: 'Sep 2026', end: 'Present', highlights: ['Tracks consignment payouts for 25 artists'], outcome_logged: false }], skills: ['Excel', 'Illustrator', 'Procreate'], interests: ['accounting', 'art', 'drawing', 'small business', 'undecided major'], career_targets: ['explore: accounting + arts (e.g., arts management, gallery finance)'], courses_taken: [{ course_id: 'ACCT:2100', term: 'Fall 2026', reviewed: false }, { course_id: 'ARTH:1060', term: 'Fall 2026', reviewed: false }], visibility: { experience: 'cohort' }, consent: { share_reviews: true, share_outcomes_aggregate: true, contact_by_peers: false, resume_retention_days: 0 }, draft: false, extensions: { x_demo_persona: 'Current student · First year · Business undergrad, undecided' } });

// a couple of synthetic posts
put('posts', 'post', { ...env('pst_0001'), author_profile_id: 'pro_daniel', type: 'tip', scope: 'career', tags: ['networking', 'alumni', 'finance'], text: 'Career Connect Calls are worth it even as an alum. Two of my best informational interviews came from the breakout rooms.', linked_record_ids: [], escalate_to_staff: false, moderation: { status: 'approved', flags: [] } });

if (errors.length) { console.error('SEED VALIDATION ERRORS', JSON.stringify(errors.slice(0, 5), null, 2), errors.length); process.exit(1); }
console.log(`seeded: ${store.count('courses')} real courses, ${store.count('events')} real events/resources, ${store.count('reviews')} synthetic reviews, ${store.count('gtks')} tips, ${store.count('outcomes')} synthetic outcomes, ${store.count('profiles')} personas. Alumni titles from data.csv: ${csvTotal} people / ${csv.length} titles.`);
