import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Flag, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StudentRoutes } from '@/lib/routes';
import { useExam, useGenerateExam } from './useExam';

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function ExamRunner() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['exam']);

  const [examId, setExamId] = useState<string | undefined>(undefined);
  const generateMutation = useGenerateExam();
  const generateStarted = useRef(false);

  useEffect(() => {
    if (!courseId || generateStarted.current) return;
    generateStarted.current = true;
    generateMutation.mutate(
      { courseId },
      { onSuccess: (data) => setExamId(data.exam_id) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const { exam, isLoading, saveAnswer, submit, isSubmitting } = useExam(examId);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remainingS, setRemainingS] = useState<number | null>(null);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (exam?.answers) setAnswers((prev) => ({ ...exam.answers, ...prev }));
  }, [exam?.answers]);

  useEffect(() => {
    if (!exam || exam.submitted_at) return;
    const deadline = new Date(exam.started_at).getTime() + exam.time_limit_s * 1000;
    const tick = () => setRemainingS(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [exam]);

  const questions = exam?.questions ?? [];
  const current = questions[index];
  const answeredCount = Object.keys(answers).length;

  const handleSubmit = useMemo(
    () => async () => {
      const result = await submit(answers);
      navigate(StudentRoutes.EXAM_REPORT(result.exam_id));
    },
    [submit, answers, navigate],
  );

  useEffect(() => {
    if (remainingS === 0 && !autoSubmitted.current && exam && !exam.submitted_at) {
      autoSubmitted.current = true;
      void handleSubmit();
    }
  }, [remainingS, exam, handleSubmit]);

  const selectAnswer = (questionId: string, optionIdx: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIdx }));
    saveAnswer(questionId, optionIdx);
  };

  const toggleFlag = (questionId: string) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  if (generateMutation.isPending || isLoading || !current) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        {t('exam:runner.loading')}
      </div>
    );
  }

  if (generateMutation.isError) {
    const message = (generateMutation.error as Error)?.message ?? '';
    const notEnough = message.includes('400');
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm text-muted-foreground max-w-md">
          {notEnough ? t('exam:generate.notEnoughQuestions') : t('exam:generate.rateLimited')}
        </p>
        <Button className="mt-6" onClick={() => navigate(StudentRoutes.HOME)}>
          {t('exam:report.backToDashboard')}
        </Button>
      </div>
    );
  }

  const progressPct = Math.round(((index + 1) / questions.length) * 100);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex-1">
          <Progress value={progressPct} className="h-1.5" />
          <p className="text-xs text-muted-foreground mt-2">
            {t('exam:runner.question', { current: index + 1, total: questions.length })}
          </p>
        </div>
        {remainingS !== null && (
          <div className="text-sm font-mono font-semibold tabular-nums text-foreground shrink-0" data-testid="exam-timer">
            {formatClock(remainingS)}
          </div>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-lg" data-testid="exam-question">
          <div className="flex items-start justify-between gap-4 mb-4">
            <p className="text-lg font-semibold text-foreground">{current.question_text}</p>
            <button
              type="button"
              onClick={() => toggleFlag(current.id)}
              className={`shrink-0 flex items-center gap-1 text-xs font-medium rounded-full px-2 py-1 border transition-colors ${
                flagged.has(current.id)
                  ? 'border-amber-400 text-amber-500 bg-amber-500/10'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Flag className="w-3 h-3" />
              {flagged.has(current.id) ? t('exam:runner.flagged') : t('exam:runner.flagForReview')}
            </button>
          </div>
          <div className="space-y-2">
            {current.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectAnswer(current.id, i)}
                data-testid={`exam-option-${i}`}
                className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
                  answers[current.id] === i
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/40'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 pb-8 flex items-center justify-between max-w-lg mx-auto w-full gap-3">
        <Button variant="outline" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          <ChevronLeft className="w-4 h-4 mr-1" /> {t('exam:runner.previous')}
        </Button>
        {index < questions.length - 1 ? (
          <Button onClick={() => setIndex((i) => i + 1)}>
            {t('exam:runner.next')} <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={() => setConfirmOpen(true)} disabled={isSubmitting}>
            {t('exam:runner.submit')}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('exam:runner.submitConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('exam:runner.submitConfirmBody', { answered: answeredCount, total: questions.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('exam:runner.submitConfirmCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSubmit()} disabled={isSubmitting}>
              {t('exam:runner.submitConfirmOk')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
