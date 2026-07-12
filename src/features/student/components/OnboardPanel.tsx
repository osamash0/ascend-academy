import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { BookOpenCheck, CircleHelp, Flame, Sparkles } from 'lucide-react';
import { SectionHeader } from '@/components/console';
import { StellaCommander } from '../../../../learnstation-luna';

/**
 * The brand-new-student ("onboard") below-the-fold: a focused "Start here +
 * how it works" instead of the full bento/browse-row firehose. The cinematic
 * hero above already carries the single "Begin" CTA; this panel just explains
 * the loop so a first-timer isn't dropped into an empty-looking dashboard.
 */
export function OnboardPanel() {
  const { t } = useTranslation(['dashboard']);

  const steps = [
    { icon: BookOpenCheck, key: 'learn' as const },
    { icon: CircleHelp, key: 'quiz' as const },
    { icon: Flame, key: 'grow' as const },
  ];

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="p-6 lg:p-12 max-w-4xl mx-auto space-y-8">
        <SectionHeader
          icon={Sparkles}
          eyebrow={t('dashboard:onboard.eyebrow')}
          title={t('dashboard:onboard.title')}
        />

        <div className="depth-card p-6 lg:p-8 flex items-start gap-4">
          <div className="shrink-0 -my-2 -ml-2">
            <StellaCommander size="sm" />
          </div>
          <p className="text-sm lg:text-base text-white/70 leading-relaxed pt-1.5">
            {t('dashboard:onboard.subtitle')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map(({ icon: Icon, key }, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.06 }}
              className="depth-card p-5 space-y-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-primary tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-sm font-black tracking-tight">
                {t(`dashboard:onboard.steps.${key}.title`)}
              </h3>
              <p className="text-xs text-white/55 leading-relaxed">
                {t(`dashboard:onboard.steps.${key}.body`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
