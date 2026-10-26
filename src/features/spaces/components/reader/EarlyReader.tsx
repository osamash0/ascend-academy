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
    if (!el || typeof ResizeObserver === 'undefined') return;
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
          onSeek={setPage}
          unit={shape === 'document' ? 'page' : 'slide'}
        />
      </div>
    </div>
  );
}
