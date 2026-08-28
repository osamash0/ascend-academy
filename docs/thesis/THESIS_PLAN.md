# Thesis Preparation Plan — Understanding Learnstation (ascend-academy)

**Goal of this plan:** NOT writing the thesis. The goal is that Abdullah fully understands this project — its architecture, the PDF→content pipeline, the data model, and the learning features — well enough to explain every diagram without notes. When the readiness checklist (§5) is done, thesis writing starts as a separate effort.

**Thesis title (context):** From Lecture Materials to Structured Educational Content: Design and Implementation of an AI-Assisted Learning Platform
**Level:** Bachelor Informatik — explain concepts before code, no overengineering, no filler.
**Language:** English (notes and diagram labels).
**Time budget:** finish all sessions within ~10-12 days (thesis deadline is ~1 month away; writing needs the rest).

---

## 0. How each session works

Each "Session" is one Claude (Opus) chat in this repo. Rules for Claude in every session:

1. **Explain, don't dump.** Concepts first, then the real code — name the actual files and walk through the important parts. Bachelor level. Direct language.
2. **Diagrams are the anchor.** Abdullah learns best visually. Build each listed diagram with the **diagram-design** skill, save to `Diagrams/` (repo root), then walk through the diagram element by element — every box and arrow must be explained.
3. **Verify understanding.** End the session with 3-5 check questions Abdullah answers in his own words. If an answer is wrong or vague, re-explain that part differently — do not move on.
4. **Record it.** Append a summary to `docs/thesis/NOTES.md`: what was covered, the key design decisions and *why*, terms Abdullah should be able to define, and anything still unclear (carry unclear items into the next session).

**Session prompt template (paste into Opus, adjust N):**

> Read docs/thesis/THESIS_PLAN.md. Run Session N following §0 exactly. I am a bachelor Informatik student — this is a learning session, not a writing session. Explain at my level, use the diagram-design skill for the listed diagrams, save them to Diagrams/, walk me through each diagram, quiz me at the end, and append the summary to docs/thesis/NOTES.md.

**One-time setup (before Session 1):**
- Install the diagram skill: `/plugin marketplace add cathrynlavery/diagram-design`
- Diagram conventions: English labels, minimal-light variant (prints well), filenames `NN-topic.html` (e.g. `03-pipeline-flow.html`), export SVG — these become thesis figures later.

---

## 1. Research-question context (shapes what to understand deeply)

The proposal's original RQs (data profiling metrics, event aggregation) fit a learning-analytics thesis; the title fits a content-pipeline thesis. Recommended reframing (confirm with supervisor, but learn accordingly):

- **RQ1:** How can heterogeneous lecture materials (PDF slides) be automatically transformed into structured, interactive educational content using LLMs, and what architecture supports this reliably? → **deepest understanding needed: Sessions 2-4.**
- **RQ2:** How do students perceive motivation and engagement in a gamified, AI-driven learning platform? → Session 6.
- **RQ3:** Does interactive, AI-generated content improve perceived learning efficiency and usability vs. static slides? → Session 5.

Consequence for learning depth: the **pipeline (Session 3) is the heart** — understand it at code level. Gamification/analytics need overview-level understanding only.

---

## 2. Learning sessions

### Session 1 — Bird's-eye view (what is this product?)
**Understand:** what Learnstation does; the two roles (student/professor); the core loop: upload lecture PDF → AI structures it → students learn interactively → gamification/analytics feedback. Feature inventory at overview level: courses, lecture viewer, quizzes, SRS "Daily Ascent", exam mode, student uploads, gamification, professor analytics, onboarding. Tech stack in one pass: React/Vite frontend, Python backend, Supabase (Postgres/Auth/Storage), Arq workers + Redis, LiteLLM provider chain, Docker on Hetzner.
**Diagrams:** `01-system-context.html` (C4 L1: users + system + external services), `02-feature-map.html`.
**You're done when you can:** describe the core loop and every major feature in one sentence each, and say what each external service is for.

### Session 2 — Architecture & deployment
**Understand:** how the containers fit together (frontend, backend API, worker, Redis, LiteLLM, nginx; Supabase as managed backend); what a request/job actually travels through; why slow PDF/LLM work runs async in a worker instead of the API process; feature flags; deployment on one Hetzner VM via Docker Compose (overview only).
**Diagrams:** `03-container-architecture.html` (C4 L2), `04-deployment.html`.
**You're done when you can:** trace "student opens a lecture" and "professor uploads a PDF" through the containers from memory, and justify the async-worker decision.

### Session 3 — THE core: PDF → structured content pipeline (longest session — this is the thesis title)
**Understand end to end, at code level:** upload (single + course-at-once batch) → storage → Docling parsing → chunking → LLM structuring via the LiteLLM provider chain (fallback order and why) → generated artifacts (structured slides, quiz cards) → professor batch review → publish. Also: error handling and retries, the Arq background-job model, progress reporting to the UI. Design decisions to internalize: why Docling, why a provider chain, why human review before publishing.
**Diagrams:** `05-pipeline-flow.html` (flowchart), `06-pipeline-sequence.html` (upload→publish sequence).
**You're done when you can:** narrate the whole pipeline from memory including what happens on failure at each stage, and defend the three design decisions above.

### Session 4 — Data model
**Understand:** core entities and their relations — universities/courses/lectures, slides/chunks, quiz cards, SRS review state, user/profile, XP/badges, events. Only thesis-relevant tables, not all 100+ migrations. Row-Level Security: what it is, one concrete policy read and explained line by line.
**Diagram:** `07-er-core.html` (ER diagram, core entities only).
**You're done when you can:** sketch the ER diagram from memory and explain how RLS keeps one student's data invisible to another.

### Session 5 — Consuming the content: interactive learning features
**Understand:** lecture viewer (structured content vs raw PDF — this is the "interactive vs static" contrast of RQ3), quiz answering, SRS review engine (spaced-repetition theory basics + how Daily Ascent implements it), exam mode overview.
**Diagrams:** `08-student-learning-flow.html` (user flow), `09-srs-state-machine.html` (card states).
**You're done when you can:** explain spaced repetition to a non-CS friend, walk through the card state machine, and state precisely what differs between static-PDF and interactive study in this app.

### Session 6 — Gamification & analytics (overview depth, RQ2)
**Understand:** server-authoritative XP/badge engine (why server-side, what idempotency means here), event capture, professor analytics dashboard at overview level.
**Diagram:** `10-gamification-event-flow.html` (action → event → XP/badge → UI feedback).
**You're done when you can:** explain why XP must be granted server-side and follow one user action through to a badge popup.

### Session 7 — Synthesis & readiness check (no new material)
**Do:** lay out all 10 diagrams; Abdullah explains each one unaided while Claude probes with follow-up questions ("why is this arrow here?", "what breaks if this box disappears?"). Revisit every "still unclear" item accumulated in NOTES.md. Fix/polish any diagram that turned out wrong or confusing during explanation.
**Output:** a gap list — anything not yet solid gets one targeted mini-explanation, then re-check.
**You're done when:** the §5 checklist is fully ticked.

---

## 3. Artifacts these sessions produce

- `Diagrams/01…10-*.html` + exported SVGs — understood, explainable, future thesis figures
- `docs/thesis/NOTES.md` — per-session summaries with design decisions and their *why* — raw material for later writing

## 4. Pacing suggestion

Sessions 1-2 → days 1-3 · Session 3 → days 4-6 (take two sittings if needed) · Session 4 → day 7 · Sessions 5-6 → days 8-10 · Session 7 → day 11-12. In parallel (non-Claude): email supervisor about the RQ reframing (§1) in the first days.

## 5. Readiness checklist — "I can start writing"

- [ ] I can explain all 10 diagrams without notes
- [ ] I can narrate the full PDF→published-content pipeline from memory, including failure handling
- [ ] I can justify the key design decisions: async worker, Docling, LLM provider chain, human review step, server-side gamification
- [ ] I can sketch the core ER diagram from memory
- [ ] I can explain RLS and spaced repetition in plain words
- [ ] `docs/thesis/NOTES.md` has a summary per session with no open "unclear" items
- [ ] Supervisor has responded on the RQ reframing
