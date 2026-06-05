import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';

interface ReviewCelebrationProps {
  /** First name to congratulate. */
  name: string;
  /** Number of lectures completed. */
  completed: number;
  /** Overall quiz accuracy, 0–100. */
  accuracy: number;
  /** Current day streak. */
  streak: number;
}

/**
 * The "all caught up" (review) banner: a celebratory headline + a few proud
 * numbers, shown above the browse rails so a student who's finished everything
 * lands on a win rather than a stale to-do list. The hero above already points
 * them at their weakest lecture to revisit.
 */
export function ReviewCelebration({ name, completed, accuracy, streak }: ReviewCelebrationProps) {
  const { t } = useTranslation(['dashboard']);

  const stats = [
    { value: completed, label: t('dashboard:review.stat.completed') },
    { value: `${accuracy}%`, label: t('dashboard:review.stat.accuracy') },
    { value: streak, label: t('dashboard:review.stat.streak') },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="depth-card relative overflow-hidden p-6 lg:p-8"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-secondary/5 to-transparent" />
      <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.3em] text-primary">
              {t('dashboard:review.eyebrow')}
            </span>
            <h2 className="text-2xl lg:text-3xl font-black tracking-tight leading-tight">
              {t('dashboard:review.title')}
            </h2>
            <p className="text-sm text-white/60 max-w-md">
              {t('dashboard:review.subtitle', { name })}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 gap-6 md:gap-8">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-black tabular-nums text-white">{s.value}</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/50">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
