# One Library in German: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every word of chrome in the One Library (the shelf) and in Studio reads German when the app language is German. This is what slice 4 of `docs/V4_TRANSLATION_PLAN.md` did for the screens this branch replaced.

**Architecture:** Use the slice-4 pattern unchanged:
- `useTranslation('v4Library')`;
- keys say *what*, not where;
- i18next plurals for counts;
- dates and sizes through `src/features/spaces/i18n/format.ts`;
- English and German files kept in parity, enforced by `scripts/check-i18n-parity.cjs`.

Each task ends with a German render test that fails on leftover English chrome or raw keys. It is modelled on `src/features/spaces/components/__tests__/spaceGerman.library.test.tsx`.

**Spec:** `docs/V4_TRANSLATION_PLAN.md` (decisions table, house rules, "How it is built", "Guards"), plus `docs/V4_GLOSSARY.md`, which holds the words.

## Global constraints
- **Namespace:** `v4Library` only. Add keys under `library.*` (the shelf) and `studio.*` (the Studio canvas). Main's existing slice-4 keys for the old screens may be reused where the meaning is identical; otherwise leave them in place, because another session may still render them.
- **Parity:** every key exists in both `src/i18n/locales/en/v4Library.json` and `src/i18n/locales/de/v4Library.json`. `node scripts/check-i18n-parity.cjs` must pass.
- **German house rules** (`docs/BRAND_VOICE.md`, "German register"):
  - du, never Sie;
  - gender-inclusive forms;
  - no exclamation marks;
  - errors keep "wir" ownership;
  - Space stays "Space", Lesson is "Lektion", page is "Seite";
  - never Kurs, Vorlesung or Folie.
- **English stays word for word as it is today.** Hundreds of tests use `getByText('…')` in English and must keep passing unchanged. If an English test breaks, the extraction changed the English, so fix the extraction, not the test.
- **Counts:** `_one` / `_other` plurals, never `n === 1 ? …`.
- **Dates:** `format.ts` helpers, never `toLocaleDateString(undefined, …)`.
- **What stays English:** demo and mock content (filenames, sample text, scripted answers, the authored summaries in `mocks/`), plus material titles and quotes from a file. Only chrome is translated.
- **The vocabulary checker** (`node scripts/check-vocabulary.mjs <dir>`) stays clean on `src/features/spaces/studio`, `src/features/spaces/library` and `src/features/spaces/data`. The only allowed hits are the existing ones in `liveRepository.ts` and `useReader.ts`.
- **Gates:**
  - `npx tsc -p tsconfig.app.json --noEmit`;
  - `npx vitest run src/features/spaces --maxWorkers=2`;
  - the parity check;
  - `npx eslint` on the changed files.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The shelf in German

**Files:**
- `src/features/spaces/screens/LibraryScreen.tsx`
- every file under `src/features/spaces/library/`: Cover, ContinueCard, YourWords, BringIn, ZoomThrough, Journey, ShareSheet (ShareActions), SelectBar, toasts.ts, returnFocus.ts
- user-visible strings produced by `src/features/spaces/studio/shelf.ts` (journey and share words, life lines) and `src/features/spaces/data/useShelf.ts`, if any
- `src/features/spaces/studio/LibraryRedirects.tsx`, if it shows text
- the locale files

**Tests:**
- Rewrite `src/features/spaces/components/__tests__/spaceGerman.library.test.tsx` so it renders **this** shelf in German:
  - `ENGLISH_CHROME` lists this shelf's real English chrome (read it from the components);
  - the shelf is opened via its real route or screen;
  - it covers the filters, a cover with and without progress, Continue, Your words with an orphan ("Needs a new home"), Bring in, the Select bar, the Share sheet, and the toasts.
- Assert no leftover English chrome and no raw `library.`/`studio.` keys. Mirror the existing test's `said()`/`leftover()`/`rawKeys()` helpers.

**Shared states.** Main's slice 3 changed `components/states.tsx`: `Failed` and `Missing` now take *which* thing (`what="library"`) and pick a whole sentence, because German needs the noun's gender. `LibraryScreen.tsx:254` passes the free string `"your Library"` and no longer type-checks. Use `what="library"`, which already exists.

**Pure functions in `shelf.ts`** (life lines, share outcome words): if one returns a sentence, change it to return `{ key, params }` and render it with `t` (plan §"How it is built" 3). Keep its existing tests language-free by asserting on keys and params.

- [ ] Step 1: write the German test, and run it to see it fail on English chrome.
- [ ] Step 2: extract the strings into `v4Library` (English is identical to today), and add German.
- [ ] Step 3: the German test passes. All existing spaces tests still pass unchanged.
- [ ] Step 4: parity, vocabulary, tsc and eslint are green. Commit: `feat(i18n): the One Library shelf in German`.

### Task 2: Studio in German

**Files:**
- `src/features/spaces/screens/StudioCanvasScreen.tsx`
- everything under `src/features/spaces/studio/components/`: Composer, PagerPill, PageRail, Peek, OriginalPage, MorphSwitch, FullPageDialog, WovenAnswer, CanvasPage, RecallTerm, RecallFooter, ProgressRing labels, DepthDial and the rest
- `src/features/spaces/studio/answers/` (Blocks.tsx and the spec/fd labels a reader sees: Check, steps, compare)
- `src/features/spaces/studio/usePageNav.ts`, if it produces labels
- the locale files

**Tests:**
- Replace main's `src/features/spaces/components/__tests__/spaceGerman.studio.test.tsx`, which rendered the removed `LibraryStudioScreen`, with a test that renders **StudioCanvasScreen** in German. It must cover:
  - Learn, Source, Peek, the composer and an answer;
  - a playable answer block (Check);
  - Recall on (blanks, Knew it / Not yet, the footer);
  - the Depth dial at each depth;
  - the Share button and the Journey.
- It asserts no leftover English chrome and no raw keys. Scripted answer *content* and authored summaries are demo data and stay English. Exclude them the way the library test excludes notes.

**Shared states.** `StudioCanvasScreen.tsx:562` and `:566` pass `"this Material"` and `"Material"` to `Failed` and `Missing`, which no longer type-checks. Add `'material'` to both union types in `components/states.tsx`. Add whole sentences under `states.failed.material` and `states.missing.material` in `v4Spaces` (en and de), following the existing entries and the German noun's gender (das Material). Then extend `spaceGerman.states.test.tsx` to render both.

- [ ] Step 1: write the German test, and run it to see it fail.
- [ ] Step 2: extract the strings, and add German.
- [ ] Step 3: the German test passes. All existing spaces tests pass unchanged, including reachable, motion, modes, boundary and dead-ends.
- [ ] Step 4: gates green. Commit: `feat(i18n): Studio in German`.

---

## Not in scope
- **A native German read.** The plan requires one before shipping. It goes on the PR as a checklist item.
- **Slice 5** (Social, Profile and the rest) belongs to another session.
