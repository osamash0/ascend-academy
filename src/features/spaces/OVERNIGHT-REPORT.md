# Overnight report · Learnstation v4 UI

*Branch `claude/peaceful-rosalind-9d0e67`. Nothing pushed; `main` untouched.
Three passes: the A–H backlog, the finish-and-review pass, and the pass that
worked this report's own backlog to zero.*

---

## Read this bit first

**Everything this report previously listed as "still not done" is done**, with
one exception that is a decision rather than a task — see *Needs your call*.

The last pass closed the six items it had been carrying: the Members tab, the
never-rendered states, loading and error on every screen, the namespace
boundary, three unmounted components, and the reader. It also found nine more
defects on the way, because closing a gap is the most reliable way to discover
the next one.

---

## What is built

**Twenty-one routes**, all reachable by clicking.

```
/v4/home                              /v4/space/:id
/v4/spaces                            /v4/space/:id/map
/v4/library                           /v4/space/:id/members
/v4/library/{uploads,drafts,impact}   /v4/space/:id/manage
/v4/social                            /v4/space/:id/lesson/:lessonId
/v4/profile                           /v4/space/:id/lesson/:lessonId/read
/v4/settings                          /v4/space/:id/lesson/:lessonId/practice
/v4/person/:personId                  /v4/space/:id/concept/:conceptId
                                      ⌘K palette (global)
```

### The reader

The last surface, and the one everything else points at — every other screen is
a way of choosing what to read. A focus surface: texture off, top bar off, one
column and a way out.

A passage per Concept, so the reader walks the same objects the map lights
rather than a parallel structure in the same Lesson. Real prose for
Normalization, because it carries the most fixtures and a reader is a
typography surface where filler lies about line length and rhythm. Where a
Lesson is unwritten it says so.

It changes no progress. Marking a Concept read on scroll would invent a
progression rule, and Doc 1 locks progression to XP awarded by the engine.

### Everything else that closed

- **The Members tab.** Six of seven Spaces printed "1,204 Members", an empty
  list, and "Showing 0 of 1,204" — three contradictory statements, none of
  which failed anything. Every joined Space has members now; an unjoined one
  says why you cannot see them.
- **All four states on all twelve screens.** Eight never called `useScenario`,
  so `?mock=loading|error` was a silent no-op — the states were not unreviewed,
  they were unreachable.
- **The namespace boundary**, which had no enforcement at all.
- **Eight code paths that had never executed**, given fixtures.
- **Three components nothing imported**, given call sites.

---

## What the cycle found, across all three passes

`CYCLE.md` documents the method. The ones worth knowing about:

**Drafts were served to anyone with the URL.** Rule 1 was enforced in
`useSpace`, but three screens did their own lookup and bypassed it.

**Eighteen controls rendered enabled and did nothing.** Seven traced to three
optional callbacks in one file; making them required turned all seven into
compile errors at once.

**Four guards could not fail.** One compared a constant to a copy of itself;
one ran `.every()` over a permanently empty array. Every guard written since
has been proved by reintroducing the defect and watching it go red.

**The map "fit" a phone by becoming unreadable** — 4.7px labels, no overflow,
nothing to see in a screenshot.

**Counts disagreed in five places.** The join preview promised 12 Lessons where
the Space showed 11. The bell announced an endorsement the contribution denied.
Library hardcoded one Lesson's name as the label for every Lesson. Linear
Algebra said 0 Lessons done while its own path had one finished — that last one
was caught by a guard written minutes earlier for something else.

**Studio ignored reduced motion entirely**, while Settings cited that very
mechanism as its reason for having no motion switch.

---

## Numbers

| | Start of the night | Now |
|---|---|---|
| Tests | 101 | **211** |
| Test files | 14 | 29 |
| Routes | 14 | 21 |
| Dead controls | 18 | 0 |
| Guards that cannot fail | 4 | 0 |
| Screens with all four states | 4 | 12 |
| Unmounted components | 3 | 0 |

---

## Three process notes

**The four gates are four for a reason.** An icon sweep introduced a JSX syntax
error that all 154 tests passed straight through — the source-reading guards
read files as text and never compile them. `tsc` caught it.

**I turned a gate off twice, two different ways.** Once by piping
`check-vocabulary.mjs` into `tail` (the exit code becomes `tail`'s), once by
putting the gates and the commit on separate lines instead of one `&&` chain.
Both times the gate went red, printed its failure on screen, and the commit
landed anyway. Both are now in `CYCLE.md` with the correct invocation.

**Guards need their false positives fixed on the first run.** Six misfired
initially — a `>` inside a JSX expression, Radix `asChild`, `max-w-[140px]`
matching a pinned-width rule, and three that fired on the prose explaining
them. A guard whose false positives outnumber its real ones gets muted within a
week, which is worse than never writing it.

---

## Needs your call

**One question, and it is the only thing blocking a clean sweep.**

`lessons.ts` asserts that a Community-origin Lesson in a Guided Space is
"impossible by definition". On the strength of that comment I deleted a
notification announcing exactly that. But a promotion *is* the Owner publishing
a member's contribution into the path with credit — which is what Guided mode
allows, and the promotion story Doc 1 describes.

If the comment is too strict, the notification should come back and the comment
should go. If it is right, the `promoted` notification kind has no possible
fixture and should be removed from the union.

## Still open (reported, not resolved)

1. **Tab order.** Built Overview · Map · Members (your call, 2026-08-30); Doc 2
   says Overview · Members · Map.
2. **Origin badge visibility.** `badges.tsx` says the badge is "never optional
   where content appears"; `LessonRow` gates it behind Open mode and argues the
   opposite in its own comment. In practice "Official" has never rendered on a
   Lesson row.
3. **Persistent chrome.** All five destinations are Learn ("minimal chrome"),
   but the top bar carries notifications, settings and sign-out.
4. **What reading does to the map.** The reader deliberately changes no
   progress rather than inventing a rule.

## Genuinely not built

- **Prose for every Lesson but one.** Content work, not design work; the
  surface exists and the empty case is handled.
- **NEEDS-BACKEND** — member roles, account deletion, sign-out, real uploads.
  Each is visibly not wired rather than faked.

## State

Working tree clean · 30 commits ahead of `main` · nothing pushed · `main` still
at `8c641d4`. Dev server on 5199; `/v4/*` is `import.meta.env.DEV` only and
cannot be reached in a production build.
