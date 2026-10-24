import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gradeAnswer, type PracticeQuestion, type ServerGrade } from '../../data/practice';
import { Pressable } from '../Pressable';
import { Plane } from './Planes';
import { useSummoned } from './useSummoned';

/**
 * The workbench, with practice on it.
 *
 * A plane of its own: when it comes forward the face recedes into the room
 * exactly as the other face does, and pressing the room brings the reading
 * back. So leaving practice is the same gesture as switching faces, which is
 * the point — one motion, one meaning.
 *
 * The questions are the Lesson's practice bank — the fixtures in demo, the
 * lecture's real quiz questions live (`data/practice.ts`). Feedback is
 * immediate and local; `onAnswer` (live only) is where the answer *counts*:
 * the server grades it again, logs the attempt and grants XP once per
 * question. The XP line appears only when the server says it was granted.
 */

interface Props {
  open: boolean;
  lessonTitle: string;
  questions: PracticeQuestion[];
  onClose: () => void;
  onAnswer?: (q: PracticeQuestion, answer: string) => Promise<ServerGrade>;
}

export function PracticePlane({ open, lessonTitle, questions, onClose, onAnswer }: Props) {
  const { t } = useTranslation('v4Reader');
  const ref = useRef<HTMLElement>(null);
  const [i, setI] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [xp, setXp] = useState(0);
  useSummoned(open, onClose, ref);

  if (!open) return null;
  const q = questions[i];
  const graded = checked && q && chosen !== null ? gradeAnswer(q, chosen) : null;
  const last = i === questions.length - 1;

  const check = () => {
    setChecked(true);
    if (onAnswer && q && chosen !== null) {
      onAnswer(q, chosen)
        .then((g) => setXp(g.xp))
        .catch(() => {
          /* The grade on screen stands; only the server's record of it was lost. */
        });
    }
  };

  const next = () => {
    setChosen(null);
    setChecked(false);
    setXp(0);
    if (last) onClose();
    else setI((n) => n + 1);
  };

  return (
    <Plane focused label={t('practice.label')} className="z-[3]">
      <div
        className="flex h-full items-start justify-center overflow-y-auto bg-[#070b14]/70 px-6 pb-[20vh] pt-[16vh]"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <section
          ref={ref}
          tabIndex={-1}
          aria-label={t('practice.heading', { title: lessonTitle })}
          className="w-full max-w-[560px] rounded-xl border border-white/[0.08] bg-[#0b1020]/95 p-7 outline-none shadow-[0_24px_80px_-24px_rgba(0,0,0,0.6)] backdrop-blur-md"
        >
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-quiet">
              {t('practice.heading', { title: lessonTitle })}
              {questions.length > 0 && (
                <span className="tabular-nums">
                  {' '}
                  · {i + 1} / {questions.length}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="console-focusable inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              {t('practice.back')}
            </button>
          </div>

          {!q ? (
            <p className="text-[15px] leading-[1.6] text-quiet">{t('practice.empty')}</p>
          ) : (
            <>
              <h2 className="text-[20px] font-semibold leading-[1.35] tracking-[-0.01em] text-foreground">
                {q.prompt}
              </h2>
              <div className="mt-6 flex flex-col gap-2">
                {q.choices.map((c) => {
                  const picked = chosen === c;
                  const right = graded && c === graded.correctAnswer;
                  const wrong = graded && picked && !graded.correct;
                  return (
                    <Pressable
                      key={c}
                      subtle
                      disabled={checked}
                      aria-pressed={picked}
                      onClick={() => setChosen(c)}
                      className={cn(
                        'console-focusable flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-[15px] leading-[1.5] transition-colors',
                        right
                          ? 'border-success/60 bg-success/10 text-foreground'
                          : wrong
                            ? 'border-destructive/50 bg-destructive/10 text-foreground'
                            : picked
                              ? 'border-white/[0.3] bg-white/[0.06] text-foreground'
                              : 'border-white/[0.08] bg-white/[0.02] text-quiet hover:text-foreground',
                      )}
                    >
                      {right && <Check aria-hidden className="mt-1 h-4 w-4 shrink-0" />}
                      <span>{c}</span>
                    </Pressable>
                  );
                })}
              </div>

              {graded && (
                <p aria-live="polite" className="mt-5 text-[14.5px] leading-[1.6] text-quiet">
                  <span className="font-medium text-foreground">{graded.correct ? t('practice.right') : t('practice.notQuite')}</span>
                  {graded.explanation}
                </p>
              )}
              {xp > 0 && (
                <p aria-live="polite" className="mt-2 text-[13px] tabular-nums text-success">
                  +{xp} XP
                </p>
              )}

              <div className="mt-6 flex justify-end">
                {!checked ? (
                  <button
                    type="button"
                    disabled={chosen === null}
                    onClick={check}
                    className="console-focusable inline-flex h-10 items-center rounded-full bg-white px-5 text-[14px] font-semibold text-slate-900 disabled:bg-white/[0.10] disabled:text-quiet"
                  >
                    {t('practice.check')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={next}
                    className="console-focusable inline-flex h-10 items-center rounded-full bg-white px-5 text-[14px] font-semibold text-slate-900"
                  >
                    {last ? t('practice.back') : t('practice.next')}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </Plane>
  );
}
