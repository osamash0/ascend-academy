# v4 — Learnstation design docs

The design-doc set the product is being rebuilt against. Concept level, not implementation.
Moved here from `~/Downloads` on 2026-08-30 and the loose copies deleted — **`docs/v4/` is the only home for these files.**

## Read in this order

| File | What it is | Status |
|---|---|---|
| [HANDOFF.md](HANDOFF.md) | Session context: who you are in this project, the doc plan, locked decisions, what Doc 2 must settle. Read first. | current |
| [01-foundations.md](01-foundations.md) | **The source of truth.** Names for everything, who can do what, how content is structured. | Locked · v1.15 |
| [01-foundations-map.html](01-foundations-map.html) | The model drawn — five panels: object map, the two axes, Origin × Grounding, Guided/Open, states. Open in a browser. | draws v1.15 |
| [spaces-mockup.html](spaces-mockup.html) | Dark-mode Spaces screen mockup (Mine / Discover tabs). | feeds Doc 2 |
| [notes-spaces-screen.md](notes-spaces-screen.md) | Nine known gaps in the Spaces screen. | feeds Doc 2 |
| [01-foundations-map-styles.html](01-foundations-map-styles.html) | The three treatments the map's visual language was picked from. Kept as the record of why it looks like it does. | decided — B |

## Doc plan

1. **Foundations** — done, v1.15
2. **Navigation & modes** — next
3. Design tokens & components
4. Create pipeline
5. Space & reader screen
6. Practice
7. Home & Library
8. Gamification rules

Later: an admin-panel doc for the parked Universe questions.

## Rules for this folder

- Every doc follows the same shape: *What it is · Objects/Rules · States · Open questions*, with a version line and a one-phrase changelog at the top.
- Rejected ideas get written into the doc **with the reason**, so they don't come back.
- Rationale lives in conversation; the docs stay lean.
- After any doc edit, re-read for stale wording, duplicates and find-and-replace artifacts. This has bitten three times.
- The map's version stamp must match the doc. If `01-foundations.md` moves past v1.15 and the stamp doesn't, the picture is stale and the doc wins.

## Where v1.15 came from

A review of v1.11 found six problems; all six are fixed and locked. The blocker was Open mode: the doc promised members would build the path, but only Owners and Editors could add Lessons, so the path members were told to build was one they had no way to make. See `HANDOFF.md` for the full list and which version fixed each.
