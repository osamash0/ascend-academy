import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { timing } from './Planes';
import { findRange } from './findText';

/**
 * A light on the page: the words an answer is talking about, found on the
 * slide itself and ringed, with the rest of the page dimmed around them.
 *
 * Drawn inside the page (`PdfPager`'s overlay), so it is in the page's own
 * coordinates and slides with it. It finds its words in the page's text
 * layer — trying for a moment, since the layer paints after the canvas —
 * and, moving from one part to the next, glides rather than jumps. Words
 * the page does not carry (a scanned slide, an authored phrase) light
 * nothing, which is the honest outcome.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6;

export function Spotlight({ words }: { words: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!words) {
      setBox(null);
      return;
    }
    let tries = 0;
    let frame = 0;
    const find = () => {
      const slot = ref.current?.parentElement;
      const range = slot ? findRange(slot, words) : null;
      if (!slot || !range) {
        if (++tries < 120) frame = requestAnimationFrame(find);
        return;
      }
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (rects.length === 0) return;
      const at = slot.getBoundingClientRect();
      /* The slot may be mid-slide or scaled; measure against its own box. */
      const sx = slot.offsetWidth / at.width || 1;
      const sy = slot.offsetHeight / at.height || 1;
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      setBox({
        x: (left - at.left) * sx - PAD,
        y: (top - at.top) * sy - PAD,
        w: (right - left) * sx + PAD * 2,
        h: (bottom - top) * sy + PAD * 2,
      });
    };
    /* Let a page that is still sliding in come to rest first. */
    const t = setTimeout(() => (frame = requestAnimationFrame(find)), 120);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(frame);
    };
  }, [words]);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <AnimatePresence>
        {box && (
          <motion.div
            key="light"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: timing.card }}
            className="absolute inset-0"
          >
            <motion.div
              layout
              transition={{ duration: timing.card }}
              className="absolute rounded-lg"
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                boxShadow:
                  '0 0 0 2px var(--reader-accent,hsl(var(--secondary))), 0 0 24px 2px var(--reader-accent,hsl(var(--secondary))), 0 0 0 200vmax rgba(5,8,14,0.55)',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
