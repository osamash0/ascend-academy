> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Parent plan: docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md (its Global Constraints bind every task here).

# Arc 7: Make receipts and savings real. TDD implementation plan

Worktree: `/Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd`.

Python: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python` (3.13.1). All commands run from the worktree root.

Every function, column and fixture named below was checked against the branch at `8673a94`.

## Decisions (read before the tasks)

**D1. Only the synthesis input changes. `content` stays raw.**
- `deck_plan.synthesis_text(raw, skeleton, i, min_chars)` returns the stripped skeleton text when two things hold: the deck has boilerplate, and stripping leaves at least `_MIN_TEXT_FOR_SYNTH` (25) characters. Otherwise it returns the raw page.
- Routing does not change. `text_idxs` is still decided on raw length.
- Problem: the batch and per-slide helpers echo their input back as `content` (`"content": text` at `unified_orchestrator.py:142` and `:270`). So the main loop has to set `content = raw_slides[i]` for the `batch` and `per_slide` routes.
- Real-world fallback case: `_long_pages()` in the existing tests produces "...Slide {i}." on every page. Digit folding makes the whole page boilerplate. The fallback sends raw text, so the slide is never sent empty.

**D2. The vision path is unaffected (keep it raw).**
- A slide goes to vision only when its RAW text is under 25 characters. That check happens before any stripping.
- The vision model gets the rendered image plus the raw text as an OCR hint (`analyze_slide_vision(b64, text, ...)`).
- Stripping could only shorten a hint that is already under 25 characters, and that text is also visible in the image.
- The receipt records `input_text: "raw"` for vision slides.

**D3. Prompt-version policy.** A version names the prompt's input contract, not just its template text.
- Bump when the template changes, or when the prompt's single caller changes what it puts into the template (which slides, stripped or raw).
- Do not bump a prompt that callers with different inputs share. Instead, record the per-slide input in the receipt as `slide_provenance[].input_text`, with values `"stripped"`, `"raw"` or `None`.

Applied:

| Prompt | Change | Reason |
|---|---|---|
| `SLIDE_ANALYSIS_PROMPT` | v2 → v3 | Only caller is `synthesis.analyze_slide`, called only from `unified_orchestrator`. |
| `LECTURE_META_ANALYSIS_PROMPT` | v2 → v3 | Fixes Arc 2 retroactively: its input moved from `slides[:15]` raw to skeleton-selected stripped text with no bump. This is the flag from the final review. |
| `BATCH_SLIDE_PROMPT` | stays v3 | `file_parse_service.py:499/533` and `slide_synth_service.py:80` still send raw text. A bump would mislabel their outputs. |
| `SYNTHESIS_DECK_QUIZ_PROMPT` | stays v3 | v3 (Arc 4) was released after Arc 2's input change, so every v3 output already used stripped input. |
| `SYNTHESIS_QUIZ_REPAIR_PROMPT` | stays v1 | It has used stripped text since it was created. |

**D4. A ContextVar, not parameter threading.**
- Threading `run_id`, `slide_indices` and `prompt_name` as parameters would change these signatures:
  - `synthesis.analyze_slide`
  - `generate_text_bulk` (20+ callers)
  - `batch_analyze_text_slides` (3 callers)
  - `_synthesize_slide`
- Test fakes copy those signatures exactly, for example `fake(prompt, ai_model=None)` in `test_synthesis.py` and `synth(idx, text, ctx, model, pdf, source_language="en")` in `test_unified_orchestrator.py` and `test_unified_pipeline_e2e.py`.
- A module global is not an option: Arq runs concurrent jobs as separate Tasks in one process, and a global would mix their contexts.

ContextVar behaviour that matters here:
- `asyncio.gather` wraps each coroutine in a Task, and a Task copies the context when it is created. A per-slide scope therefore has to be entered inside each coroutine, which is what the new `_synthesize_slide_scoped` does. Never wrap the scope around the gather.
- `asyncio.to_thread` copies the context. I checked the 3.13 source: it uses `contextvars.copy_context()` and `ctx.run`.
- `call_llm` uses `run_in_executor` (`llm_client.py:47`), which does NOT copy the context. That is harmless: `_account_for_call` runs on the event loop in the awaiting coroutine. In 3.12+, `wait_for` does not create a Task.
- The per-run `calls` list is shared by reference with every child context, so calls recorded in child Tasks land in the parse's list.

**D5. Storage: a new migration for `llm_calls`, and a fold into the unapplied receipts migration.**
- `llm_calls` (20260719010000) is applied in production, so it needs an ALTER in a new file: `20261012010000_llm_calls_run_context.sql`. It sorts after origin/main's `20261011000100` and this branch's `20261012000000`. It adds:
  - `run_id uuid` (no FK)
  - `slide_indices integer[]`
  - `prompt_name text`
  - a partial index on `run_id`
- I chose `slide_indices integer[]` over one `slide_index int` because a single batch call covers up to 8 slides. One int would misattribute; an array is exact. Deck-level calls store NULL.
- No FK on `run_id`: `log_llm_call` swallows insert errors, so an FK violation would silently drop a billed cost row.
- `parse_receipts` is unapplied everywhere, so its new `llm_usage jsonb` column is folded into `20261012000000`. This keeps one CREATE TABLE as the single definition.

**D6. Grants on `llm_calls`.**
- The original migration relies on RLS (service-role-only policies) while Supabase default privileges still grant anon and authenticated full table privileges. The test bootstrap reproduces this with `ALTER DEFAULT PRIVILEGES ... TO anon, authenticated`.
- The new migration revokes from `PUBLIC, anon, authenticated` and grants ALL to `service_role`, as `parse_receipts` does.
- Authenticated users then cannot read any rows, including their own. Today they read 0 rows because of RLS. No client reads this table; only the generated `src/integrations/supabase/types.ts` mentions it.
- The backend uses asyncpg as the table owner (`cost.py`, `admin.py:697`), which these grants do not affect.

**D7. The receipt is built at finalize from an in-memory per-attempt list, not by joining at read time.**
- `_account_for_call` records each served call, with provider, model, tokens, cost, prompt and slides, in two places: the context's call list, and `llm_calls` (now carrying `run_id`).
- At finalize, the orchestrator folds the list into:
  - `slide_provenance[i].served_by`
  - `slide_provenance[i].cost_usd` (the slide's even share of each call)
  - `parse_receipts.llm_usage` (run totals)
- Reasons for finalize over a read-time join:
  1. A forced re-parse reuses `parse_runs.run_id` (`get_or_create_run` upserts and never updates `started_at`). A join by `run_id` would add up every attempt and double-count. The receipt `created_at` resets at write time (`repos.py:515`), which is after the calls, so it cannot scope the join. The in-memory list is per-attempt by construction.
  2. The receipt does not depend on the best-effort `llm_calls` insert succeeding, and it does not depend on the order migrations are deployed.
  3. The endpoint stays a single read with no second PostgREST query.
- `llm_calls.run_id` is the durable, complete ledger. It also covers calls made after the receipt is written (localization).
- `llm_calls` writes are awaited inline in `_account_for_call` (not fire-and-forget, not batched; verified at `orchestrator.py:1300`). They stay best-effort: `log_llm_call` catches every exception.

**D8. Bounds.**
- If code deploys before the migration is applied, the run-context INSERT fails with `asyncpg.exceptions.UndefinedColumnError` (SQLSTATE 42703, verified constructible). `log_llm_call` then retries the legacy INSERT, so the cost row survives.
- Calls with no context still use the unchanged legacy SQL.
- `record_served_call` never raises and caps the list at `MAX_RECORDED_CALLS`.
- The fold that builds the receipt usage runs in its own try. If it fails, the receipt is still written without usage.

**Known gaps, stated in the code and the receipt rather than faked:**
- Vision calls are not metered: `ai/vision.py` calls providers via `asyncio.to_thread(_sync_analyze_vision, ...)` and never reaches `_account_for_call`. The receipt carries `llm_usage.vision_metered = False`, and vision slides get `served_by: []`.
- The admin-slide classifier (`content_filter.py:293` → `_llm_generate_text_sync`) is not metered either.
- Failed calls (every provider raised) are never accounted. That is unchanged.

**Commands.**
- Unit: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest <path> -m "not db" -q`
- DB: `DB_TEST_LOCAL_ADMIN_DSN=postgresql://localhost:1/postgres /Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest <path> -m db -q` (Docker running; testcontainers only).

**Commit trailers:** per the ledger ruling, the trailer names the model that actually wrote the commit.

---

## Task 1: Per-slide synthesis sends boilerplate-stripped text; persisted content stays raw

**Files**
- `backend/services/parser/deck_plan.py`
- `backend/services/parser/unified_orchestrator.py`
- `backend/tests/unit/test_deck_plan_synthesis_text.py` (new)
- `backend/tests/unit/test_unified_orchestrator.py`

**Interfaces**
- Consumes: `DeckSkeleton.boilerplate: frozenset[str]`, `DeckSkeleton.slides[i].text`, `unified_orchestrator._MIN_TEXT_FOR_SYNTH = 25`, `skeleton` (local in `parse_pdf_unified`, may be None).
- Produces: `deck_plan.synthesis_text(raw: str, skeleton: DeckSkeleton | None, index: int, min_chars: int) -> str`.

**Step 1: failing tests.**

New file `backend/tests/unit/test_deck_plan_synthesis_text.py`:
```python
"""deck_plan.synthesis_text: what per-slide synthesis sends the model (Arc 7).

Fixture rules (deck_plan.normalize_line folds digit runs to '#'): lines differ
by letters, the deck has >= 4 pages, and FOOTER is on every page so it is
stripped as boilerplate."""
from backend.services.parser.deck_plan import build_deck_skeleton, synthesis_text

FOOTER = "Course Footer Line"
PAGES = [
    f"Lecture Title Alpha\n{FOOTER}",
    f"Heading bravo\nThis slide explains the bravo concept in enough words.\n{FOOTER}",
    f"Heading charlie\nThis slide explains the charlie concept in enough words.\n{FOOTER}",
    f"Heading delta\nThis slide explains the delta concept in enough words.\n{FOOTER}",
]


def test_sends_stripped_text_when_enough_remains():
    sk = build_deck_skeleton(PAGES)
    assert sk.boilerplate == frozenset({"course footer line"})
    assert synthesis_text(PAGES[1], sk, 1, 25) == (
        "Heading bravo\nThis slide explains the bravo concept in enough words."
    )


def test_falls_back_to_raw_when_stripping_leaves_too_little():
    sk = build_deck_skeleton(PAGES)
    assert sk.slides[0].text == "Lecture Title Alpha"  # 19 chars < 25
    assert synthesis_text(PAGES[0], sk, 0, 25) is PAGES[0]


def test_threshold_is_inclusive():
    sk = build_deck_skeleton(PAGES)
    assert synthesis_text(PAGES[0], sk, 0, 19) == "Lecture Title Alpha"
    assert synthesis_text(PAGES[0], sk, 0, 20) is PAGES[0]


def test_raw_without_a_skeleton():
    assert synthesis_text(PAGES[1], None, 1, 25) is PAGES[1]


def test_raw_when_the_deck_has_no_boilerplate():
    pages = PAGES[:3]  # < 4 pages: boilerplate detection does not run
    sk = build_deck_skeleton(pages)
    assert sk.boilerplate == frozenset()
    assert synthesis_text(pages[1], sk, 1, 25) is pages[1]


def test_raw_for_an_index_outside_the_skeleton():
    sk = build_deck_skeleton(PAGES)
    extra = "An extra page that the skeleton never saw at all."
    assert synthesis_text(extra, sk, 9, 25) is extra
    assert synthesis_text(extra, sk, -1, 25) is extra
```

Append to `backend/tests/unit/test_unified_orchestrator.py`:
```python
# ── Arc 7: per-slide synthesis input ─────────────────────────────────────────

ARC7_FOOTER = "Prof Example Course Footer"
ARC7_DECK = [
    f"Short Title Bravo\n{ARC7_FOOTER}",  # stripped = 17 chars -> raw fallback
    f"Breadth-first search visits every vertex level by level.\n{ARC7_FOOTER}",
    f"Depth-first search follows one branch to its end first.\n{ARC7_FOOTER}",
    f"Dijkstra finds shortest paths with nonnegative weights.\n{ARC7_FOOTER}",
]


def _slide_contents(events):
    return {d["index"]: d["slide"]["content"] for t, d in events if t == "slide"}


async def test_batch_synthesis_gets_stripped_text_but_slides_keep_raw_content(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    rec, run = _patch_common(monkeypatch, pages=ARC7_DECK)
    sent = {}

    async def capturing_batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        sent.update({s["index"]: s["text"] for s in slides_input})
        return [{"index": s["index"], "title": f"S{s['index']}", "summary": f"sum{s['index']}",
                 "slide_type": "text"} for s in slides_input]

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", capturing_batch)
    events = await _run("h", OWNER, filename="Deck.pdf")

    assert sent[1] == "Breadth-first search visits every vertex level by level."
    assert all(ARC7_FOOTER not in sent[i] for i in (1, 2, 3))
    assert sent[0] == ARC7_DECK[0]  # never sent near-empty
    assert _slide_contents(events) == dict(enumerate(ARC7_DECK))


async def test_per_slide_fallback_gets_stripped_text_but_slides_keep_raw_content(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    rec, run = _patch_common(monkeypatch, pages=ARC7_DECK)

    async def failing_batch(*_a, **_k):
        raise RuntimeError("batch provider down")

    seen = {}

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        seen[idx] = text
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", failing_batch)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    events = await _run("h", OWNER, filename="Deck.pdf")

    assert seen[2] == "Depth-first search follows one branch to its end first."
    assert seen[0] == ARC7_DECK[0]
    assert _slide_contents(events) == dict(enumerate(ARC7_DECK))
```

**Step 2: run and confirm the failures.**
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_deck_plan_synthesis_text.py backend/tests/unit/test_unified_orchestrator.py -k "synthesis_text or stripped or Stripped or sends_ or falls_back or threshold or raw_" -m "not db" -q
```
Expected:
- `ImportError: cannot import name 'synthesis_text' from 'backend.services.parser.deck_plan'` (collection error).
- The two orchestrator tests fail with `AssertionError`: `sent[1]` still ends in `"\nProf Example Course Footer"`.

**Step 3: minimal implementation.**

In `deck_plan.py`, replace the last paragraph of the module docstring:
```
By design, lines repeated on >=60% of pages are stripped as boilerplate, and
the stripped text now feeds the meta and quiz prompts, so a genuinely repeated
content line (e.g. a recurring "Step 1" heading) is invisible to them.
```
with:
```
By design, lines repeated on >=60% of pages are stripped as boilerplate, and
the stripped text feeds the meta, quiz and per-slide synthesis prompts (see
synthesis_text for the per-slide raw fallback), so a genuinely repeated content
line (e.g. a recurring "Step 1" heading) is invisible to them.
```

Add after `skeleton_receipt` in `deck_plan.py`:
```python
def synthesis_text(raw: str, skeleton: DeckSkeleton | None, index: int, min_chars: int) -> str:
    """The text per-slide synthesis sends the model for page ``index``.

    The boilerplate-stripped skeleton text when the deck has boilerplate and
    stripping leaves at least ``min_chars`` characters; otherwise ``raw``, so a
    slide whose text is (almost) all template is never sent empty. Only the LLM
    input changes: the persisted slide content stays raw."""
    if skeleton is None or not skeleton.boilerplate or not 0 <= index < len(skeleton.slides):
        return raw
    stripped = skeleton.slides[index].text
    return stripped if len(stripped.strip()) >= min_chars else raw
```

In `unified_orchestrator.py` (inside the chunk loop), replace:
```python
                if text_idxs:
                    text_items = [(i, raw_slides[i]) for i in text_idxs]
```
with:
```python
                if text_idxs:
                    from backend.services.parser.deck_plan import synthesis_text
                    # Arc 7: the model reads boilerplate-stripped text (raw
                    # fallback under _MIN_TEXT_FOR_SYNTH); routing above and the
                    # persisted content below stay on the raw page.
                    text_items = [
                        (i, synthesis_text(raw_slides[i], skeleton, i, _MIN_TEXT_FOR_SYNTH))
                        for i in text_idxs
                    ]
```

Further down in the same function, replace:
```python
                ui_slide = {
                    "title": title,
                    "content": res.get("content", raw_slides[i]) or "",
```
with:
```python
                # Text routes echo the (stripped) synthesis input as content;
                # students must see the real page, so pin it to the raw text.
                content = (
                    raw_slides[i] if route in ("batch", "per_slide")
                    else res.get("content", raw_slides[i])
                )
                ui_slide = {
                    "title": title,
                    "content": content or "",
```

**Step 4: green.** Re-run the Step 2 command. Then run the whole module plus the full unit suite: `... -m pytest backend/tests -m "not db" -q`. All pass. The `_long_pages` decks hit the raw fallback, so batch-count tests are unchanged.

**Step 5: mutation-verify.**

| Revert | Expected |
|---|---|
| `(i, synthesis_text(raw_slides[i], skeleton, i, _MIN_TEXT_FOR_SYNTH))` → `(i, raw_slides[i])` | Both orchestrator tests fail on `sent[1]` / `seen[2]`. |
| `raw_slides[i] if route in ("batch", "per_slide")` → `res.get("content", raw_slides[i]) if route in ("batch", "per_slide")` | `_slide_contents` assertion fails (stripped content persisted). |
| `return stripped if len(stripped.strip()) >= min_chars else raw` → `return stripped` | `test_falls_back_to_raw...` and `sent[0]` fail. |
| `not skeleton.boilerplate or` → delete it | `test_raw_when_the_deck_has_no_boilerplate` fails: the identity check fails because strip rejoins lines. |

Restore each one.

**Step 6: commit.** `feat(parser): per-slide synthesis reads boilerplate-stripped text (raw fallback <25 chars); slide content stays raw`

---

## Task 2: Receipt records each slide's synthesis input; prompt-version bumps follow the input-contract policy

**Files**
- `backend/services/parser/unified_orchestrator.py`
- `backend/services/ai/prompts.py`
- `backend/tests/unit/test_unified_orchestrator.py`

**Interfaces**
- Consumes: `deck_plan.synthesis_text` (Task 1), `_provenance_entry`, `PROMPT_VERSIONS`.
- Produces:
  - `unified_orchestrator._input_text_kind(route: str, raw: str, sent: Optional[str]) -> Optional[str]`
  - `_provenance_entry(index, route, *, ai_model, synthesis_failed, needs_review, review_reason, input_text: Optional[str] = None)`
  - A new `"input_text"` key in every provenance entry.
  - `PROMPT_VERSIONS["SLIDE_ANALYSIS_PROMPT"] == "v3"` and `PROMPT_VERSIONS["LECTURE_META_ANALYSIS_PROMPT"] == "v3"`.

**Step 1: failing tests.** Append to `test_unified_orchestrator.py`:
```python
def test_input_text_kind():
    assert uo._input_text_kind("heuristic", "raw", None) is None
    assert uo._input_text_kind("batch", "raw page", "stripped page") == "stripped"
    assert uo._input_text_kind("per_slide", "raw page", "raw page") == "raw"
    assert uo._input_text_kind("per_slide", "raw page", None) == "raw"
    assert uo._input_text_kind("vision", "raw page", "stripped page") == "raw"


async def test_receipt_records_what_text_each_slide_prompt_received(monkeypatch):
    rec, run = _patch_common(monkeypatch, pages=ARC7_DECK)
    await _run("h", OWNER, filename="Deck.pdf")
    prov = rec["receipts"][0]["slide_provenance"]
    assert [p["input_text"] for p in prov] == ["raw", "stripped", "stripped", "stripped"]


async def test_on_demand_receipt_has_no_input_text(monkeypatch):
    rec, run = _patch_common(monkeypatch, pages=["raw text 0", "raw text 1"])
    await _run("h", OWNER, filename="Deck.pdf", parsing_mode="on_demand")
    assert [p["input_text"] for p in rec["receipts"][0]["slide_provenance"]] == [None, None]


def test_prompt_versions_follow_the_input_contract_policy():
    from backend.services.ai.prompts import PROMPT_VERSIONS
    # Single-caller prompts whose input changed: bumped.
    assert PROMPT_VERSIONS["SLIDE_ANALYSIS_PROMPT"] == "v3"
    assert PROMPT_VERSIONS["LECTURE_META_ANALYSIS_PROMPT"] == "v3"
    # Shared with raw-text callers (file_parse_service, slide_synth_service): not
    # bumped; slide_provenance[].input_text says what each slide received.
    assert PROMPT_VERSIONS["BATCH_SLIDE_PROMPT"] == "v3"
```

Edit the existing `test_receipt_provenance_records_batch_and_vision_routes`. Its expected `prov[0]` dict becomes:
```python
    assert prov[0] == {
        "index": 0, "route": "batch", "prompt": "BATCH_SLIDE_PROMPT",
        "prompt_version": PROMPT_VERSIONS["BATCH_SLIDE_PROMPT"], "requested_model": "groq",
        "input_text": "raw",
        "synthesis_failed": False, "needs_review": False, "review_reason": None,
    }
    assert prov[2]["input_text"] == "raw"
```

**Step 2: run.**
```
... -m pytest backend/tests/unit/test_unified_orchestrator.py -k "input_text or prompt_versions or provenance_records" -m "not db" -q
```
Expected: `AttributeError: module ... has no attribute '_input_text_kind'`, `KeyError: 'input_text'`, and `AssertionError: 'v2' == 'v3'`.

**Step 3: implementation.**

In `unified_orchestrator.py`, add after `_slide_route`:
```python
def _input_text_kind(route: str, raw: str, sent: Optional[str]) -> Optional[str]:
    """What this slide's synthesis prompt received (Arc 7): "stripped"
    (boilerplate removed by deck_plan.synthesis_text), "raw" (the page as
    extracted; vision always gets raw), or None when no LLM call was made."""
    if route == "heuristic":
        return None
    if route in ("batch", "per_slide") and sent is not None and sent != raw:
        return "stripped"
    return "raw"
```

Replace the whole `_provenance_entry` with:
```python
def _provenance_entry(
    index: int,
    route: str,
    *,
    ai_model: str,
    synthesis_failed: bool,
    needs_review: bool,
    review_reason: Optional[str],
    input_text: Optional[str] = None,
) -> Dict[str, Any]:
    """One slide's receipt line. ``requested_model`` is the model the parse
    asked for (head of the provider chain). ``input_text`` says whether the
    prompt got boilerplate-stripped or raw text: BATCH_SLIDE_PROMPT is shared
    with raw-text callers, so its version tag alone cannot say."""
    from backend.services.ai.prompts import get_prompt_version

    prompt = _ROUTE_PROMPTS.get(route)
    if route == "heuristic":
        model = None
    elif route == "vision":
        model = settings.vision_model
    else:
        model = ai_model
    return {
        "index": index,
        "route": route,
        "prompt": prompt,
        "prompt_version": get_prompt_version(prompt) if prompt else None,
        "requested_model": model,
        "input_text": input_text,
        "synthesis_failed": synthesis_failed,
        "needs_review": needs_review,
        "review_reason": review_reason,
    }
```

In `parse_pdf_unified`, after `slide_provenance: List[Dict[str, Any]] = []`, add:
```python
        synth_inputs: Dict[int, str] = {}  # Arc 7: text each slide prompt received
```

After the `text_items = [...]` list from Task 1, add:
```python
                    synth_inputs.update(text_items)
```

Replace:
```python
                slide_provenance.append(_provenance_entry(
                    i, route, ai_model=ai_model, synthesis_failed=synthesis_failed,
                    needs_review=needs_review, review_reason=review_reason,
                ))
```
with:
```python
                slide_provenance.append(_provenance_entry(
                    i, route, ai_model=ai_model, synthesis_failed=synthesis_failed,
                    needs_review=needs_review, review_reason=review_reason,
                    input_text=_input_text_kind(route, raw_slides[i], synth_inputs.get(i)),
                ))
```

In `prompts.py`:
1. Insert this block directly above `PROMPT_VERSIONS: Dict[str, str] = {`:
   ```python
   # Version policy (Arc 7): a version names the prompt's INPUT CONTRACT, not
   # only its template text. Bump when the template changes OR when the prompt's
   # single caller changes what it interpolates (which slides; stripped vs raw
   # text), because outputs before and after are not comparable under one tag.
   # A prompt shared by callers with different inputs is NOT bumped for one
   # caller's change (BATCH_SLIDE_PROMPT: the unified parse sends boilerplate-
   # stripped text, file_parse_service/slide_synth_service send raw); the parse
   # receipt records the per-slide input instead (slide_provenance[].input_text).
   ```
2. Replace the meta line with:
   ```python
       "LECTURE_META_ANALYSIS_PROMPT": "v3",       # was parser/synthesis.py:analyze_lecture_meta — v3 (Arc 7, retroactive for Arc 2): input is skeleton-selected, boilerplate-stripped slides across the whole deck, not slides[:15] raw
   ```
3. Replace the slide-analysis line with:
   ```python
       "SLIDE_ANALYSIS_PROMPT": "v3",              # was parser/synthesis.py:analyze_slide — v3 (Arc 7): {text} is boilerplate-stripped (raw fallback under 25 chars)
   ```

**Step 4: green.** Same command, then the full unit suite. The endpoint test seeds literal `"v3"` for BATCH, which is unchanged.

**Step 5: mutation-verify.**

| Revert | Expected |
|---|---|
| `if route in ("batch", "per_slide") and sent is not None and sent != raw:` → `if route in ("batch", "per_slide"):` | Receipt test shows `"stripped"` for slide 0 and fails. `test_input_text_kind` fails on the `per_slide` `"raw page"` case. |
| `"SLIDE_ANALYSIS_PROMPT": "v3"` → `"v2"` | Policy test fails. |
| `input_text=_input_text_kind(route, raw_slides[i], synth_inputs.get(i)),` → delete it | Receipt tests fail with `None` values. |

**Step 6: commit.** `feat(parser): receipt records stripped-vs-raw synthesis input; version bumps follow the input-contract policy (SLIDE_ANALYSIS v3, LECTURE_META v3)`

---

## Task 3: Deck Lab reports the realized saving and the scorecard is regenerated

**Files**
- `backend/eval/deck_lab.py`
- `backend/tests/unit/test_deck_lab_metrics.py`
- `backend/tests/unit/test_deck_lab_cli.py`
- `docs/DECK_LAB_2026_10.md` (regenerated)

**Interfaces**
- Consumes: `deck_plan.synthesis_text`, `unified_orchestrator._MIN_TEXT_FOR_SYNTH` (test only; deck_lab must not import the orchestrator, which imports supabase and redis).
- Produces:
  - `deck_lab.SYNTH_MIN_CHARS = 25`
  - `text_routed(pages: Sequence[str]) -> list[int]`
  - `synthesis_tokens_saved(pages: Sequence[str], skeleton: DeckSkeleton) -> tuple[int, int]`
  - `DeckReport.synth_tokens_saved: int`, `DeckReport.synth_slides: int`, `DeckReport.realized_saved_per_synth_slide: float`
  - `CorpusTotals.synth_tokens_saved`, `.synth_slides`, `.realized_saved_per_synth_slide`

Hand-checked numbers on the fixtures:
- `LONG_DECK`: all 18 pages are text-routed. Title stripped = 19 characters and each agenda stripped = 24 characters ("Agenda\nPart one\nPart two"); all three fall back to raw. The 15 content pages save 3 tokens each, so 45 tokens. 45 / 18 = 2.5.
- `SHORT_DECK`: title falls back to raw; 3 × 3 = 9 tokens over 4 slides.
- Total: 54 tokens over 22 slides = 2.4545, rendered as "2.5".

**Step 1: failing tests.**

In `test_deck_lab_metrics.py`, extend the import list with `SYNTH_MIN_CHARS, synthesis_tokens_saved, text_routed`, then append:
```python
def test_synth_min_chars_matches_the_orchestrator():
    from backend.services.parser import unified_orchestrator as uo
    assert SYNTH_MIN_CHARS == uo._MIN_TEXT_FOR_SYNTH


def test_text_routed_skips_image_only_pages():
    assert text_routed(["", "tiny", "  " + "x" * 24 + "  ", "y" * 25]) == [3]
    assert text_routed(LONG_DECK) == list(range(18))


def test_synthesis_tokens_saved_uses_the_production_fallback(long_sk):
    # 15 content pages x 3 footer tokens; title (19 chars) and both agendas
    # (24 chars) fall back to raw and save nothing.
    assert synthesis_tokens_saved(LONG_DECK, long_sk) == (45, 18)
    assert synthesis_tokens_saved(SHORT_DECK, build_deck_skeleton(SHORT_DECK)) == (9, 4)


def test_score_deck_reports_realized_saving():
    r = score_deck("00 DBS Syn.pdf", LONG_DECK)
    assert (r.synth_tokens_saved, r.synth_slides) == (45, 18)
    assert r.realized_saved_per_synth_slide == pytest.approx(2.5)


def test_corpus_totals_pool_realized_saving():
    t = corpus_totals([score_deck("a", LONG_DECK), score_deck("b", SHORT_DECK)])
    assert (t.synth_tokens_saved, t.synth_slides) == (54, 22)
    assert t.realized_saved_per_synth_slide == pytest.approx(54 / 22)
    assert corpus_totals([]).realized_saved_per_synth_slide == 0.0
```

In `test_deck_lab_cli.py`, replace the two lines under `# boilerplate`:
```python
    assert "| `00 DBS Syn.pdf` | 1 | 54 | 3.0 |" in md
    assert "| **Total (2 decks)** | 2 | 66 | 3.0 |" in md
```
with:
```python
    assert "| `00 DBS Syn.pdf` | 1 | 54 | 45 | 2.5 |" in md
    assert "| **Total (2 decks)** | 2 | 66 | 54 | 2.5 |" in md
    assert "implied" not in md.lower()
```

In `test_probe_section_states_interpretation_and_advisory_consequence`, replace:
```python
    assert "Implied tokens saved per slide prompt" in md
```
with:
```python
    assert "Realized per synthesized slide" in md
```

**Step 2: run.**
```
... -m pytest backend/tests/unit/test_deck_lab_metrics.py backend/tests/unit/test_deck_lab_cli.py -m "not db" -q
```
Expected: `ImportError: cannot import name 'SYNTH_MIN_CHARS'`. Once the metrics import is fixed, the CLI assertions fail on the old row format.

**Step 3: implementation in `deck_lab.py`.**

Add `synthesis_text` to the `deck_plan` import list.

After `QUIZ_MIN_CHARS = 50 ...` add:
```python
SYNTH_MIN_CHARS = 25  # unified_orchestrator._MIN_TEXT_FOR_SYNTH (pinned by a unit test;
                      # importing the orchestrator here would pull in supabase/redis)
```

After `boilerplate_tokens_removed`, add:
```python
def text_routed(pages: Sequence[str]) -> list[int]:
    """Pages per-slide TEXT synthesis handles; the rest go to vision."""
    return [i for i, p in enumerate(pages) if len((p or "").strip()) >= SYNTH_MIN_CHARS]


def synthesis_tokens_saved(pages: Sequence[str], skeleton: DeckSkeleton) -> tuple[int, int]:
    """(whitespace tokens per-slide synthesis no longer sends, text-routed
    slides), computed with the production rule deck_plan.synthesis_text:
    stripped text, raw fallback when stripping leaves < SYNTH_MIN_CHARS."""
    idxs = text_routed(pages)
    saved = sum(
        whitespace_tokens(pages[i])
        - whitespace_tokens(synthesis_text(pages[i], skeleton, i, SYNTH_MIN_CHARS))
        for i in idxs
    )
    return saved, len(idxs)
```

In `DeckReport`, add these fields after `boilerplate_removed: int`:
```python
    synth_tokens_saved: int
    synth_slides: int
```
and this property after `tokens_saved_per_slide`:
```python
    @property
    def realized_saved_per_synth_slide(self) -> float:
        return self.synth_tokens_saved / self.synth_slides if self.synth_slides else 0.0
```

In `score_deck`, add before `return DeckReport(`:
```python
    synth_saved, synth_slides = synthesis_tokens_saved(pages, sk)
```
and inside the constructor, after `boilerplate_removed=...,`:
```python
        synth_tokens_saved=synth_saved,
        synth_slides=synth_slides,
```

In `CorpusTotals`, add the same two fields after `boilerplate_removed: int` and the same property after `tokens_saved_per_slide`.

In `corpus_totals`, add after `boilerplate_removed=...,`:
```python
        synth_tokens_saved=sum(r.synth_tokens_saved for r in reports),
        synth_slides=sum(r.synth_slides for r in reports),
```

Change the module docstring line `  - boilerplate: template tokens the skeleton strips from every slide` to:
```
  - boilerplate: template tokens the skeleton strips, and how many of them
                 per-slide synthesis no longer sends (realized saving)
```

Replace the boilerplate block in `render_markdown`, from `"## Boilerplate stripped per parse",` through the total row, with:
```python
        "## Boilerplate stripped per parse",
        "",
        "Tokens removed = whitespace tokens of the raw pages minus those of the stripped",
        "skeleton texts (whitespace tokens, not model tokens); the meta and quiz prompts",
        "read the stripped texts. Per-slide synthesis (batch and per-slide prompts) now",
        "sends the stripped text too, except where stripping would leave fewer than",
        f"{SYNTH_MIN_CHARS} characters (the raw page is sent) and on image-only pages (vision).",
        "Realized = tokens per-slide synthesis no longer sends, computed with the same rule",
        "(`deck_plan.synthesis_text`); per synthesized slide = realized / text-routed slides.",
        "",
        "| Deck | Template lines | Tokens removed | Realized tokens saved (synthesis) "
        "| Realized per synthesized slide |",
        "|---|---:|---:|---:|---:|",
    ]
    for r in reports:
        out.append(f"| {_label(r.name)} | {r.boilerplate_lines} | {r.boilerplate_removed} | "
                   f"{r.synth_tokens_saved} | {r.realized_saved_per_synth_slide:.1f} |")
    out.append(f"| {total} | {t.boilerplate_lines} | {t.boilerplate_removed} | "
               f"{t.synth_tokens_saved} | {t.realized_saved_per_synth_slide:.1f} |")
```

**Step 4: green.** Re-run Step 2, then the full unit suite.

**Step 5: mutation-verify.** In `synthesis_tokens_saved`, replace `whitespace_tokens(synthesis_text(pages[i], skeleton, i, SYNTH_MIN_CHARS))` with `whitespace_tokens(skeleton.slides[i].text)`. That is the implied number. Expected: `(45, 18)` becomes `(54, 18)` and the test fails; the CLI row also fails. Restore.

**Step 6: regenerate the scorecard verbatim.**
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m backend.eval.deck_lab --out docs/DECK_LAB_2026_10.md
```
Expected:
- It prints `wrote docs/DECK_LAB_2026_10.md` and still covers 25 decks.
- The "Tokens removed" total is still `14930`.
- The new columns hold whatever the tool computes. The realized total is ≤ 14930, because title, agenda and figure slides fall back to raw and vision pages are excluded.
- Do not hand-edit anything. Check with `git diff docs/DECK_LAB_2026_10.md`: only the header (time and commit) and the boilerplate section should change.

**Step 7: commit.** `feat(eval): Deck Lab reports the realized per-slide synthesis saving (production rule); regenerate DECK_LAB_2026_10`

---

## Task 4: Migrations — `llm_calls` run context plus lockdown; `parse_receipts.llm_usage`

**Files**
- `supabase/migrations/20261012010000_llm_calls_run_context.sql` (new)
- `supabase/migrations/20261012000000_parse_receipts.sql` (edit; unapplied)
- `backend/tests/db/test_llm_calls_run_context.py` (new)
- `backend/tests/db/test_llm_calls_migration.py`
- `backend/tests/db/test_parse_receipts_rls.py`

**Interfaces**
- Produces:
  - `public.llm_calls.run_id uuid NULL`
  - `public.llm_calls.slide_indices integer[] NULL`
  - `public.llm_calls.prompt_name text NULL`
  - index `idx_llm_calls_run_id (run_id) WHERE run_id IS NOT NULL`
  - grants: none for anon and authenticated; ALL for service_role
  - `public.parse_receipts.llm_usage jsonb NULL`
- Consumes: DB fixtures `db_conn`, `make_user`, `make_lecture`, and `_make_run`/`_as_user`/`_reset` (in `test_parse_receipts_rls.py`).

**Step 1: failing tests.** New file `backend/tests/db/test_llm_calls_run_context.py`:
```python
"""DB tests for 20261012010000_llm_calls_run_context.sql (Arc 7).

llm_calls gains nullable run context (run_id, slide_indices, prompt_name) and
is locked down at the privilege layer: Supabase's default privileges grant
anon/authenticated full table rights directly, and 20260719010000 relied on
RLS alone, so the migration revokes them and grants service_role back."""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db

_INSERT = (
    "INSERT INTO public.llm_calls (user_id, feature, provider, model, prompt_tokens, "
    "completion_tokens, est_cost_usd, run_id, slide_indices, prompt_name) "
    "VALUES (%s, 'generate_text_bulk', 'groq', 'gpt-oss-20b', 900, 120, 0, %s, %s, "
    "'BATCH_SLIDE_PROMPT')"
)


def _as_user(cur, uid) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def test_run_context_columns_are_nullable_with_expected_types(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT column_name, data_type, udt_name, is_nullable "
            "FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'llm_calls' "
            "AND column_name IN ('run_id', 'slide_indices', 'prompt_name') "
            "ORDER BY column_name"
        )
        rows = cur.fetchall()
    assert rows == [
        ("prompt_name", "text", "text", "YES"),
        ("run_id", "uuid", "uuid", "YES"),
        ("slide_indices", "ARRAY", "_int4", "YES"),
    ]


def test_run_id_has_a_partial_index(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' AND indexname = 'idx_llm_calls_run_id'"
        )
        row = cur.fetchone()
    assert row is not None
    assert "(run_id)" in row[0] and "WHERE (run_id IS NOT NULL)" in row[0]


def test_select_by_run_id_round_trips_the_slide_array(db_conn, make_user):
    user = make_user(role="professor")
    run_id = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (str(user), str(run_id), [0, 1, 2]))
        cur.execute(_INSERT, (str(user), str(uuid.uuid4()), [5]))
        cur.execute(
            "SELECT slide_indices, prompt_name FROM public.llm_calls WHERE run_id = %s",
            (str(run_id),),
        )
        assert cur.fetchall() == [([0, 1, 2], "BATCH_SLIDE_PROMPT")]


def test_legacy_insert_without_run_context_still_works(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.llm_calls (feature, provider, model) "
            "VALUES ('tutor_chat', 'groq', 'm') RETURNING run_id, slide_indices, prompt_name"
        )
        assert cur.fetchone() == (None, None, None)


def test_run_id_is_not_a_foreign_key(db_conn):
    # A billed call must never be lost because its parse_runs row is missing.
    orphan = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (None, str(orphan), [0]))
        cur.execute("SELECT count(*) FROM public.llm_calls WHERE run_id = %s", (str(orphan),))
        assert cur.fetchone()[0] == 1


def test_privilege_catalog_is_locked_down(db_conn):
    privs = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
    with db_conn.cursor() as cur:
        def has(role, priv):
            cur.execute("SELECT has_table_privilege(%s, 'public.llm_calls', %s)", (role, priv))
            return cur.fetchone()[0]
        assert {p: has("anon", p) for p in privs} == dict.fromkeys(privs, False)
        assert {p: has("authenticated", p) for p in privs} == dict.fromkeys(privs, False)
        assert has("service_role", "SELECT") is True and has("service_role", "INSERT") is True


def test_authenticated_user_cannot_read_anyones_calls(db_conn, make_user):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (str(owner), str(uuid.uuid4()), [0]))
        for uid in (other, owner):
            _as_user(cur, uid)
            try:
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    cur.execute("SELECT id FROM public.llm_calls")
            finally:
                _reset(cur)


def test_anon_cannot_read_calls(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(_INSERT, (None, str(uuid.uuid4()), [0]))
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT id FROM public.llm_calls")
        finally:
            cur.execute("RESET ROLE")


def test_service_role_writes_and_reads_calls(db_conn):
    run_id = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute("SELECT set_config('request.jwt.claim.role', 'service_role', false)")
        try:
            cur.execute(_INSERT, (None, str(run_id), [3]))
            cur.execute("SELECT slide_indices FROM public.llm_calls WHERE run_id = %s", (str(run_id),))
            assert cur.fetchone() == ([3],)
        finally:
            _reset(cur)
```

In `backend/tests/db/test_llm_calls_migration.py`, change the expected set in `test_llm_calls_has_expected_columns` to:
```python
    assert columns == {
        "id", "created_at", "user_id", "course_id", "feature", "provider",
        "model", "prompt_tokens", "completion_tokens", "est_cost_usd",
        "run_id", "slide_indices", "prompt_name",
    }
```

Append to `backend/tests/db/test_parse_receipts_rls.py`:
```python
def test_llm_usage_is_nullable_jsonb(db_conn, make_user, make_lecture):
    lecture = make_lecture(make_user(role="professor"))
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture)
        cur.execute(
            "INSERT INTO public.parse_receipts (run_id, lecture_id, llm_usage) "
            "VALUES (%s, %s, %s::jsonb) RETURNING llm_usage",
            (str(run_id), str(lecture), json.dumps({"calls": 2, "cost_usd": 0.0009})),
        )
        assert cur.fetchone()[0] == {"calls": 2, "cost_usd": 0.0009}
        run2 = _make_run(cur, lecture)
        cur.execute(
            "INSERT INTO public.parse_receipts (run_id, lecture_id) VALUES (%s, %s) RETURNING llm_usage",
            (str(run2), str(lecture)),
        )
        assert cur.fetchone()[0] is None
```

**Step 2: run.**
```
DB_TEST_LOCAL_ADMIN_DSN=postgresql://localhost:1/postgres /Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/db/test_llm_calls_run_context.py backend/tests/db/test_llm_calls_migration.py backend/tests/db/test_parse_receipts_rls.py -m db -q
```
Expected failures:
- The columns test (`[] != [...]`).
- Index `row is None`.
- `UndefinedColumn: column "run_id"` on the inserts.
- The privilege test, because anon and authenticated still have privileges and service_role has none.
- The `test_llm_calls_has_expected_columns` set mismatch.
- `UndefinedColumn "llm_usage"`.

**Step 3: implementation.**

New file `supabase/migrations/20261012010000_llm_calls_run_context.sql`:
```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Arc 7 — run context on public.llm_calls.
--
-- Every LLM completion is already one llm_calls row (backend/services/ai/
-- cost.py log_llm_call), but nothing tied a row to the parse that caused it.
-- Three nullable columns, filled only for calls made inside a parse (the
-- context comes from backend/services/ai/call_context.py):
--   run_id        public.parse_runs.run_id of the parse. Deliberately NOT a
--                 foreign key: llm_calls is an append-only cost ledger and
--                 log_llm_call swallows insert errors, so an FK violation
--                 (run row deleted, or never committed) would silently drop a
--                 billed call. A dangling run_id is harmless; a lost cost row
--                 is not.
--   slide_indices 0-based slides the call synthesized. An array, not one int:
--                 one batch call covers up to 8 slides. NULL for deck-level
--                 calls (lecture meta, deck quiz, localization, ...).
--   prompt_name   backend/services/ai/prompts.py PROMPT_VERSIONS key.
-- A forced re-parse reuses its run_id, so rows of several attempts can share
-- one run_id; the parse receipt is built per attempt in memory instead.
--
-- Grants: 20260719010000 relied on RLS (service-role-only policies) while
-- Supabase's default privileges still grant anon and authenticated full table
-- privileges directly. Revoke them from the named roles and grant service_role
-- back, as 20261012000000_parse_receipts does. The backend reads and writes
-- through asyncpg as the table owner, which these grants do not affect.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.llm_calls
    ADD COLUMN IF NOT EXISTS run_id        UUID,
    ADD COLUMN IF NOT EXISTS slide_indices INTEGER[],
    ADD COLUMN IF NOT EXISTS prompt_name   TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_calls_run_id
    ON public.llm_calls (run_id)
    WHERE run_id IS NOT NULL;

REVOKE ALL ON TABLE public.llm_calls FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.llm_calls TO service_role;
```

In `supabase/migrations/20261012000000_parse_receipts.sql`, replace header lines 8–12 (the `slide_provenance` description through `slide yet (llm_calls has no run_id); not stored.`) with:
```sql
--   slide_provenance — one entry per slide: synthesis route (batch /
--                      per_slide / vision / heuristic), prompt name+version,
--                      input_text (stripped / raw), requested model,
--                      synthesis_failed, needs_review, and served_by: the
--                      provider/model/tokens/cost of each metered LLM call
--                      that carried the slide (a batch call is shared by its
--                      slides; cost_usd is the slide's even share). Vision
--                      calls are not metered (ai/vision.py reports no usage).
--   llm_usage        — run totals over the metered calls made before the
--                      receipt was written (calls, tokens, cost, by prompt,
--                      by provider). Later calls of the run (localization)
--                      are in public.llm_calls by run_id.
```
In the CREATE TABLE, replace:
```sql
    quiz_grounding   JSONB,
```
with:
```sql
    quiz_grounding   JSONB,
    llm_usage        JSONB,
```

**Step 4: green.** Re-run Step 2. Then run the whole DB suite: `... -m pytest backend/tests/db -m db -q`. Everything passes; the existing RLS-policy test still passes because the policies are unchanged.

**Step 5: mutation-verify.**

| Revert | Expected |
|---|---|
| Delete `REVOKE ALL ON TABLE public.llm_calls FROM PUBLIC, anon, authenticated;` | The privilege, authenticated and anon tests fail. |
| `WHERE run_id IS NOT NULL;` → `;` | The partial-index test fails. |
| `GRANT ALL ON TABLE public.llm_calls TO service_role;` → delete | The service-role test fails with `InsufficientPrivilege`. |

Restore each one.

**Step 6: commit.** `feat(db): llm_calls run context (run_id, slide_indices, prompt_name) + privilege lockdown; parse_receipts.llm_usage`

---

## Task 5: Call-context module, and accounting that tags `llm_calls` rows and records the serving call

**Files**
- `backend/services/ai/call_context.py` (new)
- `backend/services/ai/cost.py`
- `backend/services/ai/orchestrator.py`
- `backend/tests/unit/test_llm_call_context.py` (new)
- `backend/tests/db/test_llm_calls_run_context.py` (append)

**Interfaces**
- Produces:
  - `ServedCall(provider: str, model: str, prompt_tokens: int, completion_tokens: int, cost_usd: float, prompt_name: Optional[str], slide_indices: Optional[Tuple[int, ...]])`
  - `LLMCallContext(run_id: Optional[str] = None, slide_indices: Optional[Tuple[int, ...]] = None, prompt_name: Optional[str] = None, calls: Optional[List[ServedCall]] = None)`
  - `current_llm_call_context() -> LLMCallContext`
  - `push_llm_call_context(**changes) -> contextvars.Token`
  - `pop_llm_call_context(token) -> None`
  - `llm_call_scope(**changes)` (context manager)
  - `record_served_call(call: ServedCall) -> None`
  - `MAX_RECORDED_CALLS: int`
  - `cost.log_llm_call(*, user_id, course_id, feature, provider_id, model, usage, cost_usd, run_id: Optional[str] = None, slide_indices: Optional[Sequence[int]] = None, prompt_name: Optional[str] = None) -> None`
  - `orchestrator._account_for_call(provider_id, model, usage, *, user_id, course_id, feature, duration_seconds, prompt_name: Optional[str] = None) -> None`
- Consumes: `cost.estimate_cost`, `cost.LLMUsage`, `backend.core.database.get_db_connection`, `asyncpg.exceptions.UndefinedColumnError`.

**Step 1: failing tests.** New file `backend/tests/unit/test_llm_call_context.py`:
```python
"""Arc 7: LLM call context (contextvar) and the accounting tail that uses it."""
from __future__ import annotations

import asyncio

import asyncpg
import pytest

from backend.services.ai import call_context as cc
from backend.services.ai.call_context import (
    LLMCallContext,
    ServedCall,
    current_llm_call_context,
    llm_call_scope,
    pop_llm_call_context,
    push_llm_call_context,
    record_served_call,
)


def _call(i: int) -> ServedCall:
    return ServedCall(provider="groq", model="m", prompt_tokens=10, completion_tokens=2,
                      cost_usd=0.0, prompt_name="SLIDE_ANALYSIS_PROMPT", slide_indices=(i,))


# ── context semantics ────────────────────────────────────────────────────────

def test_default_context_is_empty():
    assert current_llm_call_context() == LLMCallContext()


def test_scopes_nest_and_restore():
    with llm_call_scope(run_id="r1"):
        with llm_call_scope(slide_indices=(3,), prompt_name="SLIDE_ANALYSIS_PROMPT"):
            c = current_llm_call_context()
            assert (c.run_id, c.slide_indices, c.prompt_name) == ("r1", (3,), "SLIDE_ANALYSIS_PROMPT")
        assert current_llm_call_context().slide_indices is None
        assert current_llm_call_context().run_id == "r1"
    assert current_llm_call_context() == LLMCallContext()


def test_scope_restores_after_an_exception():
    with pytest.raises(RuntimeError):
        with llm_call_scope(run_id="r1"):
            raise RuntimeError("boom")
    assert current_llm_call_context().run_id is None


async def test_gathered_tasks_keep_their_own_slide_and_share_the_run_list():
    sink: list = []

    async def one(i):
        with llm_call_scope(slide_indices=(i,)):
            await asyncio.sleep(0)  # force interleaving
            record_served_call(_call(i))
            return current_llm_call_context().slide_indices

    token = push_llm_call_context(run_id="r1", calls=sink)
    try:
        seen = await asyncio.gather(*(one(i) for i in range(5)))
    finally:
        pop_llm_call_context(token)
    assert seen == [(i,) for i in range(5)]
    assert sorted(c.slide_indices for c in sink) == [(i,) for i in range(5)]
    assert current_llm_call_context().calls is None


async def test_to_thread_sees_the_callers_context():
    with llm_call_scope(run_id="r-thread"):
        got = await asyncio.to_thread(lambda: current_llm_call_context().run_id)
    assert got == "r-thread"


def test_record_without_a_list_is_a_no_op():
    record_served_call(_call(0))  # outside any parse: nothing to do, no error


def test_record_is_bounded(monkeypatch):
    monkeypatch.setattr(cc, "MAX_RECORDED_CALLS", 3)
    sink: list = []
    with llm_call_scope(calls=sink):
        for i in range(5):
            record_served_call(_call(i))
    assert len(sink) == 3


def test_record_never_raises():
    class Broken(list):
        def append(self, item):
            raise RuntimeError("full")

    with llm_call_scope(calls=Broken()):
        record_served_call(_call(0))


# ── _account_for_call ────────────────────────────────────────────────────────

@pytest.fixture
def logged(monkeypatch):
    from backend.services.ai import cost as cost_module
    from backend.services.ai import orchestrator

    rows: list = []

    async def fake_log(**kwargs):
        rows.append(kwargs)

    async def noop(*_a, **_k):
        return None

    monkeypatch.setattr(cost_module, "log_llm_call", fake_log)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: None)
    monkeypatch.setattr(orchestrator._rotator, "flush_openai_cost_to_redis", noop)
    return rows


async def test_account_for_call_tags_the_row_and_records_the_serving_call(logged):
    from backend.services.ai import orchestrator
    from backend.services.ai.cost import LLMUsage

    sink: list = []
    with llm_call_scope(run_id="run-1", calls=sink):
        with llm_call_scope(slide_indices=(0, 1), prompt_name="BATCH_SLIDE_PROMPT"):
            await orchestrator._account_for_call(
                "openai", "gpt-4o-mini", LLMUsage(prompt_tokens=1000, completion_tokens=1000),
                user_id=None, course_id=None, feature="batch_analyze_text_slides",
                duration_seconds=0.1,
            )
    (row,) = logged
    assert (row["run_id"], row["slide_indices"], row["prompt_name"]) == ("run-1", (0, 1), "BATCH_SLIDE_PROMPT")
    assert (row["provider_id"], row["model"]) == ("openai", "gpt-4o-mini")
    (call,) = sink
    assert (call.provider, call.model, call.prompt_tokens, call.completion_tokens) == (
        "openai", "gpt-4o-mini", 1000, 1000)
    assert call.cost_usd == pytest.approx(0.00075)  # 1K x 0.00015 + 1K x 0.0006
    assert (call.prompt_name, call.slide_indices) == ("BATCH_SLIDE_PROMPT", (0, 1))


async def test_explicit_prompt_name_wins_over_the_scope(logged):
    from backend.services.ai import orchestrator

    with llm_call_scope(prompt_name="SYNTHESIS_DECK_QUIZ_PROMPT"):
        await orchestrator._account_for_call(
            "groq", "m", None, user_id=None, course_id=None, feature="f",
            duration_seconds=0.0, prompt_name="SYNTHESIS_QUIZ_REPAIR_PROMPT",
        )
    assert logged[0]["prompt_name"] == "SYNTHESIS_QUIZ_REPAIR_PROMPT"


async def test_outside_a_parse_rows_carry_no_run_context(logged):
    from backend.services.ai import orchestrator

    await orchestrator._account_for_call(
        "groq", "m", None, user_id=None, course_id=None, feature="tutor_chat", duration_seconds=0.0,
    )
    assert (logged[0]["run_id"], logged[0]["slide_indices"], logged[0]["prompt_name"]) == (None, None, None)


# ── log_llm_call SQL ─────────────────────────────────────────────────────────

class _Conn:
    def __init__(self, fail_first: BaseException | None = None):
        self.executed: list = []
        self._fail_first = fail_first

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def execute(self, query, *args):
        self.executed.append((query, args))
        if self._fail_first is not None and len(self.executed) == 1:
            raise self._fail_first
        return "INSERT 0 1"


@pytest.fixture
def conn_factory(monkeypatch):
    import backend.core.database as db

    def make(fail_first=None):
        conn = _Conn(fail_first)

        async def get_db_connection():
            return conn

        monkeypatch.setattr(db, "get_db_connection", get_db_connection)
        return conn

    return make


def _log_kwargs(**extra):
    from backend.services.ai.cost import LLMUsage
    return dict(user_id=None, course_id=None, feature="f", provider_id="groq", model="m",
                usage=LLMUsage(prompt_tokens=7, completion_tokens=3), cost_usd=0.0, **extra)


async def test_log_without_context_uses_the_legacy_insert(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory()
    await log_llm_call(**_log_kwargs())
    ((query, args),) = conn.executed
    assert "run_id" not in query and len(args) == 8


async def test_log_with_context_writes_the_run_columns(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory()
    await log_llm_call(**_log_kwargs(run_id="run-1", slide_indices=(0, 1), prompt_name="BATCH_SLIDE_PROMPT"))
    ((query, args),) = conn.executed
    assert "run_id, slide_indices, prompt_name" in query
    assert args[8:] == ("run-1", [0, 1], "BATCH_SLIDE_PROMPT")


async def test_log_falls_back_to_legacy_insert_before_the_migration(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory(asyncpg.exceptions.UndefinedColumnError('column "run_id" does not exist'))
    await log_llm_call(**_log_kwargs(run_id="run-1", slide_indices=(0,), prompt_name="P"))
    assert len(conn.executed) == 2
    assert "run_id" not in conn.executed[1][0] and len(conn.executed[1][1]) == 8


async def test_log_never_raises(conn_factory):
    from backend.services.ai.cost import log_llm_call
    conn = conn_factory(RuntimeError("db down"))
    await log_llm_call(**_log_kwargs(run_id="run-1"))
    assert len(conn.executed) == 1
```

Append to `backend/tests/db/test_llm_calls_run_context.py`. This is the real asyncpg round trip:
```python
@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    """Point the app's global asyncpg pool at the throwaway database."""
    import asyncpg
    import backend.core.database as core

    pool = await asyncpg.create_pool(pg_dsn, min_size=1, max_size=2, statement_cache_size=0)
    old = core.db_pool
    core.db_pool = pool
    try:
        yield pool
    finally:
        core.db_pool = old
        await pool.close()


async def test_log_llm_call_round_trips_run_context_through_asyncpg(wired_pool, db_conn):
    from backend.services.ai.cost import LLMUsage, log_llm_call

    run_id = uuid.uuid4()
    await log_llm_call(
        user_id=None, course_id=None, feature="batch_analyze_text_slides",
        provider_id="groq", model="gpt-oss-20b",
        usage=LLMUsage(prompt_tokens=900, completion_tokens=120), cost_usd=0.0,
        run_id=str(run_id), slide_indices=(0, 1, 2), prompt_name="BATCH_SLIDE_PROMPT",
    )
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT provider, model, prompt_tokens, completion_tokens, slide_indices, prompt_name "
            "FROM public.llm_calls WHERE run_id = %s",
            (str(run_id),),
        )
        assert cur.fetchall() == [("groq", "gpt-oss-20b", 900, 120, [0, 1, 2], "BATCH_SLIDE_PROMPT")]
```

**Step 2: run.**
```
... -m pytest backend/tests/unit/test_llm_call_context.py -m "not db" -q
```
Expected: `ModuleNotFoundError: No module named 'backend.services.ai.call_context'`.

```
DB_TEST_LOCAL_ADMIN_DSN=postgresql://localhost:1/postgres ... -m pytest backend/tests/db/test_llm_calls_run_context.py -k asyncpg -m db -q
```
Expected: `TypeError: log_llm_call() got an unexpected keyword argument 'run_id'`.

**Step 3: implementation.**

New file `backend/services/ai/call_context.py`:
```python
"""Per-call LLM accounting context (Arc 7).

The parse orchestrator knows which run, slide and prompt an LLM call belongs
to; the accounting tail (orchestrator._account_for_call) knows which provider
served it and what it cost. A ContextVar carries the first to the second
without changing any signature in between: synthesis.analyze_slide,
generate_text_bulk and batch_analyze_text_slides are shared with other callers
and copied by test fakes.

Rules that keep this correct under asyncio:
  - asyncio.gather wraps each coroutine in a Task, and a Task copies the
    context when it is CREATED. A per-slide scope must therefore be entered
    inside each coroutine (unified_orchestrator._synthesize_slide_scoped),
    never around the gather.
  - asyncio.to_thread copies the context into the worker thread.
  - ``calls`` is one list shared by reference with every child context, so a
    call recorded in any Task of a parse lands in that parse's list.
Concurrent parses in one worker run in separate Tasks and never see each
other's context (a module global would mix them).
"""
from __future__ import annotations

import contextlib
import dataclasses
import logging
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any, Iterator, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Upper bound on calls kept in memory per parse. A 136-page deck makes ~20
# batch calls plus fallbacks; this only stops a runaway loop from growing the
# list without limit.
MAX_RECORDED_CALLS = 5000


@dataclass(frozen=True)
class ServedCall:
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    prompt_name: Optional[str]
    slide_indices: Optional[Tuple[int, ...]]


@dataclass(frozen=True)
class LLMCallContext:
    run_id: Optional[str] = None
    slide_indices: Optional[Tuple[int, ...]] = None
    prompt_name: Optional[str] = None
    calls: Optional[List[ServedCall]] = None


_CURRENT: ContextVar[LLMCallContext] = ContextVar("llm_call_context", default=LLMCallContext())


def current_llm_call_context() -> LLMCallContext:
    return _CURRENT.get()


def push_llm_call_context(**changes: Any) -> Token:
    return _CURRENT.set(dataclasses.replace(_CURRENT.get(), **changes))


def pop_llm_call_context(token: Token) -> None:
    _CURRENT.reset(token)


@contextlib.contextmanager
def llm_call_scope(**changes: Any) -> Iterator[LLMCallContext]:
    token = push_llm_call_context(**changes)
    try:
        yield _CURRENT.get()
    finally:
        pop_llm_call_context(token)


def record_served_call(call: ServedCall) -> None:
    """Append to the current parse's call list, if any. Never raises."""
    try:
        sink = _CURRENT.get().calls
        if sink is not None and len(sink) < MAX_RECORDED_CALLS:
            sink.append(call)
    except Exception as exc:
        logger.warning("could not record served LLM call (non-fatal): %s", exc)
```

In `cost.py`, change `from typing import Optional` to `from typing import Optional, Sequence`. Replace the whole `log_llm_call` with:
```python
_LEGACY_INSERT = """
    INSERT INTO public.llm_calls
        (user_id, course_id, feature, provider, model,
         prompt_tokens, completion_tokens, est_cost_usd)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
"""

# Arc 7 (migration 20261012010000): run context for calls made inside a parse.
_RUN_CONTEXT_INSERT = """
    INSERT INTO public.llm_calls
        (user_id, course_id, feature, provider, model,
         prompt_tokens, completion_tokens, est_cost_usd,
         run_id, slide_indices, prompt_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
"""


async def log_llm_call(
    *,
    user_id: Optional[str],
    course_id: Optional[str],
    feature: str,
    provider_id: str,
    model: str,
    usage: Optional[LLMUsage],
    cost_usd: float,
    run_id: Optional[str] = None,
    slide_indices: Optional[Sequence[int]] = None,
    prompt_name: Optional[str] = None,
) -> None:
    """Best-effort INSERT into public.llm_calls. Never raises — a logging
    failure must not surface as an LLM-call failure to the caller.

    Rows with run context (Arc 7) use the extended INSERT; if the database
    predates migration 20261012010000 (UndefinedColumnError), the row is
    written without it, so a deploy-before-migrate never loses a cost row."""
    import asyncpg

    from backend.core.database import get_db_connection

    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    base = (user_id, course_id, feature, provider_id, model,
            prompt_tokens, completion_tokens, cost_usd)
    has_context = run_id is not None or slide_indices is not None or prompt_name is not None
    try:
        conn_cm = await get_db_connection()
        async with conn_cm as conn:
            if not has_context:
                await conn.execute(_LEGACY_INSERT, *base)
                return
            try:
                await conn.execute(
                    _RUN_CONTEXT_INSERT, *base, run_id,
                    list(slide_indices) if slide_indices is not None else None,
                    prompt_name,
                )
            except asyncpg.exceptions.UndefinedColumnError:
                logger.warning("llm_calls has no run-context columns yet (migration "
                               "20261012010000 not applied); logging without them")
                await conn.execute(_LEGACY_INSERT, *base)
    except Exception as exc:
        logger.warning("Failed to log llm_calls row (feature=%s provider=%s): %s",
                       feature, provider_id, exc)
```

In `orchestrator.py`, replace the whole `_account_for_call` with:
```python
async def _account_for_call(
    provider_id: str,
    model: str,
    usage: Optional["LLMUsage"],
    *,
    user_id: Optional[str],
    course_id: Optional[str],
    feature: str,
    duration_seconds: float,
    prompt_name: Optional[str] = None,
) -> None:
    """Shared cost-accounting tail for generate_text/generate_text_bulk
    (Roadmap P1-1): mirrors this call's provider count (and openai's cost, if
    any) to Redis for fleet-wide budget tracking, logs the completion to
    ``public.llm_calls``, and — when ``user_id`` is given — adds to that
    user's running monthly spend. It also emits the completed call's latency,
    cost, and token usage to Prometheus.

    Arc 7: the current ``call_context`` (set by the parse orchestrator) tags
    the row with run_id / slide_indices / prompt_name, and the serving call is
    recorded for the parse receipt. An explicit ``prompt_name`` wins over the
    context's. Entirely best-effort; never raises."""
    from backend.services.ai.call_context import (
        ServedCall,
        current_llm_call_context,
        record_served_call,
    )
    from backend.services.ai.cost import estimate_cost, log_llm_call, record_user_llm_spend
    from backend.core.metrics import (
        LLM_CALL_COST_USD_TOTAL,
        LLM_CALL_DURATION_SECONDS,
        LLM_CALL_TOKENS_TOTAL,
    )

    await _rotator.flush_success_to_redis(provider_id)
    cost = estimate_cost(provider_id, model, usage)
    if provider_id == "openai" and cost > 0:
        await _rotator.flush_openai_cost_to_redis(cost)
    call_ctx = current_llm_call_context()
    name = prompt_name or call_ctx.prompt_name
    record_served_call(ServedCall(
        provider=provider_id,
        model=model,
        prompt_tokens=usage.prompt_tokens if usage else 0,
        completion_tokens=usage.completion_tokens if usage else 0,
        cost_usd=cost,
        prompt_name=name,
        slide_indices=call_ctx.slide_indices,
    ))
    await log_llm_call(
        user_id=user_id, course_id=course_id, feature=feature,
        provider_id=provider_id, model=model, usage=usage, cost_usd=cost,
        run_id=call_ctx.run_id, slide_indices=call_ctx.slide_indices, prompt_name=name,
    )
    if user_id and cost > 0:
        await record_user_llm_spend(user_id, cost)

    labels = {"provider": provider_id, "model": model, "feature": feature}
    LLM_CALL_DURATION_SECONDS.labels(**labels).observe(duration_seconds)
    LLM_CALL_COST_USD_TOTAL.labels(**labels).inc(cost)
    if usage:
        LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="prompt").inc(usage.prompt_tokens)
        LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="completion").inc(usage.completion_tokens)
```

Further changes in `orchestrator.py`:
1. In `generate_text`, add `prompt_name=prompt_name,` to the non-llama `_account_for_call(...)` call, after `feature=feature or "generate_text",`. The llama branch has no prompt name, so leave it.
2. In `generate_text_bulk`, add `prompt_name=prompt_name,` after `feature=feature or "generate_text_bulk",`.
3. In `batch_analyze_text_slides`, add `prompt_name="BATCH_SLIDE_PROMPT",` after `feature="batch_analyze_text_slides",`.
4. Delete the stale docstring sentence in `_generate_with_rotation` that starts `` Now that P1-1's ``llm_calls`` table exists, this is still only logged ``. Replace it with: `` ``_account_for_call`` writes ``prompt_name`` to ``llm_calls`` (Arc 7). ``
5. In `prompts.py`, delete the `TODO(P1-1 llm-cost-accounting)` paragraph (lines 17–22). Replace it with: `` ``llm_calls.prompt_name`` (Arc 7) records the key; join ``PROMPT_VERSIONS`` for the version. ``

**Step 4: green.** Re-run both Step 2 commands. Then run the full unit suite. `test_metrics.test_account_for_call_emits_llm_usage_metrics` still passes: its `_noop(*a, **k)` accepts the new kwargs. The chaos lab's `_no_db_log(**_kwargs)` does too.

**Step 5: mutation-verify.**

| Revert | Expected |
|---|---|
| `run_id=call_ctx.run_id, slide_indices=call_ctx.slide_indices, prompt_name=name,` → delete | The tagging test fails (`KeyError: 'run_id'`). |
| `name = prompt_name or call_ctx.prompt_name` → `name = call_ctx.prompt_name or prompt_name` | The explicit-wins test fails. |
| Remove the `except asyncpg.exceptions.UndefinedColumnError:` branch (its two body lines) | The fallback test fails: only one execute happens. |
| `if sink is not None and len(sink) < MAX_RECORDED_CALLS:` → `if sink is not None:` | The bound test fails. |

Restore each one.

**Step 6: commit.** `feat(ai): call-context contextvar tags llm_calls rows (run_id, slide_indices, prompt_name) and records serving provider/model/tokens/cost`

---

## Task 6: Orchestrator sets the context around every parse LLM call

**Files**
- `backend/services/parser/unified_orchestrator.py`
- `backend/services/parser/synthesis.py`
- `backend/tests/unit/test_unified_orchestrator.py`
- `backend/tests/unit/test_synthesis.py`

**Interfaces**
- Consumes: `llm_call_scope`, `push_llm_call_context`, `pop_llm_call_context`, `ServedCall`, `_ROUTE_PROMPTS`.
- Produces:
  - `unified_orchestrator._synthesize_slide_scoped(idx: int, text: str, lecture_context: str, ai_model: str, pdf_bytes: bytes, source_language: str, *, prompt_name: str) -> Dict[str, Any]`
  - Local `served_calls: List[ServedCall]` in `parse_pdf_unified` (consumed by Task 7).

**Step 1: failing tests.** Append to `test_unified_orchestrator.py`:
```python
# ── Arc 7: LLM call context ──────────────────────────────────────────────────

async def test_each_parse_llm_call_runs_inside_its_scope(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    import backend.services.parser.synthesis as synthesis
    from backend.services.ai.call_context import current_llm_call_context

    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B, ""])
    seen = {}

    def snap(key):
        c = current_llm_call_context()
        seen[key] = (c.run_id, c.slide_indices, c.prompt_name, c.calls is not None)

    async def batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        snap("batch")
        return [{"index": s["index"], "title": "T", "summary": "S", "slide_type": "text"}
                for s in slides_input]

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        snap(f"slide{idx}")
        return {"title": "T", "content": text, "summary": "S", "slide_type": "text", "vision_routed": True}

    async def meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        snap("meta")
        return {"title": "L", "summary": "D"}

    async def quiz(slides, title, model, source_language="en", skeleton=None, stats=None):
        snap("quiz")
        return []

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", batch)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    monkeypatch.setattr(synthesis, "generate_quiz_questions", quiz)
    await _run("h", OWNER, filename="Deck.pdf")

    rid = str(run.run_id)
    assert seen["meta"] == (rid, None, "LECTURE_META_ANALYSIS_PROMPT", True)
    assert seen["batch"] == (rid, (0, 1), "BATCH_SLIDE_PROMPT", True)
    assert seen["slide2"] == (rid, (2,), "SLIDE_VISION_PROMPT", True)
    assert seen["quiz"] == (rid, None, "SYNTHESIS_DECK_QUIZ_PROMPT", True)
    assert current_llm_call_context().run_id is None  # reset after the parse


async def test_per_slide_fallback_calls_are_scoped_to_their_own_slide(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    from backend.services.ai.call_context import current_llm_call_context

    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B])

    async def failing_batch(*_a, **_k):
        raise RuntimeError("batch provider down")

    seen = {}

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        await asyncio.sleep(0)  # interleave the gathered tasks
        c = current_llm_call_context()
        seen[idx] = (c.slide_indices, c.prompt_name)
        return {"title": "T", "content": text, "summary": "S", "slide_type": "text"}

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", failing_batch)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    await _run("h", OWNER, filename="Deck.pdf")
    assert seen == {0: ((0,), "SLIDE_ANALYSIS_PROMPT"), 1: ((1,), "SLIDE_ANALYSIS_PROMPT")}


async def test_call_context_is_reset_when_the_parse_fails(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    from backend.services.ai.call_context import current_llm_call_context

    rec, run = _patch_common(monkeypatch, pages=_long_pages(40))

    class _StarvedRotator:
        def remaining_headroom(self, chain):
            return 3

    monkeypatch.setattr(ai_orchestrator, "get_rotator", lambda: _StarvedRotator())
    with pytest.raises(uo.InsufficientHeadroomError):
        await _run("h", OWNER)
    assert current_llm_call_context() == type(current_llm_call_context())()
```

Append to `test_synthesis.py`:
```python
async def test_repair_call_is_scoped_to_its_cited_slide(monkeypatch):
    from backend.services.ai.call_context import current_llm_call_context, llm_call_scope
    from backend.services.parser.deck_plan import build_deck_skeleton

    seen = {}

    async def fake(prompt, ai_model=None):
        c = current_llm_call_context()
        seen["ctx"] = (c.run_id, c.slide_indices, c.prompt_name)
        return json.dumps({"question": "q"})

    monkeypatch.setattr(synthesis, "generate_text_bulk", fake)
    sk = build_deck_skeleton(["alpha slide text", "bravo slide text", "charlie slide text"])
    with llm_call_scope(run_id="run-1", prompt_name="SYNTHESIS_DECK_QUIZ_PROMPT"):
        out = await synthesis._repair_question({"concept": "c"}, 3, sk, "Graphs", "groq", "en")
    assert out["source_slide"] == 3
    assert seen["ctx"] == ("run-1", (2,), "SYNTHESIS_QUIZ_REPAIR_PROMPT")
```

**Step 2: run.**
```
... -m pytest backend/tests/unit/test_unified_orchestrator.py backend/tests/unit/test_synthesis.py -k "scope or call_context" -m "not db" -q
```
Expected: `AssertionError`. Today every snap is `(None, None, None, False)` and the repair snap is `("run-1", None, "SYNTHESIS_DECK_QUIZ_PROMPT")`.

**Step 3: implementation.**

In `unified_orchestrator.py`:
- Change the typing import to `from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence`.
- After `from backend.domain.parse_models import RunStatus`, add:
  ```python
  from backend.services.ai.call_context import (
      ServedCall,
      llm_call_scope,
      pop_llm_call_context,
      push_llm_call_context,
  )
  ```

After `_synthesize_slide`, add:
```python
async def _synthesize_slide_scoped(
    idx: int, text: str, lecture_context: str, ai_model: str, pdf_bytes: bytes,
    source_language: str, *, prompt_name: str,
) -> Dict[str, Any]:
    """_synthesize_slide inside this slide's LLM call scope (Arc 7). Entered
    INSIDE the coroutine: asyncio.gather copies the context when it creates
    each task, so a scope around the gather would tag every slide the same."""
    with llm_call_scope(slide_indices=(idx,), prompt_name=prompt_name):
        return await _synthesize_slide(idx, text, lecture_context, ai_model, pdf_bytes, source_language)
```

In `_synthesize_text_slides_individually`, replace:
```python
        *[_synthesize_slide(idx, text, _ctx(idx), ai_model, pdf_bytes, source_language)
          for idx, text in text_items],
```
with:
```python
        *[_synthesize_slide_scoped(idx, text, _ctx(idx), ai_model, pdf_bytes, source_language,
                                   prompt_name=_ROUTE_PROMPTS["per_slide"])
          for idx, text in text_items],
```

In `_synthesize_text_slide_batch`, replace:
```python
        raw_results = await batch_analyze_text_slides(
            slides_input, ai_model=ai_model, blueprint=blueprint,
            source_language=source_language,
        )
```
with:
```python
        with llm_call_scope(
            slide_indices=tuple(idx for idx, _ in text_items),
            prompt_name=_ROUTE_PROMPTS["batch"],
        ):
            raw_results = await batch_analyze_text_slides(
                slides_input, ai_model=ai_model, blueprint=blueprint,
                source_language=source_language,
            )
```

In `parse_pdf_unified`, after `deck_summary = ""` (the accumulators), add:
```python
    # Arc 7: metered LLM calls of THIS attempt (a forced re-parse reuses the
    # run_id, so the list, not llm_calls, scopes the receipt to one attempt).
    served_calls: List[ServedCall] = []
    llm_ctx_token = None
```

After `run_uuid = run.run_id`, add:
```python
        llm_ctx_token = push_llm_call_context(run_id=str(run_uuid), calls=served_calls)
```

Replace:
```python
                meta = await analyze_lecture_meta(
                    raw_slides, ai_model, course_context_hint=course_context_hint,
                    source_language=source_language, skeleton=skeleton,
                )
```
with:
```python
                with llm_call_scope(prompt_name="LECTURE_META_ANALYSIS_PROMPT"):
                    meta = await analyze_lecture_meta(
                        raw_slides, ai_model, course_context_hint=course_context_hint,
                        source_language=source_language, skeleton=skeleton,
                    )
```

Replace the vision gather element:
```python
                        _synthesize_slide(
                            i, raw_slides[i], _ctx_with_instruction(i), ai_model, pdf_bytes,
                            source_language,
                        )
```
with:
```python
                        _synthesize_slide_scoped(
                            i, raw_slides[i], _ctx_with_instruction(i), ai_model, pdf_bytes,
                            source_language, prompt_name=_ROUTE_PROMPTS["vision"],
                        )
```

Replace:
```python
                deck_quiz = _map_deck_quiz(
                    await generate_quiz_questions(
                        raw_slides, lecture_title, ai_model, source_language, skeleton=skeleton,
                        stats=quiz_stats,
                    )
                )
```
with:
```python
                with llm_call_scope(prompt_name="SYNTHESIS_DECK_QUIZ_PROMPT"):
                    deck_quiz = _map_deck_quiz(
                        await generate_quiz_questions(
                            raw_slides, lecture_title, ai_model, source_language, skeleton=skeleton,
                            stats=quiz_stats,
                        )
                    )
```

Make the `finally:` begin with:
```python
    finally:
        if llm_ctx_token is not None:
            pop_llm_call_context(llm_ctx_token)
        if got_lock:
```

In `synthesis.py`, add the import `from backend.services.ai.call_context import llm_call_scope`. In `_repair_question`, replace:
```python
    try:
        raw = await generate_text_bulk(with_voice(prompt, structured=True), ai_model=ai_model)
    except Exception as exc:
        logger.warning("deck quiz repair failed (non-fatal): %s", exc)
```
with:
```python
    try:
        with llm_call_scope(prompt_name="SYNTHESIS_QUIZ_REPAIR_PROMPT",
                            slide_indices=(slide_number - 1,)):
            raw = await generate_text_bulk(with_voice(prompt, structured=True), ai_model=ai_model)
    except Exception as exc:
        logger.warning("deck quiz repair failed (non-fatal): %s", exc)
```

**Step 4: green.** Re-run Step 2, then the full unit suite. Existing fakes keep their signatures, so nothing else changes.

**Step 5: mutation-verify.**

| Revert | Expected |
|---|---|
| `_synthesize_slide_scoped(` → `_synthesize_slide(` in the vision gather, and delete `prompt_name=_ROUTE_PROMPTS["vision"],` | `seen["slide2"]` becomes `(rid, None, None, True)` and the test fails. |
| Wrap the scope around the gather in `_synthesize_text_slides_individually` instead: `with llm_call_scope(slide_indices=tuple(i for i, _ in text_items), prompt_name=...)` around `asyncio.gather` | The fallback test sees `(0, 1)` for both slides and fails. |
| `pop_llm_call_context(llm_ctx_token)` → delete | The reset tests fail. |

Restore each one.

**Step 6: commit.** `feat(parser): scope every parse LLM call (run, slide(s), prompt) via the call context; per-slide scopes entered inside gathered tasks`

---

## Task 7: Receipt carries serving provider, model and cost per slide plus run totals; endpoint returns them

**Files**
- `backend/services/parser/unified_orchestrator.py`
- `backend/services/parser/repos.py`
- `backend/api/v1/parse_receipts.py`
- `backend/tests/unit/test_unified_orchestrator.py`
- `backend/tests/unit/test_parse_receipt_repo.py`
- `backend/tests/integration/test_parse_receipt_endpoint.py`
- `backend/tests/db/test_unified_pipeline_e2e.py`

**Interfaces**
- Consumes: `served_calls` (Task 6), `ServedCall`, `parse_receipts.llm_usage` (Task 4), `_account_for_call` (Task 5).
- Produces:
  - `unified_orchestrator._llm_usage_receipt(slide_provenance: List[Dict[str, Any]], calls: Sequence[ServedCall]) -> tuple[List[Dict[str, Any]], Dict[str, Any]]` (pure).
  - `_write_parse_receipt(run_id, lecture_id, *, skeleton, slide_provenance, quiz_grounding, served_calls: Sequence[ServedCall] = ())`
  - `repos.save_parse_receipt(run_id, lecture_id, *, deck_skeleton, slide_provenance, quiz_grounding, llm_usage: Optional[dict] = None)`
  - The endpoint's `data` gains `llm_usage`.
  - Each `slide_provenance[i]` gains `served_by: list[dict]` and `cost_usd: float`.

**Step 1: failing tests.**

In `test_unified_orchestrator.py`, in `_patch_common`, replace the fake:
```python
    async def save_parse_receipt(run_id, lecture_id, *, deck_skeleton, slide_provenance, quiz_grounding):
        rec.setdefault("receipts", []).append({
            "run_id": run_id, "lecture_id": lecture_id, "deck_skeleton": deck_skeleton,
            "slide_provenance": slide_provenance, "quiz_grounding": quiz_grounding,
        })
```
with:
```python
    async def save_parse_receipt(run_id, lecture_id, *, deck_skeleton, slide_provenance, quiz_grounding,
                                 llm_usage=None):
        rec.setdefault("receipts", []).append({
            "run_id": run_id, "lecture_id": lecture_id, "deck_skeleton": deck_skeleton,
            "slide_provenance": slide_provenance, "quiz_grounding": quiz_grounding,
            "llm_usage": llm_usage,
        })
```

In `test_receipt_provenance_records_batch_and_vision_routes`, the expected `prov[0]` dict gains `"served_by": [], "cost_usd": 0.0,` (no metered calls in that test).

Append:
```python
# ── Arc 7: serving provider/cost in the receipt ─────────────────────────────

def _served(provider, model, pt, ct, cost, prompt, slides):
    from backend.services.ai.call_context import ServedCall
    return ServedCall(provider=provider, model=model, prompt_tokens=pt, completion_tokens=ct,
                      cost_usd=cost, prompt_name=prompt, slide_indices=slides)


def test_llm_usage_receipt_splits_a_batch_call_and_totals_the_run():
    prov = [{"index": 0, "route": "batch"}, {"index": 1, "route": "batch"}, {"index": 2, "route": "vision"}]
    calls = [
        _served("openai", "gpt-4o-mini", 2000, 1000, 0.0009, "BATCH_SLIDE_PROMPT", (0, 1)),
        _served("groq", "gpt-oss-120b", 500, 100, 0.0, "LECTURE_META_ANALYSIS_PROMPT", None),
        _served("groq", "gpt-oss-20b", 300, 50, 0.0, None, (7,)),  # slide not in receipt
    ]
    out, usage = uo._llm_usage_receipt(prov, calls)
    assert "served_by" not in prov[0]  # input not mutated
    assert out[0]["served_by"] == [{
        "provider": "openai", "model": "gpt-4o-mini", "prompt": "BATCH_SLIDE_PROMPT",
        "prompt_tokens": 2000, "completion_tokens": 1000, "cost_usd": 0.0009, "shared_by": 2,
    }]
    assert out[0]["cost_usd"] == pytest.approx(0.00045)
    assert out[2]["served_by"] == [] and out[2]["cost_usd"] == 0.0
    assert usage["calls"] == 3
    assert (usage["prompt_tokens"], usage["completion_tokens"]) == (2800, 1150)
    assert usage["cost_usd"] == pytest.approx(0.0009)
    assert usage["by_prompt"]["LECTURE_META_ANALYSIS_PROMPT"] == {"calls": 1, "cost_usd": 0.0}
    assert usage["by_prompt"]["unnamed"]["calls"] == 1
    assert usage["by_provider"]["openai"] == {"calls": 1, "cost_usd": 0.0009}
    assert usage["vision_metered"] is False


async def test_receipt_records_serving_provider_and_cost(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    import backend.services.parser.synthesis as synthesis
    from backend.services.ai import cost as cost_module
    from backend.services.ai.cost import LLMUsage

    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B, ""])
    logged = []

    async def fake_log(**kw):
        logged.append(kw)

    async def noop(*_a, **_k):
        return None

    monkeypatch.setattr(cost_module, "log_llm_call", fake_log)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: None)
    monkeypatch.setattr(ai_orchestrator._rotator, "flush_openai_cost_to_redis", noop)

    async def metered(provider, model, pt, ct):
        await ai_orchestrator._account_for_call(
            provider, model, LLMUsage(prompt_tokens=pt, completion_tokens=ct),
            user_id=None, course_id=None, feature="test", duration_seconds=0.0,
        )

    async def batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        await metered("openai", "gpt-4o-mini", 2000, 1000)  # $0.0003 + $0.0006
        return [{"index": s["index"], "title": f"S{s['index']}", "summary": f"sum{s['index']}",
                 "slide_type": "text"} for s in slides_input]

    async def meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        await metered("groq", "gpt-oss-120b", 500, 100)
        return {"title": "L", "summary": "D"}

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", batch)
    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    await _run("h", OWNER, filename="Deck.pdf")

    (receipt,) = rec["receipts"]
    prov = receipt["slide_provenance"]
    assert prov[0]["served_by"][0]["provider"] == "openai"
    assert prov[0]["served_by"][0]["shared_by"] == 2
    assert prov[0]["cost_usd"] == pytest.approx(0.00045)
    assert prov[2]["served_by"] == []  # vision: not metered
    usage = receipt["llm_usage"]
    assert usage["calls"] == 2 and usage["cost_usd"] == pytest.approx(0.0009)
    assert usage["by_prompt"]["LECTURE_META_ANALYSIS_PROMPT"]["calls"] == 1
    assert {row["run_id"] for row in logged} == {str(run.run_id)}


async def test_usage_fold_failure_still_writes_the_receipt(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("fold exploded")

    monkeypatch.setattr(uo, "_llm_usage_receipt", boom)
    events = await _run("h", OWNER, filename="Deck.pdf")
    assert events[-1][0] == "complete"
    (receipt,) = rec["receipts"]
    assert receipt["llm_usage"] is None
    assert "served_by" not in receipt["slide_provenance"][0]
```

Append to `test_parse_receipt_repo.py`:
```python
async def test_save_parse_receipt_writes_llm_usage_as_jsonb(conn):
    usage = {"calls": 2, "cost_usd": 0.0009, "by_prompt": {}, "by_provider": {}}
    await repos.save_parse_receipt(
        uuid4(), uuid4(), deck_skeleton=None, slide_provenance=[], quiz_grounding=None,
        llm_usage=usage,
    )
    ((query, args),) = conn.executed
    assert "llm_usage = EXCLUDED.llm_usage" in query
    assert json.loads(args[5]) == usage


async def test_save_parse_receipt_stores_sql_null_without_llm_usage(conn):
    await repos.save_parse_receipt(
        uuid4(), uuid4(), deck_skeleton=None, slide_provenance=[], quiz_grounding=None,
    )
    ((_query, args),) = conn.executed
    assert args[5] is None
```

Changes in `test_parse_receipt_endpoint.py`:
1. Change the `_seed_receipt` signature to `def _seed_receipt(fake, *, run_id, lecture_id, created_at, kept=3, llm_usage=None) -> None:`.
2. Add `"llm_usage": llm_usage,` to its insert dict.
3. In `test_owner_gets_the_latest_receipt`, the key set becomes `{"run_id", "lecture_id", "deck_skeleton", "slide_provenance", "quiz_grounding", "llm_usage", "created_at"}`.
4. Append:
   ```python
   def test_owner_gets_llm_usage(client, app, fake_supabase, professor_user):
       _auth_as(app, professor_user)
       _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
       usage = {"calls": 2, "prompt_tokens": 2500, "completion_tokens": 1100, "cost_usd": 0.0009,
                "by_prompt": {"BATCH_SLIDE_PROMPT": {"calls": 1, "cost_usd": 0.0009}},
                "by_provider": {"openai": {"calls": 1, "cost_usd": 0.0009}}, "vision_metered": False}
       _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                     created_at="2026-10-12T10:00:00+00:00", llm_usage=usage)
       r = client.get(_url(LECTURE_A))
       assert r.status_code == 200, r.text
       assert r.json()["data"]["llm_usage"] == usage
   ```

Append to `backend/tests/db/test_unified_pipeline_e2e.py`. This is the real asyncpg round trip of tagged `llm_calls` plus the receipt:
```python
async def test_parse_tags_llm_calls_with_its_run_and_receipt_totals_them(
    wired_pool, db_conn, make_user, monkeypatch
):
    import backend.services.ai.orchestrator as ai_orchestrator
    from backend.services.ai import cost as cost_module
    from backend.services.ai.cost import LLMUsage

    prof = make_user(role="professor")
    pages = [
        "Breadth-first search visits every vertex level by level.",
        "Depth-first search follows one branch to its end first.",
    ]
    _patch_synthesis(monkeypatch, pages=pages, deck_quiz=[])
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: None)

    async def batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        await ai_orchestrator._account_for_call(
            "groq", "gpt-oss-20b", LLMUsage(prompt_tokens=800, completion_tokens=200),
            user_id=None, course_id=None, feature="batch_analyze_text_slides",
            duration_seconds=0.0, prompt_name="BATCH_SLIDE_PROMPT",
        )
        return [{"index": s["index"], "title": "T", "summary": "S", "slide_type": "text"}
                for s in slides_input]

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", batch)
    await _run("hash_llm_ctx", prof)

    cur = db_conn.cursor()
    cur.execute("SELECT run_id FROM parse_runs WHERE pdf_hash = %s", ("hash_llm_ctx",))
    (run_id,) = cur.fetchone()
    cur.execute(
        "SELECT provider, slide_indices, prompt_tokens FROM public.llm_calls "
        "WHERE run_id = %s AND prompt_name = 'BATCH_SLIDE_PROMPT'",
        (run_id,),
    )
    assert cur.fetchall() == [("groq", [0, 1], 800)]
    cur.execute("SELECT llm_usage, slide_provenance FROM parse_receipts WHERE run_id = %s", (run_id,))
    usage, prov = cur.fetchone()
    assert usage["by_prompt"]["BATCH_SLIDE_PROMPT"]["calls"] == 1
    assert usage["prompt_tokens"] >= 800
    assert prov[0]["served_by"][0]["provider"] == "groq"
    assert prov[0]["served_by"][0]["shared_by"] == 2
```

**Step 2: run.**
```
... -m pytest backend/tests/unit/test_unified_orchestrator.py backend/tests/unit/test_parse_receipt_repo.py backend/tests/integration/test_parse_receipt_endpoint.py -m "not db" -q
```
Expected:
- `AttributeError: ... '_llm_usage_receipt'`.
- `KeyError: 'served_by'`.
- `TypeError: save_parse_receipt() got an unexpected keyword argument 'llm_usage'`.
- The endpoint key-set mismatch, and `llm_usage` missing.

DB:
```
DB_TEST_LOCAL_ADMIN_DSN=postgresql://localhost:1/postgres ... -m pytest backend/tests/db/test_unified_pipeline_e2e.py -k llm_calls -m db -q
```
Expected: the `llm_calls` row exists (Tasks 5 and 6), but `usage` is `None`, so `TypeError: 'NoneType' object is not subscriptable`.

**Step 3: implementation.**

In `unified_orchestrator.py`, add after `_provenance_entry`:
```python
def _llm_usage_receipt(
    slide_provenance: List[Dict[str, Any]], calls: Sequence[ServedCall],
) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Fold this attempt's metered LLM calls into the receipt (Arc 7). Pure:
    returns new provenance entries plus the run totals.

    Each entry gains ``served_by`` (one item per call that carried the slide:
    provider, model, prompt, tokens, cost, and ``shared_by`` = how many slides
    the call covered) and ``cost_usd`` (the slide's even share of those calls).
    Deck-level calls (meta, quiz, repair, ...) have no slide and count only in
    the totals. Vision calls are not metered (ai/vision.py reports no usage),
    so vision slides show an empty ``served_by``."""
    provenance = [{**entry, "served_by": [], "cost_usd": 0.0} for entry in slide_provenance]
    by_index = {entry["index"]: entry for entry in provenance}
    totals: Dict[str, Any] = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                              "cost_usd": 0.0, "by_prompt": {}, "by_provider": {}}
    for call in calls:
        totals["calls"] += 1
        totals["prompt_tokens"] += call.prompt_tokens
        totals["completion_tokens"] += call.completion_tokens
        totals["cost_usd"] += call.cost_usd
        for key, name in (("by_prompt", call.prompt_name or "unnamed"), ("by_provider", call.provider)):
            bucket = totals[key].setdefault(name, {"calls": 0, "cost_usd": 0.0})
            bucket["calls"] += 1
            bucket["cost_usd"] += call.cost_usd
        shared_by = len(call.slide_indices or ())
        for i in call.slide_indices or ():
            entry = by_index.get(i)
            if entry is None:
                continue
            entry["served_by"].append({
                "provider": call.provider, "model": call.model, "prompt": call.prompt_name,
                "prompt_tokens": call.prompt_tokens, "completion_tokens": call.completion_tokens,
                "cost_usd": round(call.cost_usd, 6), "shared_by": shared_by,
            })
            entry["cost_usd"] += call.cost_usd / shared_by
    for entry in provenance:
        entry["cost_usd"] = round(entry["cost_usd"], 6)
    totals["cost_usd"] = round(totals["cost_usd"], 6)
    for key in ("by_prompt", "by_provider"):
        for bucket in totals[key].values():
            bucket["cost_usd"] = round(bucket["cost_usd"], 6)
    totals["vision_metered"] = False
    return provenance, totals
```

Replace the whole `_write_parse_receipt` with:
```python
async def _write_parse_receipt(
    run_id: UUID,
    lecture_id: UUID,
    *,
    skeleton: Any,
    slide_provenance: List[Dict[str, Any]],
    quiz_grounding: Optional[Dict[str, Any]],
    served_calls: Sequence[ServedCall] = (),
) -> None:
    """Arc 5: persist what this parse saw and decided, for the professor.
    Arc 7: plus who served each slide and what the run cost so far. A receipt
    is diagnostics, so failing to build or write any part of it is logged and
    never fails a parse that otherwise succeeded; a failed usage fold still
    writes the rest of the receipt."""
    llm_usage: Optional[Dict[str, Any]] = None
    try:
        slide_provenance, llm_usage = _llm_usage_receipt(slide_provenance, served_calls)
    except Exception as exc:
        logger.warning("parse receipt llm usage fold failed (non-fatal) run=%s: %s",
                       run_id, exc, exc_info=True)
    try:
        from backend.services.parser.deck_plan import skeleton_receipt

        await repos.save_parse_receipt(
            run_id,
            lecture_id,
            deck_skeleton=skeleton_receipt(skeleton) if skeleton is not None else None,
            slide_provenance=slide_provenance,
            quiz_grounding=quiz_grounding,
            llm_usage=llm_usage,
        )
    except Exception as exc:
        logger.warning("parse receipt write failed (non-fatal) run=%s: %s", run_id, exc, exc_info=True)
```

At the call site, add `served_calls=list(served_calls),` after `quiz_grounding=quiz_stats or None,`. This snapshot freezes the receipt at write time; later calls such as localization stay in `llm_calls` only.

In `_provenance_entry`, replace the docstring sentence `` ``requested_model`` is the model the parse asked for (head of the provider chain). `` with: `` ``requested_model`` is the model the parse asked for (head of the provider chain); the serving provider/model/cost are added at finalize by _llm_usage_receipt. ``

In `repos.py`, replace the whole `save_parse_receipt` with:
```python
async def save_parse_receipt(
    run_id: UUID,
    lecture_id: UUID,
    *,
    deck_skeleton: Optional[dict],
    slide_provenance: list[dict],
    quiz_grounding: Optional[dict],
    llm_usage: Optional[dict] = None,
) -> None:
    """Upsert one run's receipt. A forced re-parse reuses its parse_runs row
    (get_or_create_run upserts), so the newer receipt replaces the older one.
    Missing parts are stored as SQL NULL, not JSON null. ``llm_usage`` (Arc 7)
    holds the attempt's metered-call totals.

    Known limitation: receipts are keyed by run_id alone, and parse_runs
    dedupes per (pdf_hash, pipeline_version, user_id), so one owner's two
    lectures built from the same PDF share a single run and therefore a single
    receipt (the later write wins, and lecture_id follows it). A failed or
    cancelled force-reparse leaves the previous run's receipt in place, still
    describing the earlier parse.

    Raises on DB error; non-fatality is the caller's job."""
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO parse_receipts
                (run_id, lecture_id, deck_skeleton, slide_provenance, quiz_grounding, llm_usage)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
            ON CONFLICT (run_id) DO UPDATE
                SET lecture_id = EXCLUDED.lecture_id,
                    deck_skeleton = EXCLUDED.deck_skeleton,
                    slide_provenance = EXCLUDED.slide_provenance,
                    quiz_grounding = EXCLUDED.quiz_grounding,
                    llm_usage = EXCLUDED.llm_usage,
                    created_at = now()
            """,
            run_id,
            lecture_id,
            None if deck_skeleton is None else json.dumps(deck_skeleton),
            json.dumps(slide_provenance),
            None if quiz_grounding is None else json.dumps(quiz_grounding),
            None if llm_usage is None else json.dumps(llm_usage),
        )
```

In `parse_receipts.py`:
1. Replace `_RECEIPT_COLUMNS` with:
   ```python
   _RECEIPT_COLUMNS = (
       "run_id", "lecture_id", "deck_skeleton", "slide_provenance", "quiz_grounding",
       "llm_usage", "created_at",
   )
   ```
2. In the module docstring, change the endpoint description line to: "The latest receipt for a lecture the caller owns: deck skeleton, per-slide synthesis provenance (incl. serving provider/model/cost), the deck-quiz grounding summary, and the run's LLM usage totals."

**Step 4: green.** Re-run both Step 2 commands, then the full suites:
```
... -m pytest backend/tests -m "not db" -q
DB_TEST_LOCAL_ADMIN_DSN=postgresql://localhost:1/postgres ... -m pytest backend/tests/db -m db -q
```
Expect the ledger's last counts plus the new tests, with only the known pre-existing clock-skew flake.

**Step 5: mutation-verify.**

| Revert | Expected |
|---|---|
| `entry["cost_usd"] += call.cost_usd / shared_by` → `entry["cost_usd"] += call.cost_usd` | Both 0.00045 assertions fail (0.0009). |
| `llm_usage=llm_usage,` in `_write_parse_receipt` → delete | The receipt test fails on `KeyError`/`None` usage, and the DB e2e fails. |
| `served_calls=list(served_calls),` at the call site → delete | `usage["calls"] == 0` and the receipt test fails. |
| `llm_usage = EXCLUDED.llm_usage,` in repos → delete | The repo test fails. |

Restore each one.

**Step 6: commit.** `feat(parser): parse receipt records serving provider/model/tokens/cost per slide and run LLM totals; endpoint returns llm_usage`

---

## Notes for the controller
- **Task order:** 1 → 2 → 3 (Part A, independent of Part B) → 4 → 5 → 6 → 7. Task 7 depends on 4, 5 and 6. Task 5's DB test depends on 4.
- **Fakes to update:** two fakes copy signatures exactly and are updated inside the tasks that change them:
  - the `save_parse_receipt` fake in `_patch_common` (Task 7)
  - the exact-dict provenance assertion in `test_receipt_provenance_records_batch_and_vision_routes` (Tasks 2 and 7)
- **Expected-failure risk:** `_long_pages()` decks fold every page into boilerplate. Task 1's raw fallback keeps them unchanged; if a batch test changes, look there first.
- **Not done (honest gaps; the receipt says so with `vision_metered: False`):**
  - metering for vision calls
  - metering for the sync admin-slide classifier (`content_filter._llm_generate_text_sync`)
  - regenerating `src/integrations/supabase/types.ts`, which is not needed: no client can read `llm_calls` after the revoke
- **Deploy order is safe both ways:**
  - Code before migration: `log_llm_call` falls back to the legacy insert; the receipt `llm_usage` write needs the `parse_receipts` table, which is itself unapplied.
  - Migration before code: the new columns stay NULL.

### Critical files for implementation
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/parser/unified_orchestrator.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/ai/orchestrator.py (`_account_for_call`, line ~1273)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/ai/cost.py (`log_llm_call`)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/parser/deck_plan.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/eval/deck_lab.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/supabase/migrations/20261012000000_parse_receipts.sql (and new 20261012010000_llm_calls_run_context.sql)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/tests/unit/test_unified_orchestrator.py (`_patch_common` fakes)