# Learnstation v4 UI — backlog A–H implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (inline —
> this plan is executed in one context by design; see "Deviation" below). Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** Finish the v4 interface — Space routing and pager, Concepts, Space lifecycle,
notifications, avatar/Ascent, Home port, writable Notes, Studio sweep — mock-only, on
shapes the existing backend already serves.

**Architecture:** Everything reads through `src/features/spaces/data/useSpaces.ts`, the
single seam. Screens render through `<Scene>` (browse texture vs focus near-black).
Widgets use the shared `BentoCell`. Dense work uses `StudioShell`. No component imports
the old product; patterns are copied, never imported.

**Tech Stack:** React 18 · TypeScript · Tailwind · shadcn/ui · framer-motion 12 ·
react-router-dom · vitest + @testing-library/react · lucide-react · sonner (toasts).

**Spec:** `src/features/spaces/OVERNIGHT-PROMPT.md` (backlog + overnight rules)
and `src/features/spaces/BUILD-PROMPT.md` (method, locked decisions, gates).

## Deviation from writing-plans, stated deliberately

The skill's bite-sized granularity assumes a fresh engineer per task. This plan is
executed inline by the author with full context, so transcribing every component body
here would write the night's code twice and consume the time the build needs. What is
kept verbatim is the part that actually drives TDD and cannot be reconstructed later:
**the rule assertions, the exact file paths, and the interfaces between tasks.**
Implementations are specified by contract. This is a conscious trade, not an omission.

## Global Constraints

- **Vocabulary law.** Banned in UI copy: professor · student · teacher · instructor ·
  course · classroom · module · folder · lecture · LMS. Verify with
  `node scripts/check-vocabulary.mjs src/features/spaces`.
- **Like belongs to contributions; Star belongs to whole Spaces.** Never crossed.
- **No backend work.** Mock-only below `data/useSpaces.ts`. Every fixture mirrors an
  existing service shape; anything genuinely new gets `// NEEDS-BACKEND:` and a report line.
- **No imports** from `features/{courses,student,assignments}` or `pages/`. Allowed:
  `@/components/console`, `@/components/ui/*`, `@/lib/utils`, `@/lib/topicIcon`.
- **Calm is the default** (BUILD-PROMPT §4 table). Weight 700+ for page titles only.
- **Four gates before every commit:** `tsc -p tsconfig.app.json --noEmit`,
  `eslint src/features/spaces --quiet`, `vitest run src/features/spaces`, vocabulary.
- **Browser-verify before claiming done.** `preview_eval` assertion *then* screenshot.
- **One commit per letter.** Branch `claude/peaceful-rosalind-9d0e67`. Never push.

### Motion (motion.dev/docs/react-animation)

`framer-motion@12` *is* Motion post-rename, so these docs apply directly.

- **One rhythm globally.** Add a shared `transition` to the existing `MotionConfig` in
  `Scene`, alongside `reducedMotion="user"`. Motion already defaults to spring for
  transforms and duration-eased for opacity — do not hand-specify springs per component
  and end up with five different feels.
- **Variants, not per-item delays.** Parent declares named states; children inherit.
  Stagger with `delayChildren: stagger(0.04)` and `when: "beforeChildren"` rather than
  computing `delay: i * 0.04` at each call site. Applies to: Space rows, bento cells,
  notification items, Studio rows.
- **Gestures declaratively.** `whileHover` / `whileTap` instead of CSS hover classes
  where the element is a `motion` component. `whileTap={{ scale: 0.97 }}` gives the press
  feedback that is currently missing everywhere — a CRITICAL item in the ui-ux-pro-max
  ruleset (`scale-feedback`, 0.95–1.05 on press).
- **`AnimatePresence` for anything that unmounts**: the C dialogs, the D panel, and the
  H row-removal. Without it there is no exit and things vanish.
- **`height: "auto"`** is animatable — use it for the G note editor expanding, rather
  than a max-height hack.
- Everything above still passes through `reducedMotion="user"`, which kills transforms
  and keeps opacity. Never reintroduce per-component `duration: 0`.

## File structure

| Path | Responsibility | Letter |
|---|---|---|
| `screens/SpaceScreen.tsx` (modify) | tab → route | A |
| `screens/LessonScreen.tsx` (modify) | + pager | A |
| `components/LessonPager.tsx` (create) | prev/next edge-peek cards | A |
| `screens/ConceptScreen.tsx` (create) | one Concept | B |
| `mocks/concepts.ts` (create) | concept fixtures, mirrors `LectureConcept` | B |
| `components/SpaceDialogs.tsx` (create) | New Space + Join with code | C |
| `screens/SpaceManageScreen.tsx` (create) | Studio: settings + members | C |
| `components/NotificationPanel.tsx` (create) | bell popover | D |
| `mocks/notifications.ts` (create) | mirrors `{id,title,message,type,read,created_at}` | D |
| `components/Avatar.tsx` (create) | Luna-or-initials, one place | E |
| `screens/ProfileScreen.tsx` (modify) | + rank ring, journey slot | E |
| `screens/HomeScreen.tsx` (modify) | + hero kinds, recently viewed | F |
| `components/NoteEditor.tsx` (create) | write/edit a Note | G |
| `screens/LibraryStudioScreen.tsx` (modify) | row actions + undo toasts | H |

---

## Task A — Space routing + Lesson pager

**Files:** modify `screens/SpaceScreen.tsx`, `screens/SpaceRoute.tsx`, `src/App.tsx`;
create `components/LessonPager.tsx`; test `mocks/__tests__/navigation.test.ts`.

**Interfaces produced:**
```ts
// mocks/lessons.ts
export const adjacentLessons = (spaceId: string, lessonId: string):
  { prev: Lesson | null; next: Lesson | null };
```

- [ ] **A1 — failing assertions first**
```ts
it('gives every published Lesson a prev and next except at the ends', () => {
  const ls = publishedLessonsForSpace('s-dbs');
  expect(adjacentLessons('s-dbs', ls[0].id).prev).toBeNull();
  expect(adjacentLessons('s-dbs', ls[0].id).next?.id).toBe(ls[1].id);
  expect(adjacentLessons('s-dbs', ls.at(-1)!.id).next).toBeNull();
});
it('never pages into an unpublished Lesson', () => {
  for (const s of allSpaces) for (const l of publishedLessonsForSpace(s.id)) {
    const { prev, next } = adjacentLessons(s.id, l.id);
    for (const n of [prev, next]) if (n) expect(n.state).toBe('published');
  }
});
```
- [ ] **A2** Run `npx vitest run src/features/spaces` — expect FAIL (`adjacentLessons` undefined).
- [ ] **A3** Implement `adjacentLessons` in `mocks/lessons.ts` over `publishedLessonsForSpace`.
- [ ] **A4** Routes in `App.tsx`: `/v4/space/:spaceId/map`, `/members`, `/manage`.
      `SpaceScreen` reads the tab from `useParams`/pathname instead of `useState`;
      tab clicks `navigate()`. Tab order stays **Overview · Map · Members** (Abi's call).
- [ ] **A5** `LessonPager`: fixed bottom bar, prev/next cards peeking from the screen
      edges (PS-Store), ←/→ keys, `aria-label` naming the target Lesson. Hidden when
      both are null. Uses `LessonTile` art at reduced size.
- [ ] **A6** Verify in browser: assert `location.pathname` changes on tab click; assert
      ArrowRight moves to the next Lesson id; screenshot both.
- [ ] **A7** Gates ×4, then commit `feat(design-v4): route the Space tabs and add a Lesson pager`.

---

## Task B — Concept UI + Concept overview

**Files:** create `mocks/concepts.ts`, `screens/ConceptScreen.tsx`; modify
`mocks/lessons.ts` (concepts carry `weight`), `screens/LessonScreen.tsx` (chips link),
`src/App.tsx`; test `mocks/__tests__/concepts.test.ts`.

**Backend basis (real):** `conceptsService.LectureConcept {concept_id, name, weight,
slide_indices}` and `RelatedLecture {lecture_id, title, weight}`. The v4 `Concept` type
gains `weight` and a `lessonIds` list — both directly served today. Mastery maps from
`ConceptMasteryItem.mastery_score` → existing `ConceptProgress`.

- [ ] **B1 — failing assertions**
```ts
it('anchors every Concept to at least one Lesson', () => {
  for (const c of allConcepts()) expect(c.lessonIds.length).toBeGreaterThan(0);
});
it('never marks a Concept cleared inside an untouched Lesson', () => { /* as map.test.ts */ });
it('gives Concept-anchored contributions a Concept that exists', () => {
  const ids = new Set(allConcepts().map(c => c.id));
  for (const c of conceptContributions()) expect(ids.has(c.anchor.conceptId)).toBe(true);
});
```
- [ ] **B2** Run — FAIL. **B3** Add fixtures + `conceptById`, `contributionsForConcept`,
      and 2–3 Concept-anchored contributions (Doc 1 gives Concepts their own anchor;
      only Space and Lesson levels exist today).
- [ ] **B4** `ConceptScreen` at `/v4/space/:spaceId/concept/:conceptId`. Layout from the
      Ratings-Details inspo: focused object left, context behind. Shows name, state,
      the Lessons it appears in (links), practice for it, and the Concept-level
      community section. Browse surface.
- [ ] **B5** Lesson-screen Concept chips become links. **B6** Browser-verify + screenshot.
- [ ] **B7** Gates ×4, commit `feat(design-v4): add the Concept overview`.

---

## Task C — Space lifecycle

**Files:** create `components/SpaceDialogs.tsx`, `screens/SpaceManageScreen.tsx`;
modify `screens/SpacesScreen.tsx` (wire the two inert buttons), `data/useSpaces.ts`
(in-memory mutations), `src/App.tsx`; test `mocks/__tests__/lifecycle.test.ts`.

**Backend basis:** join codes exist on courses today. **`// NEEDS-BACKEND:` member
roles** (Owner/Editor/Member) are v4-new — mock and report.

- [ ] **C1 — failing assertions**
```ts
it('creates a Space that is Private and Guided by default', () => {
  const s = draftSpace({ name: 'Test' });
  expect(s.visibility).toBe('private');   // Doc 1: Private is the default for everyone
  expect(s.state).toBe('active');
  expect(s.viewerRole).toBe('owner');
});
it('keeps a mode switch lossless — Lessons, order and progress survive', () => {
  const before = lessonsForSpace('s-linalg').map(l => [l.id, l.order, l.progress]);
  expect(switchMode('s-linalg', 'guided').lessons.map(l => [l.id, l.order, l.progress]))
    .toEqual(before);                      // Doc 1: switching changes only who may publish
});
it('refuses to delete without an exact name match', () => {
  expect(canDelete(spaceById('s-linalg')!, 'wrong')).toBe(false);
  expect(canDelete(spaceById('s-linalg')!, 'Intro to Linear Algebra')).toBe(true);
});
```
- [ ] **C2** FAIL → **C3** implement helpers in `mocks/spaces.ts`.
- [ ] **C4** `SpaceDialogs`: New Space (name → mode → visibility, Private default) and
      Join with a code (code → preview card → Join). shadcn `dialog`. On success land on
      that Space's Overview (Doc 2 landing table).
- [ ] **C5** `SpaceManageScreen` at `/v4/space/:spaceId/manage`, **Studio** via
      `StudioShell`: rename, description, mode switch, grounding toggle, archive, and
      delete-behind-typed-name. Owner only — Members get the "not yours" empty state.
- [ ] **C6** Members management in the same screen: role change, remove, invite (join
      code + copy button). No approval flow — Doc 1 keeps three visibility levels.
- [ ] **C7** Browser-verify each dialog opens, submits, and lands. Screenshot.
- [ ] **C8** Gates ×4, commit `feat(design-v4): create, join and manage a Space`.

---

## Task D — Notifications

**Files:** create `mocks/notifications.ts`, `components/NotificationPanel.tsx`;
modify `components/SpacesTopBar.tsx`; test `mocks/__tests__/notifications.test.ts`.

**Backend basis:** exact shape of `NotificationBell`'s query —
`{id, title, message, type, read, created_at}` from the `notifications` table. New v4
kinds (`endorsed`, `new_lessons`, `friend_request`) are new **values** of `type`, not a
schema change. Say so in the commit.

- [ ] **D1 — failing assertions**
```ts
it('never renders a Space as a notification target', () => {   // Doc 2: Lessons/people only
  for (const n of notifications) expect(n.target.kind).not.toBe('space');
});
it('names the Space as context on Lesson notifications', () => {
  for (const n of notifications.filter(x => x.target.kind === 'lesson'))
    expect(n.target.spaceName.length).toBeGreaterThan(0);
});
it('counts only unread in the badge', () =>
  expect(unreadCount()).toBe(notifications.filter(n => !n.read).length));
```
- [ ] **D2** FAIL → **D3** fixtures + `unreadCount`, `markAllRead`.
- [ ] **D4** `NotificationPanel`: right-side panel per the Game-Invitations inspo —
      avatar + two-line item, unread dot, grouped by day, "Mark all read", empty state.
      shadcn `popover`. Bell shows a small count, never a red spam badge.
- [ ] **D5** Browser-verify open/close/mark-read + screenshot. **D6** Gates ×4, commit.

---

## Task E — Avatar + Ascent

**Files:** create `components/Avatar.tsx`; modify `SpacesTopBar.tsx`, `ProfileScreen.tsx`,
`badges.tsx` (`AuthorLine` uses it).

**Backend basis:** `profiles.avatar_url` + `luna_suit_color/visor_tint/patch` already on
the auth profile; `LunaAstronaut` already exists in `learnstation-luna`.

- [ ] **E1** `Avatar` — image → Luna → initials, in that order, one component everywhere.
      Import `LunaAstronaut` by the same path the old product uses; no new avatar system.
- [ ] **E2** Profile: rank ring around the avatar (recreate the ring in v4 — `RankRing`
      is old-product), plus a **labelled empty slot** for the cross-Space journey.
      Do **not** port `FullJourneyPath`/`SkillTreeView`: Doc 2 lists "two maps" as an
      open question. Report it.
- [ ] **E3** Browser-verify + screenshot. **E4** Gates ×4, commit.

---

## Task F — Home, ported from the dashboard

**Files:** modify `screens/HomeScreen.tsx`, `data/useSpaces.ts`, `mocks/library.ts`.

**Port** from `pages/StudentDashboard.tsx` + `features/student/homeFeed.ts`: hero-kind
logic (`onboard` / `review` / normal), Recently viewed as a rail, and an inline quick-check.
**Do not port:** Luna tour, onboarding banners, assignments panel.
**Rule:** Home links to Lessons and practice, never a Space card.

- [ ] **F1 — failing assertions**
```ts
it('never targets a Space from Home', () => {
  const ids = new Set(allSpaces.map(s => s.id));
  for (const i of [...homeFeed, nextAction]) expect(ids.has(i.lessonId)).toBe(false);
});
it('shows the onboard hero when there is nothing to continue', () =>
  expect(heroKind({ hasProgress: false, allDone: false })).toBe('onboard'));
it('shows the celebration hero when everything is done', () =>
  expect(heroKind({ hasProgress: true, allDone: true })).toBe('review'));
```
- [ ] **F2** FAIL → **F3** `heroKind` + recently-viewed fixtures.
- [ ] **F4** Wire the three hero kinds and the Recently viewed rail beneath the bento.
- [ ] **F5** Verify all three kinds render (force via `?mock=`), screenshot each.
- [ ] **F6** Gates ×4, commit.

---

## Task G — Writable Notes

**Files:** create `components/NoteEditor.tsx`; modify `LibraryScreen.tsx`,
`LessonScreen.tsx`, `data/useSpaces.ts`.

- [ ] **G1 — failing assertions**
```ts
it('keeps a Note private to its author', () =>
  expect(notes.every(n => n.authorId === viewer.id)).toBe(true));
it('keeps a Note readable after its Lesson is gone', () => {
  const n = addNote({ lessonId: 'l-does-not-exist', body: 'orphan' });
  expect(noteById(n.id)?.body).toBe('orphan');   // Notes never vanish
});
```
- [ ] **G2** FAIL → **G3** add `authorId` to `Note`, plus `addNote`/`updateNote`/`deleteNote`.
- [ ] **G4** `NoteEditor`: textarea, autosave on blur, character-count-free, Escape cancels.
      In Library rows (edit in place) and on the Lesson screen ("New note").
- [ ] **G5** Verify create → edit → persists across a filter change. Screenshot.
- [ ] **G6** Gates ×4, commit.

---

## Task H — Studio sweep

**Files:** modify `screens/LibraryStudioScreen.tsx`, `screens/SpaceManageScreen.tsx`.

- [ ] **H1** Wire row actions: Publish removes the row and fires a `sonner` toast with
      **Undo**; Delete likewise. Undo restores the row (in-memory).
- [ ] **H2** Confirm Studio/Learn separation holds: `SpacesTopBar` is absent from every
      `StudioShell` screen; Learn screens have no tables or multi-select.
- [ ] **H3** Verify a toast appears and Undo restores. Screenshot. **H4** Gates ×4, commit.

---

## Finally

- [ ] Walk the whole click-path in the browser: top bar → each destination → inward to a
      Lesson, a Concept, Manage, and back. Every route reachable without typing a URL.
- [ ] Write `src/features/spaces/OVERNIGHT-REPORT.md`: what shipped, screenshots taken,
      every `NEEDS-BACKEND` marker, every doc conflict found, what was skipped and why.
- [ ] Confirm tree clean, nothing pushed, main untouched.

## Self-review

**Spec coverage:** A–H each map to a task; §3's overnight rules appear as Global
Constraints; §4's goal condition is the "Finally" block. No spec section is unclaimed.

**Placeholders:** none — every task names exact files, real assertions, and a commit.
Implementation bodies are by-contract *by stated deviation*, not by omission.

**Type consistency:** `adjacentLessons` (A) is consumed only by `LessonPager` (A).
`Concept.lessonIds`/`weight` (B) extend the existing `Concept`; `ConceptProgress` is
reused, not redefined. `Note.authorId` (G) is additive. `Avatar` (E) replaces inline
initials in `AuthorLine` and `SpacesTopBar` — both call sites are listed.
