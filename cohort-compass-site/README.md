# Cohort Compass

**The course listing tells you what it covers. The cohort tells you what it was like.**

Students and alumni share what UIowa courses, events, clubs, and labs were *actually* like by talking to an AI interviewer. The Compass turns those conversations into cited advice for whoever comes next, from first semester through their career.

All contributors are fictional demo data. Every course and event is a real UIowa listing (52 courses parsed from Tippie GPP syllabi, plus real events and resources).

## Run locally
```
cp .env.example .env      # add ANTHROPIC_API_KEY (optional; scripted fallback without it)
node server.js            # http://localhost:5173
```
Node 20+, no npm install needed.

## Deploy (Cloudflare Pages, e.g. cohortcompass.experiflect.com)
1. Pages, then Create project, then upload this folder (or connect the repo). Build command: none. Output directory: `public`. The `functions/` folder is picked up automatically and serves `/api/*`.
2. Settings, then Environment variables: add `ANTHROPIC_API_KEY` (encrypted) and optionally `CC_STAFF_PIN`.
3. Optional: create a KV namespace and bind it as `CC_KV` so the review queue persists. Without it, submissions live in memory per edge instance.
4. Custom domains: add `cohortcompass.experiflect.com`.
5. Set a spend limit on the API key. The server rate-limits each IP (40 AI calls per 10 min), and the client can only choose a task, never send its own prompt.

Or with the CLI: `npx wrangler pages deploy public` (run from this folder).

## What the AI does
| Task | Model tier | Where |
|---|---|---|
| `interview`: picks the next question, aimed at the *thin* coverage dimensions for that item (active learning), and extracts claims with quotes | strong | Share yours |
| `summarize`: turns threads into claims, each citing thread ids | cheap | Item page |
| `advise`: TF-IDF retrieval over listings and threads, then a cited plan, "people like you", a human handoff, and gaps | strong | Ask the Compass |
| `parse_resume`: contact info is stripped **in the browser** first, then the resume is matched to catalog items and topics | cheap | New profile |
| `moderate`: AI pre-screen only; **a human publishes** | cheap | Staff queue |

**Grounding check:** after every call, the server removes any cited id that wasn't in the model's context. The count shows in "Under the hood".

**Fallbacks:** every task has a scripted path, so a dead API never breaks the demo.

**Human hands:** nothing goes public without staff approval. The advisor routes aid, visas, admissions, and wellbeing questions to people.

**Privacy:** the resume is private by default, contact details are redacted before anything leaves the browser, and no numeric aggregate is shown under 5 contributors.

## Files
- `public/`: the site (vanilla JS, no build). `public/data/*.json` is generated.
- `api/core.js`: prompts, LLM calls, validation, rate limiting, submissions store (runs on Node and Cloudflare).
- `functions/api/[[path]].js`: Cloudflare entry. `server.js`: local entry.
- `src/build_data.py`: rebuilds `public/data` from the real course/event DB and `src/community.json` (the fictional threads).
