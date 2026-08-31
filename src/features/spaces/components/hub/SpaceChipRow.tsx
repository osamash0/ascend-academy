import { useEffect, useRef } from 'react';
import { Compass, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { Space } from '../../types';
import { coverFor } from '../../mocks/covers';
import { PRESS_SPRING } from '../Pressable';

/**
 * "Your spaces" — the chip row pinned to the bottom of the hero.
 *
 * This is the page's control surface: *chip row selects → hero reacts → rails
 * discover*. Everything above it is a reaction to what is selected here.
 *
 * **Hover selects, after 140ms.** Without the debounce, dragging the pointer
 * across the row fires a selection per chip and the hero strobes through five
 * Spaces. With it, crossing chips costs nothing and resting on one commits.
 * Click and the arrow keys bypass the delay entirely — those are deliberate.
 *
 * The chips are buttons, not links. They select; they do not navigate. The
 * hero's pill is what navigates, and the spec's whole structure depends on
 * that separation — a link here would take you off the page you are browsing.
 *
 * Arrow keys are on the row rather than the window: a global handler would
 * steal ←/→ from every text field on the page, and the row is focusable, so
 * this is the standard listbox behaviour and not a shortcut.
 */

export const DISCOVER_ID = 'discover';

export function SpaceChipRow({
  spaces,
  selected,
  onSelect,
}: {
  spaces: Space[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const hoverTimer = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const order = [...spaces.map((s) => s.id), DISCOVER_ID];

  /** Hover is a suggestion; 140ms of it is a decision. */
  const hoverSelect = (id: string) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => onSelect(id), 140);
  };
  const cancelHover = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  };

  // A pending hover must not fire after the row is gone.
  useEffect(() => cancelHover, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = order.indexOf(selected);
    if (e.key === 'ArrowRight' && i < order.length - 1) {
      e.preventDefault();
      cancelHover();
      onSelect(order[i + 1]);
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      cancelHover();
      onSelect(order[i - 1]);
    }
  };

  // Keep the selected chip in view when the arrows walk past the edge.
  useEffect(() => {
    rowRef.current
      ?.querySelector(`[data-chip="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  return (
    <div className="pb-[34px]">
      <p className="mb-[14px] text-[13.5px] text-white/[0.62]">Your spaces</p>
      <div
        ref={rowRef}
        role="listbox"
        aria-label="Your spaces"
        aria-orientation="horizontal"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseLeave={cancelHover}
        className={cn(
          'console-focusable flex gap-[14px] overflow-x-auto px-[2px] py-1',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {spaces.map((s) => {
          const isSelected = s.id === selected;
          return (
            <motion.button
              key={s.id}
              type="button"
              data-chip={s.id}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                cancelHover();
                onSelect(s.id);
              }}
              onMouseEnter={() => hoverSelect(s.id)}
              onFocus={() => onSelect(s.id)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              transition={PRESS_SPRING}
              className={cn(
                'relative h-[88px] w-[158px] flex-none overflow-hidden rounded-[10px] text-left',
                'bg-[rgba(14,16,20,0.72)] outline-offset-[3px]',
                // Selection is a thin white outline. Nothing else.
                isSelected ? 'outline outline-[1.5px] outline-white/90' : 'outline-none',
              )}
            >
              <div
                aria-hidden
                className={cn(
                  'absolute inset-0 transition-opacity duration-150',
                  isSelected ? 'opacity-[0.85]' : 'opacity-50',
                )}
                style={{ background: coverFor(s.id) }}
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(0deg,rgba(6,7,9,.78) 0%,rgba(6,7,9,.1) 60%)',
                }}
              />

              {/* Private is a lock. The one icon on a chip. */}
              {s.visibility !== 'public' && (
                <Lock
                  aria-hidden
                  className="absolute left-3 top-[10px] z-[2] h-4 w-4 text-white/[0.62]"
                />
              )}

              {/*
                Unread is the only place green appears on this row, and the
                only thing it ever means. `newSinceLastVisit` is the one
                definition of "new" in this product.
              */}
              {s.newSinceLastVisit > 0 && (
                <span
                  aria-hidden
                  className="absolute right-[10px] top-[10px] z-[2] h-2 w-2 rounded-full bg-[#57d98a] ring-[3px] ring-[rgba(6,7,9,.5)]"
                />
              )}

              <span
                className={cn(
                  'absolute bottom-[9px] left-3 right-[10px] z-[2] truncate text-[12.5px] font-medium',
                  isSelected ? 'text-white' : 'text-white/[0.62]',
                )}
              >
                {s.name}
              </span>
              {s.newSinceLastVisit > 0 && (
                <span className="sr-only">
                  {s.newSinceLastVisit} new {s.newSinceLastVisit === 1 ? 'Lesson' : 'Lessons'}
                </span>
              )}
            </motion.button>
          );
        })}

        {/*
          Discover is the last chip and reads as an action, not a Space: no
          cover, brighter fill, centred label. The spec asks for it to be
          "clearly an action" — a dimmed cover would make it look like one more
          thing you are already in.
        */}
        <motion.button
          type="button"
          data-chip={DISCOVER_ID}
          role="option"
          aria-selected={selected === DISCOVER_ID}
          onClick={() => {
            cancelHover();
            onSelect(DISCOVER_ID);
          }}
          onMouseEnter={() => hoverSelect(DISCOVER_ID)}
          onFocus={() => onSelect(DISCOVER_ID)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.98 }}
          transition={PRESS_SPRING}
          className={cn(
            'relative flex h-[88px] w-[158px] flex-none flex-col items-center justify-center gap-2',
            'rounded-[10px] bg-white/[0.13] shadow-[inset_0_0_0_1px_rgba(255,255,255,.22)]',
            'outline-offset-[3px] hover:bg-white/20',
            selected === DISCOVER_ID
              ? 'outline outline-[1.5px] outline-white/90'
              : 'outline-none',
          )}
        >
          <Compass aria-hidden className="h-[22px] w-[22px] text-white" />
          <span className="text-[12.5px] font-semibold text-white">Discover spaces</span>
        </motion.button>
      </div>
    </div>
  );
}
