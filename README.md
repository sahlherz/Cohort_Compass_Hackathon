# CohortCompass

**An AI peer advisor for Tippie students and alumni.** It works like Rate My Professor, except an AI interviewer turns what students and alumni know into structured, evidence-backed records. Those records drive course pages, matched events, "what it took" career paths and a Q&A that always cites its sources.

Built for the Applied AI Club × Tippie GPP "Lifelong Career Agent" hackathon (Module 1 of a multi-prompt build).

> **Data policy.** Courses and events are **real**: 44 graduate courses parsed from the GPP-provided Fall 2025, Spring 2026 and Summer 2026 syllabi, undergrad courses checked against catalog.registrar.uiowa.edu, and events from the Tippie, Pomerantz and UICA calendars (verified 2026-11-18). Alumni job-title counts come from GPP's `data.csv` (aggregate only). **Every person, review, tip, post and outcome is synthetic** and carries `provenance.synthetic = true`. Instructors are pseudonymized ("Instructor A") so fake reviews are never attached to real faculty.

## Run it (one command)

```bash
npm start            # installs deps on first run, seeds data, serves http://localhost:5173
npm start -- --reset # reseed demo data
npm test             # core smoke test + MCP client integration test (stdio, elicitation)
```

You need Node 20+. No API key is required: without one, every AI step uses a deterministic scripted fallback, so the demo never dead-ends. For live AI, set `ANTHROPIC_API_KEY` (see `.env.example`). The cheap model handles parsing, extraction and moderation. The strong model handles interview phrasing and Ask the Cohort.

Windows PowerShell: `$env:ANTHROPIC_API_KEY="sk-..."; npm start`

## What's inside

```
schemas/      JSON Schema 2020-12, versioned + frozen ($id https://schemas.cohortcompass.app/<name>/1.0.0)
prompts/      reusable interviewer system prompts (shared rules, review, extractor, outcome, profile, ask, post, moderation)
core/         transport-agnostic logic: validate, interview engine, extraction, recommend, insights, ask, moderation, passport
core/store/   storage adapter (JSON files for the demo; Postgres + pgvector would implement the same interface)
mcp/server.js MCP server (official TS SDK 1.32.x): 13 frozen tools + 5 x_ tools, 4 resource templates, 3 prompts
web/          zero-framework demo UI; every click calls the same core op as the matching MCP tool
scripts/      seed.js (real courses/events + synthetic people), build-schemas.js, start.js
tests/        smoke.js (end-to-end core), mcp-client.js (spawns the server, exercises tools/resources/prompts/elicitation)
```

**Design rule: "the LLM proposes, the schema disposes."** The interview engine owns the plan: what's missing, what's valid, when to stop. The model only phrases the next question and pulls extra fields out of long answers. Every extracted field is re-validated against the schema before it's kept. Ask the Cohort answers are rejected if they cite any ID that wasn't retrieved, and then rebuilt from a template.

## MCP surface

| Tool | R/W | Purpose |
|---|---|---|
| `search_courses` | read | Real catalog search with review counts (paginated) |
| `get_course_insights` | read | Aggregates only when n ≥ min_n; good-to-knows with confidence and decay |
| `parse_resume` | read | Resume → ProfileDraft with contact details stripped; nothing retained |
| `upsert_profile` | write | Confirmed profile with per-field visibility and consent |
| `validate_review` | read | Returns only `missing_fields` / `invalid_fields` |
| `save_review` | write | Validate → moderate → save (idempotent); **elicits** missing fields |
| `create_post` | write | AI-structured Ask & Share; tips promoted to GoodToKnow; flagged items go to staff |
| `recommend_events_resources` | read | Ranked real events with "why this matches you" plus evidence-based nudges |
| `log_career_outcome` | write | CareerOutcome; **elicits** `biggest_factor` if missing |
| `get_path_insights` | read | "What it took", min_n plus small-cell suppression |
| `ask_cohort` | read | Cited Q&A, or "not enough data"; sensitive topics route to staff |
| `export_profile` / `import_profile` | read / write | Career Passport (schema-validated, SHA-256 checksum, ID remap on conflict) |
| `x_interview_start` / `x_interview_answer` | write | Interview for hosts without elicitation |
| `x_moderation_queue` / `x_moderate` / `x_admin_overview` | read / write | GPP staff, human in the loop |

Resources: `schema://{name}/{version}` · `campus://{campus_id}/program/{program_id}` · `course://{campus_id}/{course_id}` · `insights://path/{target}`
Prompts: `review_interview` · `outcome_interview` · `profile_builder`

**Spec note:** the current MCP spec revision is **2026-07-28** (stateless). The latest official TypeScript SDK on npm (1.32.2) implements **2025-11-25** and earlier. The spec defines backward compatibility for initialization-based versions, so this server works with today's hosts. Moving to the stateless revision is an SDK bump, not a redesign: the HTTP transport here already runs stateless.

### Plug it into an MCP host

Claude Desktop, Claude Code or any stdio host (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "cohortcompass": {
      "command": "node",
      "args": ["C:/path/to/cohortcompass/mcp/server.js"],
      "env": { "ANTHROPIC_API_KEY": "optional", "CC_MIN_N": "5" }
    }
  }
}
```

Claude Code one-liner: `claude mcp add cohortcompass -- node /path/to/cohortcompass/mcp/server.js`
Remote hosts: `node mcp/server.js --http --port 8788`, which exposes Streamable HTTP (stateless) at `http://localhost:8788/mcp`.

### How other MCP servers consume our exports

- **Calendar server**: call `recommend_events_resources`, then create events from `items[].schedule` and `source_url`. The web demo also serves `/api/events.ics`.
- **Recruiting / CRM server**: with the user's consent, call `export_profile` → a `CareerPassport` containing the profile and outcomes. The receiver validates against `schema://career-passport/1.0.0` and checks `checksum_sha256` (SHA-256 of canonical JSON of `{profile, outcomes}`).
- **LMS server**: push course lists into `profile.courses_taken`. The "give back" nudge then prompts a review at term end. Read `course://uiowa/<code>` to show insights inside the LMS.

## Guardrails (what stays in human hands)

- Moderation before publishing: rule pass plus an optional cheap-model second opinion. The AI can add flags but never auto-rejects; rejections are staff decisions.
- Reviews cover behaviour and course design only. Protected-attribute, appearance, personal-attack and contact-info patterns are held for staff.
- Escalation: visa/immigration, financial hardship, wellbeing, discrimination and academic integrity route to GPP staff, and the AI doesn't answer them.
- Privacy: sharing is opt-in, the resume is not retained, contact details are stripped, nothing aggregate shows below n = 5, small cells are merged, and reviewer context is hidden for groups smaller than 3.
- Every Ask the Cohort claim cites a record or aggregate ID. Synthetic answers are labeled.
- **FERPA:** this prototype uses no student-record systems. Any integration with MyUI, ICON or enrollment data needs a GPP/Registrar data-access review first, and it is designed to be consent-driven (students push their own courses) rather than a bulk pull.

## Known gaps

- Instructor pages are pseudonymous by design. Mapping to real names needs a campus-approved process.
- The live-model path is implemented but was only tested in scripted mode here, because no API key was available in the build environment. Run with your key before presenting.
- The event list is a curated, verified snapshot, not a live ICS/RSS feed. The `EventResource.source` field and adapter boundary are ready for one.
- Text search is a TF-IDF stand-in for a vector index (same `search()` interface).
