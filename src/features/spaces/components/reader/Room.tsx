import { useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PdfPage } from '@/components/pdf';
import { timing } from './Planes';

/**
 * The room is the current page.
 *
 * A still of the page the Learner is at, blurred once and dimmed, behind both
 * faces — Learnstation's own motif (the slide as the room, view 2), made
 * continuous. It does not change when the face changes; it changes when the
 * *page* changes, dissolving to the next still over the 1.1 s the product's
 * `LectureBackdrop` already uses. Turning the Lesson over therefore happens
 * inside a room that stays put, which is most of what "the same object" means
 * to the eye; and reading past a page boundary turns the wallpaper with you.
 *
 * The blur is static — a filter on an image, set once — which is the one
 * blur the first prototype's review kept. Nothing live is blurred.
 *
 * The still comes from the rendered page canvas (`RoomStill` below) until the
 * backend has a poster per page; today `poster_url` exists for page 1 only.
 */

interface RoomProps {
  /** A data URL of the current page, or null before the first render lands. */
  still: string | null;
  /** The page the still is of — the key the dissolve runs on. */
  page: number;
}

export function Room({ still, page }: RoomProps) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <AnimatePresence initial={false}>
        {still && (
          <motion.img
            key={page}
            src={still}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: timing.room, ease: 'easeInOut' }}
            /*
             * `scale-110` so the blur's soft edge falls outside the window
             * rather than showing as a vignette of the console behind it.
             */
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-[40px]"
          />
        )}
      </AnimatePresence>
      {/* Dim, so the page behind never competes with the page in front. */}
      <div className="absolute inset-0 bg-[#070b14]/60" />
    </div>
  );
}

interface RoomStillProps {
  pdfUrl: string;
  page: number;
  onStill: (page: number, dataUrl: string) => void;
}

/**
 * Renders the page the room needs, out of sight, and hands its pixels over.
 *
 * A second `PdfPage` rather than the face's own, because the face showing may
 * be the text — whose page is only ever a number — and because it renders at
 * a width the wallpaper wants (640px is plenty under 40px of blur) rather
 * than the width the reader wants.
 */
export function RoomStill({ pdfUrl, page, onStill }: RoomStillProps) {
  const onRender = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      try {
        onStill(page, canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        // A tainted canvas cannot be read. The room keeps its last still.
      }
    },
    [onStill, page],
  );
  return (
    <div aria-hidden className="pointer-events-none fixed -left-[10000px] top-0 h-px w-px overflow-hidden">
      <PdfPage file={pdfUrl} page={page} width={640} onRender={onRender} loading="" error="" />
    </div>
  );
}
