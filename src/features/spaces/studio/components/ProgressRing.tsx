import { motion, useReducedMotion } from 'motion/react';

/** A thin ring that fills teal as you recall a page's terms. One soft pulse when it closes. */
export function ProgressRing({
  knew,
  total,
  size = 18,
  label,
}: {
  knew: number;
  total: number;
  size?: number;
  label: string;
}) {
  const reduce = useReducedMotion();
  if (total === 0) return <></>;
  const complete = knew === total;
  const r = 7;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, knew / total);
  return (
    <motion.span
      key={complete ? 'complete' : 'open'}
      data-complete={complete ? 'true' : undefined}
      className="inline-flex shrink-0"
      initial={complete && !reduce ? { scale: 0.88 } : false}
      animate={{ scale: 1 }}
      transition={{ duration: reduce ? 0.15 : 0.5, ease: 'easeOut' }}
    >
      <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 18 18">
        <circle cx="9" cy="9" r={r} fill="none" stroke="rgb(var(--studio-hairline))" strokeWidth="1.5" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke="rgb(var(--studio-woven))"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 9 9)"
        />
      </svg>
    </motion.span>
  );
}
