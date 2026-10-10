import { motion } from 'motion/react';
import { FileText, Sparkles } from 'lucide-react';
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

const option = 'relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium';

/** Clean | Original — spec §4.2. Press-and-hold is a quick look; a tap stays. */
export function MorphSwitch({ view, shown, onPressStart, onPressEnd, onPressCancel, onToggle }: Props) {
  const original = view === 'original';
  return (
    <div className="flex items-center gap-2">
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
        className="relative flex select-none items-center rounded-full border border-border bg-card p-0.5"
      >
        {(['clean', 'original'] as const).map((v) => (
          <span key={v} className={cn(option, shown === v ? 'text-foreground' : 'text-muted-foreground')}>
            {shown === v && (
              <motion.span
                layoutId="studio-switch-thumb"
                className="absolute inset-0 -z-10 rounded-full bg-muted"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            {v === 'clean' ? <Sparkles aria-hidden className="h-3.5 w-3.5" /> : <FileText aria-hidden className="h-3.5 w-3.5" />}
            {v === 'clean' ? 'Clean' : 'Original'}
          </span>
        ))}
      </button>
      <kbd aria-hidden className="hidden rounded border border-border px-1.5 text-[11px] text-muted-foreground md:inline">
        O
      </kbd>
      <span className="sr-only" aria-live="polite">
        {original ? 'Showing original' : 'Showing clean version'}
      </span>
    </div>
  );
}
