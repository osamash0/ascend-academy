import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MoreHorizontal, Share2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { lifeLine, type ShelfItem } from '../studio/shelf';
import { FLIGHT_EASE } from '../studio/motion';
import { shelfSpaceName, useGlance } from '../data/useShelf';

/**
 * A cover on the shelf (One Library spec §5.2): the real first page, its name,
 * where it lives, how far you are, and its state, all as one link. The menu is
 * a separate button so the link stays one target.
 */

/** Studio's colours, written out: the shelf stands on the stage, not the canvas surface. */
const SHELF_TONE = {
  term: 'text-[rgb(243,231,201)]',
  teal: 'bg-[rgb(159,211,199)]',
  amber: 'bg-[rgb(239,159,39)]',
} as const;

/** What the chip says, and what the cover's name says after the filename. */
function stateLabel(item: ShelfItem): string {
  if (item.stage === 'developing') return 'Developing…';
  if (item.stage === 'failed') return 'Couldn’t read this file';
  const s = item.share;
  if (s.kind === 'draft') return `Draft in ${shelfSpaceName(s.spaceId)}`;
  if (s.kind === 'shared') return `Shared in ${shelfSpaceName(s.spaceId)}`;
  return 'Only you';
}

const coverLabel = (item: ShelfItem): string =>
  [item.filename, stateLabel(item), ...lifeLine(item)].join(', ');

const pagesLabel = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`;

/** `**term**` → the warm term colour; everything else as written. */
export function Terms({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <b key={i} className={cn('font-medium', SHELF_TONE.term)}>
            {part.slice(2, -2)}
          </b>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** The 3px life bar: pages read of pages. */
export function LifeBar({ read, total }: { read: number; total: number }) {
  const reduce = useReducedMotion();
  const pct = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;
  return (
    <div aria-hidden className="h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-[rgb(159,211,199)] to-[rgb(159,211,199,0.4)]"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduce ? 0.15 : 0.6, ease: FLIGHT_EASE }}
      />
    </div>
  );
}

/** "Read 6/12 · Recall 9/31 · 2 answers · 1 note" — zeros left out. */
export function LifeLine({ item, className }: { item: ShelfItem; className?: string }) {
  const parts = lifeLine(item);
  if (parts.length === 0) return null;
  return (
    <p className={cn('flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-quiet', className)}>
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
    </p>
  );
}

function StateChip({ item }: { item: ShelfItem }) {
  const reduce = useReducedMotion();
  const s = item.share;
  const dot =
    item.stage === 'failed'
      ? 'bg-red-400'
      : item.stage === 'developing'
        ? 'bg-white/40'
        : s.kind === 'draft'
          ? SHELF_TONE.amber
          : s.kind === 'shared'
            ? SHELF_TONE.teal
            : 'bg-white';
  return (
    <span className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-[3px] text-[11.5px] text-quiet">
      <motion.span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)}
        animate={item.stage === 'developing' && !reduce ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
        transition={
          item.stage === 'developing' && !reduce
            ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.15 }
        }
      />
      <span className="truncate">{stateLabel(item)}</span>
      {s.kind === 'shared' && item.stage === 'ready' && (
        <>
          {s.likes > 0 && <span className="shrink-0 tabular-nums">♥ {s.likes}</span>}
          {s.endorsed && <span className="shrink-0">Endorsed</span>}
        </>
      )}
    </span>
  );
}

function CoverMenu({ filename }: { filename: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`More for ${filename}`}
          className="console-focusable flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-foreground backdrop-blur-sm transition-colors hover:bg-black/75"
        >
          <MoreHorizontal aria-hidden className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[10rem] rounded-xl border-white/10 bg-[#0b0b0b] p-1 text-foreground"
      >
        {/* Wired by the Share sheet and Remove-with-undo (One Library Tasks 6 and 7). */}
        <DropdownMenuItem disabled className="gap-2 rounded-lg text-[13px]">
          <Share2 aria-hidden className="h-3.5 w-3.5" />
          Share
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="gap-2 rounded-lg text-[13px]">
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Cover({ item }: { item: ShelfItem }) {
  const reduce = useReducedMotion();
  const { lines } = useGlance(item);
  const [glancing, setGlancing] = useState(false);
  const fade = { duration: reduce ? 0.15 : 0.6, ease: FLIGHT_EASE };
  const showLines = glancing && !!item.cover && lines.length > 0 && item.stage === 'ready';
  const developing = item.stage === 'developing';

  return (
    <motion.div
      className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.03] transition-colors hover:border-white/20"
      whileHover={reduce ? undefined : { y: -3 }}
      transition={{ duration: 0.35, ease: FLIGHT_EASE }}
    >
      <Link
        to={`/v4/library/m/${item.id}`}
        aria-label={coverLabel(item)}
        className="console-focusable block h-full rounded-2xl"
        onMouseEnter={() => setGlancing(true)}
        onMouseLeave={() => setGlancing(false)}
        onFocus={() => setGlancing(true)}
        onBlur={() => setGlancing(false)}
      >
        <div
          className={cn(
            'relative aspect-[4/3] overflow-hidden',
            item.cover ? 'bg-[#f7f6f2]' : 'bg-white/[0.04]',
          )}
        >
          {item.cover ? (
            <motion.img
              src={item.cover}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover object-left-top"
              initial={false}
              animate={
                developing
                  ? { opacity: 0.5, filter: 'blur(14px) grayscale(1)' }
                  : showLines
                    ? { opacity: 0, filter: reduce ? 'blur(0px) grayscale(0)' : 'blur(5px) grayscale(0)' }
                    : { opacity: 1, filter: 'blur(0px) grayscale(0)' }
              }
              transition={fade}
            />
          ) : (
            /* No page yet: a quiet tile with the file's initial. */
            <div
              aria-hidden
              className="flex h-full w-full items-center justify-center text-[64px] font-medium leading-none tracking-[-0.04em] text-quiet"
            >
              {item.filename.trim().charAt(0).toUpperCase()}
            </div>
          )}
          <AnimatePresence>
            {showLines && (
              <motion.div
                key="lines"
                data-testid="glance"
                className="absolute inset-0 space-y-2 overflow-hidden bg-[#0b0b0b] px-4 py-3.5 text-[12.5px] leading-relaxed text-quiet"
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

        <div className="px-3.5 pb-3.5 pt-3">
          <p className="truncate text-[14.5px] font-medium text-foreground">{item.filename}</p>
          {/*
            Where it lives is the chip's to say ("Only you", "Shared in …"); the
            meta line carries the rest, so no fact is printed twice on a cover.
          */}
          <p className="mt-0.5 text-[12.5px] text-faint">{pagesLabel(item.pageCount)}</p>
          <div className="mt-2.5">
            <LifeBar read={item.progress.pagesRead} total={item.pageCount} />
          </div>
          <LifeLine item={item} className="mt-2" />
          <StateChip item={item} />
        </div>
      </Link>

      <div className="absolute right-2 top-2 z-10">
        <CoverMenu filename={item.filename} />
      </div>
    </motion.div>
  );
}
