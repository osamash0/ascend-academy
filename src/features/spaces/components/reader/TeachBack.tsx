import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BookOpen, Check, PenLine, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TeachBack as Reading } from '../../data/liveRepository';
import { annotate } from './teach';

/**
 * Teach it back.
 *
 * Explaining an idea in your own words is the strongest test of having
 * understood it — and the gaps show only when you try. So: write it as if
 * to a friend who missed the lecture; the reader holds it against what the
 * pages actually teach and gives it back to you *as you wrote it*, with the
 * wrong parts underlined and corrected, the points you got across ticked,
 * and the ones you missed each one press from the page that teaches them.
 */

interface Props {
  /** The idea to explain; null when closed. */
  idea: { name: string; first: number; last: number } | null;
  read: (explanation: string) => Promise<Reading>;
  /** Go to a page (the reader turns to it; elsewhere it opens the reader there). */
  onPage: (page: number) => void;
  onResult?: (reading: Reading) => void;
  onClose: () => void;
}

type Phase = 'write' | 'reading' | 'read' | 'failed';

const MIN = 40;

const VERDICT: Record<Reading['verdict'], string> = {
  solid: 'teach.verdict.solid',
  partial: 'teach.verdict.partial',
  off: 'teach.verdict.off',
};

export function TeachBack({ idea, read, onPage, onResult, onClose }: Props) {
  const { t } = useTranslation('v4Reader');
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('write');
  const [text, setText] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const key = idea ? `${idea.first}-${idea.last}` : '';

  /* A different idea starts a fresh page. */
  useEffect(() => {
    setPhase('write');
    setText('');
    setReading(null);
    setFocus(null);
  }, [key]);

  useEffect(() => {
    if (!idea) return;
    if (phase === 'write') boxRef.current?.focus({ preventScroll: true });
    else panelRef.current?.focus({ preventScroll: true });
  }, [idea, phase]);

  const submit = () => {
    if (text.trim().length < MIN) return;
    setPhase('reading');
    read(text)
      .then((r) => {
        setReading(r);
        setPhase('read');
        onResult?.(r);
      })
      .catch(() => setPhase('failed'));
  };

  const covered = reading?.points.filter((p) => p.covered).length ?? 0;

  return (
    <AnimatePresence>
      {idea && (
        <motion.div
          key={`teach-${key}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[50] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('teach.label', { name: idea.name })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              /* Typing and arrows belong to the panel, not to the pages behind it. */
              e.stopPropagation();
            }}
            initial={reduce ? false : { y: 16, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/[0.09] bg-[#0b0b0c] p-6 outline-none sm:p-8"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] text-quiet">
                  <PenLine aria-hidden className="h-3.5 w-3.5" />
                  {t('teach.heading', { first: idea.first, last: idea.last })}
                </p>
                <h2 className="mt-1.5 text-[22px] font-medium leading-snug tracking-[-0.01em] text-foreground">{idea.name}</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('teach.close')}
                className="console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>

            {(phase === 'write' || phase === 'reading' || phase === 'failed') && (
              <>
                <label htmlFor="teach-back-text" className="block text-[15px] leading-[1.5] text-quiet">
                  {t('teach.prompt')}
                </label>
                <textarea
                  id="teach-back-text"
                  ref={boxRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                  }}
                  disabled={phase === 'reading'}
                  maxLength={2000}
                  rows={7}
                  placeholder={t('teach.placeholder')}
                  className="mt-3 w-full resize-y rounded-2xl border border-white/[0.1] bg-white/[0.03] p-4 text-[15px] leading-[1.6] text-foreground outline-none placeholder:text-faint focus:border-white/[0.25] disabled:opacity-60"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={phase === 'reading' || text.trim().length < MIN}
                    className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-medium text-background transition-colors disabled:bg-white/[0.12] disabled:text-faint"
                  >
                    {phase === 'reading' ? t('teach.reading', { first: idea.first, last: idea.last }) : t('teach.submit')}
                    {phase !== 'reading' && <ArrowRight aria-hidden className="h-4 w-4" />}
                  </button>
                  {text.trim().length < MIN && phase === 'write' && (
                    <span className="text-[12.5px] text-faint">{t('teach.hint')}</span>
                  )}
                  {phase === 'failed' && <span className="text-[13px] text-destructive">{t('teach.failed')}</span>}
                </div>
              </>
            )}

            {phase === 'read' && reading && (
              <div>
                <p
                  className={cn(
                    'text-[17px] font-medium',
                    reading.verdict === 'solid' ? 'text-success' : 'text-foreground',
                  )}
                >
                  {t(VERDICT[reading.verdict])}
                </p>

                {/* Their words, given back with the wrong parts marked. */}
                <blockquote className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-[15px] leading-[1.65] text-foreground">
                  {annotate(text, reading.wrong.map((w) => w.quote)).map((run, i) =>
                    run.wrong === null ? (
                      <span key={i}>{run.text}</span>
                    ) : (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setFocus(run.wrong)}
                        className={cn(
                          'console-focusable inline rounded-sm text-left underline decoration-destructive decoration-wavy decoration-[1.5px] underline-offset-4 transition-colors',
                          focus === run.wrong ? 'bg-destructive/[0.16]' : 'hover:bg-destructive/[0.1]',
                        )}
                      >
                        {run.text}
                      </button>
                    ),
                  )}
                </blockquote>

                {reading.wrong.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {reading.wrong.map((w, i) => (
                      <li
                        key={w.quote}
                        className={cn(
                          'rounded-2xl border p-3.5 text-[14px] leading-[1.5] transition-colors',
                          focus === i ? 'border-destructive/50 bg-destructive/[0.08]' : 'border-white/[0.06]',
                        )}
                      >
                        <span className="text-foreground">{w.correction}</span>
                        <button
                          type="button"
                          onClick={() => onPage(w.page)}
                          className="console-focusable ml-2 inline-flex items-center gap-1 rounded-full text-[12.5px] text-quiet transition-colors hover:text-foreground"
                        >
                          <BookOpen aria-hidden className="h-3 w-3" />
                          {t('teach.correctionPage', { page: w.page })}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* What the pages teach: ticked if you got it across, else one press from its page. */}
                <p className="mb-2 mt-6 text-[13px] tabular-nums text-quiet">
                  {t('teach.points', { covered, total: reading.points.length })}
                </p>
                <ul className="space-y-1.5">
                  {reading.points.map((p) => (
                    <li key={p.point} className="flex items-start gap-3 rounded-xl px-1 py-1.5">
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                          p.covered ? 'bg-success/[0.18] text-success' : 'border border-white/[0.25]',
                        )}
                      >
                        {p.covered && <Check aria-hidden className="h-3 w-3" />}
                      </span>
                      <span className={cn('flex-1 text-[14px] leading-[1.5]', p.covered ? 'text-foreground' : 'text-quiet')}>
                        {p.point}
                      </span>
                      {!p.covered && (
                        <button
                          type="button"
                          onClick={() => onPage(p.page)}
                          className="console-focusable shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-[12.5px] text-foreground transition-colors hover:bg-white/[0.12]"
                        >
                          {t('teach.pointPage', { page: p.page })}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {reading.next && <p className="mt-5 text-[14px] leading-[1.5] text-quiet">{reading.next}</p>}

                <div className="mt-6 flex flex-wrap gap-2">
                  {reading.verdict !== 'solid' && (
                    <button
                      type="button"
                      onClick={() => setPhase('write')}
                      className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-medium text-background transition-colors"
                    >
                      <RotateCcw aria-hidden className="h-4 w-4" />
                      {t('teach.retry')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className={cn(
                      'console-focusable inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] transition-colors',
                      reading.verdict === 'solid'
                        ? 'bg-white font-medium text-background'
                        : 'bg-white/[0.07] text-foreground hover:bg-white/[0.12]',
                    )}
                  >
                    {t('teach.keepReading')}
                    <ArrowRight aria-hidden className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
