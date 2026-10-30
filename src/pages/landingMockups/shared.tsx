/**
 * Shared pieces for the "How it's landing" mockups (DEV lab only).
 *
 * Three directions share the same numbers, the same Lessons and the same
 * colour rule: every Lesson is lit by its own deck's colour — live, the hue
 * the reader samples from its first page (`sampleAccent`); here, the cover
 * palette the fixtures already use (`stageAccentFor(order)`).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDownRight, Check, FastForward, HelpCircle, Sparkles, Target, TriangleAlert, Undo2, type LucideIcon } from 'lucide-react';
import { LunaAvatar } from '@/features/avatar/LunaAvatar';
import { stageAccentFor } from '@/features/spaces/components/stage';
import { cardCopy } from '@/features/spaces/landing/copy';
import type { InsightKind, Landing, LandingInsight, LandingLesson } from '@/features/spaces/landing/types';
import { dbsLanding } from '@/features/spaces/mocks/landing';

export const landing: Landing = dbsLanding;
export const lessonColor = (l: LandingLesson) => stageAccentFor(l.order);
export const lessonById = new Map(landing.lessons.map((l) => [l.id, l]));
export const findingsFor = (lessonId: string) => landing.insights.filter((i) => i.lessonId === lessonId);

/** The three meters every direction shows. Fixture figures. */
export const METERS = {
  reading: { value: 131 / 184, number: '131', of: 'of 184 members read this week', history: [62, 88, 97, 104, 112, 109, 124, 131] },
  landing: { value: 0.71, number: '71%', of: 'of pages are landing', history: [40, 48, 55, 58, 63, 66, 69, 71] },
  cleared: { value: 0.78, number: '78%', of: 'cleared checkpoints first try', history: [70, 72, 74, 73, 76, 77, 77, 78] },
};

export const KIND_ICON: Record<InsightKind, LucideIcon> = {
  confusion_hotspot: HelpCircle,
  silent_misleader: TriangleAlert,
  skipped_slide: FastForward,
  speed_bump: Undo2,
  overpacked: HelpCircle,
  leaky_bucket: ArrowDownRight,
  confusion_block: HelpCircle,
  quiz_misalignment: Target,
  calibration_gap: TriangleAlert,
  healthy: Sparkles,
};

/** One big number per finding — the figure the card is about. */
export function bigNumber(i: LandingInsight): { value: string; word: string } {
  const m = i.metrics;
  switch (i.kind) {
    case 'confusion_hotspot':
      return { value: `${m.askers}`, word: 'asked for help' };
    case 'silent_misleader':
    case 'calibration_gap':
      return { value: `${m.missed ?? m.pct}%`, word: 'sure, then missed' };
    case 'leaky_bucket':
      return { value: `${m.pct}%`, word: 'stopped here' };
    case 'speed_bump':
      return { value: `${m.backs}`, word: 'came back' };
    case 'quiz_misalignment':
      return { value: `${m.pct}%`, word: 'first try' };
    case 'skipped_slide':
      return { value: `${m.seconds} s`, word: 'on the page' };
    case 'healthy':
      return { value: `${m.firstTry}%`, word: 'first try' };
    default:
      return { value: '', word: '' };
  }
}

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** A ring meter, drawn in on mount. */
export function Ring({ value, color, size = 108, stroke = 9, children }: { value: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg aria-hidden width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - value) : c }}
          animate={{ strokeDashoffset: c * (1 - value) }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${mix(color, 60)})` }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/**
 * The last eight weeks of a figure, as bars: baseline at zero, the latest in
 * the figure's colour, the rest in ink at a quarter. The one chart form the
 * data earns (a series over time), drawn for the data, no library.
 */
export function History({ values, color, className = '' }: { values: number[]; color: string; className?: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...values);
  const w = 8;
  const gap = 3;
  const h = 28;
  const width = values.length * (w + gap) - gap;
  return (
    <svg aria-hidden width={width} height={h} viewBox={`0 0 ${width} ${h}`} className={className}>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * h);
        const last = i === values.length - 1;
        return (
          <motion.rect
            key={i}
            x={i * (w + gap)}
            y={h - bh}
            width={w}
            height={bh}
            rx={1.5}
            fill={last ? color : 'currentColor'}
            opacity={last ? 1 : 0.22}
            style={{ transformOrigin: `${i * (w + gap) + w / 2}px ${h}px` }}
            initial={reduce ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.6, delay: reduce ? 0 : 0.1 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </svg>
  );
}

/** Luna, saying one line in a bubble — the guide, like Duo. */
export function LunaSays({ text, size = 72, className = '' }: { text: string; size?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="shrink-0" style={{ width: size, height: size }}>
        <LunaAvatar variant="head" size={size} showBackdrop={false} title="" />
      </div>
      <div className="relative rounded-2xl rounded-bl-md border border-white/[0.1] bg-white/[0.06] px-5 py-3.5 text-[16px] leading-snug">
        {text}
      </div>
    </div>
  );
}

/** A chunky finding card: icon in the Lesson's colour, a short headline, one big number, one action. */
export function Chunky({ insight, lesson, index = 0 }: { insight: LandingInsight; lesson: LandingLesson; index?: number }) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  const color = lessonColor(lesson);
  const Icon = KIND_ICON[insight.kind];
  const n = bigNumber(insight);
  const copy = cardCopy(t, insight, lesson.title);
  const strong = insight.attention === 'act';
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay: reduce ? 0 : index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-5 rounded-3xl border p-5"
      style={{
        borderColor: mix(color, strong ? 45 : 18),
        background: `linear-gradient(120deg, ${mix(color, strong ? 14 : 6)}, transparent 70%)`,
      }}
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl" style={{ background: mix(color, 22), color, boxShadow: strong ? `0 0 18px ${mix(color, 45)}` : undefined }}>
        <Icon aria-hidden className="h-7 w-7" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-white/50">
          {lesson.title}
          {insight.page ? ` · page ${insight.page}` : ''}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[18px] font-medium leading-snug tracking-[-0.01em]">{copy.headline}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[28px] font-semibold leading-none tabular-nums tracking-[-0.03em]" style={{ color }}>
          {n.value}
        </p>
        <p className="mt-1 text-[11.5px] text-white/50">{n.word}</p>
      </div>
      <span className="hidden h-9 shrink-0 items-center rounded-full bg-white px-4 text-[13px] font-semibold text-black sm:inline-flex">
        {insight.page ? `Page ${insight.page}` : 'Open'}
      </span>
    </motion.div>
  );
}

/** The one line Luna says, from the loudest finding. */
export const LEDE = 'One page is asking for you. The rest is landing.';

export { Check };
