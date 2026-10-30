import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PdfPager, PdfScroll, scrollToPdfPage, warmPdfWorker } from '@/components/pdf';
import { useEarlyReading } from '../../data/useEarlyReading';
import { resolvedUploadId, subscribeUploads, uploadsVersion } from '../../data/uploads';
import { useIdle } from './useIdle';
import { useFullscreen } from './useFullscreen';
import { ReaderTimeline } from './ReaderTimeline';
import { shapeOf } from './pageShape';
import { LessonFacesRoute } from '../../screens/lazyScreens';

/**
 * Your own file, readable the moment it lands. Luna reads along in the
 * background; the timeline shows how far. Once her Lesson exists, the reader
 * hands over to it at the page you are on — so nothing you did is lost.
 */
interface Props {
  uploadId: string;
  filename: string;
  onReady: (lessonId: string, page: number) => void;
  /** The upload was refused before it became a run: the file stays readable, with a calm line. */
  refused?: boolean;
  /** Where to start (a swap from the temporary id keeps your place). */
  initialPage?: number;
  /** The server accepted the file this reader was opened on: the real id, and the page you are on. */
  onResolved?: (id: string, page: number) => void;
  /** Send a refused file again; absent when there is nothing to resend. */
  onRetry?: () => void;
  /** The page you are on, as it changes — so whoever hands over keeps your place. */
  onPage?: (page: number) => void;
  /** Already in your Library, with no Lesson on the shelf to move to: your file, read from this device. */
  already?: boolean;
}

export function EarlyReader({ uploadId, filename, onReady, refused, initialPage = 1, onResolved, onRetry, onPage, already }: Props) {
  const { t } = useTranslation('v4Reader');
  const { t: tl } = useTranslation('v4Library', { keyPrefix: 'studio.canvas.reading' });
  const fs = useFullscreen();
  const reduce = !!useReducedMotion();
  useEffect(warmPdfWorker, []);
  /* The Lesson this file becomes: fetched while you read, so the handover has nothing to wait for but the Lesson's own data. */
  useEffect(() => {
    void LessonFacesRoute.preload().catch(() => {});
  }, []);
  const { reading, url } = useEarlyReading(uploadId);
  const [page, setPage] = useState(initialPage);
  const [pages, setPages] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null);
  const [box, setBox] = useState({ w: 1000, h: 640 });
  /* Three elements, three refs: the box we measure, the pager, and the scrolling document. */
  const boxRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const quiet = useIdle(true, 2800);
  const shape = shapeOf(aspect);
  const total = pages || reading?.pages || 0;

  /* The handover fires once per Lesson, as soon as it has pages, with the page as it is at that moment. */
  const pageRef = useRef(page);
  pageRef.current = page;
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  useEffect(() => {
    onPageRef.current?.(page);
  }, [page]);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (!reading?.readable || !reading.lessonId || handed.current === reading.lessonId) return;
    handed.current = reading.lessonId;
    onReadyRef.current(reading.lessonId, pageRef.current);
  }, [reading?.readable, reading?.lessonId]);

  /* A reader opened on a temporary id moves to the real one when it arrives; unmounted, nothing happens. */
  useSyncExternalStore(subscribeUploads, uploadsVersion);
  const resolvedTo = uploadId.startsWith('sending-') ? resolvedUploadId(uploadId) : null;
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  useEffect(() => {
    if (resolvedTo) onResolvedRef.current?.(resolvedTo, pageRef.current);
  }, [resolvedTo]);

  const totalRef = useRef(total);
  totalRef.current = total;
  const documentRef = useRef(false);
  documentRef.current = shape === 'document';
  /** Slides turn the page; a document scrolls to it, and its scroll reports the page back. */
  const go = useCallback((p: number) => {
    const to = Math.max(1, Math.min(totalRef.current || p, p));
    if (documentRef.current && scrollRef.current) scrollToPdfPage(scrollRef.current, to, 0.38, reduce ? 'auto' : 'smooth');
    else setPage(to);
  }, [reduce]);
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      /* On the timeline, Page Up/Down belong to the slider, not the page. */
      if ((e.key === 'PageDown' || e.key === 'PageUp') && el?.closest?.('[role="slider"]')) return;
      const step = e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      goRef.current(pageRef.current + step);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* A document opens at the page you were on — once its first page has painted, so the slots have their real size. */
  const placed = useRef(false);
  const place = useCallback(() => {
    if (placed.current || initialPage <= 1 || !scrollRef.current) return;
    placed.current = true;
    scrollToPdfPage(scrollRef.current, initialPage, 0.38, 'auto');
  }, [initialPage]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width - 32, h: e.contentRect.height - 32 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /*
   * A temporary id with no file on this device and none on its way: never a
   * blank page. A server reading always has a run id, so this is the file
   * that was only here and is gone.
   */
  const gone = !url && uploadId.startsWith('sending-') && !resolvedTo;

  return (
    <div data-early-reader className="fixed inset-0 z-40 bg-black text-white">
      {gone && (
        <div className="absolute inset-x-0 bottom-16 top-12 flex flex-col items-center justify-center gap-6 px-6 text-center">
          <p className="max-w-[44ch] text-[15px] leading-relaxed text-quiet">{tl('gone')}</p>
          <Link
            to="/v4/library"
            className="console-focusable inline-flex h-11 items-center rounded-full bg-white/[0.08] px-6 text-[14px] font-medium text-foreground transition-colors hover:bg-white/[0.14]"
          >
            {tl('back')}
          </Link>
        </div>
      )}
      <div ref={boxRef} className="absolute inset-x-0 bottom-16 top-12">
        {url &&
          (shape === 'document' ? (
            <PdfScroll
              file={url}
              width={Math.min(box.w, 900)}
              onPage={setPage}
              onLoad={setPages}
              onFirstRender={place}
              scrollRef={scrollRef}
              className="h-full overflow-y-auto"
            />
          ) : (
            <PdfPager
              file={url}
              page={page}
              onPageChange={go}
              maxWidth={box.w}
              maxHeight={box.h}
              onLoad={setPages}
              onAspect={setAspect}
              rootRef={pagerRef}
              zoomable
              className="h-full w-full overflow-hidden"
            />
          ))}
      </div>
      <div className="absolute inset-x-0 top-0 flex h-12 items-center gap-2 px-3">
        <Link
          to="/v4/library"
          aria-label={tl('back')}
          title={tl('back')}
          className="console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{filename.replace(/\.pdf$/i, '')}</p>
        {fs.supported && (
          <button
            type="button"
            onClick={fs.toggle}
            aria-label={fs.full ? t('screen.exitFullscreen') : t('screen.fullscreen')}
            title={fs.full ? t('screen.exitFullscreen') : t('screen.fullscreen')}
            className="console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:text-foreground"
          >
            {fs.full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
          </button>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 px-4 pb-[max(10px,env(safe-area-inset-bottom))]">
        {gone ? null : already ? (
          /* Already yours: no Lesson on the shelf to move to, so this copy is read here. */
          <p role="status" className="mb-2 flex items-center justify-center gap-3 text-center text-[12.5px] text-quiet">
            <span>{t('early.already')}</span>
            <Link
              to="/v4/library"
              className="console-focusable h-7 rounded-full bg-white/[0.08] px-3 leading-7 text-foreground transition-colors hover:bg-white/[0.14]"
            >
              {tl('back')}
            </Link>
          </p>
        ) : refused ? (
          /* Never reached the server: it is here, on this device, and can be sent again. */
          <p role="status" className="mb-2 flex items-center justify-center gap-3 text-center text-[12.5px] text-quiet">
            <span>{t('early.refused')}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="console-focusable h-7 rounded-full bg-white/[0.08] px-3 text-foreground transition-colors hover:bg-white/[0.14]"
              >
                {t('early.retry')}
              </button>
            )}
          </p>
        ) : reading?.stage === 'failed' ? (
          <p className="mb-2 text-center text-[12.5px] text-quiet">{t('early.failed')}</p>
        ) : (
          !quiet && (
            /* How far Luna has read is the grey of the timeline; this only says she is on it. */
            <p className="mb-2 text-center text-[12.5px] text-quiet">
              {t('early.reading')} · {t('early.readOn')}
            </p>
          )
        )}
        <ReaderTimeline
          page={page}
          total={total}
          read={reading?.pagesRead ?? 0}
          quiet={quiet}
          onSeek={go}
          unit={shape === 'document' ? 'page' : 'slide'}
        />
      </div>
    </div>
  );
}
