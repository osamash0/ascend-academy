import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * A PDF as a document: every page, top to bottom, in one scroll.
 *
 * One `Document`, one slot per page. A slot is a box of the page's aspect
 * from the moment the file opens, so the scroll height is right before a
 * single page has painted and a jump to page 60 lands where page 60 will be.
 * Pages paint only near the window (two screens either side) and are let go
 * again when they leave it, so an eighty-page deck costs a handful of canvases.
 *
 * The text layer is on: it is what makes words on the page selectable, and
 * selecting words is how the reader starts anything. Each slot carries
 * `data-pdf-page` so a selection can be traced to its page.
 *
 * The component reports which page sits under a line the caller names (as a
 * fraction of the container's height) and can be told to scroll to a page —
 * two calls, both in page numbers, so the caller never thinks in pixels.
 */

interface Props {
  file: string;
  /** Rendered page width in CSS px. Height follows the page's aspect. */
  width: number;
  /** Where in the container the "current" page is read: 0.38 = 38 % down. */
  anchorLine?: number;
  onPage?: (page: number) => void;
  onLoad?: (numPages: number) => void;
  /** The canvas of the first page to paint — for sampling, never for drawing. */
  onFirstRender?: (canvas: HTMLCanvasElement | null) => void;
  scrollRef: RefObject<HTMLDivElement>;
  className?: string;
  /** Vertical room above the first page and below the last. */
  padTop?: number;
  padBottom?: number;
  gap?: number;
}

export const pdfPageId = (page: number) => `pdf-page-${page}`;

/** Put a page's top on the anchor line. */
export function scrollToPdfPage(container: HTMLElement, page: number, anchorLine: number, behavior: ScrollBehavior) {
  const el = container.querySelector<HTMLElement>(`#${pdfPageId(page)}`);
  if (!el) return;
  const top =
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    Math.round(container.clientHeight * anchorLine) +
    8;
  container.scrollTo({ top: Math.max(0, top), behavior });
}

export function PdfScroll({
  file,
  width,
  anchorLine = 0.38,
  onPage,
  onLoad,
  onFirstRender,
  scrollRef,
  className,
  padTop = 96,
  padBottom = 240,
  gap = 32,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [aspect, setAspect] = useState(405 / 720);
  const [near, setNear] = useState<Set<number>>(() => new Set([1, 2]));
  const firstRender = useRef(false);

  /* Which slots are near the window. */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || numPages === 0) return;
    const slots = root.querySelectorAll<HTMLElement>('[data-pdf-page]');
    const io = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.pdfPage);
            if (e.isIntersecting) next.add(p);
            else next.delete(p);
          }
          return next;
        });
      },
      { root, rootMargin: '200% 0px' },
    );
    slots.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [numPages, scrollRef]);

  /* Which page is under the anchor line, once per frame at most. */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !onPage) return;
    let frame = 0;
    let last = 0;
    const read = () => {
      frame = 0;
      const line = root.getBoundingClientRect().top + root.clientHeight * anchorLine;
      let hit = 1;
      for (const s of root.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
        if (s.getBoundingClientRect().top <= line) hit = Number(s.dataset.pdfPage);
        else break;
      }
      if (hit !== last) {
        last = hit;
        onPage(hit);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchorLine, onPage, scrollRef, numPages]);

  const onPageLoad = useCallback((p: { width: number; height: number }) => {
    if (p.width > 0) setAspect(p.height / p.width);
  }, []);

  return (
    <div ref={scrollRef} className={className}>
      <Document
        file={file}
        onLoadSuccess={({ numPages: n }) => {
          setNumPages(n);
          onLoad?.(n);
        }}
        loading=""
        error={
          <p role="alert" className="p-6 text-center text-[13px] text-white/70">
            The Material could not be opened.
          </p>
        }
      >
        <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
          {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
            <div
              key={p}
              id={pdfPageId(p)}
              data-pdf-page={p}
              className="mx-auto overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_2px_6px_rgba(0,0,0,0.3),0_28px_64px_-16px_rgba(0,0,0,0.65)]"
              style={{ width, height: Math.round(width * aspect), marginBottom: gap }}
            >
              {near.has(p) && (
                <Page
                  pageNumber={p}
                  width={width}
                  renderTextLayer
                  renderAnnotationLayer={false}
                  onLoadSuccess={onPageLoad}
                  onRenderSuccess={() => {
                    if (firstRender.current || !onFirstRender) return;
                    firstRender.current = true;
                    const canvas = scrollRef.current?.querySelector<HTMLCanvasElement>(
                      `#${pdfPageId(p)} canvas`,
                    );
                    onFirstRender(canvas ?? null);
                  }}
                  loading=""
                />
              )}
            </div>
          ))}
        </div>
      </Document>
    </div>
  );
}
