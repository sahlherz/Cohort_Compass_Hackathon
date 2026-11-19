# 3-minute demo script (fits the 5-minute slot with 2 minutes for Q&A)

**Setup (before you present):** `npm start -- --reset`, open http://localhost:5173, then zoom the browser to 110%. With an API key the mode badge reads "live AI". Without one it reads "scripted fallback" and the flow is identical. Optionally pin time with `CC_NOW=2026-11-19T18:00:00-06:00`.

| Time | Screen | Say / do |
|---|---|---|
| 0:00 | **How it works** | "GPP asked what a lifelong career agent should look like. Our answer: the problem isn't advice, it's *data*. Rate My Professor gives you 'hard, nice'. We interview students and alumni and turn what they know into structured, cited records. Courses and events are real; every person here is synthetic." |
| 0:20 | Click **Demo as Maya** → **Parse resume** | "Maya is undecided between accounting and art. Resume in, draft out. Two contact details were stripped and the resume isn't kept. She picks what to share and confirms." Click **Confirm profile**. |
| 0:40 | **Review a course** → ACCT:2100 → **Fill demo narrative** → **Start interview** | "She writes the way she'd tell a friend. The AI pulled 8 fields out of that" (point at the chips lighting up) "and now asks *only* the gaps, one at a time, with quick-select buttons." Tap through 3–4 answers. Give clarity a **5**: "A 5 needs a concrete example, so it asks." Answer, tap **Yes, save it**. |
| 1:15 | Open **⟨/⟩ Under the hood** | "Every click is a real MCP `tools/call`. Here's the validated JSON, schema 2020-12, versioned. Any MCP host (Claude, a calendar server, a CRM) can call these same 13 tools." |
| 1:30 | Click **See the updated ACCT:2100 page**, then **Course pages → MBA:8180** | "Median 9 hours a week, back-loaded, WACC voted hardest, 78% of office-hours users say they're worth it. Tips decay: this one hasn't been confirmed in over a year, so it's flagged *may be outdated*. MBA:9130 has 3 reviews, so it shows *not enough data*. We never show an aggregate under n=5." |
| 1:55 | Switch to **Daniel** → **Events & resources for you** | "Daniel, MS Finance '22, wants FP&A leadership. Real Tippie events, each with *why it matches him*. Plus a nudge backed by evidence: MBA:8180 shows up in 8 of 12 finance-leadership paths. And a path back to Iowa: the part-time MBA and the Innovation certificate." |
| 2:15 | **Report an offer** → **I got it** | "He got promoted. The first question is always: *what was the single biggest factor?*" Type the alum-referral answer: "It tagged that *networking referral*." Answer 2–3 more, then confirm. |
| 2:35 | **Path insights** | "That outcome now counts. For finance leadership, the #1 factor is networking referral at 46%, median 12 weeks. Small groups are merged so nobody can be singled out." |
| 2:45 | **Ask the Cohort** → "What did it take to get into finance leadership?", then "I'm worried about my visa" | "Every sentence cites a record ID; click one and you see the record. Sensitive topics go to GPP staff, not the AI." |
| 2:55 | **Campus admin** | "And this is what stays in human hands: moderation, escalations, aggregate-only views, and real alumni title data from GPP's file. Thanks!" |

**Mystery student (Thursday):** click **+ New student**, paste their resume, and run the same flow. Nothing is hard-coded to Maya or Daniel. If the resume names no target, type one into the draft before confirming.

**If something breaks:** the scripted fallback is always on. `npm start -- --reset` restores the data in about 2 seconds.
