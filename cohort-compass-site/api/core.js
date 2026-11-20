// Cohort Compass API core. Runtime-agnostic (Web Fetch API only) so the same code runs in
// Cloudflare Pages Functions and in the local Node server.
// Security: the API key never reaches the browser; prompts live here (the client can only pick a task),
// and every IP is rate-limited so a projected QR code can't drain the key.

const MODELS = { strong: 'claude-sonnet-5-5', cheap: 'claude-haiku-5-5' };
const DIMENSIONS = ['workload', 'structure_over_time', 'difficulty_hardest_part', 'career_impact', 'networking', 'who_should_take', 'prep_prereqs', 'hidden_value'];

const SHARED = `You are part of Cohort Compass, a University of Iowa tool that collects what courses, events, clubs, labs and other opportunities are ACTUALLY like from students and alumni, and uses it to advise people.
Hard rules:
- Never evaluate instructors as people (no ratings of personality, looks, etc). Talk about the course/opportunity: workload, structure, what it led to. Factual mentions like "I asked the professor about research and got a position" are fine.
- Never invent courses, events, people, or statistics. Only use ids that appear in the provided context.
- Plain, warm, specific language. No corporate filler.`;

const TASKS = {
  interview: {
    tier: 'strong', maxTokens: 1200,
    system: `${SHARED}
You are the INTERVIEWER. You are collecting one person's experience with one item. Your job is to get specific, colloquial, high-value info fast without annoying them.
- Ask ONE question at a time, max 25 words. Casual tone, like a curious upperclassman.
- Prefer follow-ups that dig into something specific they just said ("you said it got easier, when and why?").
- Steer toward the THIN dimensions listed (things the community knows little about for this item) when the conversation allows.
- Use their profile (if given) to make questions relevant (e.g. ask a working professional about balancing with a job).
- Set done=true after ~4-5 good answers, or immediately if they signal they're done. Never pressure.
- extracted: 0-3 short factual claims from their LAST answer, each tagged with a dimension and the exact quote it came from.
Dimensions: ${DIMENSIONS.join(', ')}.
Respond ONLY with JSON: {"ack": "<=12 words reacting to their answer, or empty on first turn", "next_question": "...", "target_dimension": "...", "done": false, "extracted": [{"dimension":"...","claim":"...","quote":"..."}]}`,
  },
  summarize: {
    tier: 'cheap', maxTokens: 2000,
    system: `${SHARED}
You summarize community threads about ONE item. Every claim MUST cite the thread ids it comes from. Do not generalize beyond what threads say. If contributors disagree, say so.
Respond ONLY with JSON: {"claims":[{"dimension":"<one of ${DIMENSIONS.join('|')}>","text":"<=25 words","threads":["t01"]}], "best_for":"<=20 words or empty", "watch_out":"<=20 words or empty"}`,
  },
  advise: {
    tier: 'strong', maxTokens: 4000,
    system: `${SHARED}
You are the ADVISOR ("the Compass"). Given a person's profile/question and RETRIEVED context (real UIowa items + fictional-community threads about them), give a short concrete plan.
- 3 to 5 steps. Each step names real items by id and cites the threads that justify it. Prefer advice grounded in what similar people actually reported.
- Point to specific contributors ("people like you") whose paths resemble the user's.
- If something needs a human (financial aid, visas, admissions decisions, mental health, anything you can't ground), set human_handoff to a one-sentence referral to University of Iowa staff (e.g. Tippie Graduate Career Services, an academic advisor).
- Use ONLY ids from the context. If the context can't support a step, leave it out.
- RELEVANCE IS STRICT. Retrieval is keyword-based and WILL include irrelevant items. Before using an item, check it against the person's stage (undergrad vs grad vs alum), field, and stated goal. Graduate-only courses are not recommendations for undergrads (you may mention them as a future path). Never pad: 2 strong steps beat 5 weak ones.
- If the context is thin for this person, say so honestly in "gaps" rather than stretching an unrelated item to fit.
Respond ONLY with JSON: {"headline":"<=20 words","steps":[{"title":"<=10 words","why":"<=40 words, concrete","items":["id"],"threads":["tid"]}],"people":["person_id"],"human_handoff":"" ,"gaps":"<=25 words: what the community hasn't told us yet that would help this person"}`,
  },
  parse_resume: {
    tier: 'cheap', maxTokens: 1500,
    system: `${SHARED}
You read a (contact-info-redacted) resume and decide what this person could tell the community about. Match against the provided catalog of item ids when clearly referenced; otherwise suggest general topics.
Respond ONLY with JSON: {"headline":"<=12 words","stage":"enrolled|alum","matched_items":["id"],"topics":["<=8 words each, things to ask them about, max 4"]}`,
  },
  clean_transcript: {
    tier: 'cheap', maxTokens: 900,
    system: `You fix speech-recognition errors in a University of Iowa student's spoken answer.
- Fix words the recognizer misheard, using the context: the item being discussed, department codes (CS, ECE, BAIS, MATH, STAT, FIN, ACCT, MGMT, MKTG, ECON), course numbers like "CS 2210" -> "CS:2210", and campus terms (Tippie, Hawkeye, ICON, MyUI, Pappajohn, TA, GPA, RA, PhD, LeetCode, Python, Big O). Example: "Siesta department" -> "CS department", "B ice" -> "BAIS".
- Add punctuation and sentence breaks. Remove repeated stutters only.
- Do NOT rephrase, summarize, add content, or change their casual voice.
Respond ONLY with JSON: {"text": "..."}`,
  },
  moderate: {
    tier: 'cheap', maxTokens: 800,
    system: `${SHARED}
You pre-screen a community contribution before a HUMAN staff moderator sees it. Decide: approve (useful, safe), review (borderline: names private individuals, harsh about a named instructor, possible personal info), reject (spam, junk, abusive).
Respond ONLY with JSON: {"decision":"approve|review|reject","reasons":["short"],"usefulness":1}  (usefulness 1-5)`,
  },
};

function extractJSON(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const s = body.indexOf('{'), e = body.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(body.slice(s, e + 1)); } catch { return null; }
}

// Post-hoc grounding check: drop any id the model cites that wasn't in its context.
function validate(task, out, payload) {
  let dropped = 0;
  const keep = (arr, allowed) => (arr || []).filter((x) => (allowed.has(x) ? true : (dropped++, false)));
  if (task === 'summarize') {
    const tids = new Set((payload.threads || []).map((t) => t.id));
    out.claims = (out.claims || []).map((c) => ({ ...c, threads: keep(c.threads, tids) })).filter((c) => c.threads.length);
  }
  if (task === 'advise') {
    const iids = new Set((payload.context?.items || []).map((i) => i.id));
    const tids = new Set((payload.context?.threads || []).map((t) => t.id));
    const pids = new Set((payload.context?.threads || []).map((t) => t.person_id));
    out.steps = (out.steps || []).map((s) => ({ ...s, items: keep(s.items, iids), threads: keep(s.threads, tids) })).filter((s) => s.items.length || s.threads.length);
    out.people = keep(out.people, pids);
  }
  if (task === 'parse_resume') {
    const iids = new Set(payload.catalog_ids || []);
    out.matched_items = keep(out.matched_items, iids);
  }
  return dropped;
}

const buckets = new Map();
function rateLimited(ip, limit = 40, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const b = (buckets.get(ip) || []).filter((t) => now - t < windowMs);
  b.push(now); buckets.set(ip, b);
  return b.length > limit;
}

async function callLLM(env, task, payload) {
  const spec = TASKS[task];
  const meta = { task, model: MODELS[spec.tier], ms: 0, fallback: true, dropped_citations: 0 };
  if (!env.ANTHROPIC_API_KEY) return { data: null, meta: { ...meta, reason: 'no API key: scripted fallback' } };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(env.CC_TIMEOUT_MS || 25000));
  try {
    const system = spec.system + '\n\nDeliver your answer by calling the `respond` tool exactly once with that JSON object as its input. Do not write anything else.';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env[`CC_MODEL_${spec.tier.toUpperCase()}`] || MODELS[spec.tier], max_tokens: spec.maxTokens, system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        // Structured output: force a single tool call so the reply is always a parseable JSON object.
        tools: [{ name: 'respond', description: 'Return your answer in the JSON shape described in the system prompt.', input_schema: { type: 'object', additionalProperties: true } }],
        tool_choice: { type: 'auto' } }),
    });
    meta.ms = Date.now() - t0;
    if (!res.ok) return { data: null, meta: { ...meta, reason: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` } };
    const j = await res.json();
    const toolUse = (j.content || []).find((b) => b.type === 'tool_use');
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data = toolUse?.input && Object.keys(toolUse.input).length ? toolUse.input : extractJSON(text);
    // Models sometimes nest the object one level down ({"input": {...}}, {"response": {...}}): unwrap it.
    for (let k = 0; k < 2 && data && typeof data === 'object'; k++) {
      const keys = Object.keys(data);
      if (keys.length === 1 && data[keys[0]] && typeof data[keys[0]] === 'object' && !Array.isArray(data[keys[0]])) data = data[keys[0]];
      else if (typeof data[keys[0]] === 'string' && keys.length === 1 && keys[0] !== 'text') { const inner = extractJSON(data[keys[0]]); if (inner) data = inner; else break; }
      else break;
    }
    if (!data) return { data: null, meta: { ...meta, reason: `unparseable output (stop_reason: ${j.stop_reason})` } };
    meta.dropped_citations = validate(task, data, payload);
    meta.fallback = false; meta.usage = j.usage;
    return { data, meta };
  } catch (e) {
    meta.ms = Date.now() - t0;
    return { data: null, meta: { ...meta, reason: e.name === 'AbortError' ? 'timeout' : String(e.message) } };
  } finally { clearTimeout(timer); }
}

// --- submissions store: Cloudflare KV (binding CC_KV) if present, else in-memory (+ optional file hooks for Node)
const mem = { subs: [] };
async function loadSubs(env) {
  if (env.CC_KV) return JSON.parse((await env.CC_KV.get('subs')) || '[]');
  if (env.__load) return env.__load();
  return mem.subs;
}
async function saveSubs(env, subs) {
  if (env.CC_KV) return env.CC_KV.put('subs', JSON.stringify(subs.slice(-500)));
  if (env.__save) return env.__save(subs);
  mem.subs = subs;
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
  try {
    if (path === '/status') return json({ live: !!env.ANTHROPIC_API_KEY, models: MODELS, store: env.CC_KV ? 'kv' : (env.__load ? 'file' : 'memory') });
    if (path === '/llm' && request.method === 'POST') {
      if (rateLimited(ip, Number(env.CC_RATE_LIMIT || 40))) return json({ data: null, meta: { fallback: true, reason: 'rate limited' } }, 429);
      const { task, payload } = await request.json();
      if (!TASKS[task]) return json({ error: 'unknown task' }, 400);
      const s = JSON.stringify(payload || {});
      if (s.length > 40000) return json({ error: 'payload too large' }, 413);
      return json(await callLLM(env, task, payload || {}));
    }
    if (path === '/submissions' && request.method === 'GET') return json(await loadSubs(env));
    if (path === '/submissions' && request.method === 'POST') {
      if (rateLimited('sub:' + ip, 15)) return json({ error: 'rate limited' }, 429);
      const sub = await request.json();
      if (JSON.stringify(sub).length > 20000) return json({ error: 'too large' }, 413);
      const subs = await loadSubs(env);
      const rec = { ...sub, id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), status: 'pending', received: new Date().toISOString() };
      subs.push(rec); await saveSubs(env, subs);
      return json(rec);
    }
    const m = path.match(/^\/submissions\/([\w]+)\/decision$/);
    if (m && request.method === 'POST') {
      if (env.CC_STAFF_PIN) {
        const pin = request.headers.get('x-staff-pin');
        if (pin !== env.CC_STAFF_PIN) return json({ error: 'staff pin required' }, 403);
      }
      const { status } = await request.json();
      if (!['published', 'rejected', 'pending'].includes(status)) return json({ error: 'bad status' }, 400);
      const subs = await loadSubs(env);
      const s = subs.find((x) => x.id === m[1]);
      if (!s) return json({ error: 'not found' }, 404);
      s.status = status; s.decided = new Date().toISOString();
      await saveSubs(env, subs);
      return json(s);
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
