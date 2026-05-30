import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Trophy, Zap, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { QuizQuestion } from '@/types/domain';

export interface RecapItem {
  question: QuizQuestion;
  slideIndex: number;
  slideTitle?: string;
  firstSelectedIndex: number;
  secondSelectedIndex: number | null;
}

interface LectureRecapProps {
  items: RecapItem[];
  xpEarned: number;
  correctOnFirstTry: number;
  totalQuestions: number;
  onDone: () => void;
}

function answerLabel(options: string[], index: number | null): string {
  if (index === null || index < 0 || index >= options.length) return '—';
  const letter = String.fromCharCode(65 + index);
  return `${letter}. ${options[index]}`;
}

export function LectureRecap({
  items,
  xpEarned,
  correctOnFirstTry,
  totalQuestions,
  onDone,
}: LectureRecapProps) {
  const recoveredCount = items.filter(
    (i) => i.secondSelectedIndex !== null && i.secondSelectedIndex === i.question.correct_answer,
  ).length;

  return (
    <motion.div
      data-testid="lecture-recap"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="bg-card rounded-2xl border border-border p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
            <Trophy className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Lecture complete</h2>
            <p className="text-xs text-muted-foreground">
              {correctOnFirstTry}/{totalQuestions} correct on first try · +{xpEarned} XP
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Perfect run — no questions missed. Nice work!
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            You revisited {items.length} question{items.length === 1 ? '' : 's'} and got{' '}
            <span className="font-semibold text-foreground">{recoveredCount}</span> right on the
            second pass.
          </p>
        )}
      </div>

      {items.length > 0 && (
        <div className="space-y-3" data-testid="recap-items">
          {items.map((item, idx) => {
            const correctIdx = item.question.correct_answer;
            const recovered =
              item.secondSelectedIndex !== null && item.secondSelectedIndex === correctIdx;
            return (
              <div
                key={`${item.question.id}-${idx}`}
                data-testid="recap-item"
                className="bg-card rounded-2xl border border-border p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    {item.slideTitle && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                        {item.slideTitle}
                      </p>
                    )}
                    <p className="text-sm font-semibold text-foreground">
                      {item.question.question_text}
                    </p>
                  </div>
                  {recovered ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-success shrink-0">
                      <RotateCcw className="w-3.5 h-3.5" />
                      Got it on retry
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold text-destructive shrink-0">
                      <XCircle className="w-3.5 h-3.5" />
                      Still missed
                    </span>
                  )}
                </div>

                <dl className="grid grid-cols-1 gap-2 text-xs">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <dt className="font-semibold text-muted-foreground">First answer</dt>
                      <dd className="text-foreground">
                        {answerLabel(item.question.options, item.firstSelectedIndex)}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    {recovered ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div>
                      <dt className="font-semibold text-muted-foreground">Your retry answer</dt>
                      <dd className="text-foreground">
                        {answerLabel(item.question.options, item.secondSelectedIndex)}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                    <div>
                      <dt className="font-semibold text-muted-foreground">Correct answer</dt>
                      <dd className="text-foreground">
                        {answerLabel(item.question.options, correctIdx)}
                      </dd>
                    </div>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      )}

      <Button
        data-testid="recap-done"
        onClick={onDone}
        className="w-full gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary border-none hover:opacity-90"
      >
        <Zap className="w-4 h-4" />
        Back to dashboard
      </Button>
    </motion.div>
  );
}
