import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { Landing } from './types';

/**
 * Three figures, each with its last eight weeks.
 *
 * A large figure and a worded qualifier, never a gauge; a figure that moves
 * over time shows where it came from. Parted by hairlines, not boxed.
 */
export function Figures({ landing, accent }: { landing: Landing; accent: string }) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  const { reading, landing: lands, cleared } = landing.figures;
  const rows = [
    { key: 'reading', number: `${reading.value}`, label: t('figures.reading', { members: landing.members }), history: reading.history, color: 'hsl(var(--foreground))' },
    { key: 'landing', number: `${lands.value}%`, label: t('figures.landing'), history: lands.history, color: accent },
    { key: 'cleared', number: `${cleared.value}%`, label: t('figures.cleared'), history: cleared.history, color: 'hsl(var(--success))' },
  ];
  return (
    <motion.dl
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto grid max-w-3xl grid-cols-3 divide-x divide-white/[0.08]"
    >
      {rows.map((r, i) => (
        <div key={r.key} className={cn('flex flex-col px-4 sm:px-8', i === 0 && 'pl-0', i === rows.length - 1 && 'pr-0')}>
          <dd className="text-[34px] font-medium leading-none tabular-nums tracking-[-0.03em] sm:text-[48px]">{r.number}</dd>
          <dt className="mt-2 max-w-[16ch] text-[13px] leading-snug text-quiet">{r.label}</dt>
          {r.history.length > 1 && <History values={r.history} color={r.color} className="mt-4" />}
        </div>
      ))}
    </motion.dl>
  );
}

/**
 * The last weeks as bars: baseline at zero, the latest in the figure's
 * colour, the rest in ink at a fifth. A series over time, drawn for the data.
 */
function History({ values, color, className }: { values: number[]; color: string; className?: string }) {
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
        const x = i * (w + gap);
        return (
          <motion.rect
            key={i}
            x={x}
            y={h - bh}
            width={w}
            height={bh}
            rx={1.5}
            fill={last ? color : 'currentColor'}
            opacity={last ? 1 : 0.22}
            style={{ transformOrigin: `${x + w / 2}px ${h}px` }}
            initial={reduce ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.6, delay: reduce ? 0 : 0.1 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </svg>
  );
}
