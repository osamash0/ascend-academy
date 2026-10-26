import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PdfPager, PdfScroll, scrollToPdfPage, warmPdfWorker } from '@/components/pdf';
import { useEarlyReading } from '../../data/useEarlyReading';
import { useIdle } from './useIdle';
import { useFullscreen } from './useFullscreen';
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
  const { t: tl } = useTranslation('v4Library', { keyPrefix: 'studio.canvas.reading' });
  const fs = useFullscreen();
  const reduce = !!useReducedMotion();
  useEffect(warmPdfWorker, []);
  const { reading, url } = useEarlyReading(uploadId);
  const [page, setPage] = useState(1);
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

  /* The handover fires once per Lesson, with the page as it is at that moment. */
  const pageRef = useRef(page);
  pageRef.current = page;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (reading?.stage !== 'ready' || !reading.lessonId || handed.current === reading.lessonId) return;
    handed.current = reading.lessonId;
    onReadyRef.current(reading.lessonId, pageRef.current);
  }, [reading?.stage, reading?.lessonId]);

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
      const step = e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      goRef.current(pageRef.current + step);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width - 32, h: e.contentRect.height - 32 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="fixed inset-0 z-40 bg-black text-white">
      <div ref={boxRef} className="absolute inset-x-0 bottom-16 top-12">
        {url &&
          (shape === 'document' ? (
            <PdfScroll file={url} width={Math.min(box.w, 900)} onPage={setPage} onLoad={setPages} scrollRef={scrollRef} className="h-full overflow-y-auto" />
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
              className="h-full w-full"
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
        {reading?.stage === 'failed' ? (
          <p className="mb-2 text-center text-[12.5px] text-quiet">{t('early.failed')}</p>
        ) : (
          !quiet && (
            <p className="mb-2 text-center text-[12.5px] text-quiet">
              {t('early.reading', { read: reading?.pagesRead ?? 0, total })} · {t('early.readOn')}
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
