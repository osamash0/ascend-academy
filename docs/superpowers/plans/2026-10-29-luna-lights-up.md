# Luna Lights Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The reader's faces (Explain, Text, Ask, then Practise) switch on page by page while Luna is still reading a dropped file, and the handover to the full reader happens as soon as her first pages exist instead of when the whole run ends.

**Architecture:** The existing reading-status endpoint gains `pagesReady`, `practiceReady` and `readable`. The early reader hands over at `readable` and passes the run id in the URL. The full reader (`LessonFacesScreen`) polls that run while it is not `ready`, re-reads the lesson as pages land, and gates each face per page through a small, separately tested `useLights` hook.

**Tech Stack:** FastAPI + asyncpg (backend), React 18 + TypeScript + Vite, vitest + Testing Library, `motion/react`, i18next.

**Spec:** `docs/superpowers/specs/2026-10-29-luna-lights-up-design.md`

**Branch:** `feat/luna-lights-up` (stacked on `feat/instant-reader`, PR #139).

## Global Constraints

- Upgrade `src/features/spaces/screens/LessonFacesScreen.tsx`; do not create another reader screen.
- v4 namespace boundary (`src/features/spaces/__tests__/boundary.test.ts`): PDF parts only from `@/components/pdf`; no `fetch(`, `WebSocket` or `XMLHttpRequest` inside `src/features/spaces` — use the live repository's `http` client.
- Every user-facing string in both `src/i18n/locales/en/v4Reader.json` and `src/i18n/locales/de/v4Reader.json` (`npm run lint:i18n`, `npm run lint:v4`). German never uses "Folie" or "Datei" (`docs/V4_GLOSSARY.md`).
- Monochrome; only Luna and the page's own accent carry colour. Respect `useReducedMotion()`.
- One fact, once: the page count lives in the timeline only.
- A lesson that is not a still-running upload (no run) behaves exactly as today — no polling, no gating.
- Gates before every commit: `npx tsc -p tsconfig.app.json --noEmit` (never `tsconfig.json`), the task's tests, and `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/__tests__/boundary.test.ts --testTimeout=60000`.
- Frontend tests always run as `VITE_V4_DATA_MODE=demo npx vitest run <files> --testTimeout=60000` (the local `.env.local` is live mode).
- Backend tests: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/<file> -q` from the repo root. No test may connect to a database (the local `.env` points at production): use fake connections as `test_v4_early_reading.py` does.
- No database migration. Never run `supabase db push`. Never push.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `backend/services/v4_spaces_service.py` | `reading_view` / `early_reading` gain `pagesReady`, `practiceReady`, `readable`; `uploads_for` gains `readable` |
| `backend/services/materials_service.py` | `list_my_materials` also returns `slide_count` |
| `backend/tests/unit/test_v4_early_reading.py` | tests for the new fields |
| `src/features/spaces/data/liveRepository.ts` | `EarlyReading` type gains the fields |
| `src/features/spaces/data/world.ts` | `Upload` gains `readable?: boolean` |
| `src/features/spaces/data/useRunReading.ts` (new) | polls one run's reading status; shared by the early and the full reader |
| `src/features/spaces/data/useEarlyReading.ts` | uses `useRunReading` |
| `src/features/spaces/components/reader/EarlyReader.tsx` | hands over at `readable` |
| `src/features/spaces/screens/StudioCanvasScreen.tsx` | handover URLs carry `&run=` |
| `src/features/spaces/data/useShelf.ts` | `coverOf` opens the Lesson when `ready` or `readable` |
| `src/features/spaces/data/useReader.ts` | `useReaderContent` follows a run (refetch, ideas wait) |
| `src/features/spaces/data/practice.ts` | `usePracticeQuestions` can wait (`armed`) and never pins an empty answer |
| `src/features/spaces/components/reader/lights.ts` (new) | pure helpers + `useLights` hook: per-page readiness, buffer, the once-only lines |
| `src/features/spaces/screens/LessonFacesScreen.tsx` | wires the run and the lights into tabs, keys, Ask, Practise, Luna offer, timeline |
| `src/i18n/locales/{en,de}/v4Reader.json` | `lights.*` copy |

---

### Task 1: The reading status says which pages exist

**Files:**
- Modify: `backend/services/v4_spaces_service.py` (`reading_view`, `early_reading`, `uploads_for`, ~lines 373–470)
- Modify: `backend/services/materials_service.py` (`list_my_materials` output dict, ~line 222)
- Test: `backend/tests/unit/test_v4_early_reading.py`

**Interfaces:**
- Produces: `reading_view(run: dict, pages_ready: list[int], practice_ready: bool, pdf_url: str | None) -> dict` returning
  `{"pdfUrl", "pages", "pagesRead", "pagesReady", "practiceReady", "readable", "stage", "lessonId"}`.
  `pagesReady` ascending ints; all `1..pages` when `stage == "ready"`. `pagesRead == len(pagesReady)` capped at `pages`. `readable = bool(lecture_id) and len(pagesReady) > 0`.
- Produces: each `uploads_for` row gains `"readable": bool`.
- Produces: each `list_my_materials` row gains `"slide_count": int`.

- [ ] **Step 1: Rewrite the pure-function tests for the new signature and add the new cases**

Replace the five `reading_view` tests at the top of `backend/tests/unit/test_v4_early_reading.py` with:

```python
def test_a_fresh_run_can_be_read_with_nothing_done_yet():
    v = reading_view(run(), [], False, "https://signed/x.pdf")
    assert v == {
        "pdfUrl": "https://signed/x.pdf",
        "pages": 82,
        "pagesRead": 0,
        "pagesReady": [],
        "practiceReady": False,
        "readable": False,
        "stage": "developing",
        "lessonId": None,
    }


def test_pages_luna_has_written_are_listed_in_order_and_make_it_readable():
    v = reading_view(run(lecture_id="L1"), [3, 1, 2], False, "u")
    assert v["pagesReady"] == [1, 2, 3]
    assert v["pagesRead"] == 3
    assert v["readable"] is True
    assert v["stage"] == "developing"


def test_a_lesson_row_without_pages_is_not_readable_yet():
    assert reading_view(run(lecture_id="L1"), [], False, "u")["readable"] is False


def test_progress_never_exceeds_the_page_count():
    assert reading_view(run(page_count=2, lecture_id="L1"), [1, 2, 3], False, "u")["pagesRead"] == 2


def test_a_finished_run_is_ready_and_fully_read():
    v = reading_view(run(status="completed", lecture_id="L1", page_count=4), [1, 2], True, "u")
    assert v["stage"] == "ready" and v["lessonId"] == "L1"
    assert v["pagesReady"] == [1, 2, 3, 4] and v["pagesRead"] == 4
    assert v["practiceReady"] is True and v["readable"] is True


def test_a_failed_run_keeps_what_was_read():
    v = reading_view(run(status="failed", lecture_id="L1"), [1, 2], False, "u")
    assert v["stage"] == "failed" and v["pagesReady"] == [1, 2] and v["readable"] is True


def test_unknown_page_count_reads_as_zero():
    assert reading_view(run(page_count=None), [], False, "u")["pages"] == 0
```

In the `_Conn` fake, add a `fetch` method (the route now lists slide numbers) and make `fetchval` answer the practice check:

```python
    async def fetch(self, *a):
        return []

    async def fetchval(self, *a):
        return False
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_early_reading.py -q`
Expected: FAIL — `reading_view()` takes 3 positional arguments / missing keys.

- [ ] **Step 3: Implement `reading_view` and `early_reading`**

In `backend/services/v4_spaces_service.py` replace `reading_view` and `early_reading` with:

```python
def reading_view(
    run: Dict[str, Any], pages_ready: List[int], practice_ready: bool, pdf_url: Optional[str]
) -> Dict[str, Any]:
    """What a reader of a running upload needs: the file, and what Luna has made of it.

    The file is readable from the moment it is stored. The Lesson exists once
    the pipeline has made its row, and can be opened once Luna has written its
    first pages (``readable``). ``pagesReady`` are the pages she has written; a
    finished run is fully read. Practice exists only once its questions do.
    """
    status = (run.get("status") or "").lower()
    pages = int(run.get("page_count") or 0)
    ready = bool(run.get("lecture_id")) and status in _DONE
    stage = "failed" if status in _FAILED else ("ready" if ready else "developing")
    written = list(range(1, pages + 1)) if ready else sorted({int(p) for p in pages_ready})
    return {
        "pdfUrl": pdf_url,
        "pages": pages,
        "pagesRead": min(len(written), pages),
        "pagesReady": written,
        "practiceReady": bool(practice_ready),
        "readable": bool(run.get("lecture_id")) and len(written) > 0,
        "stage": stage,
        "lessonId": str(run["lecture_id"]) if run.get("lecture_id") else None,
    }


async def early_reading(user_id: str, run_id: str) -> Optional[Dict[str, Any]]:
    """The caller's own run only; None for anything else (the route answers 404)."""
    from backend.services.v4_reader_service import signed_pdf_url

    async with await get_db_connection() as conn:
        run = await conn.fetchrow(
            "SELECT status, page_count, lecture_id, pdf_hash FROM parse_runs WHERE run_id = $1 AND user_id = $2",
            UUID(run_id),
            UUID(user_id),
        )
        if not run:
            return None
        pages_ready: List[int] = []
        practice_ready = False
        if run["lecture_id"]:
            rows = await conn.fetch(
                "SELECT slide_number FROM slides WHERE lecture_id = $1 ORDER BY slide_number", run["lecture_id"]
            )
            pages_ready = [int(r["slide_number"]) for r in rows]
            practice_ready = bool(
                await conn.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM quiz_questions q JOIN slides s ON s.id = q.slide_id"
                    " WHERE s.lecture_id = $1)",
                    run["lecture_id"],
                )
            )
    pdf_url = await signed_pdf_url(f"{run['pdf_hash']}.pdf", "pdf-uploads")
    return reading_view(dict(run), pages_ready, practice_ready, pdf_url)
```

- [ ] **Step 4: Add `slide_count` to `list_my_materials` and `readable` to `uploads_for`**

In `backend/services/materials_service.py`, in the `out.append({...})` of `list_my_materials`, add after `"quiz_count": c.get("quiz_count", 0),`:

```python
            "slide_count": c.get("slide_count", 0),
```

In `backend/services/v4_spaces_service.py` `uploads_for`, add to the per-run dict after `"stage": ...`:

```python
            # The Lesson can be opened once Luna has written its first pages.
            "readable": bool(r.get("lecture_id")) and int(r.get("slide_count") or 0) > 0,
```

and to the orphan dict after `"stage": "ready",`:

```python
            "readable": True,
```

Update the `uploads_for` docstring's last sentence to: ``ready`` once the run is done; ``readable`` as soon as its Lesson has pages.

- [ ] **Step 5: Add a test for `uploads_for`'s `readable`**

Append to `backend/tests/unit/test_v4_early_reading.py`:

```python
@pytest.mark.asyncio
async def test_the_shelf_marks_an_upload_readable_once_it_has_pages(monkeypatch):
    from backend.services import v4_spaces_service as svc

    async def mine(user_id):
        return [
            {"run_id": "r1", "lecture_id": "L1", "status": "running", "filename": "a.pdf", "title": None,
             "total_slides": 0, "slide_count": 8, "created_at": "2026-10-29T10:00:00Z"},
            {"run_id": "r2", "lecture_id": "L2", "status": "running", "filename": "b.pdf", "title": None,
             "total_slides": 0, "slide_count": 0, "created_at": "2026-10-29T09:00:00Z"},
        ]

    class _Empty:
        async def fetch(self, *a):
            return []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    async def conn():
        return _Empty()

    monkeypatch.setattr(svc.materials_service, "list_my_materials", mine)
    monkeypatch.setattr(svc, "get_db_connection", conn)
    out = {u["id"]: u for u in await svc.uploads_for("u")}
    assert out["r1"]["readable"] is True and out["r1"]["stage"] == "developing"
    assert out["r2"]["readable"] is False
```

(If `pytest.mark.asyncio` is not configured in this repo, check `backend/tests/unit/test_materials_service.py` for how async tests are marked and use the same.)

- [ ] **Step 6: Run the tests**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_early_reading.py backend/tests/unit/test_materials_service.py -q`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/v4_spaces_service.py backend/services/materials_service.py backend/tests/unit/test_v4_early_reading.py
git commit -m "feat(v4): the reading status lists the pages Luna has written and says when the Lesson can open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hand over as soon as the first pages exist

**Files:**
- Modify: `src/features/spaces/data/liveRepository.ts` (`EarlyReading`, line ~13)
- Modify: `src/features/spaces/data/world.ts` (`Upload`, line ~57)
- Create: `src/features/spaces/data/useRunReading.ts`
- Modify: `src/features/spaces/data/useEarlyReading.ts`
- Modify: `src/features/spaces/components/reader/EarlyReader.tsx` (handover effect, ~line 64)
- Modify: `src/features/spaces/screens/StudioCanvasScreen.tsx` (`onReady` ~line 600, `<Navigate>` ~line 611)
- Modify: `src/features/spaces/data/useShelf.ts` (`coverOf`, ~line 100)
- Test: `src/features/spaces/data/__tests__/useEarlyReading.test.tsx`, `src/features/spaces/components/reader/__tests__/EarlyReader.test.tsx`, `src/features/spaces/components/__tests__/earlyHandover.test.tsx`, `src/features/spaces/data/__tests__/coverOf.test.ts`, new `src/features/spaces/data/__tests__/useRunReading.test.tsx`

**Interfaces:**
- Consumes: Task 1's response shape.
- Produces:
  ```ts
  // liveRepository.ts
  export interface EarlyReading {
    pdfUrl: string | null;
    pages: number;
    pagesRead: number;
    pagesReady: number[];
    practiceReady: boolean;
    readable: boolean;
    stage: 'developing' | 'ready' | 'failed';
    lessonId: string | null;
  }
  // world.ts — Upload gains:
  readable?: boolean;
  // useRunReading.ts
  export function useRunReading(runId: string | null): EarlyReading | null;
  ```
- Produces: handover URLs `/v4/space/<spaceId>/lesson/<lessonId>/faces?page=<n>&run=<runId>` (Task 5 reads `run`).

- [ ] **Step 1: Write the failing test for `useRunReading`**

Create `src/features/spaces/data/__tests__/useRunReading.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readingFor = vi.fn();
vi.mock('../liveRepository', () => ({ loadLiveRepository: async () => ({ readingFor }) }));

import { useRunReading } from '../useRunReading';

const reading = (over = {}) => ({
  pdfUrl: 'https://signed', pages: 10, pagesRead: 0, pagesReady: [], practiceReady: false,
  readable: false, stage: 'developing', lessonId: null, ...over,
});

beforeEach(() => readingFor.mockReset());
afterEach(() => vi.useRealTimers());

describe('useRunReading', () => {
  it('asks nothing without a run, or for a file still on its way up', async () => {
    renderHook(() => useRunReading(null));
    renderHook(() => useRunReading('sending-1'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(readingFor).not.toHaveBeenCalled();
  });

  it('keeps asking while Luna is reading, and stops once she is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    readingFor
      .mockResolvedValueOnce(reading({ pagesReady: [1] }))
      .mockResolvedValueOnce(reading({ stage: 'ready', pagesReady: [1, 2], readable: true }));
    const { result } = renderHook(() => useRunReading('run-1'));
    await waitFor(() => expect(result.current?.pagesReady).toEqual([1]));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await waitFor(() => expect(result.current?.stage).toBe('ready'));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(readingFor).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/data/__tests__/useRunReading.test.tsx --testTimeout=60000`
Expected: FAIL — cannot resolve `../useRunReading`.

- [ ] **Step 3: Extend the types**

In `liveRepository.ts`, replace the `EarlyReading` interface with the one in **Interfaces** above (add `pagesReady`, `practiceReady`, `readable`, each with a one-line comment: "pages Luna has written, ascending", "practice questions exist", "the Lesson can be opened").

In `world.ts`, add to `Upload` after `stage`:

```ts
  /** Its Lesson has pages already, so it can be opened while Luna is still reading. */
  readable?: boolean;
```

- [ ] **Step 4: Create `useRunReading` by moving the polling out of `useEarlyReading`**

Create `src/features/spaces/data/useRunReading.ts`:

```ts
import { useEffect, useState } from 'react';
import { loadLiveRepository, type EarlyReading } from './liveRepository';

/** How often Luna's progress is re-read while she is still reading. */
const POLL_MS = 3000;
/** Consecutive failed reads before giving up. */
const MAX_FAILURES = 5;

/**
 * One upload's reading status, re-read every few seconds until Luna is done or
 * the run has failed. Null until the first answer, and always null without a
 * run or for a file still on its way up (`sending-*`, no run yet).
 */
export function useRunReading(runId: string | null): EarlyReading | null {
  const [reading, setReading] = useState<EarlyReading | null>(null);
  useEffect(() => {
    setReading(null);
    if (!runId || runId.startsWith('sending-')) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const tick = async () => {
      try {
        const repo = await loadLiveRepository();
        const next = await repo.readingFor(runId);
        if (!alive) return;
        failures = 0;
        setReading(next);
        if (next.stage === 'developing') timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!alive) return;
        const status = (e as { status?: number })?.status;
        // Not yours / removed / signed out: retrying cannot help.
        if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return;
        failures += 1;
        if (failures < MAX_FAILURES) timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);
  return reading;
}
```

Replace the body of `useEarlyReading.ts` with:

```ts
import { localUrlFor } from './uploads';
import { useRunReading } from './useRunReading';

/**
 * An upload you can read before its Lesson exists. The file on this device
 * opens at once (no network); otherwise the stored copy's signed link. Luna's
 * progress is re-read until she is done or the run has failed.
 */
export function useEarlyReading(uploadId: string) {
  /* One link per File, kept across the swap from `sending-N` to the run id: the PDF loads once. */
  const local = localUrlFor(uploadId);
  const reading = useRunReading(uploadId);
  return { reading, url: local ?? reading?.pdfUrl ?? null };
}
```

Note: `useRunReading` resets `reading` to null on run change; the old `useEarlyReading` did not. Check `useEarlyReading.test.tsx` still passes; adjust only fixtures (add the three new fields to each mocked reading) — not assertions.

- [ ] **Step 5: Hand over at `readable`**

In `EarlyReader.tsx` change the handover effect to:

```tsx
  useEffect(() => {
    if (!reading?.readable || !reading.lessonId || handed.current === reading.lessonId) return;
    handed.current = reading.lessonId;
    onReadyRef.current(reading.lessonId, pageRef.current);
  }, [reading?.readable, reading?.lessonId]);
```

and update the comment above it: "The handover fires once per Lesson, as soon as it has pages, with the page as it is at that moment."

- [ ] **Step 6: Carry the run id in both handover URLs**

In `StudioCanvasScreen.tsx`:

```tsx
        onReady={(lessonId, page) => {
          releaseLocalFile(item.id, lessonId);
          navigate(`/v4/space/${spaceId}/lesson/${lessonId}/faces?page=${page}&run=${item.id}`, { replace: true });
        }}
```

and the `<Navigate>` for an item that is already a Lesson:

```tsx
    const at = earlyPage.current ?? askedPage;
    const query = [at && at > 1 ? `page=${at}` : '', item.stage !== 'ready' ? `run=${item.id}` : '']
      .filter(Boolean)
      .join('&');
    return (
      <Navigate
        replace
        to={`/v4/space/${item.opens.spaceId}/lesson/${item.opens.lessonId}/faces${query ? `?${query}` : ''}`}
      />
    );
```

- [ ] **Step 7: The cover opens its Lesson when readable**

In `useShelf.ts` `coverOf`, change the `opens` line to:

```ts
    opens: {
      kind: 'lesson',
      spaceId: world.viewer.id,
      lessonId: u.stage === 'ready' || u.readable ? (u.lessonId ?? '') : '',
    },
```

and the comment's last paragraph to: "…So the cover opens the Lesson only once it has pages (`readable`) or the upload is ready; until then it opens the file itself, in the early reader."

- [ ] **Step 8: Update and extend the tests**

- `coverOf.test.ts`: add
  ```ts
  it('still being read but already with pages, it opens its Lesson', () => {
    const c = coverOf(upload({ lessonId: 'L1', readable: true }), emptyWorld());
    expect(c.opens).toEqual({ kind: 'lesson', spaceId: 'u', lessonId: 'L1' });
  });
  ```
- `EarlyReader.test.tsx`: in every mocked reading add `pagesReady: []`, `practiceReady: false`, `readable: false` (or `true` with `lessonId` where the test hands over). Change "hands over to the Lesson once it exists" to drive `readable: true, stage: 'developing', lessonId: 'L1'` and assert `onReady` was called with `('L1', <page>)`. Add: `it('does not hand over while the Lesson has no pages', …)` with `lessonId: 'L1', readable: false` → `onReady` not called.
- `earlyHandover.test.tsx`: update the expected URLs to include `&run=run-1` where the item is not `ready` (own handover: `/v4/space/u/lesson/L1/faces?page=7&run=run-1`). Items set to `stage: 'ready'` keep their current expectations (no `run`). Add one race case with `item({ stage: 'developing', readable: true } as Partial<ShelfItem>, 'L1')` expecting `…/faces?page=7&run=run-1`.

- [ ] **Step 9: Run the tests**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/data/__tests__/useRunReading.test.tsx src/features/spaces/data/__tests__/useEarlyReading.test.tsx src/features/spaces/components/reader/__tests__/EarlyReader.test.tsx src/features/spaces/components/__tests__/earlyHandover.test.tsx src/features/spaces/data/__tests__/coverOf.test.ts src/features/spaces/components/__tests__/dropOpens.test.tsx src/features/spaces/__tests__/boundary.test.ts --testTimeout=60000`
Expected: all PASS. Then `npx tsc -p tsconfig.app.json --noEmit` clean.

- [ ] **Step 10: Commit**

```bash
git add src/features/spaces
git commit -m "feat(library): hand over to the Lesson as soon as Luna has written its first pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The reader's data follows a running upload

**Files:**
- Modify: `src/features/spaces/data/useReader.ts` (`useReaderContent`, ~lines 218–283)
- Modify: `src/features/spaces/data/practice.ts` (`usePracticeQuestions`, lines 15–55)
- Test: new `src/features/spaces/data/__tests__/useReaderContentRun.test.tsx`, new `src/features/spaces/data/__tests__/practiceArmed.test.tsx`

**Interfaces:**
- Consumes: `EarlyReading` (Task 2).
- Produces:
  ```ts
  /** A running upload the reader follows: how many pages exist, and whether the run is done. */
  export interface RunFollow { pagesReady: number; done: boolean }
  export function useReaderContent(spaceId?: string, lessonId?: string, run?: RunFollow | null): LessonContentResult;
  export function usePracticeQuestions(lessonId: string | undefined, live: boolean, armed?: boolean): { state: LoadState; questions: PracticeQuestion[] };
  ```
  `RunFollow` is exported from `useReader.ts`.

- [ ] **Step 1: Write the failing test for the refetch**

Create `src/features/spaces/data/__tests__/useReaderContentRun.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const readerLecture = vi.fn();
const readerIdeas = vi.fn();
vi.mock('../liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => ({ readerLecture, readerIdeas }),
}));
vi.stubEnv('VITE_V4_DATA_MODE', 'live');

const { useReaderContent } = await import('../useReader');

const S = '11111111-1111-4111-8111-111111111111';
const L = '22222222-2222-4222-8222-222222222222';
const lecture = (n: number) => ({
  lecture: { id: L, title: 'Normalization', total_slides: 0 },
  slides: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, slide_number: i + 1, title: `T${i + 1}`, content_text: 'x', summary: '' })),
  concepts: [],
  pdf_signed_url: 'https://signed',
});

beforeEach(() => {
  readerLecture.mockReset();
  readerIdeas.mockReset();
  readerIdeas.mockResolvedValue({ concepts: [] });
});

describe('useReaderContent following a running upload', () => {
  it('reads the Lesson again as Luna writes more pages, and asks for ideas only once she is done', async () => {
    readerLecture.mockResolvedValueOnce(lecture(8)).mockResolvedValueOnce(lecture(16)).mockResolvedValueOnce(lecture(16));
    const { result, rerender } = renderHook(({ run }) => useReaderContent(S, L, run), {
      initialProps: { run: { pagesReady: 8, done: false } },
    });
    await waitFor(() => expect(result.current.bundle?.slides.length).toBe(8));
    rerender({ run: { pagesReady: 16, done: false } });
    await waitFor(() => expect(result.current.bundle?.slides.length).toBe(16));
    expect(result.current.state).toBe('ready');
    expect(readerIdeas).not.toHaveBeenCalled();
    rerender({ run: { pagesReady: 16, done: true } });
    await waitFor(() => expect(readerIdeas).toHaveBeenCalledTimes(1));
    expect(readerLecture).toHaveBeenCalledTimes(3);
  });
});
```

Before writing it, open `liveRepository.ts` and check the real method names the reader uses for the lecture and for ideas (`getLecture` calls `readerLecture`; check what `getIdeas` calls and its return shape) and adjust the mock names/shapes to match exactly. Also check `bundleFrom` for the fields a slide needs.

- [ ] **Step 2: Run it to see it fail**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/data/__tests__/useReaderContentRun.test.tsx --testTimeout=60000`
Expected: FAIL — the second length stays 8 (no refetch) and ideas are asked at once.

- [ ] **Step 3: Implement the follow**

In `useReader.ts`:

```ts
/** A running upload the reader follows: how many pages exist, and whether the run is done. */
export interface RunFollow {
  pagesReady: number;
  done: boolean;
}
```

Change the signature to `useReaderContent(spaceId, lessonId, run?: RunFollow | null)`. Derive `const following = !!run && !run.done;` and a refetch key `const generation = run ? `${run.pagesReady}:${run.done ? 1 : 0}` : 'static';`.

In the effect:
- Add `generation` to the dependency list.
- Only reset to `loading` when there is no bundle yet for this lesson (keep showing the current pages while re-reading): use a ref `shownFor` holding the lessonId whose bundle is on screen; reset state only when `shownFor.current !== lessonId`.
- When `run` is given, drop the memo before reading so the read is fresh: `if (run) lectures.delete(lessonId);`.
- Skip the ideas request while `following`: wrap the `getIdeas` block in `if (!following && r.concepts.length === 0) { … }`.
- After a successful read, set `shownFor.current = lessonId`.
- A 409 while following keeps the current bundle (no switch to `empty`): in `.catch`, `if (following && shownFor.current === lessonId) return;`.

Lessons with no `run` take exactly today's path (memoised read, ideas at once).

- [ ] **Step 4: Run the test**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/data/__tests__/useReaderContentRun.test.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 5: Write the failing test for Practise waiting**

Create `src/features/spaces/data/__tests__/practiceArmed.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const practice = vi.fn();
vi.mock('../liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => ({ practice }),
}));

const { usePracticeQuestions } = await import('../practice');

describe('usePracticeQuestions for a Lesson still being read', () => {
  it('asks nothing until armed, and an empty answer is never kept', async () => {
    practice.mockResolvedValueOnce({ questions: [] }).mockResolvedValueOnce({ questions: [{ id: 'q1' }] });
    const { result, rerender } = renderHook(({ armed }) => usePracticeQuestions('L-armed', true, armed), {
      initialProps: { armed: false },
    });
    expect(practice).not.toHaveBeenCalled();
    rerender({ armed: true });
    await waitFor(() => expect(result.current.state).toBe('empty'));
    const again = renderHook(() => usePracticeQuestions('L-armed', true, true));
    await waitFor(() => expect(again.result.current.questions).toHaveLength(1));
    expect(practice).toHaveBeenCalledTimes(2);
  });
});
```

(Check `repo.practice`'s real response shape in `liveRepository.ts` and match it.)

- [ ] **Step 6: Implement `armed`**

In `practice.ts`: add the third parameter `armed = true`. In the effect, `if (!lessonId || !armed) return;` before the live branch (demo branch unchanged when armed). Add `armed` to the dependency list. When a fetched list is empty, delete it from `cache` so a later call asks again:

```ts
      .then((questions) => {
        if (questions.length === 0) cache.delete(lessonId);
        if (alive) setResult({ state: questions.length ? 'ready' : 'empty', questions });
      })
```

While not armed the initial state stays `loading` for live.

- [ ] **Step 7: Run the tests and commit**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/data/__tests__/practiceArmed.test.tsx src/features/spaces/data/__tests__/useReaderContentRun.test.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx src/features/spaces/__tests__/boundary.test.ts --testTimeout=60000` and `npx tsc -p tsconfig.app.json --noEmit`.
Expected: PASS, clean.

```bash
git add src/features/spaces/data
git commit -m "feat(reader): the Lesson is read again as Luna writes pages; ideas and practice wait for her

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The lights — which faces a page has, and the once-only lines

**Files:**
- Create: `src/features/spaces/components/reader/lights.ts`
- Test: new `src/features/spaces/components/reader/__tests__/lights.test.tsx`

**Interfaces:**
- Consumes: `EarlyReading` (Task 2).
- Produces:
  ```ts
  export type LightLine = 'explain' | 'practice' | 'stopped';
  /** The highest page p such that every page 1..p is written: the timeline's buffer. */
  export function bufferOf(pagesReady: number[]): number;
  export interface Lights {
    following: boolean;        // a run is being followed and is not ready
    pageReady: boolean;        // this page has Explain/Text/Ask
    practiceOn: boolean;       // Practise may show (run: practiceReady; no run: `practiceCount > 0`)
    lunaReady: boolean;        // the Luna session offer may show
    buffer: number;            // grey part of the timeline
    line: LightLine | null;    // a line Luna says now (once each), else null
    ringing: boolean;          // true for RING_MS after a light came on: wake controls, ring the new tabs
    dismiss: () => void;       // clears `line` early
  }
  export const RING_MS = 4000;
  export function useLights(run: EarlyReading | null, page: number, opts: { total: number; practiceCount: number }): Lights;
  ```

Rules (from the spec):
- No `run`, or `run.stage === 'ready'`: `following=false`, `pageReady=true`, `practiceOn = run ? run.practiceReady || opts.practiceCount > 0 : opts.practiceCount > 0`, `lunaReady=true`, `buffer = opts.total`.
- Following (`stage` `developing` or `failed`): `pageReady = run.pagesReady.includes(page)`, `practiceOn = run.practiceReady`, `lunaReady = false`, `buffer = bufferOf(run.pagesReady)`.
- `line`:
  - `'explain'` once per hook lifetime, when `pageReady` turns false → true for the current page **during the visit** (not if it was already true on the first render with a run).
  - `'practice'` once, when `run.practiceReady` turns false → true during the visit.
  - `'stopped'` once, when `run.stage` becomes `'failed'` (also on first render if it is already failed).
  - A line clears itself after `RING_MS` (and via `dismiss`). `ringing` is true for `RING_MS` after `'explain'` or `'practice'`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/spaces/components/reader/__tests__/lights.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EarlyReading } from '../../../data/liveRepository';
import { bufferOf, RING_MS, useLights } from '../lights';

const run = (over: Partial<EarlyReading> = {}): EarlyReading => ({
  pdfUrl: 'u', pages: 20, pagesRead: 0, pagesReady: [], practiceReady: false, readable: true,
  stage: 'developing', lessonId: 'L1', ...over,
});
const opts = { total: 20, practiceCount: 0 };
afterEach(() => vi.useRealTimers());

describe('bufferOf', () => {
  it('is the run of written pages from page 1', () => {
    expect(bufferOf([])).toBe(0);
    expect(bufferOf([1, 2, 3, 5])).toBe(3);
    expect(bufferOf([2, 3])).toBe(0);
  });
});

describe('useLights', () => {
  it('without a run every face is on, as today', () => {
    const { result } = renderHook(() => useLights(null, 7, { total: 20, practiceCount: 3 }));
    expect(result.current).toMatchObject({ following: false, pageReady: true, practiceOn: true, lunaReady: true, buffer: 20, line: null });
  });

  it('while Luna reads, a page has faces only once she has written it', () => {
    const { result } = renderHook(() => useLights(run({ pagesReady: [1, 2] }), 5, opts));
    expect(result.current).toMatchObject({ following: true, pageReady: false, practiceOn: false, lunaReady: false, buffer: 2 });
  });

  it('says it once when the page you are on lights up, and rings for a while', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ r, p }) => useLights(r, p, opts), {
      initialProps: { r: run({ pagesReady: [1] }), p: 3 },
    });
    expect(result.current.line).toBeNull();
    rerender({ r: run({ pagesReady: [1, 2, 3] }), p: 3 });
    expect(result.current.line).toBe('explain');
    expect(result.current.ringing).toBe(true);
    act(() => { vi.advanceTimersByTime(RING_MS); });
    expect(result.current.line).toBeNull();
    expect(result.current.ringing).toBe(false);
    rerender({ r: run({ pagesReady: [1, 2, 3, 4] }), p: 4 });
    expect(result.current.line).toBeNull();
  });

  it('a page already lit when you arrive says nothing', () => {
    const { result } = renderHook(() => useLights(run({ pagesReady: [1, 2, 3] }), 3, opts));
    expect(result.current.line).toBeNull();
  });

  it('Practise arrives once, at the end', () => {
    const { result, rerender } = renderHook(({ r }) => useLights(r, 1, opts), {
      initialProps: { r: run({ pagesReady: [1] }) },
    });
    rerender({ r: run({ pagesReady: [1], practiceReady: true }) });
    expect(result.current.practiceOn).toBe(true);
    expect(result.current.line).toBe('practice');
  });

  it('a run that stops keeps what was read and says so once', () => {
    const { result } = renderHook(() => useLights(run({ pagesReady: [1, 2], stage: 'failed' }), 2, opts));
    expect(result.current).toMatchObject({ pageReady: true, line: 'stopped', lunaReady: false });
  });

  it('once Luna is done, everything is on', () => {
    const { result } = renderHook(() => useLights(run({ stage: 'ready', pagesReady: [1, 2], practiceReady: true }), 9, opts));
    expect(result.current).toMatchObject({ following: false, pageReady: true, practiceOn: true, lunaReady: true, buffer: 20 });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/components/reader/__tests__/lights.test.tsx --testTimeout=60000`
Expected: FAIL — cannot resolve `../lights`.

- [ ] **Step 3: Implement `lights.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EarlyReading } from '../../data/liveRepository';

/**
 * The lights: while Luna is still reading a Lesson, which faces a page has
 * (only pages she has written have Explain, Text and Ask), whether Practise and
 * a study session may show yet, how far the timeline's buffer reaches, and the
 * few things Luna says once — the first light on the page you are on, Practise
 * arriving, and a run that stopped. Without a run (a Space's Lesson) every
 * face is on, as it always was.
 */
export type LightLine = 'explain' | 'practice' | 'stopped';
export const RING_MS = 4000;

export function bufferOf(pagesReady: number[]): number {
  const have = new Set(pagesReady);
  let p = 0;
  while (have.has(p + 1)) p += 1;
  return p;
}

export interface Lights {
  following: boolean;
  pageReady: boolean;
  practiceOn: boolean;
  lunaReady: boolean;
  buffer: number;
  line: LightLine | null;
  ringing: boolean;
  dismiss: () => void;
}

export function useLights(
  run: EarlyReading | null,
  page: number,
  opts: { total: number; practiceCount: number },
): Lights {
  const following = !!run && run.stage !== 'ready';
  const pageReady = !following || run!.pagesReady.includes(page);
  const practiceOn = following ? run!.practiceReady : !!run?.practiceReady || opts.practiceCount > 0;
  const buffer = following ? bufferOf(run!.pagesReady) : opts.total;

  const [line, setLine] = useState<LightLine | null>(null);
  const [ringing, setRinging] = useState(false);
  const said = useRef(new Set<LightLine>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((what: LightLine, ring: boolean) => {
    if (said.current.has(what)) return;
    said.current.add(what);
    setLine(what);
    setRinging(ring);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLine(null);
      setRinging(false);
    }, RING_MS);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /* The first light seen during this visit: a change, never what was already there. */
  const was = useRef<{ page: number; ready: boolean; practice: boolean } | null>(null);
  useEffect(() => {
    if (!run) return;
    const prev = was.current;
    was.current = { page, ready: pageReady, practice: run.practiceReady };
    if (run.stage === 'failed') say('stopped', false);
    if (!prev) return;
    if (following && prev.page === page && !prev.ready && pageReady) say('explain', true);
    if (!prev.practice && run.practiceReady) say('practice', true);
  }, [run, page, pageReady, following, say]);

  const dismiss = useCallback(() => {
    setLine(null);
    setRinging(false);
  }, []);

  return { following, pageReady, practiceOn, lunaReady: !following, buffer, line, ringing, dismiss };
}
```

Note the `'explain'` rule fires for the page you stay on (`prev.page === page`); turning onto an already-written page is not a "light coming on". If a test in Step 1 disagrees with this note, the test is the requirement — adjust the code, not the test.

- [ ] **Step 4: Run the tests**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/components/reader/__tests__/lights.test.tsx src/features/spaces/__tests__/boundary.test.ts --testTimeout=60000` and `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/spaces/components/reader/lights.ts src/features/spaces/components/reader/__tests__/lights.test.tsx
git commit -m "feat(reader): the lights — which faces a page has while Luna reads, and what she says once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The full reader shows the faces per page

**Files:**
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx`
- Modify: `src/i18n/locales/en/v4Reader.json`, `src/i18n/locales/de/v4Reader.json`
- Test: new `src/features/spaces/components/__tests__/lessonLights.test.tsx`

**Interfaces:**
- Consumes: `useRunReading(runId)` (Task 2), `RunFollow` + `useReaderContent(…, run)` and `usePracticeQuestions(…, armed)` (Task 3), `useLights` / `RING_MS` (Task 4), `uploadsNow()` from `../data/uploads`.

Context in `LessonFacesScreen.tsx` (line numbers approximate, as of `feat/instant-reader` HEAD):
- `params` (search params) at ~145; `content = useReaderContent(spaceId, lessonId)` at ~138; `practice = usePracticeQuestions(lessonId, liveReader)` at ~207.
- `VIEWS` at ~127 (`slide`, `explain`, `text`); the tabs render `VIEWS.map(...)` at ~1105; the number keys use `VIEWS[Number(e.key) - 1]` at ~535.
- `SelectionAsk` with `onAsk={(text) => askAbout(text)}` at ~964 and ~982.
- `useIdle(ready && view === 'slide' && …, 2800)` at ~611 decides `quiet`.
- The Practise button in `footer` is gated by `lesson.practiceCount > 0` at ~897.
- The Luna toggle/offer cluster is gated by `lunaOn && !lunaOpen` at ~1035; `offerLuna` checks `lunaOn` at ~686.
- `<ReaderTimeline … total={numPages} read={numPages} …/>` at ~1314.
- The phone hint `screen.turnPhone` at ~1200 shows how a transient line is styled.

- [ ] **Step 1: Add the copy**

In `src/i18n/locales/en/v4Reader.json` add a top-level `"lights"` object:

```json
  "lights": {
    "explain": "Explain is ready for this page.",
    "practice": "Practise is ready.",
    "stopped": "Luna couldn't finish reading this — what she read is here."
  },
```

In `src/i18n/locales/de/v4Reader.json`:

```json
  "lights": {
    "explain": "Erklären ist für diese Seite bereit.",
    "practice": "Üben ist bereit.",
    "stopped": "Luna konnte das nicht fertig lesen — was sie gelesen hat, ist hier."
  },
```

Run `npm run lint:i18n && npm run lint:v4` — PASS.

- [ ] **Step 2: Write the failing integration test**

Create `src/features/spaces/components/__tests__/lessonLights.test.tsx`. Base it on the setup of `lessonFaces.test.tsx` (open it first and copy its render helper, router wrapper, demo lesson ids and any mocks it needs — the demo lesson with a PDF is `s-dbs` / `l-s-dbs-4`). Add a controllable mock for the run:

```tsx
const runState = vi.hoisted(() => ({ reading: null as null | Record<string, unknown> }));
vi.mock('../../data/useRunReading', () => ({ useRunReading: () => runState.reading }));
const base = { pdfUrl: 'u', pages: 82, pagesRead: 2, practiceReady: false, readable: true, stage: 'developing', lessonId: 'l-s-dbs-4' };
```

Define `mountAt(query: string)` to render `LessonFacesScreen` at `/v4/space/s-dbs/lesson/l-s-dbs-4/faces${query}` with the same providers and route as `lessonFaces.test.tsx`. In the demo data the PDF does not load in the test DOM, so the reader's page count falls back to the run's `pages` (82). Tests:

```tsx
it('on a page Luna has not written, only Page shows', async () => {
  runState.reading = { ...base, pagesReady: [1, 2] };
  mountAt('?page=5&run=run-1');
  expect(await screen.findByRole('tab', { name: 'Page' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Explain' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Text' })).toBeNull();
});

it('on a page she has written, Explain and Text are there', async () => {
  runState.reading = { ...base, pagesReady: [1, 2, 3, 4, 5] };
  mountAt('?page=5&run=run-1');
  expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
});

it('the number keys only reach the tabs that are there', async () => {
  runState.reading = { ...base, pagesReady: [1] };
  mountAt('?page=5&run=run-1');
  await screen.findByRole('tab', { name: 'Page' });
  fireEvent.keyDown(window, { key: '2' });
  expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
});

it('Practise stays hidden until its questions exist', async () => {
  runState.reading = { ...base, pagesReady: [1, 2, 3, 4, 5] };
  mountAt('?page=5&run=run-1&view=text');
  await screen.findByRole('tab', { name: 'Text' });
  expect(screen.queryByRole('button', { name: /practi[sc]e/i })).toBeNull();
});

it('the timeline buffer is the pages Luna has written', async () => {
  runState.reading = { ...base, pagesReady: [1, 2, 3, 5] };
  mountAt('?page=1&run=run-1');
  /* The awake timeline's read bar: 3 contiguous pages of the PDF's own count. */
  fireEvent.pointerMove(window);
  const bar = await screen.findByTestId('timeline-read');
  const total = Number(screen.getByTestId('timeline-count').textContent?.split('/')[1]?.trim());
  expect(bar.style.width).toBe(`${(3 / total) * 100}%`);
});

it('without a run, nothing changes', async () => {
  runState.reading = null;
  mountAt('?page=5');
  expect(await screen.findByRole('tab', { name: 'Explain' })).toBeInTheDocument();
});
```

For the timeline case: `timeline-read` and `timeline-count` are test ids in `ReaderTimeline.tsx`, rendered only while the controls are awake (not `quiet`); if the pointer event does not wake them in the test DOM, wake them the way `lessonFaces.test.tsx` does. The total comes from the demo PDF's page count, so the test reads it from `timeline-count` rather than hard-coding it. Use the real Practise button label from `v4Reader.json` / `lessonFaces.test.tsx` in the Practise case. Every test must assert something concrete — no empty bodies.

- [ ] **Step 3: Run it to see it fail**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/components/__tests__/lessonLights.test.tsx --testTimeout=60000`
Expected: FAIL — Explain/Text tabs present on page 5.

- [ ] **Step 4: Wire the run into the reader**

Near the top of the component, after `params`:

```tsx
  /*
   * A file still being read: the run to follow, from the handover (`&run=`),
   * else your uploads. Pages Luna has written have their faces; the rest wait.
   */
  const runId =
    params.get('run') ??
    uploadsNow().find((u) => u.lessonId === lessonId && u.stage !== 'ready')?.id ??
    null;
  const run = useRunReading(runId);
  const follow: RunFollow | null = run ? { pagesReady: run.pagesReady.length, done: run.stage !== 'developing' } : null;
  const content = useReaderContent(spaceId, lessonId, follow);
```

(Replace the existing `useReaderContent` call; import `uploadsNow` from `../data/uploads`, `useRunReading` from `../data/useRunReading`, `RunFollow` from `../data/useReader`.)

After `numPages`, `pdfPage` and `lesson` exist:

```tsx
  const lights = useLights(run, pdfPage, { total: numPages || run?.pages || 0, practiceCount: lesson.practiceCount });
  /* Only the faces this page has: Page always; Explain and Text once Luna has written it. */
  const views = lights.pageReady ? VIEWS : VIEWS.slice(0, 1);
```

Change `usePracticeQuestions(lessonId, liveReader)` to `usePracticeQuestions(lessonId, liveReader, lights.practiceOn)`.

- [ ] **Step 5: Gate the faces per page**

- Tabs: render `views.map(...)` instead of `VIEWS.map(...)`. On each tab button add, when `lights.ringing` and `v.id !== 'slide'`, a ring: `lights.ringing && v.id !== 'slide' && 'ring-1 ring-white/60'` in its `cn(...)` (static under reduced motion — it is a ring, not an animation).
- Keys: `const face = views[Number(e.key) - 1];`.
- Turning past Luna: add

  ```tsx
  useEffect(() => {
    if (!lights.pageReady && view !== 'slide') setView('slide');
  }, [lights.pageReady, view]);
  ```

- Ask: render each `SelectionAsk` only when `lights.pageReady` (wrap both in `{lights.pageReady && (…)}`).
- Practise: change the footer gate `lesson.practiceCount > 0` to `lights.practiceOn`.
- Luna's study session: change the cluster gate `lunaOn && !lunaOpen` to `lunaOn && lights.lunaReady && !lunaOpen`, and in `offerLuna` return early unless `lights.lunaReady` (add it to the deps).
- Controls wake for the first light: add `&& !lights.ringing` to the `useIdle(...)` condition.
- Timeline: `total={numPages || run?.pages || 0}` and `read={lights.buffer}`.

- [ ] **Step 6: Luna's line**

Next to the phone hint (same container style), render:

```tsx
      {lights.line && (
        <motion.div {...fade} className="absolute inset-x-4 top-[72px] z-30 flex justify-center">
          <p
            role="status"
            className="flex items-center gap-2 rounded-full bg-white/[0.08] py-1.5 pl-3 pr-4 text-[12.5px] text-foreground"
          >
            <LunaMark />
            {tr(`lights.${lights.line}`)}
          </p>
        </motion.div>
      )}
```

If the phone hint is showing at the same time, show only Luna's line (add `&& !lights.line` to the phone hint's condition). `LunaMark` is already imported in this file; `fade` and `tr` exist.

- [ ] **Step 7: Run the tests**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces/components/__tests__/lessonLights.test.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx src/features/spaces/components/__tests__/readerGerman.test.tsx src/features/spaces/components/reader src/features/spaces/__tests__/boundary.test.ts --testTimeout=60000`, then `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint:i18n`, `npm run lint:v4`.
Expected: all PASS / clean.

- [ ] **Step 8: Run the whole v4 suite once**

Run: `VITE_V4_DATA_MODE=demo npx vitest run src/features/spaces src/components/pdf --testTimeout=60000`
Expected: all PASS (a single `readerGerman` timeout under load that passes on its own re-run is the known flake — re-run that file alone to confirm).

- [ ] **Step 9: Commit**

```bash
git add src/features/spaces src/i18n/locales
git commit -m "feat(reader): faces light up page by page while Luna reads; Practise and Luna arrive when she is done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks (controller, not a task)

Live check on the full stack (`main-backend`, `backend-worker`, `main-frontend` from `.claude/launch.json`), signed in by the user:
1. Drop the 82-slide sample; time from drop to the first Explain/Text tabs on page 1.
2. Stay on a page ahead of Luna; see only Page, then the tabs appear with Luna's line and the controls awake.
3. Practise appears with its line once the run completes; the Luna session offer appears too.
4. No dead wait: the full reader is open throughout the run's tail.
