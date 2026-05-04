/**
 * PracticeSheetTaker — renders a practice sheet for taking.
 * Used by both students and professors (preview mode).
 * On submit, calls the attempts API and shows scores + explanations.
 */
import { useState } from 'react';
import { CheckCircle2, XCircle, ArrowLeft, Send, Loader2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { submitAttempt } from '@/services/practiceSheetsService';
import type { PracticeSheet, PracticeSheetQuestion } from '@/services/practiceSheetsService';

interface Props {
  sheet: PracticeSheet;
  isPreview?: boolean;
  onBack: () => void;
}

function McQuestion({
  question,
  answer,
  onChange,
  submitted,
}: {
  question: PracticeSheetQuestion;
  answer: string;
  onChange: (v: string) => void;
  submitted: boolean;
}) {
  const choices = question.choices ?? [];
  const correct = (question.correct_answer ?? '').trim().toLowerCase();

  return (
    <div className="space-y-3">
      {choices.map((choice, i) => {
        const selected = answer === choice;
        const isCorrect = choice.trim().toLowerCase() === correct;
        let cls =
          'w-full text-left px-4 py-3 rounded-xl border text-sm transition-all ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ';
        if (!submitted) {
          cls += selected
            ? 'border-primary bg-primary/10 text-foreground font-medium'
            : 'border-border hover:border-primary/50 hover:bg-muted/50 text-foreground';
        } else {
          if (isCorrect) cls += 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400 font-medium';
          else if (selected && !isCorrect) cls += 'border-destructive bg-destructive/10 text-destructive font-medium';
          else cls += 'border-border text-muted-foreground';
        }
        return (
          <button
            key={i}
            type="button"
            disabled={submitted}
            onClick={() => onChange(choice)}
            className={cls}
          >
            <span className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full border flex-shrink-0 flex items-center justify-center text-xs font-bold">
                {String.fromCharCode(65 + i)}
              </span>
              <span>{choice}</span>
              {submitted && isCorrect && <CheckCircle2 className="w-4 h-4 ml-auto flex-shrink-0 text-green-500" />}
              {submitted && selected && !isCorrect && <XCircle className="w-4 h-4 ml-auto flex-shrink-0 text-destructive" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PracticeSheetTaker({ sheet, isPreview = false, onBack }: Props) {
  const { toast } = useToast();
  const questions: PracticeSheetQuestion[] = sheet.questions ?? [];

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setAnswer = (qid: string, val: string) =>
    setAnswers(prev => ({ ...prev, [qid]: val }));

  const handleSubmit = async () => {
    if (submitting || submitted) return;
    setSubmitting(true);
    try {
      const result = await submitAttempt(sheet.id, answers, isPreview);
      setScore(result.score ?? null);
      setSubmitted(true);
      if (isPreview) {
        toast({ title: 'Preview complete', description: 'This attempt is stored but not counted toward student progress or analytics.' });
      } else {
        toast({
          title: 'Sheet submitted!',
          description: result.score != null ? `Your score: ${result.score}%` : 'Free-form answers are self-assessed.',
        });
      }
    } catch (err) {
      toast({
        title: 'Submission failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const gradeable = questions.filter(q => q.type !== 'free_form');
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="space-y-6 print:space-y-8">
      {/* Header */}
      <div className="flex items-start gap-3 no-print">
        <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5 flex-shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-foreground truncate">{sheet.title}</h2>
            {isPreview && (
              <span className="flex items-center gap-1 text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                <Eye className="w-3 h-3" /> Preview mode
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {questions.length} question{questions.length !== 1 ? 's' : ''}
            {gradeable.length > 0 && ` · ${gradeable.length} auto-graded`}
          </p>
        </div>
      </div>

      {/* Score banner */}
      {submitted && score !== null && (
        <div className={`rounded-2xl p-5 flex items-center gap-4 ${score >= 70 ? 'bg-green-500/10 border border-green-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
          <div className={`text-4xl font-black ${score >= 70 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {score}%
          </div>
          <div>
            <p className="font-semibold text-foreground">
              {score >= 90 ? 'Excellent!' : score >= 70 ? 'Good work!' : 'Keep practising!'}
            </p>
            <p className="text-sm text-muted-foreground">
              {gradeable.length > 0
                ? `Scored on ${gradeable.length} gradeable question${gradeable.length !== 1 ? 's' : ''}`
                : 'Self-assess your free-form answers below.'}
            </p>
          </div>
        </div>
      )}

      {/* Questions */}
      <div className="space-y-8 print:space-y-10">
        {questions.map((q, idx) => (
          <div key={q.id} className="bg-card rounded-2xl border border-border p-6 print:border-gray-300 print:rounded-none print:shadow-none">
            <div className="flex items-start gap-3 mb-4">
              <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground leading-relaxed">{q.prompt}</p>
                {q.type !== 'multiple_choice' && (
                  <span className="text-xs text-muted-foreground mt-1 inline-block capitalize">
                    {q.type === 'short_answer' ? 'Short answer' : 'Free-form / self-assessed'}
                  </span>
                )}
              </div>
            </div>

            {q.type === 'multiple_choice' ? (
              <McQuestion
                question={q}
                answer={answers[q.id] ?? ''}
                onChange={v => setAnswer(q.id, v)}
                submitted={submitted}
              />
            ) : (
              <div className="ml-10">
                <Textarea
                  value={answers[q.id] ?? ''}
                  onChange={e => setAnswer(q.id, e.target.value)}
                  disabled={submitted}
                  placeholder={q.type === 'short_answer' ? 'Type your answer…' : 'Write your response…'}
                  rows={q.type === 'free_form' ? 5 : 2}
                  className="text-sm resize-none print:border-gray-300"
                />
                {submitted && q.correct_answer && (
                  <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">Model answer</p>
                    <p className="text-foreground">{q.correct_answer}</p>
                  </div>
                )}
              </div>
            )}

            {submitted && q.explanation && (
              <div className="mt-4 ml-10 rounded-lg bg-muted/60 px-4 py-3 text-sm">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Explanation</p>
                <p className="text-foreground">{q.explanation}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Submit */}
      {!submitted && (
        <div className="flex items-center justify-between pt-2 no-print">
          <p className="text-sm text-muted-foreground">
            {answeredCount}/{questions.length} answered
          </p>
          <Button
            onClick={handleSubmit}
            disabled={submitting || answeredCount === 0}
            className="gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {isPreview ? 'Submit Preview' : 'Submit'}
          </Button>
        </div>
      )}

      {submitted && (
        <div className="flex justify-end no-print">
          <Button variant="outline" onClick={onBack}>Back to sheets</Button>
        </div>
      )}
    </div>
  );
}
