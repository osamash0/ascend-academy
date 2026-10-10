import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { timing } from './Planes';

/**
 * The same sentence, found on the other face.
 *
 * Select words on the page and press "Read this": the Lesson turns over and
 * the column arrives with *those words* underlined — a hairline in the
 * Lesson's accent that draws itself left to right under each line of the
 * match, then fades. The other way round, "Show page" lights the same words
 * on the PDF's text layer. Nothing in the layout moves; what moves is a line
 * under the words you chose, on the face you did not choose them on. It is
 * the reader's proof that its two faces are one object.
 *
 * Positioned in the viewport (`fixed`) from the range's client rectangles,
 * and cleared on the first scroll — a line pinned to where a sentence *was*
 * would be pointing at the wrong words.
 */

export interface Found {
  /** One rectangle per line of the match, in viewport coordinates. */
  rects: DOMRect[];
  /** Changes per find, so two finds of the same words both draw. */
  nonce: number;
}

export function FoundLine({ found }: { found: Found | null }) {
  const [shown, setShown] = useState<Found | null>(null);

  useEffect(() => {
    setShown(found);
    if (!found) return;
    const clear = () => setShown(null);
    window.addEventListener('scroll', clear, { capture: true, passive: true });
    // Long enough to be seen, short enough that it never becomes a fixture.
    const t = setTimeout(clear, 2400);
    return () => {
      window.removeEventListener('scroll', clear, { capture: true });
      clearTimeout(t);
    };
  }, [found]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[45]">
      <AnimatePresence>
        {shown &&
          shown.rects.map((r, i) => (
            <motion.span
              key={`${shown.nonce}-${i}`}
              initial={{ scaleX: 0, opacity: 1 }}
              animate={{ scaleX: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                scaleX: { duration: timing.found, delay: i * 0.06 },
                opacity: { duration: 0.6 },
              }}
              style={{
                left: r.left,
                top: r.bottom + 2,
                width: r.width,
                transformOrigin: 'left center',
              }}
              className="absolute h-px bg-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))] shadow-[0_0_8px_var(--reader-accent,theme(colors.secondary.DEFAULT))]"
            />
          ))}
      </AnimatePresence>
    </div>
  );
}
