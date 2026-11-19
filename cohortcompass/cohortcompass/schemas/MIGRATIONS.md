# Schema migrations

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-11-18 | Initial frozen set: course-review, good-to-know, post, event-resource, profile, career-outcome, path-insight, course, career-passport, error. |

Rules (frozen for downstream prompts and modules):
- Field names, `$id`s and tool names never change. Additive fields go in `extensions` with an `x_` prefix (e.g. `extensions.x_unconfirmed_ratings`, `extensions.x_backfill_index`, `extensions.x_author_profile_id`, `extensions.x_demo_persona`, `extensions.x_staff_handled`).
- A breaking change becomes a new version (`…/course-review/2.0.0`) and ships with a migration function in `core/migrations/` plus a note here. The old version stays readable.
- Every record carries `schema_version`, `campus_id`, `program_id`, `program_type` and `provenance.synthetic`.
