import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const LunaAstronaut = lazy(() =>
  import('../../../learnstation-luna').then((m) => ({ default: m.LunaAstronaut })),
);

/**
 * The landing page's first screen IS the product (Abi, 2026-10-10).
 *
 * Research behind the shape: people scan rather than read (NN/g — roughly a
 * fifth to a quarter of the words on a page get read), and the edtech pages
 * that work let you *do* something before you sign up (Brilliant's hero
 * problems, Duolingo's "play first"). So: a headline you can take in at a
 * glance, one line, and a live page that changes in place — Original,
 * Explore, Learn, Practise. It plays itself until the visitor takes over.
 *
 * The page is AUTHORED, not a real professor's deck (copyright, and 5.5 MB per
 * visitor). Brand is monochrome; the only colour is the page's own light.
 */

export const ACCENT = '#10b981';
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/* ─────────────────────────── Original: the dense page ─────────────────────────── */

export function Slide({ className }: { className?: string }) {
  const { t } = useTranslation('landing');
  return (
    <div
      className={cn(
        'relative aspect-[16/10] w-full overflow-hidden rounded-[10px] bg-[#f7f7f4] text-[#1c1c1c]',
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-[6%]" style={{ background: '#1f3b4d' }} />
      <div className="flex h-full flex-col px-[5.5%] pb-[4%] pt-[9%]">
        <p className="text-[clamp(6px,0.75vw,10px)] font-semibold uppercase tracking-[0.12em] text-[#1f3b4d]/70">
          {t('story.slide.kicker')}
        </p>
        <p className="mt-[1.2%] text-[clamp(10px,1.45vw,21px)] font-bold leading-tight">{t('story.slide.title')}</p>
        <div className="mt-[1.5%] h-px w-full bg-[#1f3b4d]/25" />
        <div className="mt-[3%] grid flex-1 grid-cols-[1.55fr_1fr] gap-[4%]">
          <ul className="space-y-[2.2%] text-[clamp(5.5px,0.78vw,11.5px)] leading-[1.35]">
            {(['b1', 'b2', 'b3', 'b4', 'b5'] as const).map((k) => (
              <li key={k} className="flex gap-[3%]">
                <span className="mt-[0.45em] h-[0.4em] w-[0.4em] shrink-0 rounded-full bg-[#1f3b4d]" />
                <span>{t(`story.slide.${k}`)}</span>
              </li>
            ))}
          </ul>
          <div className="self-start overflow-hidden rounded-[4px] border border-[#1f3b4d]/30 text-[clamp(5px,0.68vw,10px)]">
            <div className="grid grid-cols-3 bg-[#1f3b4d] px-[6%] py-[3%] font-semibold text-white">
              <span>OrderId</span>
              <span>Customer</span>
              <span>City</span>
            </div>
            {[
              ['101', 'Ada', 'Bonn'],
              ['102', 'Ada', 'Bonn'],
              ['103', 'Lin', 'Köln'],
              ['104', 'Ada', 'Berlin'],
            ].map((r, i) => (
              <div key={r[0]} className={cn('grid grid-cols-3 px-[6%] py-[3%]', i % 2 && 'bg-[#1f3b4d]/[0.06]')}>
                {r.map((c, j) => (
                  <span key={j} className={cn(i === 3 && j === 2 && 'font-semibold text-[#b42318]')}>
                    {c}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-auto self-end text-[clamp(5px,0.62vw,9px)] text-[#1c1c1c]/50">{t('story.slide.page')}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Learn: the same page, readable ─────────────────────────── */

function LearnView() {
  const { t } = useTranslation('landing');
  return (
    <div className="flex h-full flex-col justify-center px-[8%]">
      <h3 className="text-[clamp(22px,3vw,40px)] font-medium leading-[1.1] tracking-[-0.03em] text-white">
        {t('story.read.title')}
      </h3>
      <p className="mt-[3%] text-[clamp(14px,1.6vw,21px)] leading-[1.5] text-white/75">{t('story.read.p1')}</p>
      <p className="mt-[1.5%] text-[clamp(14px,1.6vw,21px)] leading-[1.5] text-white/75">
        <span className="rounded px-1" style={{ background: tint(ACCENT, 25), color: '#fff' }}>
          {t('story.read.p2')}
        </span>
      </p>
      {/* The original is never lost: the dense page, small, in the corner. */}
      <div className="absolute bottom-[6%] right-[5%] w-[22%] opacity-70">
        <Slide className="rounded-[6px]" />
      </div>
    </div>
  );
}

/* ─────────────────────────── Explore: a tool that computes ─────────────────────────── */

const ATTRS = ['OrderId', 'Customer', 'City'] as const;
type Attr = (typeof ATTRS)[number];
const FDS: [Attr, Attr][] = [
  ['OrderId', 'Customer'],
  ['Customer', 'City'],
];

/** Attribute closure, for real — the tool cannot say anything it did not compute. */
export function closure(start: Attr): Set<Attr> {
  const out = new Set<Attr>([start]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [a, b] of FDS)
      if (out.has(a) && !out.has(b)) {
        out.add(b);
        grew = true;
      }
  }
  return out;
}

function ExploreView({ onTouch }: { onTouch: () => void }) {
  const { t } = useTranslation('landing');
  const [start, setStart] = useState<Attr>('OrderId');
  const lit = useMemo(() => closure(start), [start]);
  return (
    <div className="flex h-full flex-col items-center justify-center px-[6%]">
      <p className="inline-flex items-center gap-2 text-[13px] text-white/50">
        <Sparkles aria-hidden className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        {t('story.ask.tool')} · {t('story.ask.hint')}
      </p>
      <div className="mt-[6%] flex w-full max-w-[560px] items-center">
        {ATTRS.map((a, i) => (
          <div key={a} className="flex flex-1 items-center last:flex-none">
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => {
                onTouch();
                setStart(a);
              }}
              aria-pressed={start === a}
              className="rounded-full border px-[clamp(10px,1.4vw,20px)] py-[clamp(6px,0.9vw,12px)] text-[clamp(12px,1.3vw,17px)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={
                lit.has(a)
                  ? { borderColor: tint(ACCENT, 60), background: tint(ACCENT, start === a ? 32 : 14), color: '#fff' }
                  : { borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)' }
              }
            >
              {a}
            </motion.button>
            {i < ATTRS.length - 1 && (
              <motion.div
                aria-hidden
                className="mx-2 h-px flex-1"
                initial={false}
                animate={{ opacity: lit.has(ATTRS[i]) && lit.has(ATTRS[i + 1]) ? 1 : 0.15 }}
                style={{ background: ACCENT }}
              />
            )}
          </div>
        ))}
      </div>
      <motion.p
        key={start}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-[7%] font-mono text-[clamp(14px,1.7vw,22px)] text-white"
      >
        {start}⁺ = {'{ '}
        {ATTRS.filter((a) => lit.has(a)).join(', ')}
        {' }'}
      </motion.p>
      <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-white/45">
        <Check aria-hidden className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        {t('story.ask.result')}
      </p>
    </div>
  );
}

/* ─────────────────────────── Practise ─────────────────────────── */

function PractiseView({ auto, onTouch }: { auto: boolean; onTouch: () => void }) {
  const { t } = useTranslation('landing');
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => setPicked((p) => p ?? '3NF'), 1100);
    return () => window.clearTimeout(id);
  }, [auto]);
  const right = picked === '3NF';
  return (
    <div className="flex h-full flex-col items-center justify-center px-[8%] text-center">
      <p className="text-[clamp(17px,2.2vw,28px)] font-medium leading-snug tracking-[-0.02em] text-white">
        {t('story.prove.q')}
      </p>
      <div className="mt-[5%] grid w-full max-w-[520px] grid-cols-3 gap-3">
        {['2NF', '3NF', 'BCNF'].map((o) => {
          const sel = picked === o;
          return (
            <motion.button
              key={o}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                onTouch();
                setPicked(o);
              }}
              className={cn(
                'h-[clamp(40px,4.6vw,56px)] rounded-xl border text-[clamp(14px,1.4vw,17px)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                !sel && 'border-white/12 text-white/80 hover:bg-white/[0.05]',
              )}
              style={
                sel
                  ? o === '3NF'
                    ? { borderColor: tint(ACCENT, 70), background: tint(ACCENT, 22), color: '#fff' }
                    : { borderColor: 'rgba(244,63,94,0.6)', background: 'rgba(244,63,94,0.14)', color: '#fff' }
                  : undefined
              }
            >
              {o}
            </motion.button>
          );
        })}
      </div>
      <div className="mt-[4%] h-6">
        <AnimatePresence mode="wait">
          {picked && (
            <motion.p
              key={picked}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="inline-flex items-center gap-2 text-[15px] text-white/80"
            >
              {right ? (
                <Check aria-hidden className="h-4 w-4" style={{ color: ACCENT }} />
              ) : (
                <X aria-hidden className="h-4 w-4 text-rose-400" />
              )}
              {right ? t('story.prove.right') : t('story.prove.wrong')}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-[3%] flex gap-1.5" aria-hidden>
        {[1, 1, 0, right ? 1 : 0].map((ok, i) => (
          <motion.span
            key={i}
            className="h-1 w-8 rounded-full"
            animate={{ background: ok ? ACCENT : 'rgba(255,255,255,0.15)' }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── The live page ─────────────────────────── */

const VIEWS = ['original', 'explore', 'learn', 'practise'] as const;
type View = (typeof VIEWS)[number];
const DWELL = 3400;

function LivePage() {
  const { t } = useTranslation('landing');
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [view, setView] = useState<View>('original');
  const [touched, setTouched] = useState(false);
  const playing = !touched && !reduce && inView;
  const touch = () => setTouched(true);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => setView((v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length]), DWELL);
    return () => window.clearTimeout(id);
  }, [playing, view]);

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[920px]">
      {/* The page's own light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-[20%] -inset-y-[30%]"
        style={{ background: `radial-gradient(50% 50% at 50% 55%, ${tint(ACCENT, 22)}, transparent 70%)` }}
      />

      {/* Views — a play bar, like stories: it fills while the page plays itself. */}
      <div
        role="tablist"
        aria-label={t('story.hero.try')}
        className="relative mx-auto flex w-fit items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur"
      >
        {VIEWS.map((v) => {
          const on = view === v;
          return (
            <button
              key={v}
              role="tab"
              aria-selected={on}
              onClick={() => {
                touch();
                setView(v);
              }}
              className={cn(
                'relative h-9 overflow-hidden rounded-full px-[clamp(10px,1.6vw,18px)] text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                on ? 'text-black' : 'text-white/60 hover:text-white',
              )}
            >
              {on && (
                <motion.span
                  layoutId="landingView"
                  className="absolute inset-0 rounded-full bg-white"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              {on && playing && (
                <motion.span
                  key={`${v}-bar`}
                  aria-hidden
                  className="absolute inset-x-3 bottom-1 h-[2px] origin-left rounded-full bg-black/25"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: DWELL / 1000, ease: 'linear' }}
                />
              )}
              <span className="relative">{t(`story.tabs.${v}`)}</span>
            </button>
          );
        })}
      </div>

      {/* The page. Every view is the same page — it changes in place. */}
      <div className="relative mt-5 aspect-[16/10] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b] shadow-[0_50px_140px_-30px_rgba(0,0,0,0.95)]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={view}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.985, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.01, filter: 'blur(10px)' }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            {view === 'original' && (
              <div className="flex h-full items-center justify-center p-[3%]">
                <Slide className="shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]" />
              </div>
            )}
            {view === 'learn' && <LearnView />}
            {view === 'explore' && <ExploreView onTouch={touch} />}
            {view === 'practise' && <PractiseView auto={!touched} onTouch={touch} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Luna keeps you company. Decoration only. */}
      <div aria-hidden className="pointer-events-none absolute -bottom-10 -left-12 hidden sm:block">
        <Suspense fallback={null}>
          <motion.div
            animate={reduce ? undefined : { y: [0, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <LunaAstronaut phase="full" size="md" animated={!reduce} />
          </motion.div>
        </Suspense>
      </div>
    </div>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */

export function Hero() {
  const { t } = useTranslation('landing');
  const navigate = useNavigate();
  return (
    <section className="relative overflow-x-clip px-6 pb-28 pt-24 sm:pt-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{ background: `radial-gradient(50% 70% at 50% 0%, ${tint(ACCENT, 12)}, transparent 72%)` }}
      />
      <div className="relative mx-auto max-w-4xl text-center">
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-[clamp(44px,6.6vw,96px)] font-medium leading-[0.98] tracking-[-0.05em] text-white"
        >
          {t('story.hero.title')}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="mx-auto mt-5 max-w-[46ch] text-[17px] leading-relaxed text-white/60"
        >
          {t('story.hero.lede')}
        </motion.p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14.5px] font-semibold text-black transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {t('story.hero.start')}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="inline-flex h-12 items-center rounded-full border border-white/12 bg-white/[0.05] px-6 text-[14.5px] font-medium text-white transition-colors hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {t('story.hero.signIn')}
          </button>
        </div>
      </div>

      <motion.div
        className="relative mt-12"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <LivePage />
      </motion.div>
    </section>
  );
}
