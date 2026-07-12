import { motion, type Transition } from 'framer-motion';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CARD_H, CARD_W, STEP } from './constants';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel";

// Default cover-flow motion (snappy). Callers can override via `transition`.
const DEFAULT_TRANSITION: Transition = { type: 'spring', stiffness: 260, damping: 30 };

export interface RailTileState {
  isActive: boolean;
  offset: number;
  dist: number;
  index: number;
}

interface MediaRailProps<T> {
  items: T[];
  focused: number;
  onFocus: (index: number) => void;
  onActivate?: (item: T, index: number) => void;
  /** Renders the inner cover content for an item (usually a <ConsoleTile/>). */
  renderTile: (item: T, state: RailTileState) => ReactNode;
  getKey: (item: T, index: number) => string;
  getAriaLabel?: (item: T, index: number) => string;
  cardWidth?: number;
  cardHeight?: number;
  step?: number;
  /** When true, ←/→ browse and Enter activates the focused item. */
  enableKeyboard?: boolean;
  /** Override the cover-flow focus animation (e.g. a slower, calmer glide). */
  transition?: Transition;
  className?: string;
}

/**
 * Horizontal "cover-flow" carousel: the focused item is centered and full-size;
 * neighbors shrink, dim and blur with distance. Supports click-to-focus,
 * click-active-to-activate, wheel scroll, on-screen chevrons and optional
 * keyboard navigation. Visuals/motion match the original library carousel.
 */
export function MediaRail<T>({
  items,
  focused,
  onFocus,
  onActivate,
  renderTile,
  getKey,
  getAriaLabel,
  cardWidth = CARD_W,
  cardHeight = CARD_H,
  step = STEP,
  enableKeyboard = false,
  transition = DEFAULT_TRANSITION,
  className,
}: MediaRailProps<T>) {
  const count = items.length;
  const [api, setApi] = useState<CarouselApi>();

  // Sync parent's focused index -> carousel
  useEffect(() => {
    if (!api) return;
    if (api.selectedScrollSnap() !== focused) {
      api.scrollTo(focused);
    }
  }, [api, focused]);

  // Sync carousel -> parent's focused index
  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      onFocus(api.selectedScrollSnap());
    };
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api, onFocus]);

  const move = useCallback(
    (dir: number) => onFocus(Math.min(Math.max(focused + dir, 0), count - 1)),
    [focused, count, onFocus]
  );

  useEffect(() => {
    if (!enableKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter' && onActivate && items[focused]) {
        e.preventDefault();
        onActivate(items[focused], focused);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableKeyboard, move, onActivate, items, focused]);

  if (count === 0) return null;

  return (
    <Carousel
      setApi={setApi}
      className={cn('relative w-full max-w-[100vw]', className)}
      opts={{
        align: "center",
        containScroll: false,
        dragFree: false,
      }}
    >
      <CarouselContent className="h-[280px] items-center">
        {items.map((item, i) => {
          const offset = i - focused;
          const dist = Math.abs(offset);
          const isActive = offset === 0;

          return (
            <CarouselItem key={getKey(item, i)} className="basis-auto pl-4 md:pl-8">
              <motion.button
                className="console-focusable origin-center rounded-2xl outline-none"
                style={{ width: cardWidth, height: cardHeight, zIndex: 100 - dist }}
                animate={{
                  scale: isActive ? 1 : 0.74,
                  opacity: dist > 2 ? 0.3 : isActive ? 1 : 0.45,
                  filter: isActive ? 'blur(0px)' : 'blur(1.5px)',
                }}
                transition={transition}
                onClick={() => (isActive ? onActivate?.(item, i) : onFocus(i))}
                tabIndex={isActive ? 0 : -1}
                aria-label={getAriaLabel?.(item, i)}
              >
                {renderTile(item, { isActive, offset, dist, index: i })}
              </motion.button>
            </CarouselItem>
          );
        })}
      </CarouselContent>
      <div className="absolute top-1/2 -translate-y-1/2 left-4 lg:left-12 z-[120]">
        <CarouselPrevious className="relative static translate-x-0 translate-y-0 flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 backdrop-blur hover:bg-white/15 hover:text-white transition border-none" />
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 right-4 lg:right-12 z-[120]">
        <CarouselNext className="relative static translate-x-0 translate-y-0 flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 backdrop-blur hover:bg-white/15 hover:text-white transition border-none" />
      </div>
    </Carousel>
  );
}
