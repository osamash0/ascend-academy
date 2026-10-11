import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import type { ShelfItem } from '../studio/shelf';
import { FLIGHT_EASE, FLIGHT_S } from '../studio/motion';
import { useGlance } from '../data/useShelf';
import { LifeBar, LifeLine, Terms } from './Cover';
import { useZoomThrough } from './ZoomThrough';

/**
 * Continue (spec §5.1): the most recently opened page, where you left it.
 * Hovering or focusing the page turns it into its summary: the Morph motif at
 * shelf scale. The whole card is one link; the pill is its label, not a button.
 */
export function ContinueCard({ item }: { item: ShelfItem }) {
  const reduce = useReducedMotion();
  const page = item.lastPage ?? undefined;
  const { image, lines } = useGlance(item, page);
  const [glancing, setGlancing] = useState(false);
  const fade = { duration: reduce ? 0.15 : FLIGHT_S, ease: FLIGHT_EASE };
  const showLines = glancing && lines.length > 0;
  /* Open: the page you left grows to the window, then the page takes over (spec §5.4). */
  const zoom = useZoomThrough();
  const frameRef = useRef<HTMLDivElement>(null);
  const href = `/v4/library/m/${item.id}`;

  return (
    <Link
      to={href}
      onClick={(e) => zoom?.(e, href, { frame: frameRef.current, src: image })}
      aria-label={`Continue reading ${item.filename}${page !== undefined ? `, page ${page} of ${item.pageCount}` : ''}`}
      className="console-focusable group grid items-center gap-[22px] rounded-[22px] border border-white/[0.09] bg-white/[0.025] p-[18px] transition-colors hover:border-white/[0.16] md:grid-cols-[1.15fr_1fr]"
      onMouseEnter={() => setGlancing(true)}
      onMouseLeave={() => setGlancing(false)}
      onFocus={() => setGlancing(true)}
      onBlur={() => setGlancing(false)}
    >
      <div ref={frameRef} className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-[#f7f6f2]">
        {image && (
          <motion.img
            src={image}
            alt=""
            className="h-full w-full object-cover object-left-top"
            initial={false}
            animate={
              showLines
                ? { opacity: 0, filter: reduce ? 'blur(0px)' : 'blur(6px)' }
                : { opacity: 1, filter: 'blur(0px)' }
            }
            transition={fade}
          />
        )}
        <AnimatePresence>
          {showLines && (
            <motion.div
              key="glance"
              data-testid="glance"
              className="absolute inset-0 space-y-3 overflow-hidden bg-[#0b0b0b] p-[22px] text-[14.5px] leading-[1.7] text-quiet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            >
              {lines.map((l) => (
                <p key={l}>
                  <Terms text={l} />
                </p>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="min-w-0 px-1 pb-1 md:px-0 md:pb-0">
        <p className="text-[13px] text-quiet">
          Pick up where you left off
          {page !== undefined && ` · page ${page} of ${item.pageCount}`}
        </p>
        <h2 className="mt-1.5 truncate text-[22px] font-medium tracking-[-0.01em] text-foreground">
          {item.filename}
        </h2>
        <div className="mt-3">
          <LifeBar read={item.progress.pagesRead} total={item.pageCount} />
        </div>
        <LifeLine item={item} className="mt-3" />
        <span className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-white px-[18px] text-[14px] font-semibold text-slate-900">
          Continue reading
          <ArrowRight aria-hidden className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
