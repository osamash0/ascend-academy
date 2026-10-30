import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

/**
 * The deck as a timeline, the way a video player shows a film: white is where
 * you are, grey is how far Luna has read (the "buffered" part). Quiet — the
 * controls asleep — it is only the hairline, so a long read keeps its place.
 */
interface Props {
  page: number;
  total: number;
  /** Pages Luna has finished. A finished Lesson passes `total`. */
  read: number;
  quiet: boolean;
  onSeek: (page: number) => void;
  unit: 'slide' | 'page';
}

const pct = (n: number, total: number) => `${total ? Math.min(100, (n / total) * 100) : 0}%`;

export function ReaderTimeline({ page, total, read, quiet, onSeek, unit }: Props) {
  const { t } = useTranslation('v4Reader');
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const word = t(`timeline.${unit}`);
  if (total <= 0) return null;
  /* A page past the end (a stale count, a deep link) still reads as the last one. */
  const at = Math.max(1, Math.min(total, page));

  const pageAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(1, Math.min(total, Math.ceil(((clientX - r.left) / r.width) * total)));
  };

  if (quiet) {
    return (
      <div aria-hidden data-testid="timeline-hairline" className="pointer-events-none h-[2px] bg-white/[0.05]">
        <motion.div
          className="h-full origin-left"
          style={{ background: 'var(--reader-accent, hsl(var(--secondary)))', opacity: 0.75 }}
          initial={false}
          animate={{ scaleX: at / total }}
          transition={{ duration: reduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    );
  }

  /* Awake, the page number sits at the end of the line — the one place it is shown. */
  return (
    <div className="flex items-center gap-3">
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('timeline.label', { unit: word, page: at, total })}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={at}
        className="console-focusable group relative h-5 min-w-0 flex-1 cursor-pointer"
        onPointerMove={(e) => setHover(pageAt(e.clientX, e.currentTarget))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSeek(pageAt(e.clientX, e.currentTarget))}
        onKeyDown={(e) => {
          const to =
            e.key === 'Home' ? 1 : e.key === 'End' ? total : e.key === 'ArrowUp' ? at + 1 : e.key === 'ArrowDown' ? at - 1 : null;
          if (to === null) return;
          e.preventDefault();
          e.stopPropagation();
          onSeek(Math.max(1, Math.min(total, to)));
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15 group-hover:h-[5px]">
          <div data-testid="timeline-read" className="absolute inset-y-0 left-0 bg-white/35" style={{ width: pct(read, total) }} />
          <div className="absolute inset-y-0 left-0 bg-white" style={{ width: pct(at, total) }} />
        </div>
        {hover !== null && (
          <div
            className="absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-white px-2 py-0.5 text-[11.5px] font-semibold text-black"
            style={{ left: pct(hover, total) }}
          >
            {t('timeline.at', { unit: word, page: hover })}
            {hover > read && <span className="ml-1 font-normal text-black/50">· {t('timeline.soon')}</span>}
          </div>
        )}
      </div>
      {/* The slider already says it to a screen reader. */}
      <span aria-hidden data-testid="timeline-count" className="shrink-0 text-[12px] tabular-nums text-quiet">
        {t('timeline.count', { page: at, total })}
      </span>
    </div>
  );
}
