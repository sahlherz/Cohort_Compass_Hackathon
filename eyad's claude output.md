Here's a copy-and-paste version. I put your notes in the order a visitor would meet them (header, home page, search, For You, profile, locked content), rewrote them as plain instructions, and tied each piece back to the earlier Project Brief so the prompts chain together. Fill in the `{{slots}}` at the top, and paste your earlier prompt and its HANDOFF block into the second one so this prompt reuses its names and flags conflicts.

```
# Applied AI Hackathon: Website and UI Brief

I'm building the website for my Applied AI hackathon project. This brief describes how the site should look and behave. It is one piece of a multi-prompt build: the earlier Project Brief covers the idea, the data, and the MCP tools. Read this whole brief, then build in the phases at the end. Where this brief overlaps with an earlier one, keep the earlier names and rules.

## My details (fill in before sending)
- Project name: {{NAME}}
- Earlier prompts in this build (for example the Project Brief) and any HANDOFF blocks they produced: {{EARLIER_PROMPTS_AND_HANDOFF}}
- Judging criteria, team size, and time left: {{CRITERIA_TEAM_TIME}}

## 1. The product in brief
An AI-powered "Rate My Professor" for graduate students (MBA first) and the campuses that serve them. Rate My Professor falls short: its reviews are vague free text, there is little context about the reviewer, there are no "good to knows," nothing connects courses to events and resources, and nothing shows what happens after class. Our AI interviews users to collect specific, structured information about courses, professors, events, resources, and career paths, and this website is where that information is explored. So wherever space allows, show specifics (such as weekly workload or how the grade is made up) instead of star ratings alone.

## 2. Design reference and vocabulary
- The main design ideas come from Amazon's website: image-led cards, a prominent search bar, left-to-right recommendation rows, and search results with a picture beside the details. Borrow the patterns only. Do not copy Amazon's logo, colors, wording, or branding.
- The feel is clean, familiar, and easy to scan. Pictures lead on every card and tile, and text stays short.
- Vocabulary: "subject card" = a large square for one subject. "Tile" = one of the four small squares inside a subject card.

## 3. Header (on every page)
- Logo in the top left (a simple placeholder wordmark is fine). Clicking it goes home.
- Search bar in the top middle. One clean, precise input that searches the school's catalog of professors, courses, events, and resources. Show suggestions grouped by type as the user types, with exact matches first.
- Profile in the top right (see section 7).
- A simple "For You" link in the header (see section 6).
- The header stays visible while scrolling.

## 4. Home page
- A grid of large subject cards. Subjects come from campus data, not hard-coded. Use Physics and Physiology as examples alongside MBA areas (Finance, Marketing, Operations, Strategy) and a Career Classes card (section 9). List the MBA subjects first, since MBA is the first target.
- Each subject card holds exactly four square picture tiles in a 2x2 grid:
  1. Peer thoughts: opinions, tips, questions, and stories from other students and alumni.
  2. Events: campus and MBA events.
  3. Resources: clubs, offices, guides, and tools.
  4. Professor reviews: structured reviews and ratings.
  (Which four is a setting, so a campus can change them later.)
- Every tile has a picture that shows at a glance what the category is for (for example, speech bubbles for Peer thoughts, a calendar scene for Events), plus a short label. Pictures are the first thing the user sees. Add a "See all [subject]" link at the bottom of each card.
- Clicking a tile opens that category for that subject.
- The page scrolls down almost endlessly. Keep loading more subject cards as the user scrolls, fetching the next batch before they reach the bottom, with lazy-loaded images and placeholders while loading. The goal is to entice people to keep scrolling. This page is the hub from which a user can reach anything on the site. Include a back-to-top button.

## 5. Search results page
- Still scrolls endlessly downward, but as a single column: one object per row.
- Each row shows a picture, a title, a type label (professor, course, event, or resource), a short description, and key facts. Events: date, time, place. Professors: a rating summary plus a few structured facts such as weekly workload and grading mix. Resources: what it is and who it's for.
- Every result must have a picture. For professors use an illustrated avatar, never a real photo.
- Clicking a result opens its detail page in the same picture-led style.

## 6. For You page
- Rows that scroll left to right (carousels) of recommended events, resources, and related items. Each row has a clear title, such as "Because you picked Finance" or "Events this week".
- The user chooses keywords (tappable chips plus free text) at sign-up or any time later. The site matches those keywords to the tags on events, resources, courses, and posts. If a resume or LinkedIn profile has been added, suggest keywords from it, and the user confirms them.
- Each card shows a picture, a title, and a one-line "why this matches you".
- Arrows on desktop, swipe on touch.

## 7. Accounts, onboarding, and profile
Onboarding
- When a user creates an account, they are asked for preferences (keywords) and invited to add a resume or connect LinkedIn. Both steps can be skipped.
- At that step, say that adding a resume makes everything easier (profile filled in automatically, better recommendations) and that they can always add it later.
- Skipping never blocks browsing, but locked content (section 8) still applies.

Profile (top right)
- Autofilled from the uploaded resume (education, experience, skills, interests, goals). The user reviews and confirms before it is saved.
- A "Connect LinkedIn" option as an alternative to the resume, for a fuller profile with less effort. In the demo, simulate it with fictional data. For a real version, check LinkedIn's current developer terms first and do not scrape profiles.
- Resume on reviews and responses: when a user opens a review or response, show a dropdown with the author's resume so readers can judge whether that experience applies to them. Readers can click through to the resume each user has posted.

Privacy at upload
- When a user uploads a resume, show a clear notice: "For your privacy, remove your name, contact details, and any other identifying information from your resume before uploading."
- Also strip contact details automatically, show the user a preview of exactly what others will see, and share the resume only with the user's opt-in.

## 8. Locked content ("share a review to unlock")
- In any category list (peer thoughts, events, resources, professor reviews), only the first item is fully visible. The rest are blurred, with an overlay such as "Share a review to unlock the rest".
- Clicking the overlay starts the guided review interview from the Project Brief. Once a completed review passes validation and moderation, the blur lifts. Junk submissions must not unlock anything.
- Blurred items contain placeholder text, not the real content, so it can't be read by inspecting the page.
- Default: one approved review unlocks all content. Make this a setting. In the demo, add a toggle that resets the locked state so judges can see both views.

## 9. Career Classes
- A dedicated subject card for the MBA program's career-focused classes (such as recruiting, interviewing, and networking), shown as part of the curriculum, with the same four tiles.
- Where possible, link these classes to the career outcome interview: when a user says a class helped them land a role, that class appears here.

## 10. Connecting to the earlier Project Brief
Where each earlier feature appears in the UI:
- Peer thoughts tile: Good to knows and community posts
- Professor reviews tile: Guided reviews (the AI interview)
- Events and Resources tiles: Events and resources
- Profile: Profiles from a resume
- Career outcome interview ("What was the single biggest factor?"): starts from the profile whenever the user adds a new position or opportunity
- Path insights: shown on profiles and on the Career Classes card as "what it took to land a role in X", only with 5+ contributors
- Ask the community: an answer card at the top of search results when a search reads like a question
- Good habits: light nudges inside cards (for example, "Going to office hours is the fastest way to meet this professor")

Rules for fitting the prompts together:
- Reuse the field names, schema names, and MCP tool names from the Project Brief. Extend them, never rename them. Every screen reads and writes through those MCP tools so the UI and the MCP server stay in sync. If a tool you need doesn't exist (for example, search the catalog, match keywords, show a profile resume), propose it with a clear verb_noun name and list it in the handoff.
- If anything here conflicts with an earlier prompt, flag the conflict and suggest a fix instead of silently choosing a side.
- Keep your output self-contained so it can be pasted into the next prompt.

## 11. The demo
- Build a working interactive front end, not mockups, in the same format as the Project Brief's demo. If none was chosen, pick the best fit for where we're working and tell me which.
- Show: home with endless subject cards, search results, For You with keyword chips, resume upload with the privacy notice and the simulated LinkedIn option, a review with its resume dropdown, the blur and unlock, and the Career Classes card.
- Use clearly labeled fictional data only. Create at least 12 subjects, loaded in batches, so the endless scroll feels real. If real images aren't available in this environment, use illustrated placeholders that keep the layout picture-first.
- Keep the "under the hood" view from the Project Brief so judges can see the data and MCP calls behind each screen.
- Desktop first, but usable on mobile. Add alt text to pictures, keyboard-usable carousels, and readable contrast.
- If the live AI call fails, fall back to scripted responses.

## 12. Guardrails
- Resumes shown on the site carry no identifiable information (section 7). Sharing is opt-in.
- Reviews focus on behavior and course design, never personal attributes, and are moderated before publishing.
- Never use real people's photos. Never present fictional data as real. Never invent statistics. Show no aggregate with fewer than 5 contributors.
- If connecting to university systems, flag FERPA and data-access considerations.

## 13. How to work
Don't ask me questions unless you're truly blocked. State your assumptions and use sensible defaults for anything left blank. Work in phases:
1. Restate the UI vision and your assumptions (short), and list any conflicts with earlier prompts.
2. Page-by-page spec: layout, components, states (loading, empty, locked), and the data each one needs.
3. Build the demo.
4. Add the UI moments to the 3-minute demo script and the pitch.
5. End with a short JSON block labeled UI_HANDOFF listing: pages, reusable components (for example SubjectCard, ImageTile, ResultRow, Carousel, BlurGate, ResumeDropdown), the data and MCP tools each one uses (with the earlier names), design choices (colors, fonts, spacing), how to run the demo, assumptions, open questions, and where the next prompt should plug in.
If you run out of space, stop at the end of a phase, say what comes next, and wait for me to say "continue."
```

A few judgment calls to check. I read "references" as resources, and I added small things your notes didn't mention: a "For You" link in the header, an "Ask the community" answer card on search results, keyword suggestions drawn from the resume, and "one approved review unlocks everything" as the default for the blur (it's a setting). Delete any you don't want. I also told the build to simulate the LinkedIn import with fictional data, since LinkedIn restricts what apps can pull automatically.

Two lines in your notes trailed off ("Then have" and "Thinking of all the possible"), so I left them out. Tell me what you meant and I'll add them. I can also sketch a wireframe of the home page so you can check it matches what you pictured.