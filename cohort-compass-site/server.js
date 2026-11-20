// Local dev server: static files from ./public + /api/* via the same core used on Cloudflare.
// Run: node server.js   (reads ANTHROPIC_API_KEY etc. from .env if present). Open http://localhost:5173
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './api/core.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const pub = join(root, 'public');
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const subsFile = join(root, 'submissions.local.json');
const env = {
  ...process.env,
  __load: async () => (existsSync(subsFile) ? JSON.parse(await readFile(subsFile, 'utf8')) : []),
  __save: async (s) => writeFile(subsFile, JSON.stringify(s, null, 1)),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!p || p.endsWith('/') || p.endsWith('\\')) p += 'index.html';
  const file = join(pub, p);
  if (!file.startsWith(pub) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(Number(process.env.PORT || 5173), () => console.log(`Cohort Compass on http://localhost:${process.env.PORT || 5173}  (LLM: ${process.env.ANTHROPIC_API_KEY ? 'live' : 'scripted fallback'})`));
