import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ConsoleBackground } from './ConsoleBackground';
import { HeroMeta, type HeroMetaItem } from './HeroMeta';
import { LaunchButton } from './LaunchButton';
import type { ConsoleStatus } from './constants';

interface ConsoleHeroProps {
  title: string;
  eyebrow?: string;
  /** Flavor line under the title. */
  tagline?: ReactNode;
  meta?: HeroMetaItem[];
  status?: ConsoleStatus;
  gradientIndex?: number;
  ctaLabel?: string;
  onLaunch?: () => void;
  /** Slot above the hero (e.g. a ProfileChip). */
  overlay?: ReactNode;
  /** Triggers the background + content cross-fade when the feature changes. */
  motionKey?: string;
  className?: string;
}

/**
 * Cinematic featured block: generated key-art background with a bold title,
 * metadata row and a launch CTA — the console home "now playing" hero.
 */
export function ConsoleHero({
  title,
  eyebrow,
  tagline,
  meta,
  status = 'progress',
  gradientIndex = 0,
  ctaLabel = 'Continue',
  onLaunch,
  overlay,
  motionKey,
  className,
}: ConsoleHeroProps) {
  return (
    <section className={cn('relative isolate overflow-hidden rounded-3xl', className)}>
      <ConsoleBackground gradientIndex={gradientIndex} status={status} motionKey={motionKey} />

      <div className="relative z-10 flex min-h-[420px] flex-col justify-end gap-6 p-8 lg:p-12">
        {overlay && <div className="absolute left-8 top-8 lg:left-12 lg:top-12">{overlay}</div>}

        <motion.div
          key={motionKey ?? title}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="max-w-2xl space-y-5"
        >
          {eyebrow && (
            <span className="text-[11px] font-black uppercase tracking-[0.3em] text-primary/90">
              {eyebrow}
            </span>
          )}
          <h1 className="text-5xl lg:text-6xl font-black tracking-tight leading-[0.95]">{title}</h1>
          {tagline && (
            <p className="text-base text-muted-foreground line-clamp-2 max-w-xl">{tagline}</p>
          )}
          {meta && meta.length > 0 && <HeroMeta items={meta} className="pt-1" />}
          {onLaunch && (
            <div className="pt-2">
              <LaunchButton label={ctaLabel} onClick={onLaunch} />
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
