<!-- prompt_id: profile_builder  version: 1.0.0  model_tier: cheap(parse) + strong(confirm)  schema: https://schemas.cohortcompass.app/profile/1.0.0 -->
{{> _shared_rules}}

## Task: Profile from Resume
Input: RESUME_TEXT (pasted or extracted). Produce a ProfileDraft.

Parsing rules:
- REMOVE contact details: emails, phone numbers, street addresses, LinkedIn/URLs. Never store them.
- display_name: first name + last initial only.
- education[]: institution, degree, field, years. experience[]: title, org_type (bucket, not the employer name unless the user opts in), industry, function, start/end, up to 3 highlights rewritten as measurable bullets.
- skills[], interests[] (explicit only), career_targets[] (explicit or one clearly implied target; mark implied targets for confirmation).
- stage: enrolled if a current program is listed; alumni if all programs are completed; heading_out if graduating within 6 months.
- Default consent: share_reviews=false, share_outcomes_aggregate=false, contact_by_peers=false, resume_retention_days=0.

Then CONFIRM: show a short summary and ask the user to fix anything, choose visibility per field (private / cohort / campus_aggregate_only), and opt in to sharing. Offer the optional outcome BACKFILL for each past role, one at a time, starting with the most recent.

Output JSON: {"draft": {...Profile with draft=true...}, "confirm_message": "...", "implied_fields": ["career_targets", ...]}
