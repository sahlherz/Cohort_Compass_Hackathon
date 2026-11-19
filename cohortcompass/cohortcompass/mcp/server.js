#!/usr/bin/env node
// CohortCompass MCP server. Same core as the web demo; tool names are FROZEN (extend with x_ prefix).
// Transports: stdio (default)  |  Streamable HTTP (stateless): `node mcp/server.js --http --port 8788`
// Built on the official TypeScript SDK (@modelcontextprotocol/sdk 1.32.x, protocol 2025-11-25).
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCore } from '../core/index.js';
import { toErrorJSON } from '../core/errors.js';
import { SCHEMAS, validate } from '../core/validate.js';
import { loadPrompt } from '../core/llm.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.CC_DATA_DIR || join(ROOT, 'data', 'db');
if (!existsSync(join(DATA, 'courses.json'))) execFileSync(process.execPath, [join(ROOT, 'scripts', 'seed.js')], { env: { ...process.env, CC_DATA_DIR: DATA }, stdio: ['ignore', 'ignore', 'inherit'] });
const core = createCore({ env: { ...process.env, CC_DATA_DIR: DATA } });

const any = z.record(z.any());
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const sid = (n) => SCHEMAS[n].$id;

const TOOLS = [
  ['search_courses', 'Search real catalog courses (registrar code, title, tags). Paginated.', { query: z.string().optional(), level: z.enum(['undergraduate', 'graduate']).optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional() }, RO, { items: z.array(any), next_cursor: z.string().nullable(), total: z.number() }],
  ['get_course_insights', 'Aggregated, evidence-backed course insights (only when n >= min_n) plus approved reviews and good-to-knows with confidence.', { course_id: z.string().describe('e.g. MBA:8180'), background_bucket: z.string().optional() }, RO, { course: any, n: z.number(), min_n_met: z.boolean(), aggregates: any.nullable(), good_to_knows: z.array(any) }],
  ['parse_resume', 'Resume text → ProfileDraft (contact details stripped, nothing retained). Requires user confirmation before upsert_profile.', { text: z.string().min(40) }, { ...RO, idempotentHint: false }, { profile_draft: any, validation: any, pii_removed: z.number() }],
  ['upsert_profile', `Create/update a confirmed Profile (${sid('profile')}).`, { profile: any }, WRITE, { profile: any, created: z.boolean() }],
  ['validate_review', `Validate a CourseReview against ${sid('course-review')}. Returns only missing/invalid fields.`, { review: any }, RO, { valid: z.boolean(), missing_fields: z.array(z.string()), invalid_fields: z.array(any) }],
  ['save_review', 'Validate, moderate and save a CourseReview. Idempotent with idempotency_key. Uses elicitation for missing fields when the client supports it.', { review: any, idempotency_key: z.string().optional(), good_to_knows_text: z.array(z.string()).optional() }, WRITE, { review: any, published: z.boolean() }],
  ['create_post', 'Create an Ask & Share post; AI lightly structures it (type, scope, tags, linked records); flagged items go to staff.', { text: z.string(), profile_id: z.string().optional(), type: z.enum(['question', 'tip', 'story']).optional() }, { ...WRITE, idempotentHint: false }, { post: any, routed_to_staff: z.boolean() }],
  ['recommend_events_resources', 'Rank real events/resources for a profile with a one-line "why this matches you", plus evidence-based nudges.', { profile_id: z.string(), limit: z.number().int().min(1).max(30).optional(), include_past: z.boolean().optional() }, RO, { items: z.array(any), nudges: z.array(any) }],
  ['log_career_outcome', `Save a CareerOutcome (${sid('career-outcome')}). biggest_factor is required; elicited if missing.`, { outcome: any, idempotency_key: z.string().optional() }, WRITE, { outcome: any, path_insight: any }],
  ['get_path_insights', '"What it took to get X". Aggregates only above min_n with small-cell suppression.', { target: z.string().describe('finance_leadership | business_analytics | project_program_mgmt | ...') }, RO, { target: z.string(), n: z.number(), min_n_met: z.boolean(), confidence: z.string() }],
  ['ask_cohort', 'Grounded Q&A over structured cohort data. Every claim cites record/aggregate IDs or says "not enough data". Sensitive topics route to staff.', { question: z.string(), profile_id: z.string().optional() }, RO, { answer: z.string(), cited_ids: z.array(z.string()), confidence: z.string(), not_enough_data: z.boolean() }],
  ['export_profile', `Export a consented CareerPassport (${sid('career-passport')}) with SHA-256 checksum.`, { profile_id: z.string(), scopes: z.array(z.enum(['profile', 'outcomes', 'reviews_authored'])).optional() }, RO, { passport: any }],
  ['import_profile', 'Import a CareerPassport (validates schema + checksum; remaps IDs on conflict).', { passport: any }, WRITE, { profile_id: z.string(), imported_outcomes: z.number() }],
  // x_ extensions (frozen names above are never renamed)
  ['x_interview_start', 'Start a scripted/AI interview (kind=review|outcome) for hosts without elicitation. Returns the first question + quick-select options.', { kind: z.enum(['review', 'outcome']), profile_id: z.string().optional(), course_id: z.string().optional(), term: z.string().optional(), narrative: z.string().optional(), outcome_seed: any.optional(), backfill_index: z.number().int().optional() }, { ...WRITE, idempotentHint: false }, { interview_id: z.string(), message: z.string() }],
  ['x_interview_answer', 'Answer the current interview question ("skip" allowed). On confirmation, saves via save_review/log_career_outcome.', { interview_id: z.string(), answer: z.string() }, { ...WRITE, idempotentHint: false }, { interview_id: z.string(), message: z.string(), status: z.string() }],
  ['x_moderation_queue', 'GPP staff: pending items and escalations.', {}, RO, { pending: z.array(any), escalations: z.array(any) }],
  ['x_moderate', 'GPP staff decision on a flagged item (human-in-the-loop).', { kind: z.enum(['review', 'good_to_know', 'post']), id: z.string(), decision: z.enum(['approved', 'rejected', 'needs_edit', 'handled']) }, { ...WRITE, destructiveHint: true }, { id: z.string() }],
  ['x_admin_overview', 'Campus admin: aggregate, anonymized insights (min_n enforced).', {}, RO, { totals: any, courses: z.array(any) }],
];

// ---- elicitation helpers (MCP 2025-06-18+: flat primitive schemas only) ----
function elicitSchemaFor(missing) {
  const props = {};
  for (const m of missing) {
    const ex = m.match(/^examples\[field=(\w+)\]$/);
    if (ex) { props[`example_${ex[1]}`] = { type: 'string', title: `Concrete example for ${ex[1].replace(/_/g, ' ')}`, minLength: 20 }; continue; }
    const top = m.split('.')[0];
    const s = SCHEMAS['course-review'].properties[top] || SCHEMAS['career-outcome'].properties[top];
    if (m === 'biggest_factor' || m.startsWith('biggest_factor')) {
      props.biggest_factor_description = { type: 'string', title: 'What was the single biggest factor in getting this?', minLength: 15 };
      props.biggest_factor_category = { type: 'string', title: 'Category', enum: SCHEMAS['career-outcome'].properties.biggest_factor.properties.category.enum };
      continue;
    }
    if (!s) continue;
    if (s.enum) props[top] = { type: 'string', title: top.replace(/_/g, ' '), enum: s.enum };
    else if (s.type === 'integer' || s.type === 'number') props[top] = { type: 'number', title: top.replace(/_/g, ' '), ...(s.minimum != null ? { minimum: s.minimum } : {}), ...(s.maximum != null ? { maximum: s.maximum } : {}) };
    else if (s.type === 'boolean') props[top] = { type: 'boolean', title: top.replace(/_/g, ' ') };
    else if (s.type === 'string') props[top] = { type: 'string', title: top.replace(/_/g, ' ') };
  }
  return { type: 'object', properties: props, required: Object.keys(props) };
}
function mergeElicited(rec, content) {
  const out = { ...rec };
  for (const [k, v] of Object.entries(content || {})) {
    const ex = k.match(/^example_(\w+)$/);
    if (ex) out.examples = [...(out.examples || []), { claim: `${ex[1]}=${JSON.stringify(rec[ex[1]] ?? '')}`, evidence: String(v), field: ex[1] }];
    else if (k === 'biggest_factor_description') out.biggest_factor = { ...(out.biggest_factor || {}), description: v };
    else if (k === 'biggest_factor_category') out.biggest_factor = { ...(out.biggest_factor || {}), category: v };
    else out[k] = v;
  }
  return out;
}

function buildServer() {
  const server = new McpServer({ name: 'cohortcompass', version: '1.0.0', title: 'CohortCompass (Tippie GPP)' }, { capabilities: { logging: {} }, instructions: 'CohortCompass turns student/alumni knowledge into structured, cited data. Courses and events are real (sourced); all people, reviews and outcomes in the demo dataset are SYNTHETIC. Never present aggregates when min_n_met=false. Use prompts review_interview / outcome_interview / profile_builder to run interviews; save with save_review / log_career_outcome.' });

  async function withElicitation(name, args, extra) {
    const kind = name === 'save_review' ? 'course-review' : 'career-outcome';
    const key = name === 'save_review' ? 'review' : 'outcome';
    const probe = { id: 'rev_probe', schema_version: '1.0.0', campus_id: 'uiowa', program_id: 'tippie-mba', program_type: 'MBA', created_at: new Date().toISOString(), provenance: { source: 'user_interview', synthetic: false }, ...(name === 'log_career_outcome' ? { target: 'other' } : {}), ...args[key] };
    const v = validate(kind, probe);
    const caps = server.server.getClientCapabilities();
    if (v.valid || !caps?.elicitation || !v.missing_fields.length) return args;
    const requestedSchema = elicitSchemaFor(v.missing_fields);
    if (!Object.keys(requestedSchema.properties).length) return args;
    const res = await server.server.elicitInput({ mode: 'form', message: `A few details are needed before saving (${v.missing_fields.join(', ')}).`, requestedSchema });
    if (res.action !== 'accept') return args;
    return { ...args, [key]: mergeElicited(args[key], res.content) };
  }

  for (const [name, description, inputSchema, annotations, outputSchema] of TOOLS) {
    server.registerTool(name, { title: name.replace(/^x_/, '').replace(/_/g, ' '), description, inputSchema, outputSchema: z.object(outputSchema).passthrough(), annotations }, async (args, extra) => {
      try {
        if (name === 'save_review' || name === 'log_career_outcome') args = await withElicitation(name, args, extra);
        const result = await core[name](args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(toErrorJSON(e)) }] };
      }
    });
  }

  // ---- resources ----
  const schemaNames = Object.keys(SCHEMAS);
  server.registerResource('schema', new ResourceTemplate('schema://{name}/{version}', { list: async () => ({ resources: schemaNames.map((n) => ({ uri: `schema://${n}/1.0.0`, name: `${SCHEMAS[n].title} 1.0.0`, mimeType: 'application/schema+json' })) }) }), { title: 'JSON Schemas (2020-12)', description: 'Versioned, frozen record schemas', mimeType: 'application/schema+json' }, async (uri, { name, version }) => {
    if (!SCHEMAS[name] || version !== '1.0.0') throw new Error(`unknown schema ${name}@${version}`);
    return { contents: [{ uri: uri.href, mimeType: 'application/schema+json', text: JSON.stringify(SCHEMAS[name], null, 2) }] };
  });
  server.registerResource('campus-program', new ResourceTemplate('campus://{campus_id}/program/{program_id}', { list: async () => { const c = core.store.get('campus', 'uiowa'); return { resources: c.programs.map((p) => ({ uri: `campus://uiowa/program/${p.program_id}`, name: p.name, mimeType: 'application/json' })) }; } }), { title: 'Campus program config', description: 'Taxonomies, min_n, programs (data, not code)', mimeType: 'application/json' }, async (uri, { campus_id, program_id }) => {
    const c = core.store.get('campus', campus_id);
    const p = c?.programs.find((x) => x.program_id === program_id);
    if (!p) throw new Error('program not found');
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ campus: { id: c.id, name: c.name, college: c.college, min_n: c.min_n, taxonomy_version: c.taxonomy_version }, program: p }, null, 2) }] };
  });
  server.registerResource('course', new ResourceTemplate('course://{campus_id}/{course_id}', { list: undefined }), { title: 'Course insights', description: 'Same as get_course_insights; course_id like MBA:8180', mimeType: 'application/json' }, async (uri, { course_id }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await core.get_course_insights({ course_id: decodeURIComponent(course_id) }), null, 2) }] }));
  server.registerResource('path-insight', new ResourceTemplate('insights://path/{target}', { list: async () => ({ resources: ['finance_leadership', 'business_analytics', 'project_program_mgmt'].map((t) => ({ uri: `insights://path/${t}`, name: t, mimeType: 'application/json' })) }) }), { title: 'Path insights', mimeType: 'application/json' }, async (uri, { target }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await core.get_path_insights({ target }), null, 2) }] }));

  // ---- prompts ----
  server.registerPrompt('review_interview', { title: 'Structured Review Interview', description: 'Interviewer system prompt + context for one course review', argsSchema: { course_id: z.string(), term: z.string().optional(), narrative: z.string().optional() } }, async ({ course_id, term, narrative }) => {
    const ins = await core.get_course_insights({ course_id }).catch(() => null);
    const text = loadPrompt('review_interview', { campus_name: 'University of Iowa', program_name: 'Tippie', course_id, course_title: ins?.course?.title || '', term: term || 'this term', reviewer_stage: 'student' });
    return { messages: [{ role: 'user', content: { type: 'text', text: `${text}\n\nSCHEMA: ${SCHEMAS['course-review'].$id} (read schema://course-review/1.0.0). When the user confirms, call validate_review then save_review.\n${narrative ? `\nUSER NARRATIVE (extract first, then ask only for gaps):\n${narrative}` : ''}` } }] };
  });
  server.registerPrompt('outcome_interview', { title: 'Career Outcome Interview', description: 'Always asks the single biggest factor first', argsSchema: { role: z.string(), type: z.string().optional(), org_type: z.string().optional(), backfill: z.string().optional() } }, async ({ role, type, org_type, backfill }) => ({ messages: [{ role: 'user', content: { type: 'text', text: loadPrompt('outcome_interview', { campus_name: 'University of Iowa', program_name: 'Tippie', role, type: type || 'full_time', org_type: org_type || 'company', backfill: backfill === 'true' }) + `\n\nSave with log_career_outcome (schema ${SCHEMAS['career-outcome'].$id}).` } }] }));
  server.registerPrompt('profile_builder', { title: 'Profile from Resume', description: 'Resume → ProfileDraft → user confirmation', argsSchema: { resume_text: z.string().optional() } }, async ({ resume_text }) => ({ messages: [{ role: 'user', content: { type: 'text', text: loadPrompt('profile_builder', { campus_name: 'University of Iowa', program_name: 'Tippie' }) + `\n\nCall parse_resume, show the draft, then upsert_profile after confirmation.${resume_text ? `\n\nRESUME_TEXT:\n${resume_text}` : ''}` } }] }));
  return server;
}

const argv = process.argv.slice(2);
if (argv.includes('--http')) {
  const port = Number(argv[argv.indexOf('--port') + 1] || process.env.CC_MCP_PORT || 8788);
  createServer(async (req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); // stateless
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    });
  }).listen(port, () => console.error(`CohortCompass MCP (Streamable HTTP, stateless) on http://localhost:${port}/mcp`));
} else {
  await buildServer().connect(new StdioServerTransport());
}
