# 01 · Foundations

**Status:** Locked · v1.15 — 2026-08-30 (XP: zero-progress like gate, "used" defined, milestone = lifetime only; real authors everywhere)
**Locked decisions:** Docs in Markdown · UI in English (informal tone) · Core unit is called a **Space** · Grouping = classification metadata, never folders · A Space never contains another Space

## What it is
The names for everything in Learnstation, who can do what, and how content is structured.
Every screen in the app is a view of exactly one of these objects. If a screen mixes two objects with equal weight, the screen is wrong.

## Objects
| Object | Plain meaning |
|---|---|
| **Universe** | An organisation — a university, company, school, or community. *Optional.* Owns Spaces, gives them scoped discovery ("At your university") and branding. |
| **Space** | A shared study room for one subject. Anyone can create one. Holds lessons, practice, and members. Can belong to one Universe — or none. |
| **Material** | A file someone uploaded (PDF, slides, later video). The original file a Lesson is generated from. |
| **Lesson** | A readable, learnable unit generated from a Material (or written by hand) — a lecture, book chapter, paper, or anything else. Lives in a Space, in a fixed order. |
| **Concept** | A single idea inside a Lesson ("gradient descent"). Extracted by the pipeline. The "planet". |
| **Practice set** | Questions belonging to one Lesson. |
| **Contribution** | Something a Member made and published into the Space. Has one anchor (Space / Lesson / Concept) and a type. Always shows its author. |
| **Origin** *(property)* | Who made it: **Official** (Owner/Editors) or **Community** (Members). Always visible. |
| **Grounding** *(property)* | How content relates to the Space's source of truth: **grounded / not grounded**. Shown by the UI — only in Spaces where grounding is switched on. |
| **Note** | Personal. Anchored to a spot in a Lesson. Only its author sees it. |
| **Membership** | A person + their role in one Space. |
| **Progress** | Per person. Per Lesson: not started / in progress / done. Per Concept: untouched / discovered (read) / cleared (practice passed) — this is what lights the map. |

## Roles — per Space, not per account
There is **no global "professor" or "student" account type.** Everyone has the same account. Roles exist only inside a Space:

- **Owner** — created the Space. Full control, sees analytics.
- **Editor** — can add and edit content. (For co-Creators: teaching assistants, study-group partners.)
- **Member** — learns. Sees published content only. **In an Open Space, Members can also publish Lessons** into the path — Community origin, author always shown.

What others call a "professor" is simply an Owner whose Space has 200 members. Someone studying alone is an Owner whose Space has 1. Same screens, same flow.

## Visibility — per Space
- **Private** — only me. *Default for everyone.*
- **Invite** — join via code or link. Approval lives here, and only here.
- **Public** — anyone on the platform can find and join. One tap, no approval. This is the open-learning shelf.

## Rules
1. Members only ever see **published** lessons. Drafts and processing states are visible only to their author and the Owner/Editors.
2. **A Space never contains another Space.** No subspaces, no folders. All hierarchy above the Space is built from labels (see below). A study group "under" a course = a normal Space that links its parent and inherits its labels.
3. v1 structure inside a Space is flat: **Space → ordered list of Lessons.** No modules yet (revisit past ~20 lessons).
4. Deleting a Material never breaks its Lesson — the Lesson keeps working and shows "source file removed." The Space's knowledge context is safe by construction: the tutor and grounding read from the **published Lessons' extracted content, never from raw files** — so removing a file leaves no hole in the context, and citations point at Lesson passages, which still exist. Only deleting the *Lesson itself* removes knowledge: the context rebuilds without it automatically, and everything grounded in it (practice, contributions, tutor citations) flips to **not grounded** and is surfaced to the Owner — same pattern as orphaned contributions, nothing dangles silently.
5. One person can be Owner in one Space and Member in another. Role never leaks across Spaces.
6. Words we use: Universe, Space, Lesson, Material, Practice, Members, XP, Rank, Like, Star — and for people: **Learner** and **Creator** (descriptive words in UI copy, not permission roles; permissions stay Owner/Editor/Member). Words we ban in the UI: professor, student, teacher, instructor, course, classroom, module, folder, lecture, LMS.
7. **One word, one meaning (locked):** **Guided/Open** name the Space modes; **grounded/not grounded** names content's relationship to the source material; **Like** belongs to contributions, **Star** belongs to whole Spaces — neither ever applies to the other's object. Consequences: there is **no star currency in the Ascent profile** (XP and ranks carry all progression), and the map's lesson body is drawn as a star but UI copy never calls it one — its label is the lesson's name.

## Classification — two axes, both labels, never folders
Content is stored flat. All grouping is metadata resolved at read time (hierarchy is a query, not a structure). One Space can appear in several places at once — folders can't do that.

**Content axis — what it's about** (platform-wide, applies to every Space):
| Level | What | Who maintains it |
|---|---|---|
| **Domain** | ~15–20 broad fields (Computer Science, Medicine, Law…) | We curate a fixed list |
| **Subject** | Topics inside a domain (Machine Learning, Anatomy…) | Curated list, grows on demand |
| **Concept** | A single idea inside a Lesson | Extracted automatically by the pipeline |

**Institutional axis — who it belongs to** (exists only when a Space has a Universe):
| Level | What | Who maintains it |
|---|---|---|
| **Universe** | The organisation itself | Created once |
| **Grouping levels** | 0–3 ordered levels, each = a name + a flat list of values. University: Faculty → Department. Company: Division → Team. School: Year → Class. Community/bootcamp: one level ("Track", "Cohort"). Small group: zero levels. | v1: whoever created the Universe. One flat list per level. |

Rules:
1. The axes never touch. Universe answers *who owns it*; Domain answers *what it's about*. A Space can sit in Marburg and be Computer Science, or sit nowhere and still be Computer Science.
2. Level names are configurable text, never hardcoded academic words. Internally: `levels[]`, capped at 3 — unlimited depth would be the folder tree sneaking back in. Zero levels is valid.
3. Content axis: AI assigns Domain/Subject/Concepts during processing; the Owner confirms editable chips at publish. Users never file manually and never invent Domains.
4. In the UI, levels are **chips** on a Space card (tap to filter) and a **group-by control** on a Universe page (collapsible sections). Same data, two views. No empty containers to click into.
5. This layer powers Discover, "At your university" scoping, related Spaces, search, and later the cross-Space concept graph.
6. v1 scope: Universe = one nullable field + labels on a Space. No seats, no SSO, no Universe admin panel yet. Classification per Space, concepts per Lesson; cross-Space concept resolution is P2.


## Content origin — the two-tier model
Learners create too. But the tiers must never blur.

- **Official** — made by Owner/Editors. The ground truth of a Guided path.
- **Community** — made by Members: contributions (summaries, practice questions, mnemonics, explanations) and, in Open Spaces, whole Lessons. Always shows its author, always badged; contributions are always anchored (Space, Lesson, or Concept — see anchors below). On the map: the path — its Lessons and Concepts, whatever their origin — is the star and planets; contributions orbit them.

**Two Space situations, same screens, no fork:**
- **Guided** — an official core exists (e.g. a university course). Only Owner/Editors publish into the path. Community content sits in a separate tab per Lesson/Concept, never silently mixed into the path. Non-negotiable: members must always know what belongs to the official material and what doesn't.
- **Open** — no official core required (e.g. people learning ML together). Every member can publish **Lessons** directly into the path — same pipeline (processing, Concepts, progress, the map), Community origin, author always shown. Likes sort community sections, never the path.

**Promotion is the bridge:** the Owner can **endorse** community content (checkmark, stays community-authored) or **promote** it into the official core (author credited) — a contribution or, in an Open Space, a whole community Lesson. An Open Space can grow a source of truth; a Guided Space can absorb the best member work.

Rules (locked):
1. Member contributions are **on by default**, visible immediately. Badges prevent confusion; the Owner can hide anything. No pre-review — it kills momentum in a 300-member Space.
2. XP is granted **only when a contribution is liked, endorsed, or used** — never per post. **Used, v1:** another member completes your practice-set contribution; other types have no "used" event yet. Reward reception, not production, or you get spam within a week. **One exception: one milestone bonus.** A small one-time XP bonus for the *first contribution in your account's history* — crossing the creator threshold, once, ever. *(Per-Space first-contribution bonuses rejected: public Spaces are one-tap joins with no pre-review, so N joins + N junk posts = N bonuses.)*
3. Owners **can** endorse and promote. This is the bridge between Guided and Open.
4. Quality control without a moderation team = origin badges (trust) + likes (sorting) + engagement-gated XP (incentive) + a report button + the Owner's right to hide.


### Contributions — where they attach, and what they can be
A **Contribution** is one object with two variable parts: an *anchor* and a *type*.

**Anchor — three levels, pick one:**
| Anchor | Example |
|---|---|
| **Space** | A whole-course cheat sheet, an exam-prep guide, a reading list |
| **Lesson** | A summary of Lesson 4, an alternative explanation of the whole lesson |
| **Concept** | A worked example of `JOIN`, a mnemonic, an animation of one idea |

Every level gets the same treatment: a Community section on that level's screen, showing what members made for it. Browsing SQL, you see the official lesson *and* "104 member contributions" beneath it.

**Type — open model, safe v1 list.** The platform stores a type + a payload, so new types are added without touching the model. But v1 accepts **low-risk types only**: text/Markdown, PDF, image, link, practice set. No executable or embedded-code artifacts.

*Future idea (parked, not v1):* members generating rich learning artifacts with coding agents — interactive demos, small programs, model visualisations — published into a Space. Genuinely compelling, and the reason the type field stays open. Blocked on sandboxing and moderation, so it waits.

Rules:
1. **Anchor is a pointer, never a copy.** Delete the Lesson, its contributions become orphaned — surfaced to the Owner *and* to each contribution's author; nobody's work vanishes silently.
2. **One contribution, one anchor.** No multi-anchoring in v1 — it makes the Community sections ambiguous.
3. **v1 accepts only low-risk types** (Markdown, PDF, image, link, practice set). Executable artifacts are out until sandboxing is designed.
4. Recognition works the same at every level: likes, and XP only on engagement (see rules above). A contribution's score is visible; the anchor level doesn't change the reward.
5. Contributions carry **both** labels: Origin (always Community) and Grounding (grounded / not grounded — shown only where grounding is on).

### Separation — Official vs Community must be unmistakable
Not subtle. A learner should never have to look twice to know who made something.

1. **Separate containers, never one merged list.** The path is one container; Community contributions live in their own clearly titled section on the same screen ("From the community · 104 contributions"). Ordering never interleaves them. In an Open Space the path itself holds Community-origin Lessons — there, the origin badge and author on each Lesson do the separating.
2. **Everything carries its real author** — name and avatar, always: Community items the Member who made them, Official content the Owner or Editor who made it. The Space card carries the Owner. Anonymous content is not allowed. If an author leaves the Space, their content and credit stay — same never-vanish pattern as orphans.
3. **The cosmic analogy does this work visually** — and it's the one place the theme earns its keep. The path is the **star and its planets**: the structure that lights up. Contributions **orbit** them — satellites around a planet. Same sky, obviously different bodies. Origin shows as a badge on the body, never as a different body. On the map you can see at a glance what the path holds and how much the community has built around it.
4. **Endorsed and promoted items are marked explicitly.** Endorsed = a checkmark, still community-authored, still in the community section. Promoted = it moved into the path, and the author's credit moves with it.

### Engagement — likes, stars, XP
Three signals, three different targets. No overlap:

| Signal | Target | What it is | Who gives it |
|---|---|---|---|
| **Like** | A contribution | One tap: "this helped." Unlimited. Sorts the community section. XP hangs off this. | Any member |
| **Star** | A whole Space | GitHub-style: "this is good, I want to find it again." Unlimited. Ranks Discover. | Anyone on the platform |
| **XP** | The person | The Learner's own progression. Earned from learning *and* from contributions that get liked, endorsed, or used. | The system |

Rules:
1. **A Like never touches a Space; a Star never touches a contribution.** Two words, two objects — a learner can't confuse rating a course with rating one summary inside it.
2. **XP from contributions is engagement-gated** — granted when a contribution is liked, endorsed, or used (v1: a practice set completed by another member). Never per post; the only exception is the one-time milestone bonus (first contribution in your account's history).
3. **You can't like your own contribution or star your own Space**, and self-engagement rings (mutual-liking pairs) are dampened, not punished. Likes are per-person-per-item, and **likes from members with zero progress in that Space grant no XP** — they still count and still sort. A liker must have actually learned something there: farming XP needs real learners, not just real emails.
4. **Ranks and the Ascent profile read from XP only.** Likes and stars are content signals; they don't have a second progression bolted on.
5. Like counts on contributions and star counts on Spaces are public. Authors see which of their work landed.

### Spaces are browsable like repos
Inspiration: a public code repo. You can look before you commit to anything.

1. **Every public Space has a public page** — visible without joining. Shows what's inside (lesson list, subject labels), who made it, member count, star count, and whether it's Guided or Open. This is what Discover links to; blind joins cause churn.
2. **Stars belong to whole Spaces — GitHub-style, unlimited.** Discover ranks by stars and active learners, never by upload count — so searching "machine learning" surfaces the versions people actually found useful, not the biggest dump of files.
3. **Joining is the only way in. There is no "copy this Space."** *(Rejected, with reason.)* Progress lives in a Membership — one person, one Space. A copy would be a second Space, so the same learner would have two progress records, two leaderboard positions, two half-lit maps, and no honest answer to "how far am I?" If someone wants their own arrangement of the material, they create a Space and add content to it; the shared-content case is served by joining and contributing.

### The two Space modes — restated plainly
| | **Guided** | **Open** |
|---|---|---|
| Who publishes Lessons | Owner/Editors only | Every member — Community origin, author shown |
| Path order | Fixed; Owner reorders | Fixed (publish order); Owner reorders |
| Contributions | On, in Community sections beside the path | Same |
| Owner control | Curates the path; can hide, endorse, promote | Same — hide, endorse, promote (incl. whole Lessons) |
| Fits | A university course with a real lecturer | A group learning a subject together |

Both use the same screens. The mode is a Space setting, switchable at any time, and the switch is lossless by construction: it changes only **who may publish going forward**. Existing Lessons keep their place, their origin, and everyone's progress — an Open Space that grew an official core flips to Guided without losing anything; flipping back simply reopens publishing.

## Source of truth — the grounding layer
Grounding is an Owner-controlled toggle, **off by default and dormant until switched on**. Turning it on nominates the **source of truth**: a set of published Lessons — default: every Official Lesson; the Owner can adjust the set. Selection is Lesson-level, never raw files (Rule 4: grounding reads from published Lessons' extracted content). Everything else in the Space then carries a relationship to that set. Binary, v1:

- **Grounded** — traces back to a truth-set Lesson and can point at where (a citation exists).
- **Not grounded** — no supporting passage found. Says nothing about correctness — quality judgment stays human (likes, endorsement). Shown as a quiet marker, not a warning.

*(Internally the field is nullable — null = check hasn't run yet; once grounding is on, the UI treats null as not grounded. If a distinct "extended" label ever earns its place, the data already supports it.)*

This one label applies uniformly to tutor answers, practice questions, and member contributions. The learner never has to ask what's trustworthy: everything on screen already says whether it's grounded or not.

Rules:
1. **Dormant until switched on.** While grounding is off — every fresh Space, most Open Spaces — no marker appears anywhere. A "not grounded" marker on everything would be a marker on nothing; the label only exists where there is a truth to trace to.
2. **Nothing is blocked. The system labels instead of forbidding.** Curiosity beyond the lesson is allowed everywhere — it's just honestly marked.
3. **The label lives in the UI, not in the prose.** The tutor answers in plain language and never narrates its own epistemics ("this is grounded in…"). The trust signal is chrome: a tappable citation, or a quiet marker for not-grounded. Calm, not defensive.
4. **Consistency is the whole feature.** Same marker, same position, everywhere content appears — reader, practice, community tab, search results. Inconsistent placement and learners stop trusting it.
5. **Strict mode is a per-Space option, off by default** (and requires grounding to be on). An Owner can restrict the learning path to grounded content only — for exam-relevant university Spaces. Open Spaces leave everything visible. (Not the same switch as Guided: Guided gates who may *publish* into the path — Origin; strict mode filters what may *stay* in it — Grounding.)
6. Grounding is orthogonal to Origin: a Community summary can be grounded; an Official Lesson *outside the truth set* can be not grounded. Truth-set Lessons are the reference itself — they carry no marker. Both labels always show wherever grounding is on.

## States
- **Lesson:** Draft → Processing → Needs review → Published → (Archived)
- **Space:** Active → Archived (archived = read-only, keeps progress, earns no XP)
- **Community contribution:** Published → (Endorsed) → (Promoted to Official) · or Hidden by Owner · or Orphaned (anchor deleted; surfaced to Owner and author)

## Open questions (parked, not blocking)
- Who can create a Universe, and is it verified? (Anyone → spam risk; verified-only → onboarding friction) → Admin panel doc
- Does a Universe have admin roles above Space owners? → Admin panel doc
- Name for the platform-wide map of all public Spaces ("Universe" is now taken; likely just "Discover")
- Modules/grouping when Spaces grow past ~20 lessons → P1
- What happens to member progress when a published Lesson is re-edited → P2 (versioning doc)
- What publishing a Lesson earns in an Open Space (it's not a contribution, so no likes and no contribution-XP by design) → Gamification doc
- **Routes** — member-made ordered routes through a Space's existing Lessons (a playlist, not a container: owns nothing, one Lesson can sit in several). Proposed for Open Spaces that grow large, e.g. a beginner Route and a maths-first Route over the same pool. Open: own object or a Space-anchored contribution? Likely P1 — only earns its place once a Space has enough Lessons to be worth routing through. *(Renamed from "Tracks" — the institutional axis example already uses "Track" as a grouping-level name, Rule 7. "Paths" rejected too: collides with the learning path.)*
