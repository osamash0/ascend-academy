/**
 * Concept check — one question, hint before answer.
 *
 * First wrong pick: the hint, and that option's "why" so the miss teaches
 * something. Second wrong pick: the right answer is revealed with its reason.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ConceptCheckProps, WidgetOutcome } from '../protocol';

export function ConceptCheck({ question, options, hint, onOutcome }: ConceptCheckProps & { onOutcome?: (o: WidgetOutcome) => void }) {
  const { t } = useTranslation('askLuna');
  const [tried, setTried] = useState<number[]>([]);
  const [done, setDone] = useState<'solved' | 'revealed' | null>(null);
  const correctIdx = options.findIndex((o) => o.correct);
  const last = tried[tried.length - 1];

  const pick = (i: number) => {
    if (done || tried.includes(i)) return;
    const next = [...tried, i];
    setTried(next);
    if (options[i].correct) {
      setDone('solved');
      onOutcome?.('correct');
    } else if (next.length >= 2) {
      setDone('revealed');
      onOutcome?.('revealed');
    } else {
      onOutcome?.('hint');
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-sm font-semibold text-white">{question}</p>
      <div className="mt-3 grid gap-2">
        {options.map((o, i) => {
          const wasTried = tried.includes(i);
          const showRight = (done && i === correctIdx);
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={!!done || wasTried}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition',
                showRight && 'border-emerald-400/60 bg-emerald-400/15 text-white',
                wasTried && !o.correct && 'border-rose-400/30 text-white/40 line-through',
                !showRight && !wasTried && 'border-white/10 text-white/85 hover:bg-white/[0.05]',
              )}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 text-[10px]">
                {showRight ? <Check className="h-3 w-3" /> : wasTried ? <X className="h-3 w-3" /> : String.fromCharCode(65 + i)}
              </span>
              {o.text}
            </button>
          );
        })}
      </div>

      {!done && last !== undefined && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-1 rounded-xl bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          <p>{options[last].why}</p>
          <p>💡 {hint}</p>
        </motion.div>
      )}
      {done && (
        <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn('mt-3 rounded-xl px-3 py-2 text-sm', done === 'solved' ? 'bg-emerald-400/10 text-emerald-100' : 'bg-white/[0.05] text-white/80')}>
          {done === 'solved' ? t('check.solved') : t('check.revealed')} {options[correctIdx].why}
        </motion.p>
      )}
    </div>
  );
}
