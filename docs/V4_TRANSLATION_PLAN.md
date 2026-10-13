# Translating v4 — plan

*2026-10-11. Scope: everything a reader sees in `src/features/spaces` (the v4 app: Home, Spaces, the Space page, the reader, rehearsal, Library/Studio, Social, Profile, Settings). Status: decisions taken (Abi, 2026-10-11: "go with your recommendations") — the words are in `docs/V4_GLOSSARY.md`. **Slices 0–3 done**; slice 4 next.*

## Where we are

- **The rest of the app is already bilingual.** i18next with `en` + `de`, 18 namespaces in `src/i18n/locales/{en,de}`, a parity check that fails lint when a key exists in one language only (`scripts/check-i18n-parity.cjs`, run by `npm run lint`), and the test setup loads the real resources (`src/test/setup.ts`).
- **One preference drives both halves.** `profiles.preferred_language` sets the UI language (`useLanguagePreference`) and the language of AI answers on the server (`preferred_language()` → `write_in(locale, served)`, fixed on PR #83). So a German reader already gets German Explain, Ask, checkpoints, rehearsals and teach-back — inside English chrome.
- **v4 never joined.** No `useTranslation` anywhere under `src/features/spaces`: about **1,060 visible strings** in 78 components and screens — 577 in `screens/`, 171 in `components/reader/`, the rest spread over dialogs, tiles, states and the top bar. The biggest files: `SpaceManageScreen` (54), `LibraryStudioScreen` (46), `LessonFacesScreen` (43), `SettingsScreen` (41), `RehearsalScreen` (41), `SpaceDialogs` (41).
- **Some copy is generated in code, not JSX:** the Today plan and exam plan (`components/course/today.ts`, `examPlan.ts` — "Missed last time · …", "Rehearse A, B & C"), light words ("Tested right", "Fading"), relative times, and dates via `toLocaleDateString(undefined, …)`, which follow the *browser's* locale, not the app's.
- **v4 Settings has no language switch.**
- **The existing German uses the old vocabulary** — *Kurs*, *Vorlesung*, *Folie* — which v4's vocabulary rule bans in English (`scripts/check-vocabulary.mjs`: Space, Lesson and page). That checker reads `.ts/.tsx` only, not translation files.

## Decisions (taken 2026-10-11 — all as recommended)

| # | Question | Recommendation |
|---|---|---|
| 1 | German for **Space** | Keep **Space** (der Space, die Spaces) — it is the product's noun, like "Workspace"; *Raum* and *Bereich* collide with everyday words. |
| 2 | German for **Lesson** · **page** · **idea** | **Lektion** · **Seite** · **Idee**. Never *Vorlesung*, *Folie*, *Kurs* in v4. |
| 3 | Names of the learning moves | *Rehearse* → **üben** / **Probedurchlauf** ("Für die Prüfung üben"); *Checkpoint* → **Checkpoint** (loanword, like Quiz and Level); *Teach it back* → **Erklär's zurück**; *Night paper* → **Nachtpapier**; *Today* → **Heute**; *Fading* → **verblasst**. |
| 4 | AI-generated content in German | `BRAND_VOICE.md` still says generated quizzes and summaries "stay English for now". The reader now generates German for German readers. **Update that line** — the scoped-down first step is over. |
| 5 | What stays English | Demo data under `mocks/` (sample content, not chrome) and anything quoted from a deck. Lesson titles and idea names stay in the deck's language. |

House rules that are already decided (`docs/BRAND_VOICE.md`, "German register"): **du everywhere, never Sie**; gender-inclusive forms (*Studierende*, *Dozent:in*); no translated exclamation marks ("Gut gemacht."); errors keep "wir" ownership; split long sentences rather than mirror English rhythm.

## How it is built

1. **Namespaces by room, not one blob.** `spaces` (top bar, states, badges, dialogs, shared words), `reader` (LessonFaces + `components/reader`), `space` (Space page, Lesson page, rehearsal, plan, map), `library` (Library + Studio), `people` (Social, Profile, Person, Rank, Moments), `settings`. Each at most ~250 keys, so a translator can hold one in view.
2. **Keys say what, not where:** `reader.checkpoint.offer.title`, not `LessonFacesScreen.text12`. Counts use i18next plurals (`pages_one` / `pages_other`), never `n === 1 ? …`.
3. **Generated copy returns data, not sentences.** `planToday` / `planExam` keep returning steps, but `why` becomes `{ key, params }` (`{ key: 'plan.missed', params: { lesson, pages } }`) and the card renders it with `t`. The planners stay pure and their tests stay language-free.
4. **One formatting module** (`src/features/spaces/i18n/format.ts`): dates, weekdays, relative days ("in 20 Tagen", "gestern"), lists ("A, B und C") — all via `Intl.*` with `i18n.language`, never `undefined`.
5. **A language switch in v4 Settings**, writing `profiles.preferred_language` through the existing `useLanguagePreference` — so the UI and the AI answers switch together.
6. **Switching refetches AI content.** The reader hooks (`useExplain`, `useAsker`, checkpoints, teach-back) key on `i18n.language` as well as the page, so a reader who switches mid-Lesson is not shown cached English. (The server cache is already keyed by locale.)

## Slices — each one ships on its own

| Slice | What | Strings (approx.) | Done when |
|---|---|---|---|
| **0** ✓ | Plumbing: namespaces `v4Spaces/v4Reader/v4Space/v4Library/v4People/v4Settings` (en + de, parity-checked), `src/features/spaces/i18n/format.ts`, a Language section in v4 Settings (the app's one setting), every reader request carries `?lang=` (server prefers it over the profile), reader hooks and memos keyed on the language, `docs/V4_GLOSSARY.md`, `BRAND_VOICE.md` decision 4 | — | choosing Deutsch switches Settings and the reader's view tabs at once, and Explain answers in German (tested) |
| **1** ✓ | **Reader** — LessonFaces, strip, points, glass pill labels, checkpoint, teach-back, break care, night paper | ~215 (done: 197 keys) | a German reader finishes a Lesson without one English word of chrome — `readerGerman.test.tsx` renders the page, Text and Explain views, a checkpoint and a teach-back in German and fails on English chrome or a raw key. Still English there: the shared loading/error/not-found states (slice 3) and the older `/read` reader (`ReaderScreen`, `SourceView`, `ReaderRail`) |
| **2** ✓ | **Space page** — Today, exam plan + runway, map, journey, search, rehearsal, Lesson page | ~180 (done: 299 v4Space keys + badges and the Lesson pager in v4Spaces) | plan reasons read naturally in German (via `{key, params}`) — the planners return phrases (`components/course/phrase.ts`); four `spaceGerman.*.test.tsx` files render the live Space page, the map, the runway, rehearsal, the Lesson page and the demo Space page in German. Still English there: the shared states' sentences (`states.tsx` weaves an English `what` — slice 3 redesigns them as whole sentences per screen, since German needs the noun's gender) and the top bar |
| **3** ✓ | **Home, Spaces hub, top bar, mobile nav, states, dialogs** | ~200 (done: 351 keys — also the Space manage screen, idea and practice pages, and the older `/read` reader) | every empty, error and loading state in German — `states.tsx` now takes *which* thing (`what="lesson"`) and picks a whole sentence, since German needs the noun's gender; `spaceGerman.states.test.tsx` renders every one. Still English: the Home ask box's suggestion chips (demo assistant data) |
| **4** | **Library + Studio** | ~170 | — |
| **5** | **Social, Profile, Person, Rank, Moments, Settings, History** | ~250 | — |
| **6** | Guards (below) switched from warn to fail | — | CI fails on a new hard-coded string |

Slices 1 and 2 are where a German student actually spends their time; if only two ship this month, ship those.

## Guards — so it stays translated

- **No literal strings in v4 JSX:** an ESLint rule scoped to `src/features/spaces` (`i18next/no-literal-string`, JSX text + `aria-label` / `title` / `placeholder`), warn during slices 1–5, fail after.
- **Parity** — already enforced; the new namespaces join it automatically.
- **German vocabulary:** extend `check-vocabulary.mjs` to read the v4 `de` files and ban *Kurs, Vorlesung, Folie*, *Dozent* without `:in`, and *Sie* as address.
- **A German render test per room:** render each screen after `i18n.changeLanguage('de')` and assert no raw keys and none of a short list of English sentinel words in visible text.
- **The AI side follows the same register:** `write_in()` tells German prompts *du, never Sie*, gender-inclusive forms, no exclamation marks (the first German run said "Ordnen Sie …"; fixed on PR #83).

## Effort and order

About one focused session per slice for 1–5 (extract → key → translate → German pass), half a session each for 0 and 6. Translation drafts can be produced in the session; **a native German read of each slice before it ships** is the one step not to skip — compounds and register are where literal translation shows.

## Risks

- **Tests match English text.** Hundreds of v4 tests use `getByText('…')`. The test setup runs in English, so they keep passing; the German render tests are added, not swapped in.
- **Extraction churns big screens** (`LessonFacesScreen` is ~1,150 lines). Extract per slice, never all at once, so reviews stay readable and other sessions' work on the same screens rebases cleanly.
- **Length.** German runs ~30% longer; the strip label, pills and Today cards are tight. Each slice includes a phone-width check in German.
