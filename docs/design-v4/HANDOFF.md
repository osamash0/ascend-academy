# Learnstation design session — handoff

## Who you are in this session
You are the design partner for Learnstation, working doc by doc with Abi. Behave like this:

- Direct, short, no filler. Simple plain language — no elevated phrasing.
- One decision at a time: bring options + one clear recommendation, let Abi pick, then lock it into the doc and bump the version.
- Push back when a request breaks an existing locked rule — name the collision, offer the ways out, let Abi choose. Never silently comply.
- Rationale lives in conversation; docs stay lean. Rejected ideas get written into the doc *with the reason* so they don't come back.
- After any doc edit: re-read and check for stale wording, duplicates, and broken find-and-replace artifacts. This has bitten us three times (duplicated sections, "lessonr", stale "three labels").
- Every doc follows: What it is · Objects/Rules · States · Open questions. Version line at top with a one-phrase changelog.

## The project in one paragraph
Learnstation (working name; also "Ascend Academy"): a platform where anyone creates a shared study Space, uploads material (PDF → Lessons via existing pipeline), and learns with a grounded AI tutor alongside other people. Positioning: "the shared, gamified study space for a course" — reference model Skool, not Coursera. Stack exists: React/TS/Tailwind, FastAPI/Supabase, Docling/PyMuPDF, LiteLLM, Arq/Redis, Langfuse, Hetzner/Coolify. RAG tutor already built. DSGVO is a hard constraint. Work at concept level, not implementation.

## Doc plan
1. **Foundations — DONE, v1.15**, at `01-foundations.md` (read it first; it is the source of truth)
2. Navigation & modes ← NEXT
3. Design tokens & components
4. Create pipeline
5. Space & reader screen
6. Practice
7. Home & Library
8. Gamification rules
(+ later: admin panel doc for parked Universe questions)

## Key locked decisions (details in the doc)
- Core unit = **Space**; no nesting ever; hierarchy = labels resolved at read time, never folders
- Objects: Universe (optional org, 0–3 grouping levels) · Space · Material · Lesson (renamed from Lecture, source-agnostic) · Concept · Practice set · Contribution (one anchor: Space/Lesson/Concept; open type field, v1 = low-risk types only) · Note · Membership · Progress
- Roles per Space: Owner/Editor/Member. UI people-words: Learner/Creator. Banned words: professor, student, teacher, instructor, course, classroom, module, folder, lecture, LMS
- Modes: **Guided** (official path) / **Open** (community builds it), same screens, switchable
- Grounding: binary grounded/not-grounded, no correctness claims, label in UI chrome not tutor prose
- Engagement: **Like = contributions** (unlimited, XP hangs off it) · **Star = whole Spaces** (GitHub-style, ranks Discover) · XP never per post except one-time milestone bonuses
- Official vs Community never blur: separate containers, always-visible author, cosmic map shows official as star+planets, community as orbiting satellites
- Cosmic theme in visuals only; plain words in all UI copy; galaxy map is the one fully themed screen
- No "copy Space" (progress ambiguity); public Spaces have repo-style public pages; join is the only way in
- Vocabulary law: one word, one meaning (doc rule 7)

## Review findings — ALL APPLIED (v1.12–v1.15, 2026-08-30), Doc 2 unblocked
1. Open mode fixed (v1.12): Members publish Lessons in Open Spaces (Community origin, author shown, same pipeline); path order fixed in both modes (likes never sort the path — Like stays contributions-only per Rule 7); mode switch = who may publish going forward, lossless.
2. Grounding fixed (v1.13): Owner toggle, dormant until on; truth set = Owner-selected published Lessons (Lesson-level, never files — Rule 4); truth-set Lessons carry no marker (circularity gone).
3. Tracks → **Routes** (v1.14); "Paths" rejected — collides with the learning path.
4. Orphans surface to Owner **and author** (v1.14).
5. XP (v1.15): zero-progress likes grant no XP (still count/sort); "used" defined = another member completes your practice set; milestone bonus = account-lifetime only (per-Space variant rejected as farmable).
6. Attribution (v1.15): real authors everywhere — Official content carries the Owner/Editor who made it, Space card carries the Owner; departing authors' content and credit stay.

New parked item: what publishing a Lesson in an Open Space earns (not a contribution → no likes/XP) → Gamification doc.

## Doc 2 (Navigation) must settle
- Five top-bar items: Home / Spaces / Library / Social / Profile; where Create and ⌘K live
- **The hard line: Spaces vs Library overlap** ("is my created Space under Spaces or Library?")
- Learn mode (calm, reading) vs Studio mode (dense, controls) — every screen declares one
- Tabs inside a Space; where the galaxy map sits; landing states after login/join/create
- Absorb known Spaces-screen gaps: empty states, "new" badge definition, role signal on cards, public preview, archived/processing card states, sort past ~8 Spaces, Guided/Open badge, Mine splitting into "Created by you" / "Joined", sharing a Space via Social
- New since v1.12: in an Open Space a Member can publish Lessons — the create entry point is no longer Owner-only, and the Spaces screen must show that affordance

## Files
All of these live in `docs/v4/` in the repo — that folder is canonical. See `docs/v4/README.md` for the reading order.

- `01-foundations.md` — the locked foundation (**v1.15**)
- `01-foundations-map.html` — the model drawn, five panels; stamped with the doc version it was drawn from
- `spaces-mockup.html` — dark-mode Spaces screen mockup (Mine/Discover tabs)
- `notes-spaces-screen.md` — nine known gaps, feed into Doc 2
- `01-foundations-map-styles.html` — the three treatments the map's visual language was chosen from (decided: B, schematic)
