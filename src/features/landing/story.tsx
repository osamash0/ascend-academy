import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, CornerDownLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';

import { HOP_MS, LunaGuide, type GuideReaction } from './LunaGuide';

/**
 * The landing page's first screen IS the product (Abi, 2026-10-10).
 *
 * Research behind the shape: people scan rather than read (NN/g — roughly a
 * fifth to a quarter of the words on a page get read), and the edtech pages
 * that work let you *do* something before you sign up (Brilliant's hero
 * problems, Duolingo's "play first"). So: a headline you can take in at a
 * glance, one line, and a live page that changes in place. It plays itself
 * until the visitor takes over, with Luna showing the way.
 *
 * Honesty rule (Abi, 2026-10-16: "demo stuff that we really provide"): the
 * four views are the reader's real faces — the Page itself, Explain (the
 * tutor's answer in its real block shapes: a headline, parts that light up
 * their words on the page, steps), Ask (a question about the page, answered
 * with a citation) and Practise (a question tied to its source page). No
 * invented views, no hand-built toys. The topic is one every visitor already
 * knows — supply and demand — so nothing is new but the product.
 *
 * The page is AUTHORED, not a real professor's deck (copyright, and 5.5 MB per
 * visitor). Brand is monochrome; the only colour is the page's own light.
 */

export const ACCENT = '#10b981';
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/* ─────────────────────────── Page: the dense slide ─────────────────────────── */

const BULLETS = ['b1', 'b2', 'b3', 'b4', 'b5'] as const;

/** A bullet with a phrase lit — the reader's "spot": the words a part is about. */
function Lit({ text, spot }: { text: string; spot: string | null }) {
  const i = spot ? text.indexOf(spot) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] px-[0.15em] text-inherit transition-colors duration-300" style={{ background: tint(ACCENT, 38) }}>
        {spot}
      </mark>
      {text.slice(i + spot!.length)}
    </>
  );
}

/** Supply meets demand: the slide's small chart. Lit with the part being explained. */
function Chart({ spot }: { spot: 'demand' | 'supply' | 'meet' | null }) {
  const on = (k: string) => (spot === k ? ACCENT : '#1f3b4d');
  return (
    <svg viewBox="0 0 100 70" className="w-full">
      <path d="M8 62 H96" stroke="#1f3b4d" strokeWidth="1" />
      <path d="M8 62 V4" stroke="#1f3b4d" strokeWidth="1" />
      <path d="M16 10 L88 56" stroke={on('demand')} strokeWidth={spot === 'demand' ? 3 : 1.8} fill="none" />
      <path d="M16 56 L88 10" stroke={on('supply')} strokeWidth={spot === 'supply' ? 3 : 1.8} fill="none" />
      <circle cx="52" cy="33" r={spot === 'meet' ? 4.5 : 2.6} fill={on('meet')} />
      <text x="90" y="54" fontSize="6" fill="#1f3b4d">D</text>
      <text x="90" y="12" fontSize="6" fill="#1f3b4d">S</text>
      <text x="44" y="29" fontSize="5.5" fill="#1f3b4d">P*</text>
    </svg>
  );
}

export function Slide({ className, spot = null, chart = null }: { className?: string; spot?: string | null; chart?: 'demand' | 'supply' | 'meet' | null }) {
  const { t } = useTranslation('landing');
  return (
    <div
      className={cn(
        'relative aspect-[16/10] w-full overflow-hidden rounded-[10px] bg-[#f7f7f4] text-[#1c1c1c] [container-type:inline-size]',
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 h-[6%]" style={{ background: '#1f3b4d' }} />
      <div className="flex h-full flex-col px-[5.5%] pb-[4%] pt-[9%]">
        <p className="text-[1.25cqw] font-semibold uppercase tracking-[0.12em] text-[#1f3b4d]/70">{t('story.slide.kicker')}</p>
        <p className="mt-[1.2%] text-[2.45cqw] font-bold leading-tight">{t('story.slide.title')}</p>
        <div className="mt-[1.5%] h-px w-full bg-[#1f3b4d]/25" />
        <div className="mt-[3%] grid flex-1 grid-cols-[1.55fr_1fr] gap-[4%]">
          <ul className="space-y-[2.2%] text-[1.32cqw] leading-[1.35]">
            {BULLETS.map((k) => (
              <li key={k} className="flex gap-[3%]">
                <span className="mt-[0.45em] h-[0.4em] w-[0.4em] shrink-0 rounded-full bg-[#1f3b4d]" />
                <span>
                  <Lit text={t(`story.slide.${k}`)} spot={spot} />
                </span>
              </li>
            ))}
          </ul>
          <div className="self-start rounded-[4px] border border-[#1f3b4d]/30 p-[3%]">
            <Chart spot={chart} />
            <p className="mt-[2%] text-center text-[1.05cqw] text-[#1c1c1c]/60">{t('story.slide.chart')}</p>
          </div>
        </div>
        <p className="mt-auto self-end text-[1.05cqw] text-[#1c1c1c]/50">{t('story.slide.page')}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Explain: the tutor's answer, as the reader shows it ─────────────────────────── */

type Part = { label: string; body: string; spot: string };
type Step = { label: string; body: string };
const PART_CHART = ['demand', 'supply', 'meet'] as const;

function ExplainView({ auto, onTouch }: { auto: boolean; onTouch: () => void }) {
  const { t } = useTranslation('landing');
  const parts = t('story.explain.parts', { returnObjects: true }) as Part[];
  const steps = t('story.explain.steps', { returnObjects: true }) as Step[];
  const [open, setOpen] = useState(0);
  // Playing itself: Luna walks the parts, one every beat.
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => setOpen((o) => Math.min(o + 1, parts.length - 1)), 1050);
    return () => window.clearInterval(id);
  }, [auto, parts.length]);
  const part = parts[open];
  return (
    <div className="grid h-full grid-cols-1 content-center gap-[4%] px-[6%] sm:grid-cols-[1.1fr_1fr] sm:items-center sm:px-[5%]">
      <div>
        <p className="text-[clamp(10px,1.4cqw,13px)] font-medium uppercase tracking-[0.14em] text-white/40">{t('story.explain.format')}</p>
        <h3 className="mt-[2%] text-[clamp(17px,3cqw,32px)] font-medium leading-[1.12] tracking-[-0.02em] text-white [text-wrap:balance]">
          {t('story.explain.headline')}
        </h3>
        <div className="mt-[5%] flex flex-wrap gap-[clamp(6px,1cqw,10px)]">
          {parts.map((p, i) => (
            <motion.button
              key={p.label}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                onTouch();
                setOpen(i);
              }}
              aria-pressed={open === i}
              className="rounded-full border px-[clamp(10px,1.8cqw,18px)] py-[clamp(5px,0.9cqw,9px)] text-[clamp(12px,1.6cqw,16px)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={
                open === i
                  ? { borderColor: tint(ACCENT, 60), background: tint(ACCENT, 22), color: '#fff' }
                  : { borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }
              }
            >
              {p.label}
            </motion.button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={open}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-[3.5%] min-h-[2.6em] text-[clamp(13px,1.9cqw,19px)] leading-[1.45] text-white/80"
          >
            {part.body}
          </motion.p>
        </AnimatePresence>
        <ol className="mt-[4%] hidden space-y-[1.2%] border-t border-white/10 pt-[3%] text-[clamp(11px,1.5cqw,15px)] text-white/60 sm:block">
          <li className="mb-[1.5%] text-[clamp(10px,1.3cqw,12px)] font-medium uppercase tracking-[0.14em] text-white/35">{t('story.explain.stepsTitle')}</li>
          {steps.map((s, i) => (
            <li key={s.label} className="flex gap-2">
              <span className="w-[1.2em] shrink-0 text-white/35">{i + 1}</span>
              <span>
                <span className="text-white/85">{s.label}.</span> {s.body}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {/* The page stays beside the answer, and the part's words light up on it. */}
      <div className="relative mx-auto w-[88%] sm:w-auto">
        <Slide className="rounded-[8px] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]" spot={part.spot} chart={PART_CHART[open] ?? null} />
        <p className="mt-2 hidden text-center text-[clamp(10px,1.3cqw,12px)] text-white/35 sm:block">{t('story.explain.tap')}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Ask: a question about the page, answered with a citation ─────────────────────────── */

function AskView({ auto }: { auto: boolean }) {
  const { t } = useTranslation('landing');
  const q = t('story.ask.q');
  const [typed, setTyped] = useState(auto ? 0 : q.length);
  const [answered, setAnswered] = useState(!auto);
  useEffect(() => {
    if (!auto) return;
    const type = window.setInterval(() => setTyped((n) => (n < q.length ? n + 1 : n)), 28);
    const reply = window.setTimeout(() => setAnswered(true), q.length * 28 + 650);
    return () => {
      window.clearInterval(type);
      window.clearTimeout(reply);
    };
  }, [auto, q.length]);
  return (
    <div className="flex h-full flex-col items-center justify-center px-[8%]">
      <div className="flex w-full max-w-[70cqw] items-center gap-3 rounded-full border border-white/12 bg-white/[0.05] px-[clamp(14px,2.2cqw,22px)] py-[clamp(10px,1.5cqw,16px)] text-[clamp(14px,2cqw,20px)] text-white">
        <span className="min-h-[1.4em] flex-1">
          {typed === 0 ? <span className="text-white/35">{t('story.ask.placeholder')}</span> : q.slice(0, typed)}
          {typed < q.length && <span className="ml-px inline-block h-[1.1em] w-[2px] translate-y-[0.2em] animate-pulse bg-white/80" />}
        </span>
        <CornerDownLeft aria-hidden className="h-[1.1em] w-[1.1em] shrink-0 text-white/40" />
      </div>
      <div className="mt-[4%] min-h-[6em] w-full max-w-[70cqw]">
        <AnimatePresence>
          {answered && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <p className="text-[clamp(14px,2.1cqw,21px)] leading-[1.5] text-white/85">{t('story.ask.a')}</p>
              <span
                data-testid="ask-cite"
                className="mt-[2.5%] inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[clamp(11px,1.4cqw,13px)] font-medium"
                style={{ borderColor: tint(ACCENT, 50), color: ACCENT }}
              >
                <Check aria-hidden className="h-3 w-3" />
                {t('story.ask.cite')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────────────────── Practise: a question tied to its page ─────────────────────────── */

const RIGHT = 2; // "Rises"

function PractiseView({
  auto,
  onTouch,
  onAnswer,
}: {
  auto: boolean;
  onTouch: () => void;
  onAnswer: (right: boolean) => void;
}) {
  const { t } = useTranslation('landing');
  const options = t('story.prove.options', { returnObjects: true }) as string[];
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => setPicked((p) => p ?? RIGHT), 1100);
    return () => window.clearTimeout(id);
  }, [auto]);
  const right = picked === RIGHT;
  useEffect(() => {
    if (picked !== null) onAnswer(picked === RIGHT);
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex h-full flex-col items-center justify-center px-[8%] text-center">
      <p className="[text-wrap:balance] text-[clamp(19px,3.6cqw,38px)] font-medium leading-[1.15] tracking-[-0.02em] text-white">
        {t('story.prove.q')}
      </p>
      <div className="mt-[6%] grid w-full max-w-[66cqw] grid-cols-3 gap-[clamp(8px,1.6cqw,16px)]">
        {options.map((o, i) => {
          const sel = picked === i;
          return (
            <motion.button
              key={o}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                onTouch();
                setPicked(i);
              }}
              className={cn(
                'h-[clamp(44px,8cqw,80px)] rounded-2xl border text-[clamp(15px,2.5cqw,24px)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                !sel && 'border-white/12 text-white/80 hover:bg-white/[0.05]',
              )}
              style={
                sel
                  ? i === RIGHT
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
      <div className="mt-[4%] h-[clamp(24px,3.4cqw,34px)]">
        <AnimatePresence mode="wait">
          {picked !== null && (
            <motion.p
              key={picked}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="inline-flex items-center gap-2 text-[clamp(15px,2.1cqw,20px)] text-white/80"
            >
              {right ? <Check aria-hidden className="h-4 w-4" style={{ color: ACCENT }} /> : <X aria-hidden className="h-4 w-4 text-rose-400" />}
              {right ? t('story.prove.right') : t('story.prove.wrong')}
              {right && (
                <span className="rounded-full border px-2 py-0.5 text-[0.75em] font-medium" style={{ borderColor: tint(ACCENT, 50), color: ACCENT }}>
                  {t('story.prove.cite')}
                </span>
              )}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────────────────── The live page ─────────────────────────── */

const VIEWS = ['page', 'explain', 'ask', 'practise'] as const;
type View = (typeof VIEWS)[number];
const DWELL = 4600;

function LivePage() {
  const { t } = useTranslation('landing');
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const seen = useInView(ref, { amount: 0.15, once: true });
  const [view, setView] = useState<View>('page');
  // The tab Luna stands on. While the page plays itself she hops to the next
  // tab first, and the page turns as she lands — she is why it changes.
  const [lunaAt, setLunaAt] = useState<View>('page');
  const [reaction, setReaction] = useState<GuideReaction | null>(null);
  const [touched, setTouched] = useState(false);
  const playing = !touched && !reduce && inView;
  const touch = () => setTouched(true);
  const show = (v: View) => {
    setLunaAt(v);
    setView(v);
  };

  useEffect(() => {
    if (!playing) return;
    const next = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
    const hop = window.setTimeout(() => setLunaAt(next), DWELL - HOP_MS);
    const turn = window.setTimeout(() => setView(next), DWELL);
    return () => {
      window.clearTimeout(hop);
      window.clearTimeout(turn);
    };
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
        ref={tabsRef}
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
                show(v);
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
        <LunaGuide tabs={tabsRef} at={lunaAt} view={view} touched={touched} arrived={seen} reaction={reaction} />
      </div>

      {/* The page. Every view is the same page — it changes in place. */}
      <div className="relative mt-5 aspect-[4/5] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b] [container-type:inline-size] sm:aspect-[16/10] shadow-[0_50px_140px_-30px_rgba(0,0,0,0.95)]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={view}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.985, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.01, filter: 'blur(10px)' }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            {view === 'page' && (
              <div className="flex h-full items-center justify-center p-[3%]">
                <Slide className="shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]" />
              </div>
            )}
            {view === 'explain' && <ExplainView auto={!touched} onTouch={touch} />}
            {view === 'ask' && <AskView auto={!touched} />}
            {view === 'practise' && (
              <PractiseView
                auto={!touched}
                onTouch={touch}
                onAnswer={(right) => setReaction({ kind: right ? 'right' : 'wrong', n: Date.now() })}
              />
            )}
          </motion.div>
        </AnimatePresence>
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
        className="relative mt-24 sm:mt-32"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <LivePage />
      </motion.div>
    </section>
  );
}
