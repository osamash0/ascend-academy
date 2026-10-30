import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { Users } from 'lucide-react';
import { stageCard } from '../components/stage';
import type { LandingAnswer } from './types';

/**
 * An answer, where the question was asked.
 *
 * Lands under the page in the reader: your question, then what the people
 * who run the Space said. When they answered for everyone it carries that
 * mark, and every member sees it on this page — the first thing in a Lesson
 * that was written by the room rather than for it.
 */
export function AnsweredHere({ question, answer, accent, mine = true }: { question: string; answer: LandingAnswer; accent: string; mine?: boolean }) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  return (
    <motion.section
      aria-label={t('reader.answered.title')}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`${stageCard} p-5 sm:p-6`}
      style={{ borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`, background: `color-mix(in srgb, ${accent} 5%, transparent)` }}
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-quiet">
        <span>{t('reader.answered.title')}</span>
        {answer.forEveryone && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-foreground">
            <Users aria-hidden className="h-3 w-3" />
            {t('reader.answered.everyone')}
          </span>
        )}
      </p>
      {mine && (
        <p className="mt-3 text-[13px] text-quiet">
          <span className="mr-2">{t('reader.answered.yours')}</span>
          <span className="text-foreground/80">{question}</span>
        </p>
      )}
      {!mine && <p className="mt-3 text-[13px] text-foreground/80">{question}</p>}
      <p className="mt-3 text-[16px] leading-relaxed">{answer.text}</p>
    </motion.section>
  );
}
