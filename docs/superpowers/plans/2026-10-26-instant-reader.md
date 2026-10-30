# Instant Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brought-in PDF can be read the moment it lands, in a cinema-style reader. Slides fill the screen, documents scroll, and the controls behave like a video player's. A timeline shows where you are and how far Luna has read. Explain and Text replace the page, while Luna's study session stays beside it.

**Architecture:** This upgrades the one existing v4 reader, `LessonFacesScreen`, in place. It does not add a second reader.

- **Phase 1 (Tasks 1–5)** is frontend only and works for every Lesson that already exists: page-shape detection, a timeline, faces that replace the page, full screen and safe areas, and a scroll mode for portrait documents.
- **Phase 2 (Tasks 6–9)** lets a student read their own upload *before* processing has made its Lesson. One small backend endpoint returns a signed link to the stored file plus progress. The Library's wait screen becomes an early reader, which hands over to `LessonFacesScreen` at the same page once the Lesson exists.
- **Lighting faces per page before the whole run ends** (LS-039 pages-before-run-end) is **out of scope** here and gets its own plan.

**Tech Stack:**
- Frontend: React 18 + TypeScript, Vite, Tailwind, `motion/react`, react-pdf via `@/components/pdf`, react-i18next (en + de), Vitest + Testing Library.
- Backend: FastAPI, asyncpg, pytest.

**Spec:** `docs/superpowers/specs/2026-10-26-library-and-spaces-design.md` (section "2 · Read now: the Reader").

## Global Constraints

- Upgrade `src/features/spaces/screens/LessonFacesScreen.tsx`; do not create another full reader screen.
- v4 namespace boundary (`src/features/spaces/__tests__/boundary.test.ts`):
  - import PDF parts only from the barrel `@/components/pdf`, never `@/components/pdf/*`, `react-pdf` or `pdfjs-dist`;
  - no `fetch(`, `WebSocket` or `XMLHttpRequest` inside `src/features/spaces` — use the live repository's `http` client.
- Every user-facing string in both `src/i18n/locales/en/v4Reader.json` and `src/i18n/locales/de/v4Reader.json` (`npm run lint:i18n`, `npm run lint:v4`).
- Monochrome. The only colour is the page's own accent (`--reader-accent`) and Luna.
- Respect reduced motion (`useReducedMotion()`): no movement when it is set.
- One fact, once: never show the same number twice on a screen (the page count lives in the timeline, not also in a pill).
- Faces split (decided 2026-10-26): **Explain and Text replace the page**; **Luna's study session stays beside the page** (column ≥1024 px, sheet below).
- Gates before every commit: `npx tsc -p tsconfig.app.json --noEmit` (not `tsconfig.json`, which checks nothing), the task's tests, and `npx vitest run src/features/spaces/__tests__/boundary.test.ts`. The throwaway demos (`TourLabScreen.tsx`, `ReaderLabScreen.tsx`, `tourLabAnalyse.ts`) must be deleted before the first commit of this plan, or the boundary test fails (see Task 0).
- Backend tests: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/<file> -q` from the repo root.
- No database migration in this plan. Never run `supabase db push`.

---

### Task 0: Start from a clean branch

**Files:** none (git only)

- [ ] **Step 1: Branch from main without the demos**

```bash
git fetch origin
git switch -c feat/instant-reader origin/main
git cherry-pick 0d963303 2c7e63c5 521a8fcb   # the spec commits, if the spec is not on main yet
ls src/features/spaces/screens | grep -i lab   # expected: nothing
```

- [ ] **Step 2: Confirm the gates are green before any change**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run src/features/spaces/__tests__/boundary.test.ts src/features/spaces/components/__tests__/lessonFaces.test.tsx`
Expected: both PASS. If the boundary test fails on main, stop and report: it is not this plan's to fix.

---

## Phase 1 — The reader, cinema style

### Task 1: Page shape, reported by the pager

**Files:**
- Create: `src/features/spaces/components/reader/pageShape.ts`
- Create: `src/features/spaces/components/reader/__tests__/pageShape.test.ts`
- Modify: `src/components/pdf/PdfPager.tsx` (the `Props` interface and `onPageLoad`)

**Interfaces:**
- Produces: `type PageShape = 'slides' | 'document'`, `shapeOf(aspect: number | null): PageShape`, and a new optional PdfPager prop `onAspect?: (heightOverWidth: number) => void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/spaces/components/reader/__tests__/pageShape.test.ts
import { describe, expect, it } from 'vitest';
import { shapeOf } from '../pageShape';

describe('shapeOf', () => {
  it('reads a landscape page as slides', () => expect(shapeOf(405 / 720)).toBe('slides'));
  it('reads a square-ish page as slides', () => expect(shapeOf(1)).toBe('slides'));
  it('reads an A4 portrait page as a document', () => expect(shapeOf(842 / 595)).toBe('document'));
  it('treats an unknown shape as slides (today’s behaviour)', () => expect(shapeOf(null)).toBe('slides'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/pageShape.test.ts`
Expected: FAIL, cannot resolve `../pageShape`.

- [ ] **Step 3: Implement**

```ts
// src/features/spaces/components/reader/pageShape.ts
/**
 * Whether a file reads as slides (one page at a time, filling the screen) or
 * as a document (pages scrolled at a readable width). Decided from page 1's
 * height / width: anything clearly taller than wide is a document. Unknown
 * reads as slides, which is what the reader did before it could tell.
 */
export type PageShape = 'slides' | 'document';

/** Taller than this (height / width) is a portrait document. A4 is 1.41. */
const PORTRAIT = 1.15;

export const shapeOf = (aspect: number | null): PageShape =>
  aspect !== null && aspect > PORTRAIT ? 'document' : 'slides';
```

In `src/components/pdf/PdfPager.tsx`, add to `Props` (after `onLoad`):

```ts
  /** Page 1's height / width once known — lets the caller choose a layout. */
  onAspect?: (heightOverWidth: number) => void;
```

Add `onAspect` to the destructured props. Replace `onPageLoad` with:

```ts
  const onPageLoad = useCallback(
    (p: { width: number; height: number; pageNumber?: number }) => {
      if (p.width <= 0) return;
      setAspect(p.height / p.width);
      if (p.pageNumber === 1 || p.pageNumber === undefined) onAspect?.(p.height / p.width);
    },
    [onAspect],
  );
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/pageShape.test.ts src/features/spaces/components/__tests__/lessonFaces.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/spaces/components/reader/pageShape.ts src/features/spaces/components/reader/__tests__/pageShape.test.ts src/components/pdf/PdfPager.tsx
git commit -m "feat(reader): tell slides from documents by page shape"
```

---

### Task 2: The timeline: where you are, and how far Luna has read

**Files:**
- Create: `src/features/spaces/components/reader/ReaderTimeline.tsx`
- Create: `src/features/spaces/components/reader/__tests__/ReaderTimeline.test.tsx`
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx`: replace the hairline block (`{/* Where you are in the deck, as a hairline … */}`, currently around lines 1178–1192) and drop the `n / N` text from the `GlassPill`, since the timeline now carries it (one fact once).
- Modify: `src/i18n/locales/en/v4Reader.json`, `src/i18n/locales/de/v4Reader.json`

**Interfaces:**
- Produces: `ReaderTimeline({ page, total, read, quiet, onSeek, unit })`, where `page`, `total` and `read` are 1-based page counts (`read` = pages Luna has finished; `total` for a finished Lesson), `quiet: boolean` (true = idle, draw only the hairline), `onSeek: (page: number) => void`, and `unit: 'slide' | 'page'`.

- [ ] **Step 1: Add the strings**

In `en/v4Reader.json`, add under the top-level object:

```json
"timeline": {
  "label": "{{unit}} {{page}} of {{total}}",
  "slide": "Slide",
  "page": "Page",
  "at": "{{unit}} {{page}}",
  "soon": "Luna soon"
}
```

In `de/v4Reader.json`:

```json
"timeline": {
  "label": "{{unit}} {{page}} von {{total}}",
  "slide": "Folie",
  "page": "Seite",
  "at": "{{unit}} {{page}}",
  "soon": "Luna gleich"
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// src/features/spaces/components/reader/__tests__/ReaderTimeline.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReaderTimeline } from '../ReaderTimeline';

const box = { left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) };

describe('ReaderTimeline', () => {
  it('is a slider at the current page', () => {
    render(<ReaderTimeline page={3} total={10} read={10} quiet={false} onSeek={() => {}} unit="slide" />);
    const s = screen.getByRole('slider');
    expect(s).toHaveAttribute('aria-valuenow', '3');
    expect(s).toHaveAttribute('aria-valuemax', '10');
  });

  it('jumps to the page under the click', () => {
    const onSeek = vi.fn();
    render(<ReaderTimeline page={1} total={10} read={10} quiet={false} onSeek={onSeek} unit="slide" />);
    const s = screen.getByRole('slider');
    s.getBoundingClientRect = () => box as DOMRect;
    fireEvent.click(s, { clientX: 150 });
    expect(onSeek).toHaveBeenCalledWith(8);
  });

  it('draws how far Luna has read as its own bar', () => {
    render(<ReaderTimeline page={2} total={10} read={4} quiet={false} onSeek={() => {}} unit="slide" />);
    expect(screen.getByTestId('timeline-read')).toHaveStyle({ width: '40%' });
  });

  it('is only a hairline while quiet', () => {
    render(<ReaderTimeline page={2} total={10} read={10} quiet onSeek={() => {}} unit="slide" />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByTestId('timeline-hairline')).toBeInTheDocument();
  });

  it('moves with the arrow keys when focused', () => {
    const onSeek = vi.fn();
    render(<ReaderTimeline page={5} total={10} read={10} quiet={false} onSeek={onSeek} unit="page" />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(onSeek).toHaveBeenCalledWith(10);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/ReaderTimeline.test.tsx`
Expected: FAIL, cannot resolve `../ReaderTimeline`.

- [ ] **Step 4: Implement**

```tsx
// src/features/spaces/components/reader/ReaderTimeline.tsx
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

/**
 * The deck as a timeline, the way a video player shows a film: white is where
 * you are, grey is how far Luna has read (the "buffered" part). Quiet — the
 * controls asleep — it is only the hairline, so a long read keeps its place.
 */
interface Props {
  page: number;
  total: number;
  /** Pages Luna has finished. A finished Lesson passes `total`. */
  read: number;
  quiet: boolean;
  onSeek: (page: number) => void;
  unit: 'slide' | 'page';
}

const pct = (n: number, total: number) => `${total ? Math.min(100, (n / total) * 100) : 0}%`;

export function ReaderTimeline({ page, total, read, quiet, onSeek, unit }: Props) {
  const { t } = useTranslation('v4Reader');
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const word = t(`timeline.${unit}`);
  if (total <= 0) return null;

  const pageAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(1, Math.min(total, Math.ceil(((clientX - r.left) / r.width) * total)));
  };

  if (quiet) {
    return (
      <div aria-hidden data-testid="timeline-hairline" className="pointer-events-none h-[2px] bg-white/[0.05]">
        <motion.div
          className="h-full origin-left"
          style={{ background: 'var(--reader-accent, hsl(var(--secondary)))', opacity: 0.75 }}
          initial={false}
          animate={{ scaleX: page / total }}
          transition={{ duration: reduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    );
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('timeline.label', { unit: word, page, total })}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={page}
      className="console-focusable group relative h-5 cursor-pointer"
      onPointerMove={(e) => setHover(pageAt(e.clientX, e.currentTarget))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => onSeek(pageAt(e.clientX, e.currentTarget))}
      onKeyDown={(e) => {
        const to =
          e.key === 'Home' ? 1 : e.key === 'End' ? total : e.key === 'ArrowUp' ? page + 1 : e.key === 'ArrowDown' ? page - 1 : null;
        if (to === null) return;
        e.preventDefault();
        e.stopPropagation();
        onSeek(Math.max(1, Math.min(total, to)));
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15 group-hover:h-[5px]">
        <div data-testid="timeline-read" className="absolute inset-y-0 left-0 bg-white/35" style={{ width: pct(read, total) }} />
        <div className="absolute inset-y-0 left-0 bg-white" style={{ width: pct(page, total) }} />
      </div>
      {hover !== null && (
        <div
          className="absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-white px-2 py-0.5 text-[11.5px] font-semibold text-black"
          style={{ left: pct(hover, total) }}
        >
          {t('timeline.at', { unit: word, page: hover })}
          {hover > read && <span className="ml-1 font-normal text-black/50">· {t('timeline.soon')}</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire it into `LessonFacesScreen`**

Add the import at the top: `import { ReaderTimeline } from '../components/reader/ReaderTimeline';`

Replace the whole hairline block (from `{/* Where you are in the deck, as a hairline that stays when everything else has gone. */}` to its closing `)}`) with:

```tsx
      {/* Where you are, and how far Luna has read: a timeline awake, a hairline asleep. */}
      {numPages > 0 && (
        <div
          className={cn('absolute bottom-0 z-30 px-4 pb-[max(6px,env(safe-area-inset-bottom))]', quiet && 'px-0 pb-0')}
          style={{ left: showToc ? TOC_WIDTH : 0, right: docked ? panelWidth : 0 }}
        >
          <ReaderTimeline
            page={pdfPage}
            total={numPages}
            read={numPages}
            quiet={quiet}
            onSeek={(p) => goToPage(p)}
            unit={shape === 'document' ? 'page' : 'slide'}
          />
        </div>
      )}
```

`read={numPages}`: a Lesson that opens here is fully processed (Phase 2 passes real progress to the early reader). `shape` comes from Task 1. Add the state near the other `useState`s:

```tsx
  const [aspect, setAspect] = useState<number | null>(null);
  const shape = shapeOf(aspect);
```

Then pass `onAspect={setAspect}` to the existing `<PdfPager … />`, and import `shapeOf` from `../components/reader/pageShape`.

In the `GlassPill`, delete the `<span className="min-w-[4.5rem] …">…{numPages}…</span>` page-number span (the timeline's label now carries "Slide n of N").

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/ReaderTimeline.test.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx src/features/spaces/components/__tests__/readerGerman.test.tsx src/features/spaces/components/__tests__/a11y.test.tsx && npm run lint:i18n && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. If a `lessonFaces` test asserted the `n / N` text, change it to assert the slider's `aria-valuenow` instead (same fact, new place).

- [ ] **Step 7: Commit**

```bash
git add src/features/spaces/components/reader/ReaderTimeline.tsx src/features/spaces/components/reader/__tests__/ReaderTimeline.test.tsx src/features/spaces/screens/LessonFacesScreen.tsx src/i18n/locales/en/v4Reader.json src/i18n/locales/de/v4Reader.json src/features/spaces/components/__tests__/lessonFaces.test.tsx
git commit -m "feat(reader): a timeline — where you are, and how far Luna has read"
```

---

### Task 3: Explain and Text replace the page; Luna stays beside it

**Files:**
- Modify: `src/features/spaces/components/reader/Studio.tsx` (new `mode` prop)
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx` (`docked`, and the two `<Studio>` calls for Explain and Text)
- Modify: `src/features/spaces/components/__tests__/lessonFaces.test.tsx`

**Interfaces:**
- Produces: `Studio` prop `mode?: 'beside' | 'replace'` (default `'beside'`, which is today's behaviour). `'replace'` covers the whole viewport, centres its content at a reading width, and cross-fades in.

- [ ] **Step 1: Write the failing tests** (append to `lessonFaces.test.tsx`)

```tsx
describe('Explain and Text replace the page', () => {
  it('Explain covers the whole stage instead of docking beside the page', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=explain');
    const layer = await screen.findByRole('complementary', { name: 'Explain' });
    expect(layer).toHaveAttribute('data-mode', 'replace');
  });

  it('Text covers the whole stage too', async () => {
    await renderFaces('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?view=text');
    const layer = await screen.findByRole('complementary');
    expect(layer).toHaveAttribute('data-mode', 'replace');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/features/spaces/components/__tests__/lessonFaces.test.tsx -t "replace the page"`
Expected: FAIL, the attribute `data-mode` is missing.

- [ ] **Step 3: Implement in `Studio.tsx`**

Add to `Props`:

```ts
  /**
   * `beside`: a panel next to the document (≥ panel width) or over it.
   * `replace`: the page steps away and this layer is the stage — Explain and
   * Text, the way the landing's faces work. Luna's session stays `beside`.
   */
  mode?: 'beside' | 'replace';
```

Destructure `mode = 'beside'`, and change the `motion.aside`:

```tsx
        <motion.aside
          ref={ref}
          tabIndex={-1}
          data-mode={mode}
          aria-label={label ?? t('studio.name')}
          data-studio={label ? undefined : 'text'}
          initial={mode === 'replace' ? { opacity: 0, scale: 0.985, filter: 'blur(10px)' } : { opacity: 0, x: 24 }}
          animate={mode === 'replace' ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 1, x: 0 }}
          exit={mode === 'replace' ? { opacity: 0, scale: 1.01, filter: 'blur(10px)' } : { opacity: 0, x: 24 }}
          transition={{ duration: mode === 'replace' ? 0.5 : timing.card, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: mode === 'beside' && panel ? width : undefined }}
          className={cn(
            'fixed flex flex-col outline-none bg-[#0b0b0c]',
            mode === 'replace'
              ? 'inset-0 z-[42]'
              : cn('inset-y-0 right-0 border-l border-white/[0.08]', panel ? 'z-30' : 'z-[42] w-full'),
          )}
        >
```

Wrap the children container so replaced content reads at a comfortable width:

```tsx
          <div className={cn('relative min-h-0 flex-1', mode === 'replace' && 'mx-auto w-full max-w-[820px]')}>{children}</div>
```

- [ ] **Step 4: Implement in `LessonFacesScreen.tsx`**

Change the docking rule (currently `const docked = (studio || (lunaOn && lunaOpen)) && panel;`) so only Luna docks:

```tsx
  /* Explain and Text replace the page; only Luna's session sits beside it. */
  const docked = lunaOn && lunaOpen && panel;
```

On the `<Studio>` for Explain (the one with `label={tr('views.explain')}`) and the one for Text (the one rendering `<ReadingFace …>`), add `mode="replace"`. Leave the Luna `<Studio>` (around line 1336) unchanged.

- [ ] **Step 5: Update the old docking test**

In `lessonFaces.test.tsx`, rename `it('composes an answer for the page in view, beside the document', …)` to `it('composes an answer for the page in view', …)`. Its body (it asserts `Page 1` inside the Explain complementary) stays as it is.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/spaces/components/__tests__/lessonFaces.test.tsx src/features/spaces/__tests__/luna-conductor.test.tsx src/features/spaces/components/__tests__/a11y.test.tsx src/features/spaces/components/__tests__/modes.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. `luna-conductor` must stay green: Luna still docks.

- [ ] **Step 7: Check it in the browser**

Start `fixture-frontend` (port 5213, demo data) via preview_start. Open a Lesson with a PDF at `/v4/space/<id>/lesson/<id>/faces`, press Explain: the page fades out and Explain fills the stage. Esc brings the page back at the same page. Open Luna: she docks beside the page as before.

- [ ] **Step 8: Commit**

```bash
git add src/features/spaces/components/reader/Studio.tsx src/features/spaces/screens/LessonFacesScreen.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx
git commit -m "feat(reader): Explain and Text replace the page; Luna stays beside it"
```

---

### Task 4: Full screen, safe areas, and the face keys

**Files:**
- Create: `src/features/spaces/components/reader/useFullscreen.ts`
- Create: `src/features/spaces/components/reader/__tests__/useFullscreen.test.tsx`
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx` (top-right cluster; key handler)
- Modify: `src/i18n/locales/en/v4Reader.json`, `src/i18n/locales/de/v4Reader.json`

**Interfaces:**
- Produces: `useFullscreen(): { full: boolean; toggle: () => void; supported: boolean }`.

- [ ] **Step 1: Strings**

In en, under `"screen"`: `"fullscreen": "Full screen", "exitFullscreen": "Exit full screen"`. In de: `"fullscreen": "Vollbild", "exitFullscreen": "Vollbild beenden"`.

- [ ] **Step 2: Write the failing test**

```tsx
// src/features/spaces/components/reader/__tests__/useFullscreen.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFullscreen } from '../useFullscreen';

describe('useFullscreen', () => {
  it('asks the document for full screen, and follows the browser’s answer', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.supported).toBe(true);
    act(() => result.current.toggle());
    expect(request).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current.full).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/useFullscreen.test.tsx`
Expected: FAIL, cannot resolve `../useFullscreen`.

- [ ] **Step 4: Implement**

```ts
// src/features/spaces/components/reader/useFullscreen.ts
import { useCallback, useEffect, useState } from 'react';

/** The browser's full screen, as the reader's: a flag that follows Esc too. */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function';
  const [full, setFull] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.();
  }, []);
  return { full, toggle, supported };
}
```

- [ ] **Step 5: Wire it into `LessonFacesScreen`**

- Imports: `import { useFullscreen } from '../components/reader/useFullscreen';` and `Maximize`, `Minimize` from `lucide-react`.
- In the component: `const fs = useFullscreen();`
- In the top-right cluster (next to the night-paper button), add a button with the same classes as that one:

```tsx
            {fs.supported && (
              <button
                type="button"
                onClick={fs.toggle}
                aria-label={fs.full ? tr('screen.exitFullscreen') : tr('screen.fullscreen')}
                className="console-focusable flex h-9 w-9 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
              >
                {fs.full ? <Minimize aria-hidden className="h-4 w-4" /> : <Maximize aria-hidden className="h-4 w-4" />}
              </button>
            )}
```

- In the existing page-turn key handler (the `useEffect` with `ArrowRight`/`PageDown`), add before `const by = …`:

```tsx
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fs.toggle();
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        setView((['slide', 'explain', 'text'] as const)[Number(e.key) - 1]);
        return;
      }
```

  and add `fs` to that effect's dependency list. Also add `' '` (space) to the forward keys: `e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' '`.
- Bottom controls container (the `motion.div` holding the `GlassPill`): add `pb-[max(12px,env(safe-area-inset-bottom))]` to its class list.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/useFullscreen.test.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx src/features/spaces/components/__tests__/a11y.test.tsx && npm run lint:i18n && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/spaces/components/reader/useFullscreen.ts src/features/spaces/components/reader/__tests__/useFullscreen.test.tsx src/features/spaces/screens/LessonFacesScreen.tsx src/i18n/locales/en/v4Reader.json src/i18n/locales/de/v4Reader.json
git commit -m "feat(reader): full screen, safe areas, keys 1–3 and space"
```

---

### Task 5: Documents scroll

**Files:**
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx` (the stage)
- Modify: `src/features/spaces/components/__tests__/lessonFaces.test.tsx`

**Interfaces:**
- Consumes: `shape` from Task 1; `PdfScroll`, `scrollToPdfPage` from `@/components/pdf`.

- [ ] **Step 1: Make the PDF mock report a portrait page, and write the failing test**

In `lessonFaces.test.tsx`, the existing `vi.mock('@/components/pdf', …)` replaces `PdfPager`. Extend the mock so it also exports `PdfScroll` and `scrollToPdfPage`, and lets a test choose the page shape:

```tsx
let mockAspect = 405 / 720;
// inside the vi.mock factory's returned object, alongside the existing PdfPager mock:
//   PdfPager: (props) => { useEffect(() => props.onAspect?.(mockAspect), []); return <div data-testid="pager" />; },
//   PdfScroll: () => <div data-testid="scroll" />,
//   scrollToPdfPage: () => {},
```

Then add the test:

```tsx
describe('a document scrolls', () => {
  it('a portrait file opens as a scroll, not a deck', async () => {
    mockAspect = 842 / 595;
    await renderFaces();
    expect(await screen.findByTestId('scroll')).toBeInTheDocument();
    mockAspect = 405 / 720;
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/spaces/components/__tests__/lessonFaces.test.tsx -t "document scrolls"`
Expected: FAIL, no element with `data-testid="scroll"`.

- [ ] **Step 3: Implement**

The pager must mount first to measure the shape. So keep `<PdfPager>` rendered (hidden) until `shape` is known to be `'document'`, then render the scroll instead. Replace the stage's `<PdfPager … />` with:

```tsx
        {shape === 'document' ? (
          <PdfScroll
            file={content.pdfUrl}
            width={Math.min(box.w, 900)}
            anchorLine={0.38}
            onPage={onPdfPage}
            onLoad={setNumPages}
            onFirstRender={(canvas) => setAccent(sampleAccent(canvas))}
            scrollRef={pdfRef}
            className="absolute inset-0 overflow-y-auto"
          />
        ) : (
          <PdfPager
            file={content.pdfUrl}
            page={pdfPage}
            onPageChange={onPdfPage}
            onStep={view === 'slide' ? stepBeat : undefined}
            maxWidth={box.w}
            maxHeight={box.h}
            onLoad={setNumPages}
            onAspect={setAspect}
            onFirstRender={(canvas) => setAccent(sampleAccent(canvas))}
            rootRef={pdfRef}
            overlay={<Spotlight words={spot} />}
            className="absolute inset-0 overflow-hidden"
          />
        )}
```

Add `PdfScroll, scrollToPdfPage` to the existing `@/components/pdf` import. In `goToPage` (and `turnPage`), when `shape === 'document'`, scroll instead of setting the pager's page:

```tsx
    if (shape === 'document' && pdfRef.current) scrollToPdfPage(pdfRef.current, p, 0.38, reduce ? 'auto' : 'smooth');
```

The "turn your phone" hint is for slides only: add `shape === 'slides' &&` to its condition (search `portraitPhone &&`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/spaces/components/__tests__/lessonFaces.test.tsx src/features/spaces/__tests__/luna-conductor.test.tsx src/features/spaces/components/__tests__/a11y.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Check it in the browser** with a portrait PDF Lesson (a paper): pages scroll at a readable width, the timeline follows the scroll, and Explain still replaces the page.

- [ ] **Step 6: Commit**

```bash
git add src/features/spaces/screens/LessonFacesScreen.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx
git commit -m "feat(reader): portrait documents scroll instead of paging"
```

---

## Phase 2 — Read your own file before Luna has finished

### Task 6: Backend — a reading view for an upload still being processed

**Files:**
- Modify: `backend/services/v4_spaces_service.py` (add `reading_view` + `early_reading`)
- Modify: `backend/api/v1/v4_spaces.py` (add the route after `GET /uploads`)
- Create: `backend/tests/unit/test_v4_early_reading.py`

**Interfaces:**
- Produces:
  - `GET /api/v1/v4/uploads/{run_id}/reading`, which returns `{"pdfUrl": str | None, "pages": int, "pagesRead": int, "stage": "developing" | "ready" | "failed", "lessonId": str | None}`, or 404 if the run is not the caller's.
  - The pure function `reading_view(run: dict, slides_done: int, pdf_url: str | None) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_v4_early_reading.py
from backend.services.v4_spaces_service import reading_view


def run(**over):
    base = {"status": "running", "page_count": 82, "lecture_id": None}
    base.update(over)
    return base


def test_a_fresh_run_can_be_read_with_nothing_done_yet():
    v = reading_view(run(), 0, "https://signed/x.pdf")
    assert v == {"pdfUrl": "https://signed/x.pdf", "pages": 82, "pagesRead": 0, "stage": "developing", "lessonId": None}


def test_progress_never_exceeds_the_page_count():
    assert reading_view(run(), 999, "u")["pagesRead"] == 82


def test_a_finished_run_is_ready_and_fully_read():
    v = reading_view(run(status="completed", lecture_id="L1"), 80, "u")
    assert v["stage"] == "ready" and v["lessonId"] == "L1" and v["pagesRead"] == 82


def test_a_failed_run_says_so():
    assert reading_view(run(status="failed"), 3, "u")["stage"] == "failed"


def test_unknown_page_count_reads_as_zero():
    assert reading_view(run(page_count=None), 4, "u")["pages"] == 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_early_reading.py -q`
Expected: FAIL, `ImportError: cannot import name 'reading_view'`.

- [ ] **Step 3: Implement in `v4_spaces_service.py`** (next to `uploads_for`)

```python
_DONE = {"complete", "completed", "succeeded", "done"}
_FAILED = {"failed", "error", "cancelled"}


def reading_view(run: Dict[str, Any], slides_done: int, pdf_url: Optional[str]) -> Dict[str, Any]:
    """What the early reader needs: the file, and how far Luna has read it.

    The file is readable from the moment it is stored; the Lesson exists once
    the pipeline has made it. Progress is the slides written so far, capped at
    the page count; a finished run is fully read.
    """
    status = (run.get("status") or "").lower()
    pages = int(run.get("page_count") or 0)
    ready = bool(run.get("lecture_id")) and status in _DONE
    stage = "failed" if status in _FAILED else ("ready" if ready else "developing")
    read = pages if ready else min(max(0, int(slides_done)), pages)
    return {
        "pdfUrl": pdf_url,
        "pages": pages,
        "pagesRead": read,
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
        done = 0
        if run["lecture_id"]:
            done = await conn.fetchval("SELECT count(*) FROM slides WHERE lecture_id = $1", run["lecture_id"]) or 0
    pdf_url = await signed_pdf_url(f"{run['pdf_hash']}.pdf", "pdf-uploads")
    return reading_view(dict(run), done, pdf_url)
```

Check that `UUID`, `Optional` and `get_db_connection` are already imported at the top of the file. Add them to the existing imports if not.

- [ ] **Step 4: Add the route in `v4_spaces.py`** (right after `v4_uploads`)

```python
@router.get("/uploads/{run_id}/reading")
@limiter.limit("120/minute")
async def v4_upload_reading(run_id: UUID, request: Request, user: Any = Depends(require_student)):
    """Read your own file while Luna is still reading it: a signed link and her progress."""
    _uploads_on()
    view = await service.early_reading(_uid(user), str(run_id))
    if view is None:
        raise HTTPException(status_code=404, detail="Nothing of yours by that id.")
    return view
```

- [ ] **Step 5: Run the tests**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_early_reading.py backend/tests/unit/test_materials_service.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/v4_spaces_service.py backend/api/v1/v4_spaces.py backend/tests/unit/test_v4_early_reading.py
git commit -m "feat(v4): an upload can be read while it is being processed"
```

---

### Task 7: Frontend data — the early reading, and the file kept on the device

**Files:**
- Modify: `src/features/spaces/data/liveRepository.ts` (add `readingFor`)
- Modify: `src/features/spaces/data/uploads.ts` (keep the `File` under the run id once a send succeeds; export `localFileFor`)
- Create: `src/features/spaces/data/useEarlyReading.ts`
- Create: `src/features/spaces/data/__tests__/useEarlyReading.test.tsx`

**Interfaces:**
- Consumes: the Task 6 endpoint.
- Produces:
  - `interface EarlyReading { pdfUrl: string | null; pages: number; pagesRead: number; stage: 'developing' | 'ready' | 'failed'; lessonId: string | null }`;
  - `localFileFor(uploadId: string): File | null`;
  - `useEarlyReading(uploadId: string): { reading: EarlyReading | null; url: string | null }`, where `url` is the local object URL if the file is on this device, else `reading.pdfUrl`.

- [ ] **Step 1: Repository method** (in the object `liveRepository.ts` returns, next to `removeUpload`)

```ts
    readingFor: (runId: string) => http.get<EarlyReading>(`${root}/uploads/${idPath(runId)}/reading`),
```

and export the type from the same file:

```ts
/** An upload as the early reader sees it (GET /v4/uploads/:run/reading). */
export interface EarlyReading {
  pdfUrl: string | null;
  pages: number;
  pagesRead: number;
  stage: 'developing' | 'ready' | 'failed';
  lessonId: string | null;
}
```

- [ ] **Step 2: Keep the file under its run id** (`uploads.ts`)

In `send(id, file)`, right after `const r = await repo.bringIn(file);` (`r.run_id` for a queued upload, `r.lecture_id` for a duplicate), add:

```ts
    const kept = r.run_id ?? r.lecture_id;
    if (kept) files.set(kept, file);
```

Export:

```ts
/** The file itself, if it was brought in on this device during this visit. */
export const localFileFor = (uploadId: string): File | null => files.get(uploadId) ?? null;
```

- [ ] **Step 3: Write the failing hook test**

```tsx
// src/features/spaces/data/__tests__/useEarlyReading.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const readingFor = vi.fn();
vi.mock('../liveRepository', () => ({ loadLiveRepository: async () => ({ readingFor }) }));
const localFileFor = vi.fn();
vi.mock('../uploads', () => ({ localFileFor: (id: string) => localFileFor(id) }));

import { useEarlyReading } from '../useEarlyReading';

beforeEach(() => {
  readingFor.mockReset();
  localFileFor.mockReset();
});

describe('useEarlyReading', () => {
  it('reads the file on this device before the server link', async () => {
    localFileFor.mockReturnValue(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }));
    readingFor.mockResolvedValue({ pdfUrl: 'https://signed', pages: 10, pagesRead: 2, stage: 'developing', lessonId: null });
    URL.createObjectURL = vi.fn(() => 'blob:local');
    const { result } = renderHook(() => useEarlyReading('run-1'));
    expect(result.current.url).toBe('blob:local');
    await waitFor(() => expect(result.current.reading?.pagesRead).toBe(2));
  });

  it('falls back to the signed link when the file is not on this device', async () => {
    localFileFor.mockReturnValue(null);
    readingFor.mockResolvedValue({ pdfUrl: 'https://signed', pages: 10, pagesRead: 0, stage: 'developing', lessonId: null });
    const { result } = renderHook(() => useEarlyReading('run-1'));
    await waitFor(() => expect(result.current.url).toBe('https://signed'));
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/features/spaces/data/__tests__/useEarlyReading.test.tsx`
Expected: FAIL, cannot resolve `../useEarlyReading`.

- [ ] **Step 5: Implement the hook**

```ts
// src/features/spaces/data/useEarlyReading.ts
import { useEffect, useMemo, useState } from 'react';
import { loadLiveRepository, type EarlyReading } from './liveRepository';
import { localFileFor } from './uploads';

/** How often Luna's progress is re-read while she is still reading. */
const POLL_MS = 3000;

/**
 * An upload you can read before its Lesson exists. The file on this device
 * opens at once (no network); otherwise the stored copy's signed link. Luna's
 * progress is re-read until she is done or the run has failed.
 */
export function useEarlyReading(uploadId: string) {
  const local = useMemo(() => {
    const f = localFileFor(uploadId);
    return f ? URL.createObjectURL(f) : null;
  }, [uploadId]);
  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local);
  }, [local]);

  const [reading, setReading] = useState<EarlyReading | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const repo = await loadLiveRepository();
        const next = await repo.readingFor(uploadId);
        if (!alive) return;
        setReading(next);
        if (next.stage === 'developing') timer = setTimeout(tick, POLL_MS);
      } catch {
        if (alive) timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [uploadId]);

  return { reading, url: local ?? reading?.pdfUrl ?? null };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/spaces/data/__tests__/useEarlyReading.test.tsx src/features/spaces/__tests__/boundary.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. The boundary test proves no `fetch(` slipped in.

- [ ] **Step 7: Commit**

```bash
git add src/features/spaces/data/liveRepository.ts src/features/spaces/data/uploads.ts src/features/spaces/data/useEarlyReading.ts src/features/spaces/data/__tests__/useEarlyReading.test.tsx
git commit -m "feat(library): keep a brought-in file on the device and read its progress"
```

---

### Task 8: The Library's wait screen becomes an early reader

**Files:**
- Create: `src/features/spaces/components/reader/EarlyReader.tsx`
- Create: `src/features/spaces/components/reader/__tests__/EarlyReader.test.tsx`
- Modify: `src/features/spaces/screens/StudioCanvasScreen.tsx` (the `// A real upload still being read has no Lesson to open yet.` branch, and the `Navigate` right after it)
- Modify: `src/i18n/locales/en/v4Reader.json`, `src/i18n/locales/de/v4Reader.json`

**Interfaces:**
- Consumes: `useEarlyReading` (Task 7), `ReaderTimeline` (Task 2), `shapeOf` (Task 1), `PdfPager` and `PdfScroll` from `@/components/pdf`.
- Produces: `EarlyReader({ uploadId, filename, onReady })`, where `onReady: (lessonId: string, page: number) => void` is called once the Lesson exists.

- [ ] **Step 1: Strings** (en / de, new `"early"` block)

```json
"early": {
  "reading": "Luna is reading along · {{read}} / {{total}}",
  "readOn": "Read on — nothing waits for her",
  "faceSoon": "Explain arrives when Luna has read this far",
  "failed": "Luna could not read this one. You can still read it here."
}
```

```json
"early": {
  "reading": "Luna liest mit · {{read}} / {{total}}",
  "readOn": "Lies einfach weiter – nichts wartet auf sie",
  "faceSoon": "Erklären kommt, sobald Luna so weit gelesen hat",
  "failed": "Luna konnte diese Datei nicht lesen. Lesen kannst du sie trotzdem hier."
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// src/features/spaces/components/reader/__tests__/EarlyReader.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = { reading: { pdfUrl: 'x', pages: 10, pagesRead: 3, stage: 'developing', lessonId: null } as any, url: 'blob:x' };
vi.mock('../../../data/useEarlyReading', () => ({ useEarlyReading: () => state }));
vi.mock('@/components/pdf', () => ({
  PdfPager: () => <div data-testid="pager" />,
  PdfScroll: () => <div data-testid="scroll" />,
  scrollToPdfPage: () => {},
  warmPdfWorker: () => {},
}));

import { EarlyReader } from '../EarlyReader';

describe('EarlyReader', () => {
  it('shows the file at once, with Luna’s progress on the timeline', () => {
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={() => {}} />);
    expect(screen.getByTestId('pager')).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 10/)).toBeInTheDocument();
  });

  it('hands over to the Lesson once it exists, at the page being read', () => {
    const onReady = vi.fn();
    state.reading = { ...state.reading, stage: 'ready', lessonId: 'L1', pagesRead: 10 };
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={onReady} />);
    expect(onReady).toHaveBeenCalledWith('L1', 1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/EarlyReader.test.tsx`
Expected: FAIL, cannot resolve `../EarlyReader`.

- [ ] **Step 4: Implement**

```tsx
// src/features/spaces/components/reader/EarlyReader.tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PdfPager, PdfScroll, warmPdfWorker } from '@/components/pdf';
import { useEarlyReading } from '../../data/useEarlyReading';
import { useIdle } from './useIdle';
import { ReaderTimeline } from './ReaderTimeline';
import { shapeOf } from './pageShape';

/**
 * Your own file, readable the moment it lands. Luna reads along in the
 * background; the timeline shows how far. Once her Lesson exists, the reader
 * hands over to it at the page you are on — so nothing you did is lost.
 */
interface Props {
  uploadId: string;
  filename: string;
  onReady: (lessonId: string, page: number) => void;
}

export function EarlyReader({ uploadId, filename, onReady }: Props) {
  const { t } = useTranslation('v4Reader');
  useEffect(warmPdfWorker, []);
  const { reading, url } = useEarlyReading(uploadId);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null);
  const [box, setBox] = useState({ w: 1000, h: 640 });
  const root = useRef<HTMLDivElement>(null);
  const quiet = useIdle(true, 2800);
  const shape = shapeOf(aspect);
  const total = pages || reading?.pages || 0;

  useEffect(() => {
    if (reading?.stage === 'ready' && reading.lessonId) onReady(reading.lessonId, page);
  }, [reading?.stage, reading?.lessonId, onReady, page]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width - 32, h: e.contentRect.height - 32 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="fixed inset-0 z-40 bg-black text-white">
      <div ref={root} className="absolute inset-x-0 bottom-16 top-12">
        {url &&
          (shape === 'document' ? (
            <PdfScroll file={url} width={Math.min(box.w, 900)} onPage={setPage} onLoad={setPages} scrollRef={root} className="h-full overflow-y-auto" />
          ) : (
            <PdfPager
              file={url}
              page={page}
              onPageChange={(p) => setPage(Math.max(1, Math.min(total || p, p)))}
              maxWidth={box.w}
              maxHeight={box.h}
              onLoad={setPages}
              onAspect={setAspect}
              rootRef={root}
              className="h-full w-full"
            />
          ))}
      </div>
      <p className="absolute left-4 top-3 max-w-[70vw] truncate text-[14px] font-medium">{filename.replace(/\.pdf$/i, '')}</p>
      <div className="absolute inset-x-0 bottom-0 px-4 pb-[max(10px,env(safe-area-inset-bottom))]">
        {reading?.stage === 'failed' ? (
          <p className="mb-2 text-center text-[12.5px] text-white/60">{t('early.failed')}</p>
        ) : (
          !quiet && (
            <p className="mb-2 text-center text-[12.5px] text-white/60">
              {t('early.reading', { read: reading?.pagesRead ?? 0, total })} · {t('early.readOn')}
            </p>
          )
        )}
        <ReaderTimeline
          page={page}
          total={total}
          read={reading?.pagesRead ?? 0}
          quiet={quiet}
          onSeek={setPage}
          unit={shape === 'document' ? 'page' : 'slide'}
        />
      </div>
    </div>
  );
}
```

`useIdle(enabled, ms)` is the reader's existing idle hook (`src/features/spaces/components/reader/useIdle.ts`).

- [ ] **Step 5: Use it in `StudioCanvasScreen`**

Replace the branch `if (item?.opens.kind === 'lesson' && !item.opens.lessonId) return frame(…);` with:

```tsx
  // A real upload still being read: read it now; the Lesson takes over when it exists.
  if (item?.opens.kind === 'lesson' && !item.opens.lessonId)
    return (
      <EarlyReader
        uploadId={item.id}
        filename={item.filename}
        onReady={(lessonId, page) =>
          navigate(`/v4/space/${item.opens.kind === 'lesson' ? item.opens.spaceId : ''}/lesson/${lessonId}/faces?page=${page}`, {
            replace: true,
          })
        }
      />
    );
```

Change the `<Navigate>` right after it to open the reader directly: `` to={`/v4/space/${item.opens.spaceId}/lesson/${item.opens.lessonId}/faces`} ``. Import `EarlyReader` from `../components/reader/EarlyReader`, and `useNavigate` if the file does not already use it.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/spaces/components/reader/__tests__/EarlyReader.test.tsx src/features/spaces/__tests__/boundary.test.ts src/features/spaces/components/__tests__/a11y.test.tsx && npm run lint:i18n && npm run lint:v4 && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/spaces/components/reader/EarlyReader.tsx src/features/spaces/components/reader/__tests__/EarlyReader.test.tsx src/features/spaces/screens/StudioCanvasScreen.tsx src/i18n/locales/en/v4Reader.json src/i18n/locales/de/v4Reader.json
git commit -m "feat(library): read your file while Luna reads it; hand over at the same page"
```

---

### Task 9: Dropping a file opens it

**Files:**
- Modify: `src/features/spaces/screens/LibraryScreen.tsx` (where `bringFilesIn` / `useBringIn` is called)
- Modify: `src/features/spaces/data/uploads.ts` (`bringInLive` resolves the first upload's id once sent)
- Test: `src/features/spaces/components/__tests__/` (extend the Library test that covers bringing in; find it with `grep -rln "bringFilesIn\|Bring in your first" src/features/spaces --include='*.test.tsx'`)

**Interfaces:**
- Consumes: `localFileFor` (Task 7), the `/v4/library/m/:id` route (Task 8).
- Produces: `bringInLive(list, fail): Promise<string | null>`, the id of the first file's upload once the server has accepted it (`run_id`, or `lecture_id` for a duplicate). `null` if it was refused.

- [ ] **Step 1: Write the failing test** in the Library test file

```tsx
it('opens the first file you drop, straight into reading', async () => {
  // with the live repository mocked to accept the upload as run 'run-1'
  dropFiles([new File(['%PDF'], 'Normalization.pdf', { type: 'application/pdf' })]);
  await waitFor(() => expect(currentPath()).toBe('/v4/library/m/run-1'));
});
```

Use the test file's existing helpers for dropping and reading the route. If it has none, mount `LibraryScreen` in a `MemoryRouter` with a `Route path="/v4/library/m/:id" element={<p>opened</p>}` and assert the text "opened".

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL. The path stays `/v4/library`.

- [ ] **Step 3: Implement**

In `uploads.ts`, make `send` return the accepted id (`r.run_id ?? r.lecture_id ?? null`, and `null` from its refusal paths). Make `bringInLive` return a promise of the first file's result:

```ts
  const first = ids[0];
  const results = ids.map((id) => send(id, files.get(id)!));
  return results[0] ?? Promise.resolve(null);
```

(Change the `ids.forEach((id) => void send(…))` line accordingly.)

In `LibraryScreen.tsx`, after a bring-in, open the first file:

```tsx
  const navigate = useNavigate();
  const bring = async (list: File[]) => {
    const opened = await bringFilesIn(list, importWillFail());
    if (typeof opened === 'string') navigate(`/v4/library/m/${opened}`);
  };
```

Route the drop, the first cell and `U` through `bring`. In the demo world `bringFilesIn` returns ids synchronously: keep that path unchanged, since it only navigates when it gets a string.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/spaces && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS (the whole v4 suite, boundary included).

- [ ] **Step 5: Check it in the browser** (live, port 5212, backend + worker running; use a test account and a test PDF, never someone else's data):
- drop a PDF on the Library: the reader opens with page 1 within about a second;
- the timeline's grey part grows as Luna reads;
- when she is done, the reader becomes the Lesson at the same page, and Explain works.

- [ ] **Step 6: Commit**

```bash
git add src/features/spaces/screens/LibraryScreen.tsx src/features/spaces/data/uploads.ts src/features/spaces/components/__tests__
git commit -m "feat(library): dropping a file opens it"
```

---

## After this plan

- **Per-page lighting** (faces enable page by page as Luna finishes, LS-039 pages-before-run-end) is a separate plan. It needs the pipeline to serve finished pages before the run completes, and `useReader` to accept a partial bundle.
- **Find in document, zoom, lazy thumbnails** (spec §2) are a follow-up plan.
- **Ships only with LS-037 (v4 build flags) and LS-032 (student uploads on in prod).**
