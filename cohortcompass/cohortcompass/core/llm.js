// Thin LLM client with model tiers and guaranteed fallback.
// - cheap tier: parsing, extraction, moderation, post structuring
// - strong tier: interview phrasing, Ask the Cohort composition
// If no key, a timeout, or bad JSON: returns null and callers use deterministic/scripted logic,
// so the demo never dead-ends. Every call is logged for the "Under the hood" panel.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

export function loadPrompt(name, vars = {}) {
  let t = readFileSync(join(PROMPT_DIR, `${name}.md`), 'utf8');
  t = t.replace(/\{\{> ([a-z_]+)\}\}/g, (_, p) => readFileSync(join(PROMPT_DIR, `${p}.md`), 'utf8'));
  t = t.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) => (vars[k] ? body : ''));
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? `{{${k}}}`));
}

export function extractJSON(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

export function createLLM(env = process.env) {
  const key = env.ANTHROPIC_API_KEY || '';
  const mode = env.CC_LLM_MODE || (key ? 'live' : 'scripted'); // live | scripted
  const models = {
    strong: env.CC_MODEL_STRONG || 'claude-sonnet-5-5',
    cheap: env.CC_MODEL_CHEAP || 'claude-haiku-5-5',
  };
  const timeoutMs = Number(env.CC_LLM_TIMEOUT_MS || 20000);
  const log = [];

  async function call(tier, system, user, { maxTokens = 900, json = true } = {}) {
    const entry = { at: new Date().toISOString(), tier, model: models[tier], ok: false, ms: 0, fallback: true };
    log.push(entry);
    if (log.length > 200) log.shift();
    if (mode !== 'live' || !key) { entry.reason = 'scripted mode (no ANTHROPIC_API_KEY)'; return null; }
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(env.CC_ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: models[tier], max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      entry.ms = Date.now() - t0;
      if (!res.ok) { entry.reason = `HTTP ${res.status}`; return null; }
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      entry.usage = data.usage;
      const out = json ? extractJSON(text) : text;
      if (json && !out) { entry.reason = 'unparseable JSON'; return null; }
      entry.ok = true; entry.fallback = false;
      return out;
    } catch (e) {
      entry.ms = Date.now() - t0;
      entry.reason = e.name === 'AbortError' ? 'timeout' : String(e.message);
      return null;
    } finally { clearTimeout(timer); }
  }

  return { call, mode, models, log, get live() { return mode === 'live' && !!key; } };
}
