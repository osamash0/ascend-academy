import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { resolvePosterUrl } from '@/services/lectureService';

/**
 * LectureBackdrop — Netflix-style key art for the console hero.
 *
 * Renders the focused lecture's poster (a WebP of page 1, produced at ingest)
 * full-bleed behind the hero, then cross-fades calmly whenever focus moves to
 * another lecture. A slow Ken-Burns zoom and a heavy darkening gradient keep it
 * quiet enough that the foreground text always stays readable.
 *
 * This deliberately does NOT read the source PDF. It used to hand pdf_url to
 * react-pdf and render page 1, but pdf.js auto-fetches the whole document, so
 * focusing a lecture pulled its entire PDF (1.6 MB average, up to 6.9 MB) just to
 * paint a background. That was the dominant source of the Supabase egress
 * overage. A poster is 30–124 KB for the same pixels — a ~98% reduction. If a
 * lecture has no poster yet, show the ambient gradient; never fall back to the
 * PDF.
 */

// Cache resolved signed URLs per lecture so re-focusing is instant. The signed
// URL itself is additionally cached per object in lectureService, which is what
// lets the storage CDN serve repeat views.
const urlCache = new Map<string, string>();

function BackdropImage({ url }: { url: string }) {
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // `onLoad` alone is not enough. `load` does not bubble, so React attaches the
  // handler directly to the element -- and a memory-cached poster can dispatch
  // `load` in the gap between the element being created and the listener being
  // attached. The event is then lost and the art stays at opacity 0 forever.
  // (The old react-pdf path could not miss this, because rasterising a page is
  // always asynchronous.) A callback ref is too early to help, so re-check the
  // element's real state here: effects run after DOM commit, and `decode()`
  // resolves for an already-decoded image.
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    let cancelled = false;
    const reveal = () => { if (!cancelled) setReady(true); };

    // Order matters: subscribe BEFORE testing `complete`. Either the listener
    // catches the load, or it had already finished and `complete` is true --
    // there is no window in between for the event to slip through.
    el.addEventListener('load', reveal);
    if (el.complete && el.naturalWidth > 0) reveal();

    return () => {
      cancelled = true;
      el.removeEventListener('load', reveal);
    };
  }, [url]);

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
      <img
        ref={imgRef}
        src={url}
        alt=""
        aria-hidden="true"
        decoding="async"
        onLoad={() => setReady(true)}
        // A poster that fails to load must not leave the hero stuck mid-fade at
        // partial opacity; reveal nothing and let the ambient gradient stand.
        onError={() => setReady(false)}
        className="h-full w-full object-cover"
      />
    </motion.div>
  );
}

interface LectureBackdropProps {
  /** Focused lecture id — drives the cross-fade. Undefined = no key art. */
  lectureId?: string;
  /** Raw stored poster_url (path); resolved to a signed URL. Null = gradient only. */
  posterUrl?: string | null;
}

export function LectureBackdrop({ lectureId, posterUrl }: LectureBackdropProps) {
  const [url, setUrl] = useState<string | null>(() =>
    lectureId ? urlCache.get(lectureId) ?? null : null,
  );

  useEffect(() => {
    if (!lectureId || !posterUrl) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(lectureId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    resolvePosterUrl(posterUrl)
      .then((signed) => {
        if (cancelled || !signed) return;
        urlCache.set(lectureId, signed);
        setUrl(signed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lectureId, posterUrl]);

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
