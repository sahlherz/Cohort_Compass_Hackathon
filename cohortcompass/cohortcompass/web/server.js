// Web demo server: zero-framework node:http. Every UI action calls POST /api/tool/<name>, which runs the
// SAME core operation the MCP server exposes, and returns the equivalent MCP JSON-RPC request for the
// "Under the hood" panel.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createCore } from '../core/index.js';
import { toErrorJSON } from '../core/errors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.CC_DATA_DIR || join(ROOT, 'data', 'db');
const seed = () => execFileSync(process.execPath, [join(ROOT, 'scripts', 'seed.js')], { env: { ...process.env, CC_DATA_DIR: DATA }, stdio: 'inherit' });
if (!existsSync(join(DATA, 'courses.json'))) seed();
let core = createCore({ env: { ...process.env, CC_DATA_DIR: DATA } });
const PORT = Number(process.env.PORT || 5173);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
let rpcId = 1;

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });

function ics(items) {
  const esc = (s) => String(s || '').replace(/[,;\\]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const dt = (s) => (s.length === 10 ? `;VALUE=DATE:${s.replace(/-/g, '')}` : `:${new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  const ev = items.filter((i) => i.schedule?.start).map((i) => ['BEGIN:VEVENT', `UID:${i.id}@cohortcompass`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART${dt(i.schedule.start)}`, ...(i.schedule.end ? [`DTEND${dt(i.schedule.end)}`] : []), `SUMMARY:${esc(i.title)}`, `DESCRIPTION:${esc(i.why_this_matches_you + ' Source: ' + (i.source_url || ''))}`, `LOCATION:${esc(i.location_or_url)}`, ...(i.source_url ? [`URL:${i.source_url}`] : []), 'END:VEVENT'].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CohortCompass//EN', ...ev, 'END:VCALENDAR'].join('\r\n');
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname.startsWith('/api/tool/')) {
      const name = url.pathname.slice('/api/tool/'.length);
      if (typeof core[name] !== 'function' || ['store', 'llm', 'trace'].includes(name)) return send(res, 404, { error: { code: 'NOT_FOUND', message: `no tool ${name}` } });
      const args = await readBody(req);
      const mcp = { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } };
      try {
        const result = await core[name](args);
        const t = core.trace.at(-1);
        return send(res, 200, { ok: true, result, mcp, read_only: core.READ_ONLY.has(name), ms: t?.ms, llm_calls: t?.llm_calls || [] });
      } catch (e) {
        const t = core.trace.at(-1);
        return send(res, 200, { ok: false, ...toErrorJSON(e), mcp, llm_calls: t?.llm_calls || [] });
      }
    }
    if (url.pathname === '/api/state') return send(res, 200, { llm: { live: core.llm.live, mode: core.llm.live ? 'live' : 'scripted', models: core.llm.models }, min_n: core.MIN_N(), now: core.now(), personas: (await core.x_list_profiles()).items });
    if (url.pathname.startsWith('/api/resume/')) { const k = url.pathname.split('/').pop().replace(/[^a-z]/g, ''); const f = join(ROOT, 'data', 'seed', 'resumes', `${k}_fictional.txt`); return existsSync(f) ? send(res, 200, readFileSync(f, 'utf8'), 'text/plain; charset=utf-8') : send(res, 404, ''); }
    if (url.pathname === '/api/events.ics') { const r = await core.recommend_events_resources({ profile_id: url.searchParams.get('profile_id'), limit: 30 }); res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="cohortcompass-recommended.ics"' }); return res.end(ics(r.items)); }
    if (url.pathname === '/api/record') { const id = url.searchParams.get('id'); for (const c of ['reviews', 'gtks', 'outcomes', 'posts', 'events', 'profiles']) { const r = core.store.get(c, id); if (r) return send(res, 200, r); } return send(res, 404, { error: { code: 'NOT_FOUND', message: id } }); }
    if (req.method === 'POST' && url.pathname === '/api/reset') { seed(); core = createCore({ env: { ...process.env, CC_DATA_DIR: DATA } }); return send(res, 200, { ok: true }); }
    const file = join(ROOT, 'web', 'public', url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\./g, ''));
    if (existsSync(file) && file.startsWith(join(ROOT, 'web', 'public'))) return send(res, 200, readFileSync(file), MIME[extname(file)] || 'application/octet-stream');
    send(res, 404, 'not found', 'text/plain');
  } catch (e) { send(res, 500, toErrorJSON(e)); }
}).listen(PORT, () => {
  console.log(`\n  CohortCompass demo → http://localhost:${PORT}`);
  console.log(`  AI mode: ${core.llm.live ? `LIVE (${core.llm.models.strong} / ${core.llm.models.cheap})` : 'SCRIPTED fallback (set ANTHROPIC_API_KEY for live AI)'}`);
  console.log('  MCP server: npm run mcp   (stdio)   |   node mcp/server.js --http --port 8788\n');
});
