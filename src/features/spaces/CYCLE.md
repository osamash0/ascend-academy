# The cycle

*Discover → Build → Test → Review. A repeatable pass over the v4 UI.*

Every defect found in this project so far was found by one of three methods,
and never by reading the code hoping something would look wrong. The cycle is
those three methods written down so they run on purpose instead of by luck.

---

## Why a cycle and not a checklist

A checklist asks "did I do the thing?". This asks "what is this screen lying
about?" — and the difference matters, because every real defect here looked
correct at the time it was written:

- The top bar and the leaderboard each stated the viewer's rank. Both right.
- `createSpace` returned a Space and navigated to it. The Space did not exist.
- A saved note collapsed to a button reading "Edit this note". Perfectly clear,
  and it hid every note's contents behind a click.
- The map's unlit labels were 4.18:1. They looked *fine*.

None of these would fail a checklist. All four fall out of a question.

---

## Step 1 — Discover

Interrogate each screen with the fixed question set below. The set is fixed on
purpose: a question you invent while looking at a screen is a question shaped
by what you already believe about it.

### A. Two sources for one fact
Does any value on this screen exist in more than one place? A count, a rank, a
title, a member total. If two places state it, they can disagree, and both will
look right.

> Caught: `rank = 'Rank 1', xp = 60` in the top bar vs `leaderboard`.
> Caught: `lessonCount` vs the actual fixtures — "0/23 LESSONS" over "0 Lessons".

### B. Claims the build cannot back
Does any copy promise something the code does not do? Compliance, security,
"always", "never", "instantly". Naming a regulation is a promise.

> Caught (v3 audit): a privacy page asserting GDPR compliance the product
> did not have.

### C. Dead ends
Click every control. Which do nothing? Of those, which *look* like they should?
A disabled control that says why is fine. An enabled control that silently does
nothing is the defect.

> Caught: the gear, ⌘K and every Practice button — inert for two sessions.

### D. States that were never rendered
Empty, loading, error, one item, one hundred items, the longest string in the
fixtures, a null relation. Which of these has this screen actually been seen in?

> Caught: `material: null` made every row say "Source file removed".
> Caught: the Concept community section had no fixtures, so it had never
> rendered against anything at all.

### E. Rules stated somewhere and enforced nowhere
Take each locked rule that touches this screen. Where is it enforced — by
construction, by a guard, or by remembering? "By remembering" is the answer
that costs later.

> Caught: browse/focus was a convention until `Scene` made it a type.

### F. Accessibility (§5.3)
Contrast of *every* text tier against what is actually behind it — composite
the alpha over the real backdrop, not over the card. Hit targets ≥24×24.
Decorative icons `aria-hidden`. Focus visible and ordered. Motion via
`reducedMotion="user"`, never a second switch.

> Caught: unlit map labels at 4.18:1, an AA failure that looked deliberate.

### G. Vocabulary
Run the checker. Then read the screen out loud — the banned words are the easy
half; the tell is a sentence that sounds like an LMS.

### H. Guards that cannot fail
For each existing guard on this screen: if the bug came back, would it catch
it? A guard that has never been seen to fail is not known to work.

---

## Step 2 — Build

Fix what has an obvious right answer. Anything about taste gets written into
the report and left alone.

The fix goes at the level the defect lives at. Two sources for one fact is
fixed by deleting a source, not by making them agree.

---

## Step 3 — Test

Add a guard so the defect cannot come back. Prefer, in order:

1. **By construction** — make the wrong thing unrepresentable. `Scene` taking a
   `Surface` beats a comment asking people to remember.
2. **Fixture guard** — assert the *mock data* obeys the rule. A fixture that
   breaks one produces a screen that looks right and is wrong. This has caught
   more real defects here than any other kind.
3. **Source guard** — for composition rules ("which chrome may this screen
   mount"), read the source. Strip comments first: a rule that fires on the
   prose explaining it is a rule people switch off. That trap has now been hit
   three times — `modes.test.tsx`, the vocabulary checker, and the
   reduced-motion guard in `settings.test.tsx`.
4. **Render test** — last, because it needs data and still misses the screen
   that imported the wrong thing.

---

## Step 4 — Review

**Prove the guard fails.** Reintroduce the defect, watch the test go red, put
it back. This is the step that is always tempting to skip and is the only
reason to trust any of the others.

> `Scene.test.tsx` was proved this way: reintroducing the remount bug turned
> 3 of its 4 assertions red. Before that it was a test that passed, which is
> not the same as a test that works.

Then log it — what was found, what was changed, which guard now holds it, and
whether the guard was seen to fail.

---

## Running it

Four gates must be green at every commit:

```
npx tsc -p tsconfig.app.json --noEmit     # tsconfig.json checks nothing
npx eslint src/features/spaces --quiet
npx vitest run src/features/spaces
node scripts/check-vocabulary.mjs
```

Then drive the screen in the browser. Assert with `preview_eval` *first* and
screenshot second — a screenshot shows you what you expected to see.

Findings land in `OVERNIGHT-REPORT.md` under the pass that found them.
