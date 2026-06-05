import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Document, Page, pdfjs } from 'react-pdf';
import { resolvePdfUrl } from '@/services/lectureService';

// Share the worker config with the rest of the app's react-pdf usage.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * LectureBackdrop — Netflix-style key art for the console hero.
 *
 * Renders the focused lecture's first slide (page 1 of its PDF) full-bleed
 * behind the hero, then cross-fades calmly whenever focus moves to another
 * lecture. A slow Ken-Burns zoom and a heavy darkening gradient keep it quiet
 * enough that the foreground text always stays readable.
 */

// Cache resolved signed URLs per lecture so re-focusing is instant and we
// don't mint a fresh signed URL on every cursor move.
const urlCache = new Map<string, string>();

function BackdropImage({ url }: { url: string }) {
  const [ready, setReady] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: ready ? 1 : 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        opacity: { duration: 1.1, ease: 'easeInOut' },
        scale: { duration: 12, ease: 'easeOut' },
      }}
      className="absolute inset-0"
    >
      <Document file={url} loading={null} error={null}>
        <Page
          pageNumber={1}
          width={1440}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          onRenderSuccess={() => setReady(true)}
          className="h-full w-full [&_canvas]:!h-full [&_canvas]:!w-full [&_canvas]:object-cover"
        />
      </Document>
    </motion.div>
  );
}

interface LectureBackdropProps {
  /** Focused lecture id — drives the cross-fade. Undefined = no key art. */
  lectureId?: string;
  /** Raw stored pdf_url (path or legacy URL); resolved to a signed URL. */
  pdfUrl?: string | null;
}

export function LectureBackdrop({ lectureId, pdfUrl }: LectureBackdropProps) {
  const [url, setUrl] = useState<string | null>(() =>
    lectureId ? urlCache.get(lectureId) ?? null : null,
  );

  useEffect(() => {
    if (!lectureId || !pdfUrl) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(lectureId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    resolvePdfUrl(pdfUrl)
      .then((signed) => {
        if (cancelled || !signed) return;
        urlCache.set(lectureId, signed);
        setUrl(signed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lectureId, pdfUrl]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {url && lectureId && <BackdropImage key={lectureId} url={url} />}
      </AnimatePresence>
      {/* Calm darkening: opaque at the bottom/left where the hero text lives,
          fading the art into the ambient gradient toward the top-right. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/75 to-background/30" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent" />
    </div>
  );
}
