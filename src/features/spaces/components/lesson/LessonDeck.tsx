import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { PdfPage, sampleAccent } from '@/components/pdf';

/**
 * The Lesson as the thing it is: its deck.
 *
 * The title page in front, the next two fanned behind it, and a glow in the
 * deck's own colour underneath — sampled from the cover, so every Lesson
 * lights its overview in its own colour. Resting a pointer on it spreads the
 * fan a little: the deck invites being opened, and pressing it does.
 *
 * Purely the Material's own pages; nothing here is drawn for the deck that
 * the deck does not already contain.
 */

interface Props {
  file: string;
  pageCount?: number;
  onOpen: () => void;
  onAccent?: (accent: string | null) => void;
  label: string;
}

const FAN = [
  { page: 3, rest: { rotate: 5, x: 46, y: 18 }, open: { rotate: 9, x: 120, y: 26 } },
  { page: 2, rest: { rotate: -4, x: -40, y: 12 }, open: { rotate: -8, x: -112, y: 20 } },
];

export function LessonDeck({ file, onOpen, onAccent, label }: Props) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(false);
  const sampled = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.max(260, Math.min(720, el.clientWidth - 140)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = Math.round(width * (405 / 720));
  const spread = hover && !reduce;

  return (
    <div ref={box} className="relative flex justify-center" style={{ height: height + 70 }}>
      {FAN.map((f) => (
        <motion.div
          key={f.page}
          aria-hidden
          initial={false}
          animate={spread ? f.open : f.rest}
          transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-2 overflow-hidden rounded-xl bg-white opacity-60 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)]"
          style={{ width, height }}
        >
          <PdfPage file={file} page={f.page} width={width} loading="" error="" />
        </motion.div>
      ))}
      <motion.button
        type="button"
        onClick={onOpen}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label={label}
        initial={false}
        animate={{ y: spread ? -6 : 0 }}
        transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
        className="console-focusable absolute top-2 overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_40px_90px_-20px_rgba(0,0,0,0.9)]"
        style={{ width, height }}
      >
        <PdfPage
          file={file}
          page={1}
          width={width}
          loading=""
          error=""
          onRender={(canvas) => {
            if (sampled.current || !canvas) return;
            sampled.current = true;
            onAccent?.(sampleAccent(canvas));
          }}
        />
      </motion.button>
    </div>
  );
}
