# Overnight report · Learnstation v4 UI

*Branch `claude/peaceful-rosalind-9d0e67`. Nothing pushed; `main` untouched.
Two sessions: the A–H backlog (2026-08-30), then the finish-and-review pass
(2026-08-31).*

---

## Read this bit first

The backlog A–H shipped in the first session. The second session did three
things: **finished the three missing screens**, **ran a discovery cycle over
everything**, and **fixed what it found**.

The discovery cycle is the part worth your attention. It found 18 controls that
rendered enabled and did nothing, a draft Lesson that was being served to
anyone with the URL, three guards that could not fail, and a map that "fit" a
phone by becoming unreadable. None of it was visible in a screenshot and none
of it failed a test — which is exactly why the cycle exists.

Four questions you answered, all of which shaped the night:
Ascent inherits the map rules · full responsive pass · practice grants nothing ·
auto-fix and log.

---

## What is now built

**Twenty routes**, every one reachable by clicking.

```
/v4/home                              /v4/space/:id
/v4/spaces                            /v4/space/:id/map
/v4/library                           /v4/space/:id/members
/v4/library/{uploads,drafts,impact}   /v4/space/:id/manage
/v4/social                            /v4/space/:id/lesson/:lessonId
/v4/profile                           /v4/space/:id/lesson/:lessonId/practice
/v4/settings          NEW             /v4/space/:id/concept/:conceptId
/v4/person/:personId  NEW             ⌘K palette (global)
```

### The three screens that were missing

**Practice** — a focus surface. Console texture off, top bar off, one question
at a time. It explains every answer, right or wrong, because practice that only
says "wrong" teaches nothing. Per your call it **grants no XP and clears
nothing on the map**: it is a place to be wrong safely, and the moment it
scores you, you stop guessing honestly. A guard asserts the screen never
touches XP, rank, or map state.

**⌘K** — mounted once by the top bar rather than threaded through nine screens
as a prop, so the shortcut cannot silently work everywhere except the screen
that forgot. Groups by type, names the Space on every hit, never renders
content inline, and searches only what you can already see.

**Settings** — a Studio screen off Profile. No reduced-motion switch, because
one that could disagree with the OS is a bug with a label on it. Account
deletion is visibly not wired rather than faked.

### Ascent

Profile's labelled empty slot is filled. Your call was that it inherits the ten
map rules, so: a body is a Space, its light is the fraction of its path you
have cleared, order is time so the route reads as a history, and the palette is
identical — two maps disagreeing about what gold means would be worse than one
map. It does *not* inherit the boustrophedon layout, because rows would imply
an order between subjects that does not exist.

`maps.test.tsx` is what makes "inherits" mean anything rather than being a
comment the second map drifts away from.

### Mobile

Bottom bar with the same five destinations; the top bar drops its pills at the
same breakpoint. Every screen checked at 375×812.

---

## What the cycle found

`CYCLE.md` documents the method. Findings, by severity.

### 1. Drafts were served to anyone with the URL

Rule 1 — Members only see published Lessons — was real and enforced, in
`useSpace`. But `LessonScreen`, `ConceptScreen` and `PracticeScreen` each did
their own `lessonsForSpace(id).find(...)`, so `/v4/space/s-linalg/lesson/
l-s-linalg-4` rendered an unpublished Lesson to a stranger, with no Draft
marker anywhere on the screen. Three screens, one rule, and the rule lived
somewhere none of them looked.

Fixed at the level it lives at: `visibleLessonsForSpace(space)` takes the Space
rather than an id, so a caller cannot ask the question without having
established who is asking.

### 2. Eighteen controls did nothing

Not one was a typo. Each was written as a real control, styled as one, given an
`aria-label`, and left unwired because its destination did not exist yet. Two
carried `aria-pressed` and "Tap to remove" — a screen reader being told about a
state change that never happened.

Seven of the eighteen came from **three optional callbacks** in `states.tsx`.
Making them required turned all seven into compile errors at once. That is the
shape of most of these: a prop that was optional so it could be added later,
and later never came.

Like and Star are now self-wiring — they take an id instead of an optional
`onToggle`, so the unwired version cannot be written. Add Lesson and Contribute
open real dialogs that create real objects. Accept and Decline move people
between lists.

### 3. Three guards could not fail

- `map.test.ts` declared its own `const FOLD_THRESHOLD = 20` and asserted it
  against itself. Changing the real one turned nothing red — and the source
  comment told the next person the number was protected.
- The orphan guard ran `orphans.every(...)` over a list that never contained an
  orphan. `[].every()` is `true`. Three render paths — the warning border,
  "Your work is safe", "Needs a new home" — had never once executed.
- `studio.test.ts` sorted a one-element array against itself.

**Every guard written tonight was proved by reintroducing the defect and
watching it go red.** A test that passes is not the same as a test that works.

### 4. Fixtures contradicted each other

The bell announced an endorsement the contribution recorded as `endorsed:
false`, so Library, the impact table and the card badge all said it had not
happened. A second notification described a promotion into a Guided Space,
which `lessons.ts` states is impossible by definition, pointing at an Official
Lesson by someone else.

Library also hardcoded `'Normalization'` and `'s-dbs'` as the label for *any*
lesson-anchored contribution, in three places, and dropped Concept anchors
entirely — so ⌘K found a contribution that Library denied existed.

### 5. Accessibility had decayed

Sixteen icons exposed to screen readers, each beside the word it depicts.
`font-black` and `uppercase` back in five places. Raw `text-white/45` carrying a
Space tile's own progress line.

Two worth naming:

- **Studio ignored reduced motion entirely.** `reducedMotion="user"` lives in
  `Scene`, which only Learn screens go through. Settings cited that very
  mechanism as its reason for having no motion switch — in a file the mechanism
  did not cover.
- **The viewer had two faces.** Three call sites drew their own initials
  instead of mounting `Avatar`, whose own doc comment names this exact failure
  mode. You rendered as "Ab" in the Social friends stack and as Luna in the top
  bar two inches away.

### 6. The map "fit" a phone by becoming unreadable

The most interesting finding, because it passes every check that asks "does it
fit". At 375px the per-Space map scaled its 896-unit viewBox by 0.36 and turned
every label into **4.7px** of type. No overflow, no clipping, nothing to see in
a screenshot. Both maps now hold a legible floor and scroll in their own
container; labels read at ~11.5px.

---

## Numbers

| | Then | Now |
|---|---|---|
| Tests | 101 | **169** |
| Test files | 14 | 23 |
| Routes | 14 | 20 |
| Dead controls | 18 | 0 |
| Guards that cannot fail | 3 | 0 |

Four gates green at every commit: `tsc -p tsconfig.app.json` · `eslint
src/features/spaces --quiet` · `vitest` · `check-vocabulary.mjs`.

---

## Two process notes

**The four gates are four for a reason.** The icon sweep introduced a JSX
syntax error that all 154 tests passed straight through — the source-reading
guards read files as text and never compile them. `tsc` caught it.

**Guards need their false positives fixed immediately.** Three of the new ones
misfired on first run: a `>` inside a JSX expression, Radix `asChild`, and
`max-w-[140px]` matching a "pinned width" rule. A guard whose false positives
outnumber its real ones gets muted within a week, which is worse than not
having written it.

---

## Open questions and conflicts

Reported, not resolved.

1. **Promotion may be possible in Guided Spaces.** `lessons.ts` asserts a
   Community-origin Lesson in a Guided Space is "impossible by definition". But
   a promotion *is* the Owner publishing a member's contribution with credit,
   which is exactly what Guided mode allows. If the comment is too strict, the
   notification I deleted should come back. **This needs your call.**
2. **Tab order.** Built Overview · Map · Members (your call, 2026-08-30). Doc 2
   says Overview · Members · Map. Docs should be amended or the build changed.
3. **Origin badge visibility.** `badges.tsx` says the Origin badge is "never
   optional where content appears"; `LessonRow` gates it behind Open mode and
   argues the opposite in its own comment. Two comments, incompatible rules,
   nothing adjudicating. In practice no Guided Space shows an origin marker, so
   "Official" has never rendered on a Lesson row at all.
4. **Persistent chrome is unruled.** All five destinations are Learn ("minimal
   chrome"), but the top bar carries notifications, settings and sign-out. Open
   since two sessions ago.

## Still not done

- **A reader.** There is no reading view and the fixtures carry no prose, so a
  Lesson's "Start" opens its first idea instead. Marked `NEEDS-CONTENT`.
- **`LessonTile`** exists and nothing imports it. Its five states have never
  rendered.
- **States with no fixture** — the map's fold, `SpaceTile`'s "Done" badge, the
  `achievement` notification kind, `Avatar`'s image branch, six of seven
  Members tabs (which currently print "1,204 Members" over an empty list).
  These are code paths that have never executed; the full list is in the
  session transcript.
- **NEEDS-BACKEND** — member roles, account deletion, sign-out, real uploads.

## State

Working tree clean · 20 commits ahead of `main` · nothing pushed · `main` still
at `8c641d4`. Dev server on 5199; `/v4/*` is `import.meta.env.DEV` only.
