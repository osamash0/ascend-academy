import { useEffect, useState, type ReactNode } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';

/*
 * One worker for the whole app. `SlideViewer` set this at module scope for
 * the same reason: react-pdf needs it before the first `<Document>` and the
 * URL is the bundler's, so it cannot come from a prop.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * One page of a PDF, as uploaded.
 *
 * Lifted out of `SlideViewer.tsx`, which renders the same `Document`/`Page`
 * pair inside a card that also owns text-to-speech, a confidence rating and a
 * regenerate form. This is the rendering alone, so a reading surface can show
 * the Material without inheriting the rest of that card.
 *
 * Two things the old block did that are kept on purpose:
 *
 *   • The loading state changes its mind after a few seconds. A spinner that
 *     looks the same at one second and at eighteen reads as hung; a second
 *     line after six seconds says the file is large, not lost.
 *   • The text layer is on. It is what makes a sentence on the page
 *     selectable, and selection is how a reader starts a question.
 *
 * The annotation layer is off: links inside a lecture PDF open somewhere
 * else, and a focus surface should not have doors in it that lead out.
 */

interface Props {
  /** A URL the browser can fetch — signed, or a static asset in development. */
  file: string;
  /** 1-based, as printed on the page. */
  page: number;
  /** Rendered width in CSS pixels. The height follows the page's aspect. */
  width: number;
  className?: string;
  /** Fires once the file is open, with how many pages it has. */
  onLoad?: (numPages: number) => void;
  onError?: () => void;
  /** Fires with the page's canvas after each render — for sampling, never for drawing. */
  onRender?: (canvas: HTMLCanvasElement | null) => void;
  loading?: ReactNode;
  error?: ReactNode;
}

/** Six seconds is where a spinner stops meaning "working" and starts meaning "stuck". */
const SLOW_AFTER_MS = 6000;

function Loading({ label, slowLabel }: { label: string; slowLabel: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="status" className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3">
      <div
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white"
      />
      <p className="text-[12.5px] text-white/70">{slow ? slowLabel : label}</p>
    </div>
  );
}

export function PdfPage({
  file,
  page,
  width,
  className,
  onLoad,
  onError,
  onRender,
  loading,
  error,
}: Props) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  /*
   * Report the canvas after the page has actually painted into it, not when
   * the ref is attached — react-pdf attaches the element first and draws
   * later, and a sampler reading an empty canvas learns nothing.
   */
  const [renders, setRenders] = useState(0);
  useEffect(() => {
    if (renders > 0) onRender?.(canvas);
  }, [renders, canvas, onRender]);

  return (
    <Document
      file={file}
      onLoadSuccess={({ numPages }) => onLoad?.(numPages)}
      onLoadError={onError}
      loading={
        loading ?? (
          <Loading label="Opening the Material" slowLabel="Still opening. Large files take a moment." />
        )
      }
      error={
        error ?? (
          <p role="alert" className="p-6 text-center text-[13px] text-white/70">
            The Material could not be opened.
          </p>
        )
      }
      className={className}
    >
      <Page
        pageNumber={page}
        width={width}
        renderTextLayer
        renderAnnotationLayer={false}
        canvasRef={setCanvas}
        onRenderSuccess={() => setRenders((n) => n + 1)}
        loading=""
      />
    </Document>
  );
}
