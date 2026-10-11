import { Fragment, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, MoreHorizontal, Share2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { lifeLine, type ShelfItem } from '../studio/shelf';
import { FLIGHT_EASE } from '../studio/motion';
import { shelfSpaceName, shelfActions, useCoverTitle, useGlance } from '../data/useShelf';
import { useDeveloping } from './BringIn';
import { ShareSheet } from './ShareSheet';
import { useZoomThrough } from './ZoomThrough';

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

const coverLabel = (item: ShelfItem, title: string): string =>
  [title, stateLabel(item), ...lifeLine(item)].join(', ');

const SMALL_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'the', 'to']);

/** Two letters for a text tile: "Change of Basis" → "CB", "Determinants" → "De". */
const titleInitials = (title: string): string => {
  const words = title.split(/\s+/).filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return title.trim().charAt(0).toUpperCase();
  if (words.length === 1) return words[0].charAt(0).toUpperCase() + words[0].charAt(1).toLowerCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
};

/**
 * A quiet tint for a text tile, the same for every tile of one Space: white at
 * one of four low strengths, so the monochrome brand holds and no hue appears.
 */
const spaceTint = (spaceId: string): number => {
  let h = 0;
  for (const ch of spaceId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [0.03, 0.05, 0.07, 0.09][h % 4];
};

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
export function LifeBar({
  read,
  total,
  developing = false,
}: {
  read: number;
  total: number;
  /** A file being read: the bar runs 0 → 100% across the development, then rests at the real count. */
  developing?: boolean;
}) {
  const reduce = useReducedMotion();
  const pct = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;
  const width = developing ? '100%' : `${pct}%`;
  return (
    <div aria-hidden className="h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
      {/* Reduced motion: the bar is simply where it belongs, and fades in — its width never runs. */}
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-[rgb(159,211,199)] to-[rgb(159,211,199,0.4)]"
        initial={reduce ? { width, opacity: 0 } : { width: 0 }}
        animate={{ width, opacity: 1 }}
        transition={
          reduce
            ? { width: { duration: 0 }, opacity: { duration: 0.15 } }
            : developing
              ? { duration: 3.3, ease: 'linear' }
              : { duration: 0.6, ease: FLIGHT_EASE }
        }
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

function StateChip({ item, pulse }: { item: ShelfItem; pulse: boolean }) {
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
    <motion.span
      key={pulse ? 'ready' : 'rest'}
      className={cn(
        'mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px]',
        item.stage === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-white/[0.07] text-quiet',
      )}
      animate={pulse && !reduce ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={{ duration: 0.5, ease: FLIGHT_EASE }}
    >
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
      <span className="truncate">
        {stateLabel(item)}
        {pulse && ' · ready'}
      </span>
      {s.kind === 'shared' && item.stage === 'ready' && (
        <>
          {s.likes > 0 && <span className="shrink-0 tabular-nums">♥ {s.likes}</span>}
          {s.endorsed && <span className="shrink-0">Endorsed</span>}
        </>
      )}
    </motion.span>
  );
}

function CoverMenu({ item, onRemove }: { item: ShelfItem; onRemove?: () => void }) {
  const [sharing, setSharing] = useState(false);
  const { filename } = item;
  return (
    <>
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
        <DropdownMenuItem
          disabled={item.stage !== 'ready'}
          onSelect={() => setSharing(true)}
          className="gap-2 rounded-lg text-[13px]"
        >
          <Share2 aria-hidden className="h-3.5 w-3.5" />
          Share
        </DropdownMenuItem>
        {/* Remove, with its confirm and Undo, lives in Select: one place for the one destructive act. */}
        {onRemove && (
          <DropdownMenuItem onSelect={onRemove} className="gap-2 rounded-lg text-[13px]">
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            Remove…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <ShareSheet item={item} open={sharing} onOpenChange={setSharing} />
    </>
  );
}

export function Cover({
  item,
  select,
  onRemove,
}: {
  item: ShelfItem;
  /** Select (spec §5.8): the cover is a checkable tile and its link is inert. */
  select?: { checked: boolean; onToggle: () => void };
  /** "Remove…" from the menu: into Select, with this cover checked. */
  onRemove?: () => void;
}) {
  const reduce = useReducedMotion();
  const { title, lessonTitle } = useCoverTitle(item);
  const { lines } = useGlance(item);
  const [glancing, setGlancing] = useState(false);
  const fade = { duration: reduce ? 0.15 : 0.6, ease: FLIGHT_EASE };
  const showLines = glancing && !!item.cover && lines.length > 0 && item.stage === 'ready';
  const developing = item.stage === 'developing';
  /* Only what you brought in this visit develops in front of you; a seeded file is simply still being prepared. */
  const live = developing && !!item.broughtIn;
  const { phase, pulse } = useDeveloping(item);
  /* A cover that arrives developing comes in with a scale and a fade (a fade alone when motion is reduced). */
  const [enter] = useState(() =>
    live ? (reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }) : false,
  );
  const devLook = reduce
    ? { opacity: 0.5, filter: 'blur(0px) grayscale(0)' }
    : phase === 'writing'
      ? { opacity: 0.8, filter: 'blur(5px) grayscale(0.4)' }
      : { opacity: 0.5, filter: 'blur(14px) grayscale(1)' };
  const imgFade = { duration: reduce ? 0.15 : live || pulse ? 1.4 : 0.6, ease: FLIGHT_EASE };
  /* Open: the page frame grows to the window, then the page takes over (spec §5.4). */
  const zoom = useZoomThrough();
  const frameRef = useRef<HTMLDivElement>(null);
  const href = `/v4/library/m/${item.id}`;
  const tint = item.opens.kind === 'lesson' ? spaceTint(item.opens.spaceId) : null;

  const body = (
    <>
      <div
        ref={frameRef}
        className={cn(
          'relative aspect-[4/3] overflow-hidden',
          item.cover ? 'bg-[#f7f6f2]' : !tint && 'bg-white/[0.04]',
        )}
        style={!item.cover && tint ? { backgroundColor: `rgba(255,255,255,${tint})` } : undefined}
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
                ? devLook
                : showLines
                  ? { opacity: 0, filter: reduce ? 'blur(0px) grayscale(0)' : 'blur(5px) grayscale(0)' }
                  : { opacity: 1, filter: 'blur(0px) grayscale(0)' }
            }
            transition={live || pulse ? imgFade : fade}
          />
        ) : (
          /*
            No page yet: a quiet tile. A Lesson's gives its title's initials,
            on its Space's tint, so two of them never look the same.
          */
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center text-[64px] font-medium leading-none tracking-[-0.04em] text-quiet"
          >
            {lessonTitle ? titleInitials(lessonTitle) : item.filename.trim().charAt(0).toUpperCase()}
          </div>
        )}
        {live && (
          <p
            aria-hidden
            className="absolute inset-x-0 bottom-2.5 text-center text-[12px] font-semibold tracking-[0.01em] text-[#222]"
          >
            {phase === 'writing' ? 'Writing your summary…' : 'Reading your pages…'}
          </p>
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
              {lines.map((l, i) => (
                <p key={i}>
                  <Terms text={l} />
                </p>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-3.5 pb-3.5 pt-3">
        <p className="truncate text-[14.5px] font-medium text-foreground">{title}</p>
        {/*
          Where it lives is the chip's to say ("Only you", "Shared in …"); the
          meta line carries the rest, so no fact is printed twice on a cover.
        */}
        <p className="mt-0.5 text-[12.5px] text-faint">
          {pagesLabel(item.pageCount)}
          {item.sample && <span className="ml-2 rounded-full bg-white/[0.07] px-2 py-px text-[11px]">Sample pages</span>}
        </p>
        <div className="mt-2.5">
          <LifeBar read={item.progress.pagesRead} total={item.pageCount} developing={live} />
        </div>
        <LifeLine item={item} className="mt-2" />
        <StateChip item={item} pulse={pulse} />
      </div>
    </>
  );

  return (
    <motion.div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white/[0.03] transition-colors',
        select?.checked ? 'border-white/60' : 'border-white/[0.09] hover:border-white/20',
      )}
      initial={enter}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={reduce || select ? undefined : { y: -3 }}
      transition={{ duration: 0.35, ease: FLIGHT_EASE }}
    >
      {select ? (
        /* Selecting: the link is gone, so a click anywhere on the tile checks it; the checkbox is the control. */
        <div className="block flex-1 cursor-pointer rounded-2xl" onClick={select.onToggle}>
          {body}
        </div>
      ) : (
        <Link
          to={href}
          aria-label={coverLabel(item, title)}
          onClick={(e) => zoom?.(e, href, { frame: frameRef.current, src: item.cover })}
          className="console-focusable block flex-1 rounded-2xl"
          onMouseEnter={() => setGlancing(true)}
          onMouseLeave={() => setGlancing(false)}
          onFocus={() => setGlancing(true)}
          onBlur={() => setGlancing(false)}
        >
          {body}
        </Link>
      )}

      {select && (
        <button
          type="button"
          role="checkbox"
          aria-checked={select.checked}
          aria-label={coverLabel(item, title)}
          onClick={select.onToggle}
          className={cn(
            'console-focusable absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg border transition-colors',
            select.checked
              ? 'border-white bg-white text-black'
              : 'border-white/50 bg-black/55 text-transparent backdrop-blur-sm hover:border-white',
          )}
        >
          <Check aria-hidden className="h-4 w-4" />
        </button>
      )}

      {!select && item.stage === 'failed' && (
        <div className="px-3.5 pb-3.5">
          <button
            type="button"
            onClick={() => shelfActions.retryDeveloping(item.id)}
            className="console-focusable h-8 rounded-full border border-white/15 px-3.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-white/[0.07]"
          >
            Try again
          </button>
        </div>
      )}

      {!select && (
        <div className="absolute right-2 top-2 z-10">
          <CoverMenu item={item} onRemove={onRemove} />
        </div>
      )}
    </motion.div>
  );
}
