import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { pdfPageId } from './PdfScroll';
import { pdfOptions } from './worker';

/**
 * A PDF as a deck: one page in view, turned sideways.
 *
 * The page is fitted whole into the box the caller gives it — width and
 * height both — so a slide is always seen entire, never scrolled. The pages
 * either side of it are painted too, off to the left and right on the same
 * track, so a turn slides an already-drawn page in rather than a blank one.
 *
 * The page is the caller's: this component is told which page to show and
 * reports the reader's wish to turn (`onPageChange`). Turning by wheel and by
 * touch swipe lives here, since both are gestures on the page itself; keys
 * are the caller's, which knows when a key belongs to something else.
 *
 * Each slot carries `data-pdf-page` and the text layer is on, as in
 * `PdfScroll`, so a selection can be traced to its page.
 *
 * The page in view is drawn first. Its neighbours wait until it is up, so on
 * opening they never compete with it for the worker or the file's bytes.
 */

interface Props {
  file: string;
  page: number;
  onPageChange: (page: number) => void;
  /** The box the page must fit inside, in CSS px. */
  maxWidth: number;
  maxHeight: number;
  onLoad?: (numPages: number) => void;
  /** Page 1's height / width once known — lets the caller choose a layout. */
  onAspect?: (heightOverWidth: number) => void;
  /** The canvas of the first page to paint — for sampling, never for drawing. */
  onFirstRender?: (canvas: HTMLCanvasElement | null) => void;
  rootRef: RefObject<HTMLDivElement>;
  className?: string;
  /** Drawn over the page in view, in its own coordinates — a highlight, a mark. */
  overlay?: ReactNode;
  /** Vertical wheel travel, when the caller wants it for something other than turning. */
  onStep?: (by: 1 | -1) => void;
}

/** How many pages either side of the current one are kept painted. */
const NEIGHBOURS = 1;
/** Wheel travel that counts as one turn, and the pause before the next. */
const WHEEL_STEP = 50;
const WHEEL_REST = 420;
const SWIPE_MIN = 48;

export function PdfPager({
  file,
  page,
  onPageChange,
  maxWidth,
  maxHeight,
  onLoad,
  onAspect,
  onFirstRender,
  rootRef,
  className,
  overlay,
  onStep,
}: Props) {
  const reduce = useReducedMotion();
  const [numPages, setNumPages] = useState(0);
  const [aspect, setAspect] = useState(405 / 720);
  const firstRender = useRef(false);
  /* The first page has been drawn — until then, the placeholder, and no neighbours. */
  const [painted, setPainted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paintedFile, setPaintedFile] = useState(file);
  if (paintedFile !== file) {
    setPaintedFile(file);
    setPainted(false);
    setFailed(false);
    setNumPages(0);
    firstRender.current = false;
  }

  const width = Math.max(200, Math.floor(Math.min(maxWidth, maxHeight / aspect)));
  const height = Math.round(width * aspect);

  const turn = useCallback(
    (by: number) => {
      const next = Math.min(Math.max(1, page + by), numPages || 1);
      if (next !== page) onPageChange(next);
    },
    [page, numPages, onPageChange],
  );

  /* Wheel and trackpad: whichever axis moved most, one page per gesture. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let travel = 0;
    let restUntil = 0;
    let settle = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      e.preventDefault();
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const d = sideways ? e.deltaX : e.deltaY;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => (travel = 0), 160);
      if (performance.now() < restUntil) return;
      travel += d;
      if (Math.abs(travel) >= WHEEL_STEP) {
        if (!sideways && onStep) onStep(travel > 0 ? 1 : -1);
        else turn(travel > 0 ? 1 : -1);
        travel = 0;
        restUntil = performance.now() + WHEEL_REST;
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', onWheel);
      window.clearTimeout(settle);
    };
  }, [rootRef, turn, onStep]);

  /* Touch: a sideways swipe turns. A mouse drag stays a text selection. */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    touchStart.current = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.4) turn(dx < 0 ? 1 : -1);
  };

  const onPageLoad = useCallback(
    (p: { width: number; height: number; pageNumber?: number }) => {
      if (p.width <= 0) return;
      setAspect(p.height / p.width);
      if (p.pageNumber === 1 || p.pageNumber === undefined) onAspect?.(p.height / p.width);
    },
    [onAspect],
  );

  const reach = painted ? NEIGHBOURS : 0;
  const shown: number[] = [];
  for (let p = page - reach; p <= page + reach; p++) if (p >= 1 && p <= numPages) shown.push(p);

  /* A page's place on the track: one page and a gutter per step from the current one. */
  const step = width + Math.max(48, width * 0.08);

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className={className}
      style={{ touchAction: 'pan-y' }}
    >
      <Document
        file={file}
        options={pdfOptions()}
        className="h-full w-full"
        onLoadSuccess={({ numPages: n }) => {
          setNumPages(n);
          onLoad?.(n);
        }}
        onLoadError={() => setFailed(true)}
        loading=""
        error={
          <p role="alert" className="p-6 text-center text-[13px] text-white/70">
            The Material could not be opened.
          </p>
        }
      >
        <div className="relative h-full w-full">
          {shown.map((p) => {
            const offset = p - page;
            return (
              <motion.div
                key={p}
                id={pdfPageId(p)}
                data-pdf-page={p}
                aria-hidden={offset !== 0 || undefined}
                {...(offset !== 0 ? { inert: '' } : {})}
                initial={false}
                animate={{ x: offset * step, opacity: offset === 0 ? 1 : 0.35, scale: offset === 0 ? 1 : 0.94 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }}
                className="absolute left-1/2 top-1/2 overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_2px_6px_rgba(0,0,0,0.3),0_28px_64px_-16px_rgba(0,0,0,0.65)]"
                style={{ width, height, marginLeft: -width / 2, marginTop: -height / 2 }}
              >
                <Page
                  pageNumber={p}
                  width={width}
                  renderTextLayer={offset === 0}
                  renderAnnotationLayer={false}
                  onLoadSuccess={onPageLoad}
                  onRenderSuccess={() => {
                    if (offset === 0) setPainted(true);
                    if (firstRender.current || !onFirstRender) return;
                    firstRender.current = true;
                    const canvas = rootRef.current?.querySelector<HTMLCanvasElement>(`#${pdfPageId(p)} canvas`);
                    onFirstRender(canvas ?? null);
                  }}
                  onRenderError={() => offset === 0 && setPainted(true)}
                  loading=""
                />
                {offset === 0 && overlay}
              </motion.div>
            );
          })}
        </div>
      </Document>
      {/*
        While the file arrives: the page's own shape, breathing, and a word
        about it. Outside the Document, which draws nothing of its own until
        the file is open, and over the page's slot until the page is drawn.
      */}
      {!painted && !failed && (
        <motion.div
          aria-label="Opening the deck"
          role="status"
          initial={{ opacity: 0.25 }}
          animate={reduce ? { opacity: 0.4 } : { opacity: [0.25, 0.5, 0.25] }}
          transition={reduce ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="pointer-events-none absolute left-1/2 top-1/2 flex items-end justify-center rounded-xl bg-white/[0.08] pb-5 text-[12.5px] text-white"
          style={{ width, height, marginLeft: -width / 2, marginTop: -height / 2 }}
        >
          Opening the deck…
        </motion.div>
      )}
    </div>
  );
}
