import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Layers } from 'lucide-react';
import { LanguageToggle } from '@/components/LanguageToggle';
import { PublicRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { ACCENT } from './story';

const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** The mark: the brand's white tile, black glyph. No colour of its own. */
export function Mark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'flex items-center justify-center bg-white text-black',
        size === 'md' ? 'h-9 w-9 rounded-[11px]' : 'h-7 w-7 rounded-[9px]',
      )}
    >
      <Layers aria-hidden className={size === 'md' ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'} />
    </span>
  );
}

export function LandingNav() {
  const { t } = useTranslation('landing');
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 16);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        scrolled ? 'bg-black/70 backdrop-blur-xl' : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Learnstation"
        >
          <Mark />
          <span className="hidden text-[16px] font-semibold tracking-[-0.01em] text-white min-[400px]:inline">Learnstation</span>
        </button>
        <div className="flex items-center gap-2 sm:gap-4">
          <LanguageToggle variant="icon-dark" />
          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:inline-flex"
          >
            {t('story.nav.signIn')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="inline-flex h-9 items-center whitespace-nowrap rounded-full bg-white px-4 text-[13.5px] font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {t('story.nav.start')}
          </button>
        </div>
      </div>
      <div
        aria-hidden
        className={cn('h-px transition-opacity duration-300', scrolled ? 'opacity-100' : 'opacity-0')}
        style={{ background: `linear-gradient(90deg, transparent, ${tint(ACCENT, 55)} 50%, transparent)` }}
      />
    </header>
  );
}

/**
 * The brand promise, made literal: there is no brand colour. Each deck lights
 * the room in its own, and the room changes as you move between them.
 */
const DECK_LIGHTS = [ACCENT, '#06b6d4', '#f59e0b'];

export function Lights() {
  const { t } = useTranslation('landing');
  const reduce = useReducedMotion();
  const decks = t('story.lights.decks', { returnObjects: true }) as string[];
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || reduce) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % DECK_LIGHTS.length), 2600);
    return () => window.clearInterval(id);
  }, [held, reduce]);

  return (
    <section className="relative overflow-hidden py-32">
      {DECK_LIGHTS.map((c, i) => (
        <motion.div
          key={c}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={false}
          animate={{ opacity: active === i ? 1 : 0 }}
          transition={{ duration: 1.1, ease: 'easeInOut' }}
          style={{ background: `radial-gradient(45% 55% at 50% 62%, ${tint(c, 22)}, transparent 72%)` }}
        />
      ))}
      <div className="relative mx-auto max-w-5xl px-6 text-center">
        <h2 className="mx-auto max-w-[18ch] text-[clamp(32px,4.6vw,64px)] font-medium leading-[1.04] tracking-[-0.04em] text-white">
          {t('story.lights.title')}
        </h2>

        <div
          className="mt-16 grid gap-4 sm:grid-cols-3"
          onMouseLeave={() => setHeld(false)}
        >
          {decks.map((name, i) => {
            const c = DECK_LIGHTS[i];
            const on = active === i;
            return (
              <button
                key={name}
                type="button"
                onMouseEnter={() => {
                  setHeld(true);
                  setActive(i);
                }}
                onFocus={() => {
                  setHeld(true);
                  setActive(i);
                }}
                onClick={() => setActive(i)}
                aria-pressed={on}
                className="group relative aspect-[16/10] overflow-hidden rounded-2xl border text-left transition-[border-color,transform] duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{
                  borderColor: on ? tint(c, 55) : 'rgba(255,255,255,0.08)',
                  transform: on ? 'translateY(-6px)' : 'none',
                  background: on ? tint(c, 10) : 'rgba(255,255,255,0.025)',
                }}
              >
                <span className="absolute left-5 top-5 h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                <span className="absolute inset-x-5 top-12 space-y-2">
                  {[78, 92, 64, 84].map((w, j) => (
                    <span key={j} className="block h-1.5 rounded-full bg-white/[0.08]" style={{ width: `${w}%` }} />
                  ))}
                </span>
                <span className="absolute bottom-5 left-5 text-[17px] font-medium text-white">{name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Close() {
  const { t } = useTranslation('landing');
  const navigate = useNavigate();
  return (
    <section className="relative px-6 pb-32 pt-24">
      <div className="mx-auto max-w-3xl text-center">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-[clamp(40px,6vw,88px)] font-medium leading-[1] tracking-[-0.05em] text-white"
          >
            {t('story.close.title')}
          </motion.h2>
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="inline-flex h-14 items-center gap-2 rounded-full bg-white px-8 text-[15px] font-semibold text-black transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {t('story.close.start')}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  const { t } = useTranslation('landing');
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 py-10 sm:flex-row lg:px-10">
        <div className="flex items-center gap-2.5">
          <Mark size="sm" />
          <span className="text-[14px] font-medium text-white">Learnstation</span>
        </div>
        <nav className="flex items-center gap-6 text-[13px] text-white/50">
          <a href={PublicRoutes.DATENSCHUTZ} className="hover:text-white">
            {t('footer.privacyPolicy')}
          </a>
          <a href={PublicRoutes.IMPRESSUM} className="hover:text-white">
            {t('footer.imprint')}
          </a>
          <span>{t('footer.copyright', { year: new Date().getFullYear() })}</span>
        </nav>
      </div>
    </footer>
  );
}
