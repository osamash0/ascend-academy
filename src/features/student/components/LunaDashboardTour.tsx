import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { LunaAstronaut } from '../../../../learnstation-luna';
import type { Profile } from '@/lib/auth';

interface TourStep {
  id: string;
  /** CSS selector for the element to spotlight; omitted = centered card (welcome/closing). */
  targetSelector?: string;
}

const STEPS: TourStep[] = [
  { id: 'welcome' },
  { id: 'browse', targetSelector: '[data-tour="browse-courses"]' },
  { id: 'materials', targetSelector: '[data-tour="my-materials"]' },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measureTarget(selector?: string): Rect | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

const PAD = 10;

interface LunaDashboardTourProps {
  profile?: Profile | null;
  /** Called on skip or on finishing the last step — parent persists the "seen" flag and unmounts this. */
  onDone: () => void;
}

/**
 * A lightweight, skippable spotlight tour shown once after onboarding.
 * Walks a brand-new student to the "browse courses" and "My Materials"
 * entry points on the dashboard, Luna doing the talking.
 */
export function LunaDashboardTour({ profile, onDone }: LunaDashboardTourProps) {
  const { t } = useTranslation(['dashboard']);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  // Advance past any step whose target isn't actually on the page (e.g. a
  // feature flag is off), scroll the real target into view, then measure it.
  useEffect(() => {
    if (step.targetSelector && !document.querySelector(step.targetSelector)) {
      if (stepIndex < STEPS.length - 1) {
        setStepIndex((i) => i + 1);
      } else {
        onDone();
      }
      return;
    }

    const el = step.targetSelector ? document.querySelector(step.targetSelector) : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const delay = el ? 380 : 0;
    const id = setTimeout(() => setRect(measureTarget(step.targetSelector)), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  const remeasure = useCallback(() => setRect(measureTarget(step.targetSelector)), [step.targetSelector]);
  useEffect(() => {
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [remeasure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const goNext = () => (isLast ? onDone() : setStepIndex((i) => i + 1));

  const spotlightStyle = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Card placement: anchored just below the spotlight (clamped to the
  // viewport), or dead-centered for the welcome/no-target steps.
  const cardWidth = 320;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardTop = spotlightStyle
    ? Math.min(spotlightStyle.top + spotlightStyle.height + 16, viewportH - 220)
    : undefined;
  const cardLeft = spotlightStyle
    ? Math.min(Math.max(spotlightStyle.left, 16), viewportW - cardWidth - 16)
    : undefined;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={t('dashboard:tour.ariaLabel', { defaultValue: 'Guided tour' })}>
      {/* Dimmed backdrop with a spotlight cutout via box-shadow. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={spotlightStyle ? `spot-${step.id}` : 'dim'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute rounded-3xl pointer-events-none"
          style={
            spotlightStyle
              ? {
                  top: spotlightStyle.top,
                  left: spotlightStyle.left,
                  width: spotlightStyle.width,
                  height: spotlightStyle.height,
                  boxShadow: '0 0 0 9999px rgba(4,6,12,0.75)',
                  border: '2px solid hsl(var(--primary))',
                }
              : { inset: 0, boxShadow: 'none', background: 'rgba(4,6,12,0.75)' }
          }
        />
      </AnimatePresence>

      {/* Clicking the dimmed area (not the card) doesn't force-close — only Skip/Escape do. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/*
        Positioning lives on this plain wrapper, not the motion.div below —
        framer-motion drives `transform` itself for the enter/exit spring, so
        a custom `transform` (needed here to center the welcome/closing card)
        on the same element would fight it and freeze the animation.
      */}
      <div
        className="absolute"
        style={
          cardTop !== undefined && cardLeft !== undefined
            ? { top: cardTop, left: cardLeft, width: cardWidth }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: cardWidth }
        }
      >
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="glass-card rounded-[28px] border border-white/10 shadow-glow-primary/20 p-5"
        >
          <button
            onClick={onDone}
            aria-label={t('dashboard:tour.skip', { defaultValue: 'Skip tour' })}
            className="absolute right-3 top-3 text-white/40 hover:text-white/80 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3 pr-4">
            <LunaAstronaut
              variant="head"
              phase="crescent"
              size="sm"
              animated
              suitColor={profile?.luna_suit_color || undefined}
              visorTint={profile?.luna_visor_tint || undefined}
              patchImage={profile?.luna_patch || undefined}
            />
            <div className="pt-1 space-y-1.5">
              <h3 className="text-base font-black leading-tight">
                {t(`dashboard:tour.steps.${step.id}.title`)}
              </h3>
              <p className="text-sm text-white/65 leading-relaxed">
                {t(`dashboard:tour.steps.${step.id}.body`)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <span
                  key={s.id}
                  className={`h-1.5 rounded-full transition-all ${
                    i === stepIndex ? 'w-4 bg-primary' : 'w-1.5 bg-white/20'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onDone}
                className="text-xs font-bold uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors"
              >
                {t('dashboard:tour.skip', { defaultValue: 'Skip tour' })}
              </button>
              <button
                onClick={goNext}
                className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-900 hover:bg-white/90 transition-colors"
              >
                {isLast
                  ? t('dashboard:tour.finish', { defaultValue: 'Got it!' })
                  : t('dashboard:tour.next', { defaultValue: 'Next' })}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
      </div>
    </div>
  );
}
