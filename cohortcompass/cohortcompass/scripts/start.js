// One-command start: seeds on first run, then launches the web demo (which uses the same core as the MCP server).
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(ROOT, 'node_modules', '@modelcontextprotocol'))) {
  console.log('Installing dependencies (first run)…');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}
const DATA = process.env.CC_DATA_DIR || join(ROOT, 'data', 'db');
if (process.argv.includes('--reset') || !existsSync(join(DATA, 'courses.json'))) execFileSync(process.execPath, [join(ROOT, 'scripts', 'seed.js')], { stdio: 'inherit', env: { ...process.env, CC_DATA_DIR: DATA } });
await import('../web/server.js');
