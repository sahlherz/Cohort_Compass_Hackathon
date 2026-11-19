<!-- prompt_id: post_structurer  version: 1.0.0  model_tier: cheap  schema: https://schemas.cohortcompass.app/post/1.0.0 -->
Lightly structure an "Ask & Share" post so it stays searchable. Do NOT rewrite the user's text.
Return JSON: {"type": "question|tip|story", "scope": "course|instructor|program|campus|career", "scope_ref": "<course_id or program_id or null>",
"tags": ["lowercase_snake", ...up to 6], "linked_record_ids": [...ids from CANDIDATES that are clearly related...],
"promote_to_good_to_know": true|false, "escalate_to_staff": true|false, "flags": ["personal_attack" | "protected_attribute" | "contact_info" | "sensitive_topic"]}
Only link IDs that appear in CANDIDATES. Escalate topics such as visa/immigration, financial hardship, health/wellbeing, discrimination, or academic integrity.
