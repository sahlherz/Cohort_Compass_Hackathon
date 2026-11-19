// Spawns the MCP server over stdio with the official SDK client and exercises tools, resources,
// prompts and elicitation. Proves the server is importable into any MCP host.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'ccmcp-'));
const transport = new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'mcp', 'server.js')], env: { ...process.env, CC_DATA_DIR: dir, CC_LLM_MODE: 'scripted', CC_NOW: '2026-11-18T15:00:00Z' } });
const client = new Client({ name: 'cc-test-host', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } });
let elicited = null;
client.setRequestHandler(ElicitRequestSchema, async (req) => {
  elicited = req.params;
  const content = {};
  for (const [k, s] of Object.entries(req.params.requestedSchema.properties)) content[k] = s.enum ? s.enum[0] : s.type === 'number' ? 3 : s.type === 'boolean' ? true : 'The instructor posted a worked example before each assignment, every single week.';
  return { action: 'accept', content };
});
await client.connect(transport);
const ok = (m) => console.log('  ✓', m);
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(r.content[0].text); return r.structuredContent; };

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
for (const t of ['search_courses', 'get_course_insights', 'parse_resume', 'upsert_profile', 'validate_review', 'save_review', 'create_post', 'recommend_events_resources', 'log_career_outcome', 'get_path_insights', 'ask_cohort', 'export_profile', 'import_profile']) assert.ok(names.includes(t), t);
assert.equal(tools.find((t) => t.name === 'ask_cohort').annotations.readOnlyHint, true);
ok(`tools/list: ${tools.length} tools (13 frozen + ${tools.length - 13} x_), annotations present, server ${client.getServerVersion()?.name}`);

const { resourceTemplates } = await client.listResourceTemplates();
assert.ok(resourceTemplates.some((r) => r.uriTemplate === 'schema://{name}/{version}'));
const sch = await client.readResource({ uri: 'schema://course-review/1.0.0' });
assert.match(sch.contents[0].text, /2020-12/);
const crs = await client.readResource({ uri: 'course://uiowa/MBA:8180' });
assert.ok(JSON.parse(crs.contents[0].text).min_n_met);
const pin = await client.readResource({ uri: 'insights://path/business_analytics' });
assert.ok(JSON.parse(pin.contents[0].text).n >= 5);
ok(`resources: ${resourceTemplates.length} templates; schema://, course://, insights:// readable`);

const { prompts } = await client.listPrompts();
assert.deepEqual(prompts.map((p) => p.name).sort(), ['outcome_interview', 'profile_builder', 'review_interview']);
const pr = await client.getPrompt({ name: 'outcome_interview', arguments: { role: 'Data Analyst' } });
assert.match(pr.messages[0].content.text, /single biggest factor/);
ok('prompts: review_interview, outcome_interview, profile_builder');

const s = await call('search_courses', { query: 'finance', limit: 5 });
assert.ok(s.items.length > 0 && s.items[0].review_count >= 0);
const ask = await call('ask_cohort', { question: 'Is Data Science (BAIS:6070) heavy?' });
assert.ok(ask.cited_ids.length);
ok(`search_courses + ask_cohort over MCP (cited ${ask.cited_ids.join(', ')})`);

// elicitation: save a review that is missing required fields + evidence for a 5
const partial = { course_id: 'MBA:8150', term: 'Fall 2025', workload_hours_per_week: 7, clarity: 5, examples: [] };
const saved = await call('save_review', { review: partial, idempotency_key: 'idem_mcp_test' });
assert.ok(elicited, 'server elicited missing fields');
assert.ok(saved.review.examples.some((e) => e.field === 'clarity'));
ok(`elicitation: server requested [${Object.keys(elicited.requestedSchema.properties).join(', ')}] → review saved ${saved.review.id}`);

const outc = await call('log_career_outcome', { outcome: { type: 'full_time', role: 'Data Analyst' } });
assert.ok(outc.outcome.biggest_factor.description.length >= 15);
ok(`elicitation for biggest_factor → outcome ${outc.outcome.id}, path n=${outc.path_insight.n}`);

const ex = await call('export_profile', { profile_id: 'pro_daniel' });
const im = await call('import_profile', { passport: ex.passport });
ok(`career passport over MCP: exported + imported as ${im.profile_id}`);

const err = await client.callTool({ name: 'get_course_insights', arguments: { course_id: 'FAKE:0000' } });
assert.ok(err.isError && JSON.parse(err.content[0].text).error.code === 'NOT_FOUND');
ok('errors use the one consistent shape {error:{code,message,...}}');
await client.close();
console.log('\nmcp: all passed');
