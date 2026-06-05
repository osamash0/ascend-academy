/**
 * LectureSidebar — the slide timeline for the lecture player.
 *
 * Visual states per slide node:
 *   visited   — green checkmark (student navigated through it)
 *   skipped   — amber dashed border + skip icon (jumped past it)
 *   current   — primary glow + pulsing aura (where they are now)
 *   unvisited — muted grey (not yet reached)
 *
 * The filled progress track reflects actual `visited` count, not position.
 * Skipped slides are clearly distinct so students know gaps remain.
 */
import { useEffect, useRef, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  SkipForward,
  CheckSquare,
  RotateCcw,
  Star,
} from 'lucide-react';
import type { SlideState } from '@/types/domain';

interface Slide {
  id: string;
  slide_number: number;
  title: string | null;
}

type DisplayState = 'visited' | 'skipped' | 'current' | 'unvisited';

function getDisplayState(
  slideNumber: number,
  index: number,
  currentSlideIndex: number,
  slideStates: Record<string, SlideState>,
): DisplayState {
  if (index === currentSlideIndex) return 'current';
  const s = slideStates[String(slideNumber)];
  if (s === 'visited') return 'visited';
  if (s === 'skipped') return 'skipped';
  return 'unvisited';
}

// ─── Per-slide connector segment ─────────────────────────────────────────────

function ConnectorSegment({ above }: { above: DisplayState }) {
  if (above === 'visited') {
    return (
      <div className="absolute left-[31px] -top-2 w-[1px] h-2 bg-success/50 z-0" />
    );
  }
  if (above === 'skipped') {
    return (
      <div
        className="absolute left-[31px] -top-2 w-[1px] h-2 z-0"
        style={{ borderLeft: '1px dashed rgba(251,191,36,0.4)' }}
      />
    );
  }
  // current or unvisited
  return <div className="absolute left-[31px] -top-2 w-[1px] h-2 bg-white/5 z-0" />;
}

// ─── Individual slide item ────────────────────────────────────────────────────

const SlideItem = memo(function SlideItem({
  slide,
  index,
  displayState,
  isFirst,
  aboveState,
  onSelect,
  onValidate,
}: {
  slide: Slide;
  index: number;
  displayState: DisplayState;
  isFirst: boolean;
  aboveState: DisplayState;
  onSelect: (index: number) => void;
  onValidate?: (slideNumber: number) => void;
}) {
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (displayState === 'current' && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [displayState]);

  const isSkipped = displayState === 'skipped';
  const isCurrent = displayState === 'current';
  const isVisited = displayState === 'visited';

  const handleClick = () => {
    onSelect(index);
    // When clicking a skipped slide, also validate it (upgrade to visited as they navigate there)
    if (isSkipped && onValidate) onValidate(slide.slide_number);
  };

  return (
    <div className="relative">
      {!isFirst && <ConnectorSegment above={aboveState} />}

      <button
        ref={isCurrent ? itemRef : undefined}
        onClick={handleClick}
        title={isSkipped ? 'Click to navigate here and mark as visited' : undefined}
        className={`w-full flex items-center gap-4 py-2.5 px-2 rounded-xl transition-all duration-300 group relative z-10 outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
          isCurrent
            ? 'bg-primary/10 text-primary'
            : isSkipped
            ? 'hover:bg-amber-400/5 text-amber-400/70'
            : isVisited
            ? 'text-success/80 hover:bg-success/5'
            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
        } cursor-pointer`}
        aria-current={isCurrent ? 'true' : undefined}
        aria-label={`Slide ${slide.slide_number}${slide.title ? `: ${slide.title}` : ''} — ${displayState}`}
      >
        {/* Node dot */}
        <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center relative">
          {/* Current slide aura */}
          {isCurrent && (
            <motion.div
              layoutId="activeNodeGlow"
              className="absolute inset-0 bg-primary/20 blur-md rounded-full"
            />
          )}

          <div
            className={`w-6 h-6 rounded-lg flex items-center justify-center relative z-10 transition-all duration-300 ${
              isCurrent
                ? 'bg-primary text-white shadow-glow-primary'
                : isVisited
                ? 'bg-success/20 text-success border border-success/30'
                : isSkipped
                ? 'bg-amber-400/10 text-amber-400 border border-dashed border-amber-400/50 group-hover:border-amber-400/80'
                : 'bg-surface-2 text-muted-foreground border border-white/5 group-hover:border-primary/30'
            }`}
          >
            {isVisited ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : isSkipped ? (
              <SkipForward className="w-3 h-3" />
            ) : (
              <span className="text-[10px] font-bold">{slide.slide_number}</span>
            )}
          </div>
        </div>

        {/* Label */}
        <div className="flex-1 text-left min-w-0">
          <p
            className={`text-sm font-bold truncate transition-colors ${
              isCurrent
                ? 'text-foreground'
                : isVisited
                ? 'text-success/80'
                : isSkipped
                ? 'text-amber-400/70 group-hover:text-amber-400'
                : 'text-muted-foreground group-hover:text-foreground'
            }`}
          >
            {slide.title || `Slide ${slide.slide_number}`}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
            {isCurrent
              ? 'Current'
              : isVisited
              ? 'Done'
              : isSkipped
              ? 'Skipped · click to validate'
              : 'Remaining'}
          </p>
        </div>
      </button>
    </div>
  );
});

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface LectureSidebarProps {
  slides: Slide[];
  currentSlideIndex: number;
  /** Granular per-slide state map from useSlideProgress. */
  slideStates: Record<string, SlideState>;
  /** Actual visited-slide % (0–100) for the progress bar. */
  completionPct?: number;
  onSelectSlide: (index: number) => void;
  /** Called when a skipped slide is clicked — validates it to visited. */
  onValidateSlide?: (slideNumber: number) => void;
  /** Manually mark entire lecture as complete. */
  onMarkComplete?: () => void;
  /** Reset all slide progress. */
  onResetProgress?: () => void;
  isCollapsed: boolean;
  onToggle: () => void;
}

export function LectureSidebar({
  slides,
  currentSlideIndex,
  slideStates,
  completionPct = 0,
  onSelectSlide,
  onValidateSlide,
  onMarkComplete,
  onResetProgress,
  isCollapsed,
  onToggle,
}: LectureSidebarProps) {
  const handleToggle = useCallback(() => onToggle(), [onToggle]);

  const displayStates = slides.map((slide, i) =>
    getDisplayState(slide.slide_number, i, currentSlideIndex, slideStates),
  );

  const skippedCount = displayStates.filter((s) => s === 'skipped').length;

  return (
    <motion.div
      initial={false}
      animate={{ width: isCollapsed ? 72 : 280 }}
      className="h-full glass-panel border-r border-white/5 flex flex-col relative z-20"
      style={{ flexShrink: 0 }}
    >
      {/* Toggle button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={handleToggle}
        className="absolute -right-3 top-20 z-30 w-6 h-6 glass-panel-strong border border-white/10 rounded-full flex items-center justify-center text-primary shadow-glow-primary/20 cursor-pointer"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </motion.button>

      {/* Header */}
      <div className="p-5 border-b border-white/5 bg-surface-1/30">
        {!isCollapsed ? (
          <div className="space-y-1">
            <h2 className="text-[10px] font-bold text-primary uppercase tracking-widest">
              Syllabus
            </h2>
            <p className="text-sm font-bold text-foreground">Lecture Content</p>

            {/* Progress bar — based on actual visited count */}
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-success to-success/70 rounded-full"
                  animate={{ width: `${completionPct}%` }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className="text-[10px] font-bold text-muted-foreground">
                {completionPct}%
              </span>
            </div>

            {/* Skipped badge */}
            {skippedCount > 0 && (
              <p className="text-[10px] font-bold text-amber-400/70 mt-1">
                {skippedCount} slide{skippedCount > 1 ? 's' : ''} skipped
              </p>
            )}
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-primary" />
            </div>
          </div>
        )}
      </div>

      {/* Slide timeline */}
      <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
        <div className="relative space-y-0 px-3">
          {slides.map((slide, index) => (
            <SlideItem
              key={slide.id}
              slide={slide}
              index={index}
              displayState={displayStates[index]}
              isFirst={index === 0}
              aboveState={index > 0 ? displayStates[index - 1] : 'unvisited'}
              onSelect={onSelectSlide}
              onValidate={onValidateSlide}
            />
          ))}
        </div>
      </div>

      {/* Footer: session bonus + manual actions */}
      {!isCollapsed && (
        <div className="p-4 border-t border-white/5 bg-surface-1/30 space-y-3">
          {/* XP bonus line */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
              <Star className="w-4 h-4 text-xp" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Session Bonus
              </p>
              <p className="text-xs font-bold text-foreground">+10 XP per Quiz</p>
            </div>
          </div>

          {/* Manual progress controls */}
          {(onMarkComplete || onResetProgress) && (
            <div className="flex gap-2">
              {onMarkComplete && (
                <button
                  onClick={onMarkComplete}
                  title="Mark entire lecture as completed"
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-success/10 hover:bg-success/20 text-success text-[10px] font-bold uppercase tracking-wider transition-colors"
                >
                  <CheckSquare className="w-3 h-3" />
                  Done
                </button>
              )}
              {onResetProgress && (
                <button
                  onClick={onResetProgress}
                  title="Reset all progress for this lecture"
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground text-[10px] font-bold uppercase tracking-wider transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
