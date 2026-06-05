import { motion, AnimatePresence } from 'framer-motion';
import { StatusPill, LaunchButton } from '@/components/console';
import type { LectureView } from '@/features/student/homeFeed';

interface HeroStageProps {
  view: LectureView;
  /** "Good morning · Ada" style line. */
  eyebrow: string;
  /** Quiz accuracy across the student's work, 0–100. */
  accuracy: number;
  /** AI-generated one-liner for the focused lecture. */
  tagline?: string;
  ctaLabel: string;
  onLaunch: () => void;
}

/**
 * The cinematic lower-third hero: greeting eyebrow, big lecture title, status +
 * progress metadata, an AI tagline and the launch CTA. Cross-fades when the
 * focused lecture changes. Driven by the home-feed resolver, not rail position.
 */
export function HeroStage({ view, eyebrow, accuracy, tagline, ctaLabel, onLaunch }: HeroStageProps) {
  const { lecture, status, pct, completedSlides, totalSlides, cleanTitle } = view;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={lecture.id}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="max-w-2xl space-y-4"
      >
        <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/60">{eyebrow}</span>
        <h1 className="text-5xl lg:text-7xl font-black tracking-tight leading-[0.9] drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)]">
          {cleanTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusPill status={status} />
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/70">Progress {pct}%</span>
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/70">
            Slides {completedSlides}/{totalSlides}
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/70">Accuracy {accuracy}%</span>
        </div>
        {(tagline || lecture.description) && (
          <p className="text-sm text-white/60 line-clamp-2 max-w-xl">
            {tagline ? <span className="italic">“{tagline}”</span> : lecture.description}
          </p>
        )}
        <div className="pt-1">
          <LaunchButton label={ctaLabel} onClick={onLaunch} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
