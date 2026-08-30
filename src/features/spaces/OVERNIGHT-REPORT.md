# Overnight report · Learnstation v4 UI

*Run of `OVERNIGHT-PROMPT.md` backlog A–H, 2026-08-31. Branch
`claude/peaceful-rosalind-9d0e67`. Nothing pushed; `main` untouched.*

---

## Status: all eight letters shipped

| | Backlog item | Commit |
|---|---|---|
| **A** | Space tab routing + Lesson pager | `1608991` |
| **B** | Concept overview | `244724b` |
| **C** | Create, join and manage a Space | `2bc36ad` |
| **D** | Notifications | `72760cd` |
| **E** | Luna avatar + Rank ring | `004b1f3` |
| **F** | Home hero kinds + Recently viewed | `a30a575` |
| **G** | Writable Notes | `a95eeb7` |
| **H** | Studio row actions + mode guard | `7d9b4ce` |

Plus `70f760b` — the plan itself, at
`docs/superpowers/plans/2026-08-31-v4-ui-backlog.md`.

**Gates, all green at every commit:** `tsc -p tsconfig.app.json` · `eslint
src/features/spaces --quiet` · `vitest` · `check-vocabulary.mjs`.

**Tests: 47 → 101.** Every new rule a screen touches has an assertion.

## Routes — 14, all reachable by clicking

```
/v4/home                              /v4/space/:id
/v4/spaces                            /v4/space/:id/map
/v4/library                           /v4/space/:id/members
/v4/library/{uploads,drafts,impact}   /v4/space/:id/manage
/v4/social                            /v4/space/:id/lesson/:lessonId
/v4/profile                           /v4/space/:id/concept/:conceptId
```

Walked end to end without typing a URL:
`Spaces → Database Systems → Lesson 1 → pager → Lesson 2 → Concept → back`,
then all five destinations from the top bar. All 14 return 200.

## What the browser caught that the tests did not

Three defects, each found by driving the UI rather than by a passing suite.
Each now has a guard.

1. **Creating a Space navigated to a Space that did not exist.** `draftSpace`
   built the object and returned it; nothing registered it, so the landing
   404'd. Now `createSpace` registers into a session list kept *separate* from
   the fixture array — a mutable base array would make "covers every state"
   depend on whatever was last clicked.
2. **A saved Note hid its own text.** It collapsed to a button reading "Edit
   this note", so reading your notes meant opening every one. Closed is a
   note's *reading* state; it now shows the writing.
3. **The mode guard's first run was a false positive** — it matched
   `SpaceManageScreen`'s own doc comment saying the Learn bar is "deliberately
   absent". Comments are stripped before matching now, exactly as the
   vocabulary checker does. A rule that fires on the prose explaining it is a
   rule people switch off.

## NEEDS-BACKEND

Only one genuinely new capability was needed. Everything else mirrors a shape
the backend already serves.

- **Member roles (Owner / Editor / Member)** — `SpaceManageScreen`, marked in
  source. No counterpart in the current schema. Join codes *do* exist on
  courses today, so the invite half of that screen mirrors something real and
  the role half does not.

Mirrored rather than invented:

| v4 | Existing shape |
|---|---|
| Concepts, `weight`, "appears in" | `conceptsService.LectureConcept` + `RelatedLecture` |
| Notifications | the `notifications` row `{id,title,message,type,read,created_at}` |
| New notification kinds | new **values** of `type`, not a schema change |
| Avatar | `profiles.avatar_url` + `luna_suit_color/visor_tint/patch` |
| Uploads / drafts | `myMaterialsService`, `uploadBatchService` |

## Doc conflicts and open questions

Reported, not resolved — per §7 of the build prompt.

1. **Tab order.** Built as **Overview · Map · Members** (Abi's call,
   2026-08-30). Doc 2 §"Tabs inside a Space" says Overview · Members · Map.
   The docs should be amended or the build changed; the divergence is
   deliberate and recorded in the source.
2. **The two maps.** Doc 2's ten map rules are written for the per-Space map.
   `Ascent` holds a cross-Space journey (`FullJourneyPath`, `SkillTreeView`).
   Whether one inherits the other's rules is undecided, so Profile carries a
   **labelled empty slot** rather than a guess. This is the single largest
   piece of deliberately unbuilt UI.
3. **Concept-level contributions had no fixtures until now.** Doc 1 defines
   three anchors — Space, Lesson, Concept — but only the first two had data, so
   the Concept community section had never rendered against anything. It has
   fixtures now, which is what surfaced that the anchor was untested.
4. **Persistent chrome is unruled.** All five destinations are Learn ("minimal
   chrome"), but the top bar carries notifications, settings and sign-out.
   Still unanswered from the previous session.

## Deliberately not done

- **Practice** — every practice affordance is a button that does nothing. It is
  its own doc (Doc 6) and was not in the backlog.
- **⌘K search** — the trigger exists and is inert. `searchService.ts` exists, so
  this is wiring, not design.
- **Settings** — the top-bar gear is inert; Doc 2 puts Settings under Profile as
  a Studio screen.
- **Mobile** — nothing here has been checked below `sm`. Doc 2 lists the bottom
  bar and ⌘K-without-a-keyboard as open.
- **`FullJourneyPath` / `SkillTreeView`** — not ported, see conflict 2.

## Method notes

- **Fixture guards keep earning their place.** They have now caught eight real
  defects across two sessions. The pattern is: assert the *mock data* obeys the
  locked rules, because a fixture that breaks one produces a screen that looks
  right and is wrong.
- **`modes.test.tsx` is a new kind of guard** — it reads source rather than
  rendering, because the Learn/Studio rule is about *composition*: which chrome
  a screen may mount. A render test would need every screen's data and would
  still miss the one that imports the wrong bar.
- **Motion follows motion.dev** as instructed: variant propagation with
  `staggerChildren` instead of per-item delays, declarative `whileHover` /
  `whileTap`, `AnimatePresence` for anything that unmounts, animated
  `height: "auto"` for the note editor. All of it still passes through
  `reducedMotion="user"` in `Scene`, which drops transforms and keeps opacity.

## State

Working tree clean · 9 commits ahead of `main` on
`claude/peaceful-rosalind-9d0e67` · nothing pushed · `main` still at `8c641d4`.

Dev server on **5199**; `/v4/*` routes are `import.meta.env.DEV` only and cannot
be reached in a production build.
