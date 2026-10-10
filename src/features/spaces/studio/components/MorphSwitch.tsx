import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { CanvasView } from '../useMorph';

interface Props {
  /** The committed choice — what the switch announces. */
  view: CanvasView;
  /** What is on screen — differs from `view` during a quick look; drives the visuals only. */
  shown: CanvasView;
  onPressStart(): void;
  onPressEnd(): void;
  onPressCancel(): void;
  /** Keyboard on the switch itself: Enter/Space toggles and stays. */
  onToggle(): void;
}

const VIEWS = [
  { id: 'clean', label: 'Clean' },
  { id: 'original', label: 'Original' },
] as const;

/**
 * Clean | Original — spec §4.2. Press-and-hold is a quick look; a tap stays.
 *
 * Dressed as the reader's face tablist (a white pill sliding on a quiet
 * track), but it stays one `switch`: two faces of one Material, one control.
 */
export function MorphSwitch({ view, shown, onPressStart, onPressEnd, onPressCancel, onToggle }: Props) {
  const original = view === 'original';
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-2">
      <kbd aria-hidden className="hidden h-6 min-w-6 items-center justify-center rounded-md bg-[rgb(var(--studio-chip))] px-1.5 text-[11px] text-faint md:inline-flex">
        O
      </kbd>
      <button
        type="button"
        role="switch"
        aria-checked={original}
        aria-label="Show original"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          onPressStart();
        }}
        onPointerUp={onPressEnd}
        onPointerCancel={onPressCancel}
        onLostPointerCapture={onPressCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!e.repeat) onToggle();
          }
        }}
        className="console-focusable relative flex select-none rounded-full bg-[rgb(var(--studio-chip))] p-1"
      >
        {VIEWS.map((v) => {
          const on = shown === v.id;
          return (
            <span
              key={v.id}
              className={cn(
                'relative flex h-8 items-center rounded-full px-4 text-[13px] transition-colors',
                on ? 'text-background' : 'text-quiet hover:text-foreground',
              )}
            >
              {on && (
                <motion.span
                  layoutId="studio-switch-thumb"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }}
                  className="absolute inset-0 rounded-full bg-foreground"
                />
              )}
              <span className="relative">{v.label}</span>
            </span>
          );
        })}
      </button>
      <span className="sr-only" aria-live="polite">
        {original ? 'Showing original' : 'Showing clean version'}
      </span>
    </div>
  );
}
