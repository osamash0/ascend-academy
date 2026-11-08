# How it's landing, Plan 3 PR B: the owner's door, live in v4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person who runs a Space opens "How it's landing" from the Space's masthead and reads the real, server-made view of it: Luna's one line, the figures, the map with pages too few people have reached drawn as outlines, and nothing that counts or names anyone.

**Architecture:** One pull request on top of PR A (#175, merged and deployed). Two small backend changes to the landing payload (a page under the floor is `null` in `help`; the Space's `reach` replaces its reader count) ship with the frontend that reads them. The frontend first fixes the door's own shapes on fixtures (reach, outlines, traps first, questions as Plan 4 will send them), then adds the live seam (`data/landing.ts` calls `GET /api/v1/v4/spaces/{id}/landing` and draws the colours client-side), the door's loading/error/empty states, the owner-only route `/v4/space/:spaceId/landing` behind `SpaceOwnerGate`, the masthead pill, and a copy pass. Live answering of questions is Plan 4's and is left out.

**Tech Stack:** FastAPI + Pydantic v2, pytest (backend `landing_map.py`, `v4_landing_service.py`); React 18 + TypeScript + Vite, react-router-dom 6, motion/react, react-i18next (en+de), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` (§0, §4 Phase C rows C1 to C7, §6, §7 direction E, §8 "Decided" including the fold rules). Starting point: `docs/superpowers/plans/2026-11-05-how-its-landing-plan-3-door-in-v4.md`, section "PR B: the door in v4" (Tasks 9 to 16), re-verified here against `origin/main` @ `68bf5752`. Plan 4 (not built): `docs/superpowers/plans/2026-11-05-how-its-landing-plan-4-questions.md`, section "Contract with Plan 3".

## Abi's decisions this plan builds against (2026-11-06)

1. **Faint outline for pages under the floor (story 5).** A page fewer than `MIN_READERS` people read is `null` in `lessons[].help`, never `0`. The door draws a `null` cell as a 1px white outline at about 25% opacity, no fill, the height of a quiet cell, not clickable. A dark (filled) cell then always means landing. The map's lede gains one sentence about outlines, en and de.
2. **Luna's floor line says no count:** "A few people have been reading. Patterns show once five people have been through a page." (de, du). The top-level reader count is not shown anywhere on the door.
3. **Traps first** is live in the engine (PR A Task 4b). The demo fixtures follow: the trap leads.
4. Already done, not re-planned: `lessons[].readers` is off the wire; the per-person routes are gone; the legacy floor work is done.

## What the code says today (verified on `origin/main` @ `68bf5752`, 2026-11-06)

| Piece | State | Evidence |
|---|---|---|
| C1 route + gate | **Not built.** `/v4/space/:id/landing` falls into `:tab` and renders `CourseScreen` (live) or the demo `SpaceScreen`. | `src/App.tsx:466-470`; `src/features/spaces/screens/SpaceRoute.tsx:19-29` |
| C2 pill | **Not built.** The copy exists: `v4Landing:door.pill`. The Rehearse link is a lone `Link` in the masthead. | `src/features/spaces/screens/CourseScreen.tsx:173-180` |
| C3/C4 door | **Built on fixtures** (direction E, fold rules, Questions above the map, Answered fold). Non-ready states all render `NotFound`. | `src/features/spaces/landing/LandingScreen.tsx:39-46` |
| C5 seam | **Demo only.** No live branch, no loading, error or retry. | `src/features/spaces/data/landing.ts:18-33` |
| C6 seam ratchet | Walks `screens`, `components`, `studio`; not `landing`. `landing/` imports no mocks today. | `src/features/spaces/__tests__/seam.test.ts:26` |
| Wire `help` | `0.0` under the page floor, the same as a landing page. Story 5 is the one strict xfail left. | `backend/services/insights/landing_map.py:33-52`; `backend/tests/unit/test_landing_stories.py:197-208` |
| Wire `readers` | Top-level count, used by the frontend only to tell floor from not (`ledeKey`) and to count in `door.lede.floor_*`. | `backend/services/v4_landing_service.py:115`; `landing/copy.ts:31-36`; `LandingScreen.tsx:49,61` |
| Frontend `LandingLesson.readers` | **Still required in `types.ts`** although the wire dropped it in PR A. Nothing on the door reads it; the lab's old directions A to D (`src/pages/landingMockups/*`) do. | `landing/types.ts:40-41`; `MockupTiles.tsx:120`, `MockupPath.tsx:98`, `MockupCovers.tsx:93`, `MockupV4.tsx:118` |
| `LandingQuestion.asker` | A full `Person` (id, avatar). Plan 4's contract sends `{ name } \| null` and a separate `answered` list. | `landing/types.ts:96-105`; Plan 4 "Contract with Plan 3" |
| Fixture ranking | Hotspot before trap in both `DBS_INSIGHTS` and `BIG_INSIGHTS`; the demo reads `insights[0]` as given. | `src/features/spaces/mocks/landing.ts:67-87, 268-270` |
| Engine thresholds the copy cites | `confusion_block`: each page ≥ 25% of raters foggy (`detectors.py:236`). `overpacked`: ≥ 30% foggy and 1.5× dwell and (help rate ≥ 0.3 **or** erratic dwell) (`detectors.py:35-56`). `quiz_misalignment`: under 50% first-try share over practice **and** checkpoint tries (`space_facts.py:97-119`). `healthy` (collapsed per Lesson, `landing_map.py:118-129`): a page with ≥ 25% foggy that ≥ 75% then got right first try (`detectors.py:337-350`). | as cited |
| `/api/analytics/*` professor gate (#176) | Does not touch the door: `GET /api/v1/v4/spaces/{id}/landing` depends only on `verify_token` + `assert_space_owner`. | `backend/api/v1/v4_landing.py:33-37`; `backend/main.py:274-275` |
| `/v4/space/:id/manage` | Redirects to the classic manager (personal Space: `/v4/library`). OwnerBar's comment still promises "analytics" there. | `screens/SpaceManageScreen.tsx:127`; `components/course/OwnerBar.tsx:14-21` |

## Decisions this plan makes (read before executing)

1. **`reach` replaces `readers` on the wire, three-valued: `'none' | 'few' | 'enough'`.** Ruling on "keep `readers`, or a `belowFloor` boolean":
   - The door needs exactly one fact from it: which line Luna says. A count says more than that; in a Space of two, `readers: 1` is a person, which is why Abi took the count out of the copy. Leaving it in the payload keeps the decision in the copy only, one edit away from coming back (it already came back once, the 2026-11-05 open question).
   - A boolean is not enough: with **zero** readers Abi's line ("A few people have been reading") would be false, and zero is the commonest real state (a new Space with Lessons, nobody in yet; real usage is near zero). So the wire says `none`, `few` or `enough`, and Luna has one line for each side of the floor. The zero line is new copy: "Nobody has been reading yet. Patterns show once five people have been through a page." (Open question 1.)
   - Cost is small: the backend changes in this PR anyway (decision 1), the cache version bumps once (Task 1), and nothing live reads the endpoint before this PR's frontend ships.
   - `floor` stays on the wire unchanged (a constant, harmless); nothing on the door reads it after Task 3.
2. **One key, not plurals, for the floor line.** `door.lede.floor_one` / `floor_other` become `door.lede.floor`, and `door.lede.none` joins it. The line has no number in it, so two plural forms with identical text would be two keys to keep in sync that suggest a count is coming. `LandingScreen` stops passing `count` to the lede altogether (no lede uses it).
3. **The outline.** `null` in `help` is an outline cell: `border border-white/25`, no fill, `h-6` (the quiet cell's height), `aria-hidden`, no link. `cellColor` returns no colour for `null`. Consequences, ruled here:
   - A Lesson above its floor can have outlined pages (people stopped, or only some reached the end). It is drawn, its light still comes from its findings (`calm` when there are none).
   - **A Lesson with any outlined page is never folded into "N Lessons landing".** The fold line claims landing; an outline is not landing. Such a Lesson is always drawn, so its outlines show.
   - The map's lede adds the outline sentence **only when the map draws an outline** (`lessons.mapLedeOutlined` vs `lessons.mapLede`): a legend for nothing on screen would describe something the screen does not do.
   - Findings never sit on an outlined page (every finding needs 5 readers on its pages, `space_engine.py:143-145`), so lit and outlined never meet.
4. **Questions arrive in Plan 4's shape, and live mode offers no action that does nothing.**
   - `LandingQuestion.asker` narrows to `{ name: string } | null` (Plan 4 Decision 2: a name, never an id or a face). The row's mark is the same quiet ring for everyone: the name's first letter, or "?" for Someone. Fixtures follow. (Open question 2.)
   - The seam merges Plan 4's `questions` (waiting) and `answered` lists into the one `questions` array the screen already splits by `answer`. Both are optional; absent means `[]`, and the door then draws no section.
   - **The Answer button is hidden in live mode** (not demo-only-but-shown): `useLanding` returns `answer` only in the demo build, and `QuestionsRow` draws Answer only when it gets `onAnswer`. Until Plan 4 ships, live questions are `[]` anyway; when Plan 4's backend sends them before its composer lands, they show read-only, each still opening its page. Plan 4 then supplies the live `answer` (its contract asks for `Promise<void>`; the optional prop takes that change without touching the row).
   - Old Task 15 (live answering) is **out of PR B**; it belongs to Plan 4.
5. **Fixtures never render in a live build.** The old Task 10 let demo ids through the gate on `!isLive(id)`, which in production (live mode, a non-UUID id) would render the Database Systems fixture at `/v4/space/s-dbs/landing`. Here fixtures are read only when `liveWorld() === null` (the demo build, as `ConceptScreen.tsx:51` and `HomeScreen.tsx:134` decide it); a live build shows "That Space isn't here" for a demo id.
6. **Colour** (unchanged from Plan 3 Decision 5): `accent = stageAccentFor(spaceName.length)`, as `SpaceScreen.tsx:187,204` and `PracticeScreen.tsx:81` do; `lessons[].color = stageAccentFor(order)`, as the fixtures do. The wire's `order` is 1-based by `created_at` (`sources/space.py:114-121,215`), the same order `CourseScreen` draws (`v4_reader_service.py:147,162`). `sampleAccent` at ingest stays a follow-up.
7. **`/v4/space/:id/manage` stays as it is.** OwnerBar's doc comment stops promising analytics there; no behaviour changes.
8. **No new flag.** The door is reachable only by a Space's owner, only from its masthead; the endpoint is mounted under `FEATURE_V4` (on in prod).
9. **`LandingLesson.readers` becomes optional, documented as lab-only.** The wire type omits it, the door never reads it, and the lab's old directions A to D keep drawing it from fixtures. Deleting those mockups is not this PR's call.
10. **No migration.** Nothing in this PR touches SQL; Task 12 checks `git diff --stat origin/main -- supabase/` is empty.

## Global Constraints

- No member is ever shown one by one. The only names an owner sees are on Questions a learner chose to send (spec §8.1).
- `MIN_READERS = 5` (`backend/services/insights/space_engine.py:25`) is the floor for every share the door prints. The owner's own reading never counts.
- The backend emits kinds and numbers, never English copy (spec B5). Payload keys are camelCase.
- `src/features/spaces` imports only what `src/features/spaces/__tests__/boundary.test.ts` allows: `react-i18next` and `@/i18n` yes, `i18next` no, no `fetch`. Live calls go through `data/liveRepository.ts`.
- v4 copy: en and de keys match. German is du, with no exclamation marks. No em or en dashes in new copy. Words follow `docs/V4_GLOSSARY.md`: Space, Lesson/Lektion, page/Seite, idea/Idee. Never Folie, Vorlesung, Kurs, professor, student, lecture, slide, course.
- One fact, once; show, don't count. No eyebrows, no decorative dots, no glow, figures not gauges, hairline lists.
- Only demo or describe what the app really does today.
- Backend tests never run with a `.env` you do not trust (`backend/services/ai/orchestrator.py` calls `load_dotenv(override=True)`). This worktree has no `.env` and must never get one.
- Work only in the worktree `/private/tmp/claude-501/-Users-abdullahabobaker-Desktop-ascend-academy/673df2b3-fe05-42ae-846a-20c7b879de52/scratchpad/pr-b` (branch `claude/landing-plan-3-door-in-v4`, from `origin/main` @ `68bf5752`; `node_modules` is symlinked). Every command below runs from that directory.
- Node: `export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"` before any `npx`/`npm`.
- Python: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest … -q -p no:cacheprovider`. Ruff: `/Library/Frameworks/Python.framework/Versions/3.11/bin/ruff`.
- Gates every task keeps green (pre-existing local failures excepted, see Task 0):
  - `npm run lint`
  - `npx vitest run`
  - `npx tsc --noEmit -p tsconfig.app.json` (not `tsconfig.json`, which checks nothing)
  - `.venv/bin/python -m pytest backend/tests -m "not db" -q`
  - `ruff check backend/ --select F821,F811,F841`
- Locally 19 vitest files fail to load because `streamdown` is not installed in the shared `node_modules` (pre-existing; CI has it). Do not fix it here.
- Several Claude sessions share one tree: `git status` and `git log -1` before every commit and every push.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- In the browser tools, `form_input` does not register on `/auth`: click and type. The agent never enters a password and never signs in to prod.

## File Structure

**Backend**
- Modify: `backend/services/insights/landing_map.py` (`help_share`, `help_index`: `None` under the page floor).
- Modify: `backend/services/v4_landing_service.py` (`LANDING_VERSION` to `landing-v2`; `reach` replaces `readers`; module docstring).
- Tests: `backend/tests/unit/test_landing_map.py`, `backend/tests/unit/test_landing_stories.py` (story 5 flips; floor stories read `reach`), `backend/tests/unit/test_v4_landing_api.py`, `backend/tests/db/test_v4_landing_db.py` (`-m db`, not a gate, kept true).

**Frontend: the door's shapes (fixtures)**
- Modify: `src/features/spaces/landing/types.ts` (`Reach`, `reach`, `help: (number | null)[]`, `readers?` lab-only, `asker: { name } | null`).
- Modify: `src/features/spaces/landing/copy.ts` (`ledeKey` reads `reach`), `light.ts` (`cellColor` takes `null`), `LessonMap.tsx` (outline cell, fold rule), `QuestionsRow.tsx` (name-only mark, `onAnswer` optional), `LandingScreen.tsx` (lede, `under`, map lede, states, `answer` optional).
- Modify: `src/features/spaces/mocks/landing.ts` (reach, outlines on Integrity, traps first, askers by name, healthy metrics, floor figures as the backend sends them).
- Modify: `src/pages/landingMockups/MockupTiles.tsx`, `MockupCovers.tsx` (lab-only: compile against the narrowed types).
- Modify: `src/i18n/locales/{en,de}/v4Landing.json` (`door.lede.floor`, `door.lede.none`, `lessons.mapLedeOutlined`, four finding summaries).
- Tests: `src/features/spaces/__tests__/landing.test.tsx`.

**Frontend: live**
- Modify: `src/features/spaces/data/liveRepository.ts` (`WireLanding`, `landing`), `src/features/spaces/data/landing.ts` (`fromWire`, live `useLanding`), `src/features/spaces/__tests__/seam.test.ts` (cover `landing/`).
- Create: `src/features/spaces/screens/SpaceOwnerGate.tsx`, `src/features/spaces/screens/LandingRoute.tsx`.
- Modify: `src/App.tsx` (lazy imports, route before `:tab`), `src/features/spaces/screens/CourseScreen.tsx` (pill), `src/features/spaces/components/course/OwnerBar.tsx` (comment only).
- Tests: create `src/features/spaces/__tests__/landing-live.test.tsx`, `src/features/spaces/__tests__/landing-door.test.tsx`; append to `src/features/spaces/components/__tests__/oneApp.test.tsx`.

---

### Task 0: Baseline in the worktree

**Files:** none changed by hand except the first commit of this plan.

- [ ] **Step 1: Check the tree**

```bash
cd /private/tmp/claude-501/-Users-abdullahabobaker-Desktop-ascend-academy/673df2b3-fe05-42ae-846a-20c7b879de52/scratchpad/pr-b
git status && git log -1 --oneline
git fetch origin && git log --oneline -1 origin/main
test ! -e .env && test ! -e backend/.env && echo "no env files: good"
```

Expected: branch `claude/landing-plan-3-door-in-v4`, HEAD `68bf5752` (or `origin/main` has moved; if it has, `git rebase origin/main` before starting and re-check the line numbers this plan cites for files you touch). No `.env` anywhere.

- [ ] **Step 2: Commit this plan**

```bash
git add docs/superpowers/plans/2026-11-06-how-its-landing-plan-3b-door-in-v4.md
git commit -m "docs: How it's landing, plan 3 PR B (the door in v4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Baseline every gate**

```bash
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx vitest run 2>&1 | tail -15
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider 2>&1 | tail -5
/Library/Frameworks/Python.framework/Versions/3.11/bin/ruff check backend/ --select F821,F811,F841
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
```

Write down: vitest passed/failed counts (19 files failing on `streamdown` is the known local baseline), pytest passed/xfailed counts (story 5 is 1 xfailed), and the vocabulary total. Anything else already red is pre-existing: note it, do not fix it.

---

### Task 1 (backend): A page fewer than five people read says nothing, which is not landing

Story 5 (`test_landing_stories.py:197-208`): four people read all of Normalization, all foggy on page 3; a fifth opens only page 1. Today pages 2 to 4 come back `0.0`, the value of a landing page, so the door draws them dark: "landing". After this task they are `null`.

**Files:**
- Modify: `backend/services/insights/landing_map.py:10` (import `Optional` is already there), `:33-52` (`help_share`, `help_index`)
- Modify: `backend/services/v4_landing_service.py:48` (`LANDING_VERSION`)
- Test: `backend/tests/unit/test_landing_map.py:162-168` and `:176-181`, plus one new test; `backend/tests/unit/test_landing_stories.py:197-198` (the xfail marker); `backend/tests/unit/test_v4_landing_api.py` (one new test)

**Interfaces:**
- Produces: `help_share(f: PageFacts) -> Optional[float]` (`None` under `MIN_READERS` readers); `help_index(facts) -> dict[str, list[Optional[float]]]`; wire `lessons[].help: (number | null)[]`; `LANDING_VERSION = "landing-v2"`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_landing_map.py`, change the two existing help assertions:

```python
    assert help_share(quiet) == 0.1 and help_share(few) is None
    assert help_index({"l1": lf}) == {"l1": [0.2, 1.0, None, None]}
```

(in `test_help_is_the_share_of_readers_who_needed_the_page_never_brighter_than_half_of_them`, lines 167-168), and

```python
    assert help_index({"l1": facts({**shown, 9: hidden}, count=4)}) == alone == {"l1": [0.2, 0.8, None, None]}
```

(in `test_a_hidden_page_beyond_the_lessons_pages_does_not_dim_the_shown_ones`, line 181). After them add:

```python
def test_a_page_fewer_than_five_read_says_nothing_and_nothing_is_not_landing():
    # Five read page 1 and nobody needed it: landing (0). Four read page 2, all asking: nothing to say (None).
    landing = PageFacts(readers=people(5))
    few = PageFacts(readers=people(4), ask=people(4))
    lf = facts({1: landing, 2: few}, count=3)
    assert help_share(landing) == 0.0 and help_share(few) is None
    assert help_index({"l1": lf}) == {"l1": [0.0, None, None]}
```

In `backend/tests/unit/test_landing_stories.py`, delete the two-line decorator above `test_one_member_opening_page_one_does_not_make_pages_four_people_read_look_like_landing` (lines 197-198):

```python
@pytest.mark.xfail(strict=True, reason="help_share() returns 0.0 under the page floor, the same value as a landing page "
                                       "— not in Plan 3")
```

In `backend/tests/unit/test_v4_landing_api.py`, after `test_under_the_spaces_floor_it_says_so_with_no_findings_and_no_light`, add:

```python
def test_the_cache_key_moves_with_the_wire_shape(monkeypatch):
    """A payload cached before this shape (help 0 under the floor) is never served after it."""
    seen = {}

    async def row(space_id, uid):
        return {"id": space_id, "title": "Database Systems", "professor_id": uuid.UUID(OWNER), "is_member": False}

    async def cached(key, view, compute, **kw):
        seen.update(kw["params"])
        return {}

    monkeypatch.setattr(service, "space_row", row)
    monkeypatch.setattr(service.analytics_cache, "get_or_compute_async", cached)
    asyncio.run(service.get_landing(SPACE, OWNER, "en"))
    assert seen == {"lang": "en", "v": "landing-v2"}
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_map.py backend/tests/unit/test_landing_stories.py backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider`
Expected: FAIL. `help_share(few)` is `0.0`, `help_index` has `0.0` where `None` is expected, story 5 fails on `[0.0, 0.0, 0.0]`, and the cache test sees `landing-v1`.

- [ ] **Step 3: Implement**

In `backend/services/insights/landing_map.py`, replace `help_share` and `help_index` (lines 33-52) with:

```python
def help_share(f: PageFacts) -> Optional[float]:
    """Of the people who read this page, the share who needed it.

    None while fewer than `MIN_READERS` people read it: such a page says nothing, and
    nothing is not 0, which the door draws as landing (story 5; Abi, 2026-11-06)."""
    if len(f.readers) < MIN_READERS:
        return None
    return len(f.helped & f.readers) / len(f.readers)


def help_index(facts: dict[str, LessonFacts]) -> dict[str, list[Optional[float]]]:
    """Per Lesson, one value per page: its help share, normalised over the Space to 0–1, or
    None for a page fewer than `MIN_READERS` people read (the door draws it as an outline).

    As long as the Lesson has pages (else the highest page seen), so a page number
    beyond them never lengthens the list, and normalised over those shown pages only,
    so a page no one is shown never sets the scale."""
    shares: dict[str, list[Optional[float]]] = {}
    for lid, lf in facts.items():
        # The Lesson's own page count when it has one; else the highest page seen (never above MAX_PAGE).
        length = lf.lesson.pages if lf.lesson.pages > 0 else max(lf.pages, default=0)
        shares[lid] = [help_share(lf.pages.get(n, PageFacts())) for n in range(1, length + 1)]
    scale = max(HELP_FULL, max((v for s in shares.values() for v in s if v is not None), default=0.0))
    return {lid: [None if v is None else round(min(1.0, v / scale), 2) for v in s] for lid, s in shares.items()}
```

In `backend/services/v4_landing_service.py`, replace line 48 with:

```python
#: Moves whenever the payload's shape does, so a cached older shape is never served.
#: v2 (2026-11-06): a page under the floor is null in `help`, never 0.
LANDING_VERSION = "landing-v2"
```

- [ ] **Step 4: Run the tests**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_map.py backend/tests/unit/test_landing_stories.py backend/tests/unit/test_v4_landing_api.py backend/tests/unit/test_landing_figures.py -q -p no:cacheprovider
/Library/Frameworks/Python.framework/Versions/3.11/bin/ruff check backend/ --select F821,F811,F841
```

Expected: all pass, 0 xfailed in the stories file. `test_the_owner_sees_the_space_in_aggregate_and_never_a_question` still sees `help[2] == 1.0` (all four pages there have ten readers).

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add backend/services/insights/landing_map.py backend/services/v4_landing_service.py \
  backend/tests/unit/test_landing_map.py backend/tests/unit/test_landing_stories.py backend/tests/unit/test_v4_landing_api.py
git commit -m "fix(landing): a page fewer than five read is null in help, never landing (story 5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2 (backend): The Space says how far its reading has got, never how many

Decision 1. `readers` (a count) leaves the payload; `reach` (`none`, `few`, `enough`) takes its place.

**Files:**
- Modify: `backend/services/v4_landing_service.py:1-11` (module docstring), `:48-50` (version comment), `:76-122` (`landing_from`; new `reach`)
- Test: `backend/tests/unit/test_landing_stories.py:150-160` and one new story; `backend/tests/unit/test_v4_landing_api.py:131,149`; `backend/tests/db/test_v4_landing_db.py:47`

**Interfaces:**
- Consumes: `MIN_READERS` (`space_engine.py:25`).
- Produces: `v4_landing_service.reach(readers: int) -> str` returning `"none" | "few" | "enough"`; wire key `reach` (no `readers` key at the top level).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_landing_stories.py`, in `test_four_people_reading_closely_get_lunas_floor_line_and_nothing_else`, replace

```python
    assert (body["readers"], body["floor"]) == (4, 5)
```

with

```python
    assert (body["reach"], body["floor"]) == ("few", 5)
    assert "readers" not in body  # in a group of two, a count is who (Abi, 2026-11-06)
```

and add, after that test:

```python
def test_a_space_nobody_has_read_yet_says_so_without_a_count(door):
    """A Space with a Lesson and no reading at all: reach is none, so Luna can say nobody yet, never 'a few'."""
    body = door.look(space([lesson(NORM, 4)], []))
    assert body["reach"] == "none" and "readers" not in body
    assert body["insights"] == [] and [x["light"] for x in body["lessons"]] == ["few"]


def test_one_person_reading_is_a_few_not_one(door):
    """One member reads one page: the owner is told 'few', never 'one'."""
    body = door.look(space([lesson(NORM, 4)], reads([0], NORM, [1])))
    assert body["reach"] == "few"
    assert '"readers"' not in json.dumps(body)
```

In `backend/tests/unit/test_v4_landing_api.py`, line 131 becomes

```python
    assert (body["spaceName"], body["members"], body["reach"], body["floor"]) == ("Database Systems", 12, "enough", 5)
    assert "readers" not in body
```

and line 149 becomes

```python
    assert body["reach"] == "few" and body["insights"] == [] and body["themes"] == []
```

In `backend/tests/db/test_v4_landing_db.py`, line 47 becomes

```python
    assert (body["members"], body["reach"]) == (6, "enough")
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_stories.py backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider`
Expected: FAIL with `KeyError: 'reach'`.

- [ ] **Step 3: Implement**

In `backend/services/v4_landing_service.py`, after `THEMES_PAGES = 5` (line 51), add:

```python
def reach(readers: int) -> str:
    """How far the Space's reading has got, never how many: in a group of two, "1 read" is who.
    `none` lets Luna say nobody has read yet instead of "a few" (Abi, 2026-11-06)."""
    if readers == 0:
        return "none"
    return "few" if readers < MIN_READERS else "enough"
```

In `landing_from`, replace `"readers": readers,` (line 115) with `"reach": reach(readers),`. Keep the local `readers` variable: `above` still uses it.

Extend the version comment (Task 1) to:

```python
#: v2 (2026-11-06): a page under the floor is null in `help`, never 0; `reach` replaces `readers`.
```

In the module docstring (lines 1-11), after "Nothing in the payload names a member or quotes one (spec §0)." add: "Nor does it count them where a count would say who: a Lesson carries no reader count, and the Space says only how far its reading has got (`reach`)."

- [ ] **Step 4: Run the tests**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -q -p no:cacheprovider -k "landing"
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider 2>&1 | tail -3
/Library/Frameworks/Python.framework/Versions/3.11/bin/ruff check backend/ --select F821,F811,F841
grep -rn '\["readers"\]' backend/ || echo "no reader count read anywhere"
```

Expected: all pass; the grep prints the fallback line.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add backend/services/v4_landing_service.py backend/tests/unit/test_landing_stories.py \
  backend/tests/unit/test_v4_landing_api.py backend/tests/db/test_v4_landing_db.py
git commit -m "feat(landing): the Space says how far its reading has got (reach), never how many

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 (frontend): Luna's floor line says no count, and nobody yet when nobody has read

Decisions 1 and 2, on the door and the fixtures.

**Files:**
- Modify: `src/features/spaces/landing/types.ts:117-133` (`Reach`, `reach` replaces `readers` on `Landing`)
- Modify: `src/features/spaces/landing/copy.ts:30-36` (`ledeKey`)
- Modify: `src/features/spaces/landing/LandingScreen.tsx:48-64, 89, 102` (`under`, lede without `count`)
- Modify: `src/i18n/locales/en/v4Landing.json:10-11`, `src/i18n/locales/de/v4Landing.json:10-11`
- Modify: `src/features/spaces/mocks/landing.ts:203-234, 325-331` (`reach`; the floor Space's figures as the backend sends them)
- Test: `src/features/spaces/__tests__/landing.test.tsx:160-171, 279-284`, plus two new tests

**Interfaces:**
- Produces: `type Reach = 'none' | 'few' | 'enough'`; `Landing.reach: Reach`; `ledeKey(insights: LandingInsight[], reach: Reach): 'act' | 'watch' | 'calm' | 'floor' | 'none'`; i18n keys `v4Landing:door.lede.floor`, `v4Landing:door.lede.none`.

- [ ] **Step 1: Write the failing tests**

In `landing.test.tsx`, in `under the floor it says so once, with no figures and no light`, replace the first expectation with:

```tsx
    expect(screen.getByText('A few people have been reading. Patterns show once five people have been through a page.')).toBeInTheDocument();
    // No count: in a group of six, "4 people" is nearly who.
    expect(screen.queryByText(/\d+ (people|person) ha(ve|s) been reading/)).toBeNull();
```

After that test add:

```tsx
  it('with nobody reading yet, Luna says nobody, never a few', () => {
    fixture.override = { ...friendsLanding, reach: 'none', questions: [] };
    door('s-friends');
    expect(screen.getByText('Nobody has been reading yet. Patterns show once five people have been through a page.')).toBeInTheDocument();
    expect(screen.queryByText(/A few people/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Lessons' })).toBeNull();
  });

  it('under the floor, in German, without a count', async () => {
    await i18n.changeLanguage('de');
    door('s-friends');
    expect(screen.getByText('Ein paar Leute haben gelesen. Muster zeigen sich, sobald fünf Leute durch eine Seite sind.')).toBeInTheDocument();
  });
```

Replace the `follows the loudest finding, and the floor before anything` test body with:

```tsx
    expect(ledeKey(dbsLanding.insights, dbsLanding.reach)).toBe('act');
    expect(ledeKey(friendsLanding.insights, friendsLanding.reach)).toBe('floor');
    expect(ledeKey([], 'enough')).toBe('calm');
    expect(ledeKey(dbsLanding.insights, 'none')).toBe('none');
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/landing.test.tsx`
Expected: FAIL. The floor line still counts ("4 people…"), `reach` does not exist on the fixtures, and `ledeKey` takes a number.

- [ ] **Step 3: Implement**

`landing/types.ts`: after `export type LessonLight = Attention | 'few';` (line 20) add:

```ts
/**
 * How far a Space's reading has got, never how many: nobody yet, fewer than
 * `floor` people, or enough to say something. In a group of two a count is who.
 */
export type Reach = 'none' | 'few' | 'enough';
```

and in `Landing` replace

```ts
  /** Members who have read anything, the owner excluded. */
  readers: number;
```

with

```ts
  /** How far the members' reading has got (the owner excluded). Under the floor there are no figures and no map. */
  reach: Reach;
```

`landing/copy.ts`: replace `ledeKey` (lines 30-36) with:

```ts
/** The door's lede: the floor before anything, then the loudest finding sets the tone. */
export function ledeKey(insights: LandingInsight[], reach: Reach): 'act' | 'watch' | 'calm' | 'floor' | 'none' {
  if (reach === 'none') return 'none';
  if (reach === 'few') return 'floor';
  if (insights.some((i) => i.attention === 'act')) return 'act';
  if (insights.some((i) => i.attention === 'watch')) return 'watch';
  return 'calm';
}
```

and change its import line to `import type { LandingInsight, Reach } from './types';`.

`landing/LandingScreen.tsx`: replace lines 49-50 with:

```tsx
  const lede = ledeKey(landing.insights, landing.reach);
  // Under the floor Luna says so, once; no figures and no map say it again.
  const under = lede === 'floor' || lede === 'none';
  const loudest = under ? undefined : landing.insights[0];
```

replace line 61 `? t(\`door.lede.${lede}\`, { count: landing.readers })` with `? t(\`door.lede.${lede}\`)`, and change both `{lede !== 'floor' && (` (lines 89 and 102) to `{!under && (`.

`en/v4Landing.json`: replace the two `floor_one` / `floor_other` lines with:

```json
      "floor": "A few people have been reading. Patterns show once five people have been through a page.",
      "none": "Nobody has been reading yet. Patterns show once five people have been through a page.",
```

`de/v4Landing.json`: replace the two `floor_one` / `floor_other` lines with:

```json
      "floor": "Ein paar Leute haben gelesen. Muster zeigen sich, sobald fünf Leute durch eine Seite sind.",
      "none": "Noch hat niemand gelesen. Muster zeigen sich, sobald fünf Leute durch eine Seite sind.",
```

`mocks/landing.ts`: in `dbsLanding` and `bigLanding` replace `readers: 131,` / `readers: 154,` with `reach: 'enough',`. In `friendsLanding` replace `readers: 4,` with `reach: 'few',` and its `figures` with what the backend sends under the floor (a week under five is `null`, `figures.py:51-57`):

```ts
  figures: {
    reading: { value: null, history: [null, null, null, null, null, null, null, null] },
    landing: { value: null, history: [] },
    cleared: { value: null, history: [] },
  },
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/features/spaces/__tests__/landing.test.tsx
npx tsc --noEmit -p tsconfig.app.json
npm run lint
grep -rn "landing.readers\|floor_one\|floor_other" src/ || echo "no reader count on the door"
```

Expected: all pass; i18n parity holds; the grep prints the fallback line.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/landing/types.ts src/features/spaces/landing/copy.ts src/features/spaces/landing/LandingScreen.tsx \
  src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json src/features/spaces/mocks/landing.ts \
  src/features/spaces/__tests__/landing.test.tsx
git commit -m "feat(v4-landing): Luna's floor line counts no one, and says nobody yet when nobody has read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 (frontend): A page too few people have reached is a faint outline

Decisions 1 and 3. Dark always means landing; an outline means too few have been through it.

**Files:**
- Modify: `src/features/spaces/landing/types.ts:45-50` (`help: (number | null)[]`)
- Modify: `src/features/spaces/landing/light.ts:23-32` (`cellColor` takes `null`)
- Modify: `src/features/spaces/landing/LessonMap.tsx:25-36` (doc), `:70` (`quiet`), `:110-139` (the cell)
- Modify: `src/features/spaces/landing/LandingScreen.tsx` (the map's lede, around line 103)
- Modify: `src/i18n/locales/{en,de}/v4Landing.json` (`lessons.mapLedeOutlined`, after `lessons.mapLede`)
- Modify: `src/features/spaces/mocks/landing.ts:32-63` (`helpFor`, `LessonSeed`, `lessonsFrom`), `:142` (Integrity is being read), header comment lines 10-14
- Modify: `src/pages/landingMockups/MockupTiles.tsx:98` (lab-only, compiles against `null`)
- Test: `src/features/spaces/__tests__/landing.test.tsx:85-95, 173-182`, plus new tests

**Interfaces:**
- Consumes: wire `lessons[].help: (number | null)[]` (Task 1).
- Produces: `cellColor(color: string, help: number | null, finding: Attention | null): CSSProperties | null`; cells carry `data-cell="outline" | "lit" | "page"`; i18n `v4Landing:lessons.mapLedeOutlined`.

- [ ] **Step 1: Write the failing tests**

In `landing.test.tsx`, add `bigLanding` to the fixtures import (`import { bigLanding, dbsLanding, friendsLanding } from '../mocks/landing';`), add `import { cellColor } from '../landing/light';`, and change `draws every Lesson as its pages, and a lit page opens that page` (lines 92-94) to:

```tsx
    // Lessons too few have been through are named once, below the map, not drawn.
    expect(screen.getByText('Transactions, Query Processing, and Index Structures: too few readers yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Transactions' })).toBeNull();
```

In `reads in German the way the glossary says` (line 180), the under-floor line becomes `'Transactions, Query Processing und Index Structures: noch zu wenige Lesende.'`.

Add to `describe('the owner’s door', …)`:

```tsx
  it('a page too few people have reached is an outline: drawn, never lit, and it opens nothing', () => {
    door('s-dbs');
    const lesson = screen.getByRole('heading', { level: 3, name: 'Integrity' }).closest('li')!;
    // Nine people have started Integrity; past page 6 fewer than five have been through a page.
    expect(lesson.querySelectorAll('[data-cell="outline"]')).toHaveLength(10);
    expect(lesson.querySelectorAll('[data-cell="page"]')).toHaveLength(6);
    expect(within(lesson).queryAllByRole('link', { name: /^Page \d+ of Integrity$/ })).toHaveLength(0);
    // The map says what an outline is, once, because one is on screen.
    expect(screen.getByText(/Too few people have reached an outlined one yet\./)).toBeInTheDocument();
  });

  it('with no outline on the map, the map does not explain one', () => {
    door('s-big');
    expect(screen.queryByText(/outlined/)).toBeNull();
  });
```

Add to `describe('a big Space folds what needs nothing', …)`:

```tsx
  it('a Lesson with an outlined page is never folded away as landing', () => {
    fixture.override = {
      ...bigLanding,
      lessons: bigLanding.lessons.map((l) => (l.id === 'l-s-big-3' ? { ...l, help: l.help!.map((h, i) => (i >= 10 ? null : h)) } : l)),
    };
    door('s-big');
    expect(titlesDrawn()).toContain('Use cases');
    expect(screen.getByRole('button', { name: '5 Lessons landing' })).toBeInTheDocument();
  });
```

Add to `describe('the lede', …)`:

```tsx
  it('a page with nothing to say never takes a colour', () => {
    expect(cellColor('#06b6d4', null, null)).toBeNull();
    expect(cellColor('#06b6d4', 0.8, null)).not.toBeNull();
    expect(cellColor('#06b6d4', 0.05, null)).toBeNull();
  });
```

In `each Lesson above the floor carries one help value per page`, add after the loop:

```tsx
    // A null is a page too few have reached; every other value is 0–1.
    for (const v of dbsLanding.lessons.flatMap((l) => l.help ?? [])) expect(v === null || (v >= 0 && v <= 1)).toBe(true);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/landing.test.tsx`
Expected: FAIL. Integrity is under the floor in the fixture (not drawn), there is no `data-cell`, no outline lede, and the run still folds 6.

- [ ] **Step 3: Implement**

`landing/types.ts`, the `help` field of `LandingLesson`:

```ts
  /**
   * How much each page asked of people, 0–1, one value per page: the engine's
   * per-page help index (Explain and Ask opened, foggy check-ins, turning
   * back). `null` is a page fewer than `floor` people have reached: it says
   * nothing, which is not landing, so the door draws it as an outline.
   * Absent while the whole Lesson is under the floor.
   */
  help?: (number | null)[];
```

`landing/light.ts`, replace `cellColor` (lines 23-32) with:

```ts
/**
 * A page cell's colour, or null for no colour (drawn with a class: the dark
 * ground for a landing page, an outline for a page with nothing to say yet).
 * A page a finding is about is lit outright; any other page shows its help
 * index as a share of the Lesson's colour. A page fewer than the floor have
 * reached (`help` null) never takes a colour.
 */
export function cellColor(color: string, help: number | null, finding: Attention | null): CSSProperties | null {
  if (finding) return { background: finding === 'calm' ? mix(color, 55) : color };
  if (help !== null && help > LANDING) return { background: mix(color, Math.round(help * 70)) };
  return null;
}
```

`landing/LessonMap.tsx`:
- In the doc comment, after "Only Lessons enough people have been through are drawn, so a dark strip always means landing, never "nobody looked"." add: "Inside a drawn Lesson, a page too few people have reached is a faint outline: dark is always landing, an outline is not yet anything."
- Replace line 70 with:

```tsx
  // Quiet: nothing to point at, and every page reached. An outlined page is not landing, so it never folds as one.
  const quiet = (l: LandingLesson) =>
    !insights.some((i) => i.lessonId === l.id && (i.page || i.first)) && !l.help?.some((h) => h === null);
```

- Replace lines 112-123 (from `const f = lit.get(page) ?? null;` through the closing `/>` of the `motion.span`) with:

```tsx
                const f = lit.get(page) ?? null;
                const help = l.help?.[i];
                // Fewer than the floor have reached it: an outline, never a colour, never a way in.
                const outlined = help === null && !f;
                const color = cellColor(l.color, help === undefined ? 0 : help, f?.attention ?? null);
                const labelled = f && (f.page === page || f.first === page);
                const cell = (
                  <motion.span
                    data-cell={outlined ? 'outline' : f ? 'lit' : 'page'}
                    className={cn(
                      'block w-full rounded-[3px]',
                      f ? 'h-9' : 'h-6',
                      outlined ? 'border border-white/25' : !color && 'bg-white/[0.06]',
                    )}
                    style={color ?? undefined}
                    initial={reduce ? false : { opacity: 0, scaleY: 0.4 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    transition={{ duration: 0.4, delay: reduce ? 0 : Math.min(0.5, 0.15 + li * 0.04 + i * 0.012), ease: [0.16, 1, 0.3, 1] }}
                  />
                );
```

`landing/LandingScreen.tsx`: before `return (` of the ready screen add:

```tsx
  // The map explains an outline only when it draws one.
  const outlined = landing.lessons.some((l) => l.light !== 'few' && Boolean(l.help?.some((h) => h === null)));
```

and change the map's `StageRow` lede to `lede={t(outlined ? 'lessons.mapLedeOutlined' : 'lessons.mapLede')}`.

`en/v4Landing.json`, after `"mapLede"`:

```json
    "mapLedeOutlined": "Each cell is a page. The brighter it is, the more people needed help there; a labelled one opens that page. Too few people have reached an outlined one yet.",
```

`de/v4Landing.json`, after `"mapLede"`:

```json
    "mapLedeOutlined": "Jede Zelle ist eine Seite. Je heller, desto mehr Leute brauchten dort Hilfe; eine beschriftete öffnet die Seite. Eine umrandete Seite haben noch zu wenige Leute erreicht.",
```

`mocks/landing.ts`: replace `helpFor`, `LessonSeed` and `lessonsFrom` (lines 35-63) with:

```ts
/**
 * One help value per page: a calm floor, each finding's page raised by its
 * attention, and the pages either side carrying a little of it, because
 * trouble is rarely one page wide. Past `reached`, fewer than five people
 * have been through a page: null, as the engine sends it.
 */
function helpFor(pages: number, findings: LandingInsight[], reached = pages): (number | null)[] {
  const values: (number | null)[] = Array.from({ length: pages }, (_, i) => (i < reached ? 0.06 + ((i * 7) % 5) * 0.012 : null));
  const raise = (i: number, v: number) => {
    if (i < 0 || i >= reached) return;
    values[i] = Math.max(values[i] as number, v);
  };
  for (const f of findings) {
    if (!f.page) continue;
    const top = RAISE[f.attention];
    raise(f.page - 1, top);
    raise(f.page - 2, top * 0.35);
    raise(f.page, top * 0.25);
  }
  return values;
}

type LessonSeed = Omit<LandingLesson, 'color' | 'help'> & {
  /** Pages at least five people have been through; the rest are outlines. All of them when absent. */
  reached?: number;
};

/** Colour from the cover palette; help from the findings, unless under the floor. */
const lessonsFrom = (seeds: LessonSeed[], insights: LandingInsight[]): LandingLesson[] =>
  seeds.map(({ reached, ...l }) => ({
    ...l,
    color: stageAccentFor(l.order),
    help: l.light === 'few' ? undefined : helpFor(l.pages, insights.filter((i) => i.lessonId === l.id), reached),
  }));
```

Replace the Integrity seed (line 142) with:

```ts
    // Nine people have started it; past page 6 fewer than five have been through a page.
    { id: 'l-s-dbs-7', title: 'Integrity', order: 7, pages: 16, readers: 9, light: 'calm', reached: 6 },
```

and in the header comment change "and four Lessons that are too new to say anything about" to "one Lesson people are only starting (its later pages are outlines), and three Lessons too new to say anything about".

`src/pages/landingMockups/MockupTiles.tsx` line 98 (lab-only direction B):

```tsx
            const values = (l.help ?? Array.from({ length: 12 }, (_, k) => 3 + ((k * 5) % 4))).map((v) => v ?? 0);
```

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/features/spaces/__tests__/landing.test.tsx src/features/spaces/components/__tests__/motion.test.tsx
npx tsc --noEmit -p tsconfig.app.json
npm run lint
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
```

Expected: all pass; vocabulary total unchanged from Task 0.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/landing/types.ts src/features/spaces/landing/light.ts src/features/spaces/landing/LessonMap.tsx \
  src/features/spaces/landing/LandingScreen.tsx src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json \
  src/features/spaces/mocks/landing.ts src/pages/landingMockups/MockupTiles.tsx src/features/spaces/__tests__/landing.test.tsx
git commit -m "feat(v4-landing): a page too few have reached is a faint outline; dark always means landing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5 (frontend): The lab opens on the trap, as the engine does

Decision 3. The engine ranks a trap first within its band (`landing_map.py:139-151`); the demo seam reads `insights[0]` as given, so the fixtures carry the engine's order.

**Files:**
- Modify: `src/features/spaces/mocks/landing.ts:67-87` (`DBS_INSIGHTS`: `i-dbs-trap-9` before `i-dbs-hotspot-12`), `:268-270` (`BIG_INSIGHTS`: `i-big-9-trap` before `i-big-9-hot`)
- Test: `src/features/spaces/__tests__/landing.test.tsx:43-51, 173-177`, plus one new test

- [ ] **Step 1: Write the failing tests**

In `opens on Luna naming the one page, with the one action beside her`, replace lines 46-48 with:

```tsx
    // Two pages need the owner; the trap leads (people think they understood it), the button carries its page.
    expect(screen.getByText('2 pages are asking for you. Start with Relational Algebra.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open page 9' })).toHaveAttribute('href', '/v4/space/s-dbs/lesson/l-s-dbs-5/faces?page=9');
```

In `reads in German the way the glossary says`, line 177 becomes `expect(screen.getByText('2 Seiten brauchen dich. Fang mit Relational Algebra an.')).toBeInTheDocument();`.

`with one page asking, Luna says one…` (which drops `i-dbs-trap-9`) stays as it is: Normalization and page 12.

Add to `describe('a big Space folds what needs nothing', …)`:

```tsx
  it('opens on the trap, the page people wrongly think they understood', () => {
    door('s-big');
    expect(screen.getByText('2 pages are asking for you. Start with Concurrency.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open page 21' })).toHaveAttribute('href', '/v4/space/s-big/lesson/l-s-big-9/faces?page=21');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/landing.test.tsx`
Expected: FAIL. Luna starts with Normalization / page 12, and the big Space opens page 14.

- [ ] **Step 3: Implement**

In `DBS_INSIGHTS`, move the whole `i-dbs-trap-9` object above `i-dbs-hotspot-12`. In `BIG_INSIGHTS`, move the `i-big-9-trap` line above `i-big-9-hot`. Above each array add the comment:

```ts
/* In the engine's order (`rank`, landing_map.py): band, then a trap before the rest, then reach. The door reads [0]. */
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/spaces/__tests__/landing.test.tsx`
Expected: all pass. Within a Lesson the map still orders findings by severity (Concurrency's two loudest are unchanged).

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/mocks/landing.ts src/features/spaces/__tests__/landing.test.tsx
git commit -m "fix(v4-landing): the lab opens on the trap, as the engine ranks it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6 (frontend): Questions as they will arrive: a name, never a face, and no Answer without a way to answer

Decision 4. Plan 4's contract: `asker: { name: string } | null`. The live door gets no `onAnswer` until Plan 4 ships one.

**Files:**
- Modify: `src/features/spaces/landing/types.ts:95-105` (`LandingAsker`, `asker`)
- Modify: `src/features/spaces/landing/QuestionsRow.tsx:7` (drop the `Avatar` import), `:51-64` (`onAnswer` optional), `:69-101` (no Answer without it), `:168-174` (the mark)
- Modify: `src/features/spaces/landing/LandingScreen.tsx:97` (passes `answer`, which may be `undefined` from Task 7 on; no change needed now)
- Modify: `src/features/spaces/mocks/landing.ts:1-3` (imports), `:163-201, 244-253, 312` (askers by name)
- Modify: `src/pages/landingMockups/MockupTiles.tsx:77`, `src/pages/landingMockups/MockupCovers.tsx:109` (lab-only)
- Test: `src/features/spaces/__tests__/landing.test.tsx` (new `describe`)

**Interfaces:**
- Produces: `interface LandingAsker { name: string }`; `LandingQuestion.asker: LandingAsker | null`; `QuestionsRow` prop `onAnswer?: (questionId: string, text: string, forEveryone: boolean) => void`.

- [ ] **Step 1: Write the failing tests**

Add `import { QuestionsRow } from '../landing/QuestionsRow';` to `landing.test.tsx` and append:

```tsx
describe('questions, as they will arrive', () => {
  it('a sender is a name, never a face', () => {
    door('s-dbs');
    const row = screen.getByText(/Why does the BCNF split on page 12/).closest('li')!;
    expect(within(row).getByText('Åsa Lindqvist')).toBeInTheDocument();
    // The quiet ring with her initial, not an astronaut drawn for her.
    expect(row.querySelector('svg')).toBeNull();
    expect(within(row).getByText('Å')).toBeInTheDocument();
  });

  it('with no way to answer, a question is read and never offered an action that does nothing', () => {
    const waiting = dbsLanding.questions.filter((q) => !q.answer);
    render(
      <MemoryRouter>
        <QuestionsRow questions={waiting} lessons={new Map(dbsLanding.lessons.map((l) => [l.id, l]))} spaceId="s-dbs" accent="#06b6d4" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Why does the BCNF split on page 12/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    // Each still opens its page.
    expect(screen.getByRole('link', { name: 'Normalization, page 12' })).toHaveAttribute('href', '/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=12');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/landing.test.tsx -t "questions, as they will arrive"`
Expected: FAIL. The row draws an `Avatar` (an SVG astronaut), and `QuestionsRow` requires `onAnswer` (tsc) and always draws Answer.

- [ ] **Step 3: Implement**

`landing/types.ts`, replace `LandingQuestion`'s doc and `asker` with:

```ts
/** Who sent a question: the name they sent it with. Never an id, never a face (Plan 4, Decision 2). */
export interface LandingAsker {
  name: string;
}

/** A question someone chose to send to the people who run the Space. */
export interface LandingQuestion {
  id: string;
  lessonId: string;
  page: number;
  text: string;
  /** Null when sent without a name (or with none on the profile): "Someone". The answer still finds its way back. */
  asker: LandingAsker | null;
  createdAt: string;
  answer?: LandingAnswer;
}
```

Remove the now-unused `import type { Person } from '../types';` at the top of `types.ts` if nothing else in the file uses it (`grep -n Person src/features/spaces/landing/types.ts`).

`landing/QuestionsRow.tsx`:
- Delete line 7 (`import { Avatar } from '../components/Avatar';`).
- In the file's doc comment, change "Answering happens in the row:" to "Where answering is possible, it happens in the row:".
- Replace the `QuestionsRow` signature and `send` (lines 51-64) with:

```tsx
/** The questions still waiting for an answer. Without `onAnswer` (live, until the Questions channel ships its composer) they are read, never offered an answer that goes nowhere. */
export function QuestionsRow({
  onAnswer,
  ...props
}: RowsProps & { onAnswer?: (questionId: string, text: string, forEveryone: boolean) => void }) {
  const { t } = useTranslation('v4Landing');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const ordered = [...props.questions].sort(longestWaiting);
  const step = useStepped(ordered.length, FIRST, STEP);

  const send = (q: LandingQuestion, forEveryone: boolean) => {
    const text = draft.trim();
    if (!text || !onAnswer) return;
    onAnswer(q.id, text, forEveryone);
    setOpenId(null);
    setDraft('');
  };
```

- In the `Rows` children (line 69), change `{(q) =>` / `openId === q.id ? (` to `{(q) => !onAnswer ? null : openId === q.id ? (` and keep both branches as they are.
- Replace the asker mark (lines 168-174) with:

```tsx
            {/* A name, never a face: the asker chose to be named, not to be shown. */}
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.18] text-[12px] text-quiet">
              {q.asker?.name.trim().charAt(0).toLocaleUpperCase() || '?'}
            </span>
```

`mocks/landing.ts`: change line 1 to also import `Person`: add `import type { Person } from '../types';`, and after `hoursAgo` add:

```ts
/** A question carries the name it was sent with, nothing else (Plan 4's contract). */
const named = (p: Person) => ({ name: p.name });
```

Then `asker: lindqvist` → `asker: named(lindqvist)`, `asker: okonkwo` → `asker: named(okonkwo)`, `asker: weber` → `asker: named(weber)`, `asker: ferreira` → `asker: named(ferreira)`, and line 312:

```ts
const BIG_ASKERS = [lindqvist, null, okonkwo, weber, ferreira, keller].map((p) => (p ? named(p) : null));
```

`src/pages/landingMockups/MockupTiles.tsx:77` and `MockupCovers.tsx:109` (lab-only directions B and C, kept for comparison): replace `person={q.asker}` with `person={{ id: q.id, name: q.asker.name, avatarUrl: null }}`.

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/features/spaces/__tests__/landing.test.tsx
npx tsc --noEmit -p tsconfig.app.json
npm run lint
```

Expected: all pass. `an answer moves the question under the Answered fold` still passes: the demo screen still hands `onAnswer` down.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/landing/types.ts src/features/spaces/landing/QuestionsRow.tsx src/features/spaces/mocks/landing.ts \
  src/pages/landingMockups/MockupTiles.tsx src/pages/landingMockups/MockupCovers.tsx src/features/spaces/__tests__/landing.test.tsx
git commit -m "feat(v4-landing): a question carries a name, never a face; no Answer without a way to answer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 (frontend): The live seam

**Files:**
- Modify: `src/features/spaces/data/liveRepository.ts:5-10` (type import), after `:195` (`WireLanding`), after `:334` (`landing`)
- Modify: `src/features/spaces/data/landing.ts` (whole file)
- Modify: `src/features/spaces/landing/types.ts:40-41` (`readers?`, lab-only)
- Modify: `src/features/spaces/__tests__/seam.test.ts:26`
- Test: create `src/features/spaces/__tests__/landing-live.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/v4/spaces/{id}/landing` (Tasks 1 and 2: `reach`, `help` with nulls, `questions: []`), tagged with `?lang=` by `withLanguage` (`liveRepository.ts:375-387`). Errors carry `status` (`src/lib/apiErrors.ts:18-27`).
- Produces:
  - `type WireLanding` (exported from `data/liveRepository.ts`, re-exported from `data/landing.ts`).
  - `LiveRepository.landing(spaceId: string): Promise<WireLanding>`.
  - `fromWire(w: WireLanding): Landing`.
  - `useLanding(spaceId: string): LandingData` where `interface LandingData { state: LoadState; landing: Landing | null; answer?: (questionId: string, text: string, forEveryone: boolean) => void; retry: () => void }`. Demo build: fixtures, `answer` present. Live id: the backend, `answer` absent; 403 and 404 are `'empty'`, anything else `'error'`. A live build at a demo id: `'empty'`.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/landing-live.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createLiveRepository, type V4Transport } from '../data/liveRepository';
import { stageAccentFor } from '../components/stage';
import { setLiveWorld } from '../data/world';
import { emptyWorld } from './emptyWorld';
import type { LandingQuestion } from '../landing/types';

const { landingApi } = vi.hoisted(() => ({ landingApi: vi.fn() }));
vi.mock('../data/liveRepository', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/liveRepository')>();
  return { ...real, loadLiveRepository: async () => ({ landing: landingApi }) };
});

import { fromWire, useLanding, type WireLanding } from '../data/landing';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const NULLS = [null, null, null, null, null, null, null, null];

/** What the backend sends a Space of six with four reading (Tasks 1 and 2). */
const wire: WireLanding = {
  spaceId: SPACE,
  spaceName: 'Lerngruppe',
  members: 6,
  reach: 'few',
  floor: 5,
  figures: { reading: { value: null, history: NULLS }, landing: { value: null, history: [] }, cleared: { value: null, history: [] } },
  lessons: [
    { id: 'l1', title: 'Vectors', order: 1, pages: 14, light: 'few' },
    { id: 'l2', title: 'Matrices', order: 2, pages: 19, light: 'few' },
  ],
  insights: [],
  questions: [],
  themes: [],
};

const waiting: LandingQuestion = { id: 'q1', lessonId: 'l1', page: 6, text: 'Only 2×2?', asker: { name: 'Lea' }, createdAt: '2026-11-05T10:00:00Z' };
const done: LandingQuestion = { ...waiting, id: 'q2', asker: null, answer: { text: 'Any size.', forEveryone: true, at: '2026-11-05T11:00:00Z' } };

afterEach(() => {
  landingApi.mockReset();
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

describe('the door’s data, live', () => {
  it('asks the Space’s own endpoint', async () => {
    const calls: string[] = [];
    const http = { get: vi.fn(async (p: string) => (calls.push(p), wire)), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as V4Transport;
    await createLiveRepository(http).landing(SPACE);
    expect(calls).toEqual([`/api/v1/v4/spaces/${SPACE}/landing`]);
  });

  it('draws the colours the server leaves out, the way the rest of the Space is lit', () => {
    const l = fromWire(wire);
    expect(l.accent).toBe(stageAccentFor('Lerngruppe'.length));
    expect(l.lessons.map((x) => x.color)).toEqual([stageAccentFor(1), stageAccentFor(2)]);
  });

  it('passes questions through as the Questions channel will send them, and none until it does', () => {
    expect(fromWire({ ...wire, questions: undefined }).questions).toEqual([]);
    const asked = fromWire({ ...wire, questions: [waiting], answered: [done] });
    expect(asked.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(asked.questions[0].asker).toEqual({ name: 'Lea' });
  });

  it('a live Space loads, and its owner can try again after a failure', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 })).mockResolvedValueOnce(wire);
    const { result } = renderHook(() => useLanding(SPACE));
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.landing?.spaceName).toBe('Lerngruppe');
    // Live, there is no way to answer yet: Plan 4 brings it.
    expect(result.current.answer).toBeUndefined();
  });

  it.each([403, 404])('a Space that is not yours is simply not there (%i)', async (status) => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockRejectedValue(Object.assign(new Error(String(status)), { status }));
    const { result } = renderHook(() => useLanding(SPACE));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('the demo build reads its fixture, with no request, and can answer in place', () => {
    const { result } = renderHook(() => useLanding('s-dbs'));
    expect(result.current.state).toBe('ready');
    expect(result.current.answer).toBeTypeOf('function');
    expect(landingApi).not.toHaveBeenCalled();
  });

  it('a live build never shows a made-up Space, even at a demo id', () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    setLiveWorld(emptyWorld());
    const { result } = renderHook(() => useLanding('s-dbs'));
    expect(result.current.state).toBe('empty');
    expect(result.current.landing).toBeNull();
    expect(landingApi).not.toHaveBeenCalled();
  });
});
```

In `src/features/spaces/__tests__/seam.test.ts`, change line 26 to:

```ts
const DIRS = ['screens', 'components', 'studio', 'landing'];
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/seam.test.ts`
Expected: FAIL. `landing` is not a repository method and `fromWire` / `WireLanding` do not exist. The seam test passes (the door's components import no mocks; that is what it now locks in).

- [ ] **Step 3: Implement**

`landing/types.ts`, the `readers` field of `LandingLesson` (lines 40-41):

```ts
  /**
   * Lab only: the earlier directions A to D (`src/pages/landingMockups`) draw it.
   * The wire never sends it (in a small group, "three read it" says who) and the door never reads it.
   */
  readers?: number;
```

`data/liveRepository.ts`: add to the type imports at the top

```ts
import type { Landing, LandingLesson, LandingQuestion } from '../landing/types';
```

after `LessonBatchRow` (line 195) add

```ts
/**
 * What `GET /v4/spaces/{id}/landing` sends: `Landing` without the colours the
 * app draws, a Lesson without a reader count, and the Questions channel's two
 * lists (Plan 4: waiting, answered) optional until it ships.
 */
export type WireLanding = Omit<Landing, 'accent' | 'lessons' | 'questions'> & {
  lessons: Omit<LandingLesson, 'color' | 'readers'>[];
  questions?: LandingQuestion[];
  answered?: LandingQuestion[];
};
```

and after `rehearsalHistory` (line 334) add

```ts
    /* The owner's view of their Space (How it's landing). 403 for a member, 404 for anyone else. */
    landing: (spaceId: string) => http.get<WireLanding>(`${root}/spaces/${idPath(spaceId)}/landing`),
```

Replace `src/features/spaces/data/landing.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Landing, LandingAnswer } from '../landing/types';
import { landingFor } from '../mocks/landing';
import { stageAccentFor } from '../components/stage';
import type { LoadState } from '../types';
import { loadLiveRepository, type WireLanding } from './liveRepository';
import { isLive } from './useReader';
import { liveWorld } from './world';

export type { WireLanding } from './liveRepository';

/**
 * The data seam for the owner's door.
 *
 * The demo build reads `mocks/landing.ts`, as the lab does. A live Space reads
 * `GET /api/v1/v4/spaces/{id}/landing`, in the language the app is showing,
 * and the app draws the two colours the server leaves out: the Space's light
 * from its name and each Lesson's from its order, the way every other room of
 * the Space is lit (`SpaceScreen`, `PracticeScreen`). A hue sampled from a
 * Lesson's first page belongs on the Lesson at ingest; until it is stored
 * there, order is the honest choice.
 *
 * Questions come with the Questions channel (Plan 4), as two lists, waiting
 * and answered; the door splits one list by whether it has an answer, so they
 * are joined here. Until then there are none, and the door draws no section.
 */
export function fromWire(w: WireLanding): Landing {
  const { answered, questions, ...rest } = w;
  return {
    ...rest,
    accent: stageAccentFor(w.spaceName.length),
    lessons: w.lessons.map((l) => ({ ...l, color: stageAccentFor(l.order) })),
    questions: [...(questions ?? []), ...(answered ?? [])],
    themes: w.themes ?? [],
  };
}

type Loaded = { state: LoadState; landing: Landing | null };

export interface LandingData extends Loaded {
  /**
   * Answering, only where it really happens. The demo build answers in the
   * screen's state, so the lab's answer flow works end to end. Live, answering
   * is the Questions channel's (Plan 4); until it ships there is no way to
   * answer, and the door offers none.
   */
  answer?: (questionId: string, text: string, forEveryone: boolean) => void;
  retry: () => void;
}

/** An HTTP status from the transport's error, when it carries one (`ApiError.status`). */
const statusOf = (e: unknown) => (typeof e === 'object' && e && 'status' in e ? Number((e as { status: unknown }).status) : 0);

/** Fixtures in the demo build only: a live build never shows a made-up Space, even at a demo id. */
const fixture = (spaceId: string): Loaded => {
  const landing = liveWorld() === null ? landingFor(spaceId) : null;
  return { state: landing ? 'ready' : 'empty', landing };
};

export function useLanding(spaceId: string): LandingData {
  const live = isLive(spaceId);
  const { i18n } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>(() => (live ? { state: 'loading', landing: null } : fixture(spaceId)));
  const [tick, setTick] = useState(0);

  // Demo: a different Space is a different fixture (answers in place last for the life of the Space).
  useEffect(() => {
    if (!live) setLoaded(fixture(spaceId));
  }, [spaceId, live]);

  // Live: read again on a new Space, a retry, or a new language (themes are written in it).
  useEffect(() => {
    if (!live) return;
    let alive = true;
    setLoaded({ state: 'loading', landing: null });
    loadLiveRepository()
      .then((repo) => repo.landing(spaceId))
      .then((w) => {
        if (alive) setLoaded({ state: 'ready', landing: fromWire(w) });
      })
      .catch((e) => {
        if (!alive) return;
        const s = statusOf(e);
        setLoaded({ state: s === 403 || s === 404 ? 'empty' : 'error', landing: null });
      });
    return () => {
      alive = false;
    };
  }, [spaceId, live, tick, i18n.language]);

  const answerInPlace = useCallback((questionId: string, text: string, forEveryone: boolean) => {
    const reply: LandingAnswer = { text, forEveryone, at: new Date().toISOString() };
    setLoaded((l) =>
      l.landing ? { ...l, landing: { ...l.landing, questions: l.landing.questions.map((q) => (q.id === questionId ? { ...q, answer: reply } : q)) } } : l,
    );
  }, []);
  const retry = useCallback(() => setTick((t) => t + 1), []);

  return { ...loaded, answer: live ? undefined : answerInPlace, retry };
}
```

`LandingScreen.tsx` already passes `onAnswer={answer}`; it now type-checks against the optional prop from Task 6.

- [ ] **Step 4: Run the tests and the seal**

```bash
npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx \
  src/features/spaces/__tests__/seam.test.ts src/features/spaces/__tests__/boundary.test.ts
npx tsc --noEmit -p tsconfig.app.json
npm run lint
```

Expected: all pass. The boundary holds: `react-i18next`, relative imports only, no `fetch`.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/data/liveRepository.ts src/features/spaces/data/landing.ts src/features/spaces/landing/types.ts \
  src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/seam.test.ts
git commit -m "feat(v4-landing): the door reads the Space's real view; colours drawn by the app; fixtures never live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 (frontend): The door waits, fails and sits under the floor well, live

Today every non-ready state is `NotFound` (`LandingScreen.tsx:39-46`). Live it needs: loading (the stage's skeleton), error (the stage's error with Try again), empty (not yours, or gone: `NotFound`), and ready, including the floor, which is what most real Spaces show.

**Files:**
- Modify: `src/features/spaces/landing/LandingScreen.tsx:6` (imports), `:37` (`retry`), `:39-46` (non-ready branch)
- Test: `src/features/spaces/__tests__/landing-live.test.tsx` (append)

**Interfaces:**
- Consumes: `useLanding` → `{ state, landing, answer?, retry }` (Task 7); `DetailSkeleton`, `SpacesError`, `NotFound` from `src/features/spaces/components/states.tsx:90,222,260` (`SpacesError` takes `onRetry`; `Back` is `{ to, place: 'spaces' }`).

- [ ] **Step 1: Write the failing tests**

Append to `landing-live.test.tsx` (merge the new imports into the file's import block at the top):

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import LandingScreen from '../landing/LandingScreen';

const door = () =>
  render(
    <MemoryRouter>
      <LandingScreen spaceId={SPACE} />
    </MemoryRouter>,
  );

describe('the door, live', () => {
  const live = () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    setLiveWorld(emptyWorld());
  };

  it('waits on the stage, then says it could not load, with a way to try again', async () => {
    live();
    landingApi.mockRejectedValue(Object.assign(new Error('500'), { status: 500 }));
    door();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a door that is not yours, or gone, is simply not there', async () => {
    live();
    landingApi.mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));
    door();
    expect(await screen.findByText('That Space isn’t here')).toBeInTheDocument();
  });

  it('under the floor: Luna says it once, with no count, no figures and no map', async () => {
    live();
    landingApi.mockResolvedValue(wire);
    door();
    expect(await screen.findByText('A few people have been reading. Patterns show once five people have been through a page.')).toBeInTheDocument();
    expect(screen.getAllByText(/Patterns show once five/)).toHaveLength(1);
    expect(screen.queryByText(/members read this week/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Lessons' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Questions for you' })).toBeNull();
  });

  it('a question that arrives live is read, opens its page, and offers no answer that goes nowhere', async () => {
    live();
    landingApi.mockResolvedValue({ ...wire, questions: [waiting] });
    door();
    expect(await screen.findByRole('heading', { level: 2, name: 'Questions for you' })).toBeInTheDocument();
    expect(screen.getByText('Only 2×2?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vectors, page 6' })).toHaveAttribute('href', `/v4/space/${SPACE}/lesson/l1/faces?page=6`);
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  });

  it('reads in German', async () => {
    live();
    landingApi.mockResolvedValue(wire);
    await i18n.changeLanguage('de');
    door();
    expect(await screen.findByRole('heading', { level: 1, name: 'Wie es ankommt' })).toBeInTheDocument();
    expect(screen.getByText('Ein paar Leute haben gelesen. Muster zeigen sich, sobald fünf Leute durch eine Seite sind.')).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-live.test.tsx -t "the door, live"`
Expected: the first test FAILS (no skeleton, no Try again: `NotFound` shows). The others may already pass on the ready screen; then they pin it.

- [ ] **Step 3: Implement**

In `LandingScreen.tsx`, change line 6 to `import { DetailSkeleton, NotFound, SpacesError } from '../components/states';`, line 37 to `const { state, landing, answer, retry } = useLanding(spaceId);`, and replace the non-ready branch (lines 39-46) with:

```tsx
  if (state !== 'ready' || !landing) {
    return (
      <Scene surface={SURFACES.course} status="progress" motionKey={`landing-${spaceId}`}>
        <SpacesTopBar active="spaces" viewer={viewer} />
        {state === 'loading' ? (
          <DetailSkeleton />
        ) : state === 'error' ? (
          <SpacesError what="space" onRetry={retry} />
        ) : (
          <NotFound what="space" back={{ to: '/v4/spaces', place: 'spaces' }} />
        )}
      </Scene>
    );
  }
```

In the component's doc comment, after "Under the floor it says so once, and shows no figures and no light." add: "Live, it waits on the stage's skeleton and fails with a way to try again; a door that is not yours is simply not there."

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx
npx tsc --noEmit -p tsconfig.app.json
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/landing/LandingScreen.tsx src/features/spaces/__tests__/landing-live.test.tsx
git commit -m "feat(v4-landing): the door waits, fails with a retry and sits under the floor on the stage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9 (frontend): `/v4/space/:spaceId/landing`, for the person who runs it

Spec C1. Ownership only (`courses.professor_id`), as `assert_space_owner` decides it on the server (`backend/domain/authorization.py:47-62`): an editor is not the owner.

**Files:**
- Create: `src/features/spaces/screens/SpaceOwnerGate.tsx`, `src/features/spaces/screens/LandingRoute.tsx`
- Modify: `src/App.tsx:114` (lazy imports after `SpaceMemberGate`), `:468-469` (route after `/manage`, before `:tab`)
- Modify: `src/features/spaces/components/course/OwnerBar.tsx:17-20` (doc comment only, Decision 7)
- Test: create `src/features/spaces/__tests__/landing-door.test.tsx`

**Interfaces:**
- Consumes: `spaceById(id)` (`data/world.ts:94`), `liveWorld()` (`data/world.ts:82`), `isLive` (`data/useReader.ts:45`).
- Produces: `<SpaceOwnerGate>{children}</SpaceOwnerGate>` (default export): the demo build renders its children; a live build renders them only when the Space is live, `viewerRole === 'owner'` and not `personal`, else `<Navigate replace to="/v4/space/:spaceId" />`. `LandingRoute` (default export) renders `<LandingScreen spaceId>`.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/landing-door.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { setLiveWorld } from '../data/world';
import type { Space } from '../types';
import { emptyWorld } from './emptyWorld';
import SpaceOwnerGate from '../screens/SpaceOwnerGate';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const space = (viewerRole: Space['viewerRole'], personal = false) =>
  ({ id: SPACE, name: 'Lerngruppe', owner: { id: 'u', name: 'Lea', avatarUrl: null }, viewerRole, personal, state: 'active', visibility: 'private', memberCount: 6 }) as unknown as Space;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

const visit = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/v4/space/${id}/landing`]}>
      <Where />
      <Routes>
        <Route path="/v4/space/:spaceId/landing" element={<SpaceOwnerGate><p>the door</p></SpaceOwnerGate>} />
        <Route path="/v4/space/:spaceId" element={<p>the space</p>} />
      </Routes>
    </MemoryRouter>,
  );

const liveWith = (spaces: Space[]) => {
  vi.stubEnv('VITE_V4_DATA_MODE', 'live');
  setLiveWorld(emptyWorld({ spaces }));
};

afterEach(() => {
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

describe('the door is the owner’s', () => {
  it('the person who runs the Space walks in', () => {
    liveWith([space('owner')]);
    visit(SPACE);
    expect(screen.getByText('the door')).toBeInTheDocument();
  });

  it.each([
    ['a member', [space('member')]],
    ['someone who helps run it but does not own it', [space('editor')]],
    ['someone who has not joined', [space(null)]],
    ['someone the Space is hidden from', []],
    ['the owner of their own personal Space', [space('owner', true)]],
  ])('%s is taken back to the Space', (_who, spaces) => {
    liveWith(spaces);
    visit(SPACE);
    expect(screen.getByText('the space')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe(`/v4/space/${SPACE}`);
  });

  it('a live build never opens a demo Space’s fixture', () => {
    liveWith([space('owner')]);
    visit('s-dbs');
    expect(screen.getByTestId('where').textContent).toBe('/v4/space/s-dbs');
  });

  it('the demo build opens a demo Space on its fixture', () => {
    visit('s-dbs');
    expect(screen.getByText('the door')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-door.test.tsx`
Expected: FAIL. Cannot resolve `../screens/SpaceOwnerGate`.

- [ ] **Step 3: Implement**

Create `src/features/spaces/screens/SpaceOwnerGate.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isLive } from '../data/useReader';
import { liveWorld, spaceById } from '../data/world';

/**
 * The way into a room only the person who runs a Space may see.
 *
 * How it's landing is the owner's: a member, someone who helps run it, someone
 * who has not joined, or someone the Space is hidden from is taken back to the
 * Space itself, never told the room exists. Your personal Space has no owner's
 * view: it is only you. The server says the same (`assert_space_owner`).
 *
 * The world is loaded before any v4 screen renders, so the answer is
 * synchronous. The demo build passes: its fixtures are a design study. A live
 * build never opens a demo id, so a fixture can never show as a real Space.
 */
export default function SpaceOwnerGate({ children }: { children: ReactNode }) {
  const { spaceId } = useParams<{ spaceId: string }>();
  if (!spaceId) return <Navigate replace to="/v4/spaces" />;
  if (liveWorld() === null) return <>{children}</>;
  const space = isLive(spaceId) ? spaceById(spaceId) : undefined;
  if (space?.viewerRole === 'owner' && !space.personal) return <>{children}</>;
  return <Navigate replace to={`/v4/space/${spaceId}`} />;
}
```

Create `src/features/spaces/screens/LandingRoute.tsx`:

```tsx
import { Navigate, useParams } from 'react-router-dom';
import LandingScreen from '../landing/LandingScreen';

/** Adapts the route to the door, which stays route-agnostic (as `SpaceRoute` does for the Space). */
export default function LandingRoute() {
  const { spaceId } = useParams<{ spaceId: string }>();
  return spaceId ? <LandingScreen spaceId={spaceId} /> : <Navigate replace to="/v4/spaces" />;
}
```

In `src/App.tsx`, after line 114 (`const SpaceMemberGate = lazy(…);`) add:

```tsx
const SpaceOwnerGate = lazy(() => import("./features/spaces/screens/SpaceOwnerGate"));
const V4Landing = lazy(() => import("./features/spaces/screens/LandingRoute"));
```

After the `/v4/space/:spaceId/manage` route (line 468) and before the comment above `:tab` (line 469), add:

```tsx
            {/* How it's landing: the owner's door. Declared before :tab so it is not swallowed as one. */}
            <Route path="/v4/space/:spaceId/landing" element={<SpaceOwnerGate><V4Landing /></SpaceOwnerGate>} />
```

In `src/features/spaces/components/course/OwnerBar.tsx`, change the doc comment's "a way to the course manager for everything rarer (rename, reorder, remove, analytics)" to "a way to the course manager for everything rarer (rename, reorder, remove). How the Space is landing has its own room, from the masthead." No behaviour changes.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/landing-door.test.tsx src/features/spaces/__tests__/boundary.test.ts \
  src/features/spaces/__tests__/seam.test.ts src/features/spaces/components/__tests__/reachable.test.tsx
npx tsc --noEmit -p tsconfig.app.json
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/screens/SpaceOwnerGate.tsx src/features/spaces/screens/LandingRoute.tsx src/App.tsx \
  src/features/spaces/components/course/OwnerBar.tsx src/features/spaces/__tests__/landing-door.test.tsx
git commit -m "feat(v4-landing): /v4/space/:id/landing, behind the owner's gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10 (frontend): One ghost pill on the masthead, for the owner only

Spec C2: beside **Rehearse**, "How it's landing", no number on it. An empty Space returns earlier (`CourseScreen.tsx:118-129`): nothing has landed yet, so no pill there.

**Files:**
- Modify: `src/features/spaces/screens/CourseScreen.tsx:5-23` (import `ghostPill`), `:173-179` (masthead)
- Test: `src/features/spaces/components/__tests__/oneApp.test.tsx` (new `describe`, reusing its harness: mocks at lines 17-40, `space()` at 51-52, `mountCourse` at 137-144)

**Interfaces:**
- Consumes: `v4Landing:door.pill` (en "How it’s landing", de "Wie es ankommt"); `ghostPill` (`components/stage.tsx:146`).
- Produces: a `Link` to `/v4/space/:id/landing`, shown when `space.viewerRole === 'owner' && !space.personal` and the Space has Lessons.

- [ ] **Step 1: Write the failing test**

Append to `src/features/spaces/components/__tests__/oneApp.test.tsx`:

```tsx
describe('the door, from the masthead', () => {
  const withLessons = { state: 'ready', course: { id: SPACE, title: 'Lerngruppe', author: null, lectures: [{ id: 'l1', title: 'Intro', total_slides: 3, ideas: [] }] } };
  beforeEach(() => useCourseMock.mockReturnValue(withLessons));

  it('the person who runs the Space sees one quiet way in, with no number on it', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'public')] }));
    mountCourse();
    const pill = await screen.findByRole('link', { name: 'How it’s landing' });
    expect(pill).toHaveAttribute('href', `/v4/space/${SPACE}/landing`);
    expect(pill.textContent).not.toMatch(/\d/);
    expect(screen.getByRole('link', { name: /Rehearse for the exam/ })).toBeInTheDocument();
  });

  it.each([
    ['a member', 'member'],
    ['someone who helps run it', 'editor'],
  ] as const)('%s does not', async (_who, role) => {
    setLiveWorld(emptyWorld({ spaces: [space(role)] }));
    mountCourse();
    expect(await screen.findByRole('heading', { name: 'Lerngruppe' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'How it’s landing' })).not.toBeInTheDocument();
  });

  it('nor does the owner of a personal Space', async () => {
    setLiveWorld(emptyWorld({ spaces: [{ ...space('owner'), personal: true } as Space] }));
    mountCourse();
    expect(await screen.findByRole('heading', { name: 'Lerngruppe' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'How it’s landing' })).not.toBeInTheDocument();
  });

  it('reads in German', async () => {
    await i18n.changeLanguage('de');
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'public')] }));
    mountCourse();
    expect(await screen.findByRole('link', { name: 'Wie es ankommt' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/components/__tests__/oneApp.test.tsx -t "the door, from the masthead"`
Expected: FAIL. No such link.

- [ ] **Step 3: Implement**

In `CourseScreen.tsx` add `import { ghostPill } from '../components/stage';` after the `states` import (line 9). Replace the Rehearse `Link` (lines 173-179) with:

```tsx
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={`/v4/space/${course.id}/rehearse`}
              className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-background"
            >
              <Target aria-hidden className="h-4 w-4" />
              {t('course.rehearse')}
            </Link>
            {/* The owner's door (spec C2): one quiet pill, no number on it. */}
            {owner && !space?.personal && (
              <Link to={`/v4/space/${course.id}/landing`} className={ghostPill}>
                {t('v4Landing:door.pill')}
              </Link>
            )}
          </div>
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/spaces/components/__tests__/oneApp.test.tsx src/features/spaces/components/__tests__/modes.test.tsx \
  src/features/spaces/components/__tests__/spaceGerman.plan.test.tsx src/features/spaces/components/__tests__/responsive.test.tsx
npx tsc --noEmit -p tsconfig.app.json
node scripts/check-v4-strings.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/screens/CourseScreen.tsx src/features/spaces/components/__tests__/oneApp.test.tsx
git commit -m "feat(v4-landing): the owner's pill beside Rehearse, no number on it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11 (frontend): Each finding says only what its numbers back

What is left of old Task 13 after PR A. Verified against `v4Landing.json` on `68bf5752`: every summary already names its page and none names its Lesson (spec §8: "Finding sentences name their page but not their Lesson"). Old Task 13's "drop the page" was reversed by that decision and is not done. Four summaries claim more than the engine measured (thresholds in "What the code says today"):

- `confusion_block`: "for **most** who read them". The bar is one in four raters per page.
- `overpacked`: "and **many ask for help** there". The detector fires on erratic dwell **or** help-seeking; what it always has is ≥ 30% foggy.
- `quiz_misalignment`: "passed its **practice**". The share is over practice **and** checkpoint first tries.
- `healthy`: "**Few asked for help**, and most cleared its **checkpoints**". It is a page that drew confusion (≥ 25% foggy) that ≥ 75% then got right first try, over practice and checkpoints.

**Files:**
- Modify: `src/i18n/locales/en/v4Landing.json` and `de/v4Landing.json`: `kind.confusion_block.summary`, `kind.overpacked.summary`, `kind.quiz_misalignment.summary`, `kind.healthy.summary`
- Modify: `src/features/spaces/mocks/landing.ts` (`i-dbs-healthy-2`: `metrics: {}`, as `collapse_healthy` sends it, `landing_map.py:126-129`)
- Test: `src/features/spaces/__tests__/landing.test.tsx` (new `describe`)

- [ ] **Step 1: Write the failing test**

Append to `landing.test.tsx`:

```tsx
describe('each finding says only what its numbers back', () => {
  const en = i18n.getFixedT('en', 'v4Landing');
  const de = i18n.getFixedT('de', 'v4Landing');

  it('a foggy stretch claims one in four, not most', () => {
    expect(en('kind.confusion_block.summary', { first: 3, last: 5 })).toBe('Pages 3 to 5 ran foggy for at least one in four of the people who said how those pages read.');
    expect(de('kind.confusion_block.summary', { first: 3, last: 5 })).toBe('Die Seiten 3 bis 5 waren für mindestens jede vierte Person nebelig, die gesagt hat, wie sie sich lesen.');
  });

  it('a page that asks too much is said to be foggy, which the engine always measured', () => {
    expect(en('kind.overpacked.summary', { page: 7, ratio: '2.1' })).toBe('Page 7 holds people 2.1× longer than the other pages, and at least three in ten said it was still foggy.');
    expect(de('kind.overpacked.summary', { page: 7, ratio: '2.1' })).toBe('Seite 7 hält Leute 2.1× länger als die anderen Seiten, und mindestens drei von zehn fanden sie noch nebelig.');
  });

  it('a question that tests something else counts its questions, practice and checkpoints alike', () => {
    expect(en('kind.quiz_misalignment.summary', { page: 22, pct: 38 })).toBe('Page 22 read easily, yet only 38% got its questions right first try.');
    expect(de('kind.quiz_misalignment.summary', { page: 22, pct: 38 })).toBe('Seite 22 las sich leicht, doch nur 38% haben ihre Fragen beim ersten Versuch gelöst.');
  });

  it('a Lesson that is landing names a struggle that resolved, not an easy ride', () => {
    expect(en('kind.healthy.summary')).toBe('A page here asked something of people, and most then got its questions right first try.');
    expect(de('kind.healthy.summary')).toBe('Eine Seite hier hat den Leuten etwas abverlangt, und die meisten haben ihre Fragen danach beim ersten Versuch gelöst.');
  });

  it.each(['en', 'de'])('no finding sentence names its Lesson (%s)', (lng) => {
    const t = i18n.getFixedT(lng, 'v4Landing');
    const kinds = ['confusion_hotspot', 'skipped_slide', 'speed_bump', 'overpacked', 'leaky_bucket', 'confusion_block', 'quiz_misalignment', 'calibration_gap', 'healthy'];
    for (const k of kinds) {
      const s = t(`kind.${k}.summary`, { page: 12, first: 3, last: 5, lesson: 'Normalization', askers: 7, foggy: 40, seconds: 3, backs: 6, ratio: '2.1', pct: 30 });
      expect(s, `${lng} ${k}`).not.toMatch(/Normalization/);
      expect(s, `${lng} ${k}`).not.toMatch(/[–—]/);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/landing.test.tsx -t "each finding says only what its numbers back"`
Expected: the first four FAIL on today's wording; the last passes (it pins the page/Lesson rule).

- [ ] **Step 3: Write the copy**

`en/v4Landing.json`, inside `kind` (replace only these `summary` values; `headline` and `why` stay):

```json
"confusion_block": { "summary": "Pages {{first}} to {{last}} ran foggy for at least one in four of the people who said how those pages read." },
"overpacked": { "summary": "Page {{page}} holds people {{ratio}}× longer than the other pages, and at least three in ten said it was still foggy." },
"quiz_misalignment": { "summary": "Page {{page}} read easily, yet only {{pct}}% got its questions right first try." },
"healthy": { "summary": "A page here asked something of people, and most then got its questions right first try." }
```

`de/v4Landing.json` (du, no exclamation marks):

```json
"confusion_block": { "summary": "Die Seiten {{first}} bis {{last}} waren für mindestens jede vierte Person nebelig, die gesagt hat, wie sie sich lesen." },
"overpacked": { "summary": "Seite {{page}} hält Leute {{ratio}}× länger als die anderen Seiten, und mindestens drei von zehn fanden sie noch nebelig." },
"quiz_misalignment": { "summary": "Seite {{page}} las sich leicht, doch nur {{pct}}% haben ihre Fragen beim ersten Versuch gelöst." },
"healthy": { "summary": "Eine Seite hier hat den Leuten etwas abverlangt, und die meisten haben ihre Fragen danach beim ersten Versuch gelöst." }
```

Merge each into its existing `kind.<k>` object. In `mocks/landing.ts`, change `i-dbs-healthy-2`'s `metrics: { firstTry: 91, foggy: 6 }` to `metrics: {}`.

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/features/spaces/__tests__/landing.test.tsx src/features/spaces/__tests__/v4Strings.test.ts
npm run lint
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
```

Expected: pass; i18n parity holds; vocabulary total unchanged. `HOTSPOT` and `TRAP` in `landing.test.tsx` (lines 34-35) are untouched kinds and still match.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json src/features/spaces/mocks/landing.ts \
  src/features/spaces/__tests__/landing.test.tsx
git commit -m "fix(v4-landing): each finding says only what its numbers back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: See it on a phone, in German, without motion; then hand over

**Files:** none changed unless a check fails.

- [ ] **Step 1: Every gate**

```bash
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx vitest run 2>&1 | tail -15
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider 2>&1 | tail -3
/Library/Frameworks/Python.framework/Versions/3.11/bin/ruff check backend/ --select F821,F811,F841
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
git diff --stat origin/main -- supabase/ | tail -1
```

Expected: green except Task 0's pre-existing failures (the 19 `streamdown` files). pytest has no xfail left in `test_landing_stories.py` and more passes than Task 0 (the new tests). Vocabulary at or below Task 0. The `supabase/` diff is empty (no migration).

- [ ] **Step 2: In the browser, demo build (no `.env`, no prod)**

Start a dev server from this worktree in demo mode (the default without `VITE_V4_DATA_MODE`; `import.meta.env.DEV` opens the v4 routes, `src/App.tsx:171-172`). Use `preview_start` with the `dev` configuration if this session's `.claude/launch.json` resolves to the worktree; otherwise add a worktree entry to the session's launch config that runs `node node_modules/vite/bin/vite.js --port 5221 --strictPort` with `cwd` set to the worktree. Never copy the main tree's `.env` into the worktree.

- Open `/v4/space/s-dbs/landing`, `/v4/space/s-friends/landing` and `/v4/space/s-big/landing` (the demo build passes the gate).
  - s-dbs: Luna says "2 pages are asking for you. Start with Relational Algebra." beside **Open page 9**; Integrity shows 6 dark cells and 10 outlined ones; the map's lede has the outline sentence.
  - s-friends: "A few people have been reading. …", no figures, no map, the one question as a row with the initial ring.
  - s-big: opens page 21 of Concurrency; no outline sentence.
- `resize_window` preset `mobile` (375×812):
  - no horizontal scroll: `document.documentElement.scrollWidth <= innerWidth` via `javascript_tool`;
  - an outlined cell is visibly an outline at 375 px (zoom on Integrity), and cells on the 120-page Lesson stay at least 3 px wide;
  - Luna's button is reachable.
- Switch the app to Deutsch and read every line of the door: du, Lektion/Seite/Idee, no Folie/Vorlesung/Kurs; the floor line and the outline sentence in German.
- Reduced motion: `resize_window` does not emulate it, so check the code path: `grep -n "initial=" src/features/spaces/landing/*.tsx` shows every `motion.*` keyed off `useReducedMotion()` (the outline cell reuses the existing cell's motion), and `npx vitest run src/features/spaces/components/__tests__/motion.test.tsx` passes.
- `read_console_messages` with `onlyErrors`: none.
- Reset with preset `desktop`.

- [ ] **Step 3: In the browser, live, only with Abi**

Live data needs a signed-in owner, and the existing local dev setup (the main tree's `.env`) reads the **prod** database. Do it only while Abi is there, read-only, in the main tree's running dev server (not this worktree). Abi signs in himself on `/auth` (the agent never types a password; note that `form_input` does not register there). Then, as the owner of a real Space:
- the pill shows beside Rehearse on the Space; as a member's Space it does not;
- the door opens; most real Spaces show the floor or the nobody line;
- `read_network_requests` with `urlPattern: "/landing"`: the payload has `reach`, no `readers`, `null`s in `help` where pages are under the floor, and no name, id, email or question text;
- colours draw.

That backend is the main tree's code, not this branch, until the PR is deployed: if it still sends `readers`, note it and do not judge the floor line from it. Otherwise skip this step and say so in the PR.

- [ ] **Step 4: Open the PR**

```bash
git status && git log -1 --oneline
git push -u origin claude/landing-plan-3-door-in-v4
```

Open **"How it's landing, Plan 3 PR B: the door in v4"** against `main`. The description lists Tasks 1 to 11 one line each; Decisions 1, 3, 4 and 5 (reach, outline rules, questions shape and no live Answer, fixtures never live); that old Task 15 (live answering) is left to Plan 4; that Plan 4's plan must read `reach` where it reads `body["readers"]` (its Task with `test_space_questions_db.py`, around its line 1441); the deploy below; and the open questions. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. CI runs on the PR (not on the branch push). Auto-merge is off: Abi merges by hand after CI.

- [ ] **Step 5: Record it**

Update `/Users/abdullahabobaker/.claude/projects/-Users-abdullahabobaker-Desktop-ascend-academy/memory/project_analytics_v4_integration.md`: PR B's number, what it changed (reach, outlines, the door live), that it needs a backend and frontend deploy and no migration, and that Plan 4 is next. If the release punch list artifact is reachable in the session (db collection `issues`), add or close the matching `LS-NNN` rows (the door in v4; story 5); otherwise list them in the PR for Abi.

---

## Deploy (manual, `docs/runbooks/deploy-main-to-prod.md`)

**What ships together:** backend (Tasks 1 and 2: `api`) and frontend (Tasks 3 to 11: `frontend`). **No migration** (Task 12 Step 1 checks). The worker runs no landing code; if the compose file builds `api` and `worker` from one image, recreating both is harmless.

1. **Check what prod runs first.** PR A (#175) is in the last full deploy (main @ `c57721f2`, 2026-11-06). Compare image build dates in UTC (`docker images`) against the merge commit of this PR (+0200 in `git log`). An unauthenticated `curl -s -o /dev/null -w '%{http_code}' https://learnstation.app/api/v1/v4/spaces/00000000-0000-0000-0000-000000000000/landing` answers 401 or 403, not 404.
2. **Rollback tags first** (`pre-deploy-main-<date>`), as the runbook does.
3. **Backend, then frontend.** Nothing in prod reads the landing endpoint before this PR's frontend (the door has no live route until then), so the order is safe either way; backend first means the first live door already gets `reach`. `LANDING_VERSION` moved to `landing-v2`, so no cached `landing` row of the old shape is served; no cache cleanup is needed.
4. **Frontend rebuild**, not a restart (`VITE_*` are baked at build). No new `VITE_*` flag.
5. **After deploy:**
   - As an owner, the pill shows on the Space masthead; as a member it does not; `/v4/space/<id>/landing` as a member lands on the Space.
   - The door's request returns `reach` and no `readers`.
   - Better Stack stays green.

## Open questions for Abi

1. **The zero line.** With nobody reading yet (the commonest real state), "A few people have been reading" would be false, so Luna says: "Nobody has been reading yet. Patterns show once five people have been through a page." (de: "Noch hat niemand gelesen. Muster zeigen sich, sobald fünf Leute durch eine Seite sind.") Is that wording right?
2. **A named asker on the door.** Plan 4 sends a name only (no id, no face), so PR B draws every question with the same quiet ring: the name's first letter, or "?" for Someone. Is that right, or should a named asker show their own astronaut (which needs Plan 4 to send more than a name)?

## Self-review notes (done while writing)

- **Spec coverage, Phase C:**
  - C1 → Task 9 (route before `:tab`; ownership only, editor and personal excluded; `/manage` unchanged, Decision 7).
  - C2 → Task 10.
  - C3/C4 → built on fixtures before this plan; Task 3 (lede), Task 4 (outline, fold rule), Task 5 (traps first), Task 6 (questions), Task 8 (live states), Task 11 (copy).
  - C5 → Task 7 (live seam, ratchet covers `landing/`).
  - C6 → Tasks 3, 4, 8, 10, 11 (en+de), Task 12 (phone width, reduced motion, vocabulary).
  - C7 → owner sees pill / member and editor don't: Task 10; gate redirects: Task 9; floor state: Tasks 3 and 8; expand and open-page link: kept in `landing.test.tsx`; German: Tasks 3, 4, 8, 10, 11; live mapping: Task 7.
- **§6/§8 Questions:** waiting above the map, Answered fold, no section when empty: already built; Task 7 passes Plan 4's two lists through; Task 6 and Task 8 ensure live never offers a dead Answer. Old Task 15 is out (Plan 4).
- **§8 fold rules:** kept; Task 4 adds the one consequence of outlines (an outlined Lesson never folds as landing).
- **Abi 2026-11-06:** 1 → Tasks 1 and 4; 2 → Tasks 2 and 3 (Decision 1 for the wire); 3 → Task 5; 4 → not re-planned (Task 7 only makes the frontend type agree with the wire, Decision 9).
- **Placeholders:** none; every code step carries its code, every run step its command and expected result.
- **Names across tasks:** backend `help_share`, `help_index`, `reach()`, `LANDING_VERSION = "landing-v2"`; wire `reach`, `help: (number | null)[]`, optional `questions` / `answered`; frontend `Reach`, `Landing.reach`, `ledeKey(insights, reach)`, `cellColor(color, help: number | null, finding)`, `data-cell`, `LandingAsker`, `QuestionsRow` `onAnswer?`, `WireLanding`, `fromWire`, `LandingData`, `useLanding` → `{ state, landing, answer?, retry }`, `LiveRepository.landing`, `SpaceOwnerGate`, `LandingRoute`, `V4Landing`; i18n `door.lede.floor`, `door.lede.none`, `lessons.mapLedeOutlined`. Consistent in every task that uses them.
