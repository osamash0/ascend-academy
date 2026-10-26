import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { Space } from '../../types';
import { PRESS_SPRING } from '../Pressable';
import { Planet, planetSize } from '../sky/Planet';
import { planetOf, StarCluster } from './HeroCover';

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
 *
 * **Planets, not tiles** (2026-10-26). Each Space is its planet, sized by how
 * many Lessons it holds, with its name under it. One fact once: no counts and
 * no progress numbers here — the moons already show both. The only second
 * line is one nothing else on the row says: that a Space is invite only.
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
  const { t } = useTranslation('v4Spaces');
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
      <p className="mb-[14px] text-[13.5px] text-quiet">{t('hub.chips.yours')}</p>
      <div
        ref={rowRef}
        role="listbox"
        aria-label={t('hub.chips.yours')}
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
          const isPrivate = s.visibility !== 'public';
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
                'relative flex w-[128px] flex-none flex-col items-center rounded-[12px] px-2 pb-2 pt-1 text-center',
                'outline-offset-[3px]',
                // Selection is a thin white outline. Nothing else.
                isSelected ? 'outline outline-[1.5px] outline-white/90' : 'outline-none',
              )}
            >
              {/*
                Motion, not `transition-opacity`. Opacity is the library's to
                animate — a CSS transition sails past
                `MotionConfig reducedMotion="user"` and animates for people who
                asked the OS for less. `initial={false}` so the planets do not
                all fade in on mount.
              */}
              <motion.span
                aria-hidden
                initial={false}
                animate={{ opacity: isSelected ? 1 : 0.62 }}
                transition={{ duration: 0.15 }}
                className="flex h-[84px] w-full items-center justify-center"
              >
                <Planet size={planetSize(s.lessonCount, 36, 72)} {...planetOf(s)} />
              </motion.span>

              {/*
                Unread is the only place green appears on this row, and the
                only thing it ever means. `newSinceLastVisit` is the one
                definition of "new" in this product.
              */}
              {s.newSinceLastVisit > 0 && (
                <span
                  aria-hidden
                  className="absolute right-[10px] top-[8px] z-[2] h-2 w-2 rounded-full bg-[#57d98a] ring-[3px] ring-black/50"
                />
              )}

              <span
                className={cn(
                  'block w-full truncate text-[12.5px] font-medium',
                  isSelected ? 'text-white' : 'text-quiet',
                )}
              >
                {s.name}
              </span>
              {isPrivate && (
                <span className="mt-0.5 block w-full truncate text-[11.5px] text-label">
                  {t('hub.cards.inviteOnlyShort')}
                </span>
              )}
              {s.newSinceLastVisit > 0 && (
                <span className="sr-only">
                  {t('hub.chips.newLessons', { count: s.newSinceLastVisit })}
                </span>
              )}
            </motion.button>
          );
        })}

        {/*
          Discover is the last entry and reads as somewhere to go, not a
          Space: no planet, a loose cluster of stars — everything out there
          you have not visited yet.
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
            'relative flex w-[128px] flex-none flex-col items-center rounded-[12px] px-2 pb-2 pt-1 text-center',
            'outline-offset-[3px]',
            selected === DISCOVER_ID
              ? 'outline outline-[1.5px] outline-white/90'
              : 'outline-none',
          )}
        >
          <span aria-hidden className="flex h-[84px] w-full items-center justify-center">
            <StarCluster seed="discover-chip" className="h-auto w-[88px]" />
          </span>
          <span
            className={cn(
              'block w-full truncate text-[12.5px] font-medium',
              selected === DISCOVER_ID ? 'text-white' : 'text-quiet',
            )}
          >
            {t('hub.chips.discover')}
          </span>
        </motion.button>
      </div>
    </div>
  );
}
