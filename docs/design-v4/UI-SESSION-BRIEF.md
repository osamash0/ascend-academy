# Brief · UI session

For the parallel session building the v4 UI. The docs session works from `01-foundations.md`; you work from this.
**`01-foundations.md` (Locked v1.15) is the source of truth. If this brief and that doc disagree, the doc wins — say so rather than guessing.**

## What Learnstation is

Anyone creates a shared study **Space**, uploads material, and learns with an AI tutor alongside other people. Reference model is Skool, not Coursera. The v4 design set is a rebuild of the product's vocabulary and structure.

## Scope of this session

Build the UI first, with mock data. Wiring to the backend comes later and is not your job yet.

1. **Foundation** — map the v4 design language onto the token layer that already exists. Do *not* rebuild shadcn.
2. **Spaces screen** — the list: Mine / Discover. A mockup already exists (`spaces-mockup.html`) and nine known gaps are written up (`notes-spaces-screen.md`).
3. **Space screen** — one Space: its ordered Lessons, community sections, members.
4. **Library** — see the warning under "Do not decide these" before you design this.

## The vocabulary law — the thing most likely to go wrong

One word, one meaning. These are **banned in all UI copy**:

> professor · student · teacher · instructor · course · classroom · module · folder · lecture · LMS

Use instead: **Universe · Space · Lesson · Material · Practice · Members · XP · Rank · Like · Star**, and for people **Learner** and **Creator** (descriptive copy words only — permissions are Owner/Editor/Member).

Two traps:
- **Like** belongs to contributions. **Star** belongs to whole Spaces. Neither ever applies to the other's object.
- The map draws a lesson as a star *shape*, but UI copy never calls it one — its label is the lesson's name.

The existing code is full of banned words (`features/courses/`, `features/student/`, `features/assignments/`). That is the old product. **Do not touch it, do not rename it, do not import from it.** Build in a new `features/spaces/` namespace. Old and new coexist.

## The objects you're rendering

| Object | What it is |
|---|---|
| **Universe** | Optional org (university, company). Gives a Space scoped discovery and branding. |
| **Space** | A shared study room for one subject. Holds Lessons, practice, members. Never contains another Space. |
| **Material** | An uploaded file. A Lesson is generated from it. Deleting it does *not* break the Lesson. |
| **Lesson** | The readable unit. Lives in a Space in a **fixed order**. |
| **Concept** | One idea inside a Lesson. |
| **Practice set** | Questions belonging to one Lesson. |
| **Contribution** | Member-made. One anchor: Space, Lesson, or Concept. Always shows its author. |
| **Note** | Private, anchored in a Lesson. Only its author sees it. |
| **Membership / Progress** | Per person, per Space. Progress is what lights the map. |

Two properties ride on content and both are always visible where they apply:
- **Origin** — Official (Owner/Editors) or Community (Members).
- **Grounding** — grounded / not grounded. **Dormant by default**: if the Owner hasn't switched grounding on, render *no marker at all*. A marker on everything is a marker on nothing.

## Rules that have visual consequences

1. **Official and Community must never blur.** Separate containers, never one merged list. Ordering never interleaves them. Every item carries its real author, name and avatar. No anonymous content.
2. **Two Space modes.** *Guided* — only Owner/Editors publish into the path. *Open* — **every Member can publish Lessons into the path**, carrying a Community badge and their name. Same screens for both; the only difference is who may publish. A Space card should show which mode it's in.
3. **Members only see published content.** Drafts and processing states belong to their author and the Owner/Editors.
4. **Path order is fixed in both modes.** Likes sort community sections; likes never reorder the path.
5. **No folders, ever.** Grouping is chips on a card and a group-by control. No empty containers to click into.
6. **Nothing is blocked, things are labelled.** Quiet markers, not warnings.

## Do not decide these — surface them instead

These are open questions the docs session is actively writing. If your design forces an answer, **stop and report it** rather than quietly picking one:

- **The Spaces ↔ Library line.** "Is my created Space under Spaces or Library?" is unresolved. You are building both surfaces, so you will hit this immediately. That is useful — a concrete collision beats an abstract argument — but report what you find, don't silently resolve it.
- **Learn mode vs Studio mode.** Every screen is meant to declare one (calm reading vs dense controls). Undecided.
- Where the galaxy map sits, and landing states after login/join/create.

## What already exists — use it, don't rebuild it

- **shadcn/ui** configured (`components.json`, aliases `@/components`, `@/lib/utils`), ~30 primitives in `src/components/ui/`.
- **Token layer** in `tailwind.config.ts` + `src/index.css`, CSS-variable based: `surface-1/2/3`, `primary` + `primary-dim`, `secondary`, `muted`, `accent`, `success`, `destructive`, `card`, `popover`. Extend these; don't invent a parallel system.
- **Stack**: React + TypeScript + Tailwind + Vite.

## Constraints

- **Mock data only.** No API calls, no Supabase, no backend imports. Put fixtures in `features/spaces/mocks/`. Wiring later should mean swapping the data source, not rewriting components.
- **Your own worktree and branch.** Never commit to `main` directly.
- Cover the states, not just the happy path: empty, loading/processing, archived, error. `notes-spaces-screen.md` lists the specific ones for the Spaces screen.
- Verify visually in the browser before claiming a screen works.

## Reference files

Absolute paths in the main checkout — readable from any worktree:

```
/Users/abdullahabobaker/Desktop/ascend-academy/docs/design-v4/
├── 01-foundations.md              ← source of truth, Locked v1.15
├── 01-foundations-map.html        ← the model drawn, five panels — open in a browser
├── spaces-mockup.html             ← the Spaces screen mockup
├── notes-spaces-screen.md         ← nine known gaps
├── HANDOFF.md                     ← project context, doc plan, locked decisions
└── README.md                      ← reading order
```

Read `01-foundations.md` first, then open `01-foundations-map.html` in a browser — five panels covering the object model, the two classification axes, Origin × Grounding, Guided/Open, and states.

## Working agreement with the docs session

- **The user will supply design resources.** Ask for them before committing to a visual direction.
- Docs session owns `docs/design-v4/**`. You own `src/features/spaces/**` and the token layer. Neither edits the other's territory.
- When you hit something the foundation doesn't answer, or something it answers *badly* once it's on screen, report it. Screens are where design docs get found out, and a flaw caught in your session costs a paragraph in the doc instead of a rebuild.
