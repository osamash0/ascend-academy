import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, RefreshCw, Send, BrainCircuit, Rocket } from 'lucide-react';
import { useGenerateExam, useExamAttempt, useSaveExamAnswer, useSubmitExam, getExamErrorMessage } from '@/features/student/hooks/useExamMode';
import { DepthScene } from '@/components/console';
import { toast } from 'sonner';
import { PixelSpark, LunaLoader } from '../../learnstation-luna';
import { useAuth } from '@/lib/auth';
import { StudentRoutes } from '@/lib/routes';
import { recordOnboardingActivation, recordOnboardingEvent } from '@/services/onboardingService';

// Must match backend/api/v1/exams.py's GRACE_SECONDS — the server accepts
// (and grades) a submission up to this many seconds after time_limit_s and
// merely flags it `expired`; it never rejects a late submit. The client
// mirrors the same deadline purely to know when to auto-submit, not to
// enforce anything the server doesn't already enforce itself.
const GRACE_SECONDS = 30;

// ── Configuration Screen ──────────────────────────────────────────────────
export function MockExamConfig() {
  const { t } = useTranslation('exam');
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const generateExam = useGenerateExam(courseId || '');

  const [numQuestions, setNumQuestions] = useState(20);

  if (!courseId) return null;

  const handleStart = async () => {
    try {
      const res = await generateExam.mutateAsync({ num_questions: numQuestions });
      void recordOnboardingActivation('mock_exam', courseId);
      navigate(`/exam/take/${res.exam_id}`);
    } catch (err: unknown) {
      console.error(err);
      toast.error(getExamErrorMessage(err, t, 'generate'));
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:50px_50px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card max-w-md w-full p-8 rounded-[32px] border border-white/10 relative z-10 text-center"
      >
        <div className="mx-auto mb-2 flex justify-center">
          <PixelSpark size="sm" />
        </div>

        <h1 className="text-3xl font-black tracking-tight text-foreground mb-2">{t('generate.title')}</h1>
        <p className="text-muted-foreground mb-8">
          {t('generate.subtitle')}
        </p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">
              {t('generate.numQuestions')}
            </label>
            <div className="flex gap-3 justify-center">
              {[20, 30, 40].map(n => (
                <button
                  key={n}
                  onClick={() => setNumQuestions(n)}
                  className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center transition-all ${
                    numQuestions === n 
                      ? 'bg-primary text-white shadow-glow-primary scale-110 font-black' 
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground border border-white/5'
                  }`}
                >
                  <span className="text-xl leading-none">{n}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleStart}
            disabled={generateExam.isPending}
            className="w-full mt-6 rounded-2xl bg-gradient-to-r from-primary to-secondary px-8 py-4 text-sm font-black uppercase tracking-widest text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-glow-primary/30"
          >
            {generateExam.isPending ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Rocket className="w-5 h-5" />
                {t('generate.start')}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Exam Taking Screen ────────────────────────────────────────────────────
export function MockExamTake() {
  const { t } = useTranslation('exam');
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  // R9: don't destructure just `isError` — react-query also has an
  // `isPaused` state (fetchStatus: 'paused') when the browser reports
  // itself offline mid-retry: `isLoading` is false, `isError` is false, and
  // `data` stays undefined, exactly like a normal error, but the query is
  // just waiting for connectivity rather than having failed outright. An
  // offline refresh mid-exam hits this, not `isError` — both need the same
  // error/retry UI, so the render check below is `isError || isPaused`.
  const { data: exam, isLoading, isError, isPaused, refetch } = useExamAttempt(examId);
  const saveAnswer = useSaveExamAnswer(examId || '');
  const submitExam = useSubmitExam(examId || '');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // R32: only hydrate local `answers` from the server once per attempt (on
  // first load, or when navigating to a different exam_id) — never again
  // after that. Local state is already the source of truth for what the
  // student picked (set synchronously on click, before the autosave POST
  // even fires); re-hydrating from any later background refetch risked
  // reverting a newer local selection back to a stale server snapshot.
  const hydratedExamIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (exam && exam.exam_id && hydratedExamIdRef.current !== exam.exam_id) {
      setAnswers(exam.answers || {});
      hydratedExamIdRef.current = exam.exam_id;
    }
  }, [exam]);

  // Latest answers, readable from the timer interval below without
  // recreating the interval on every keystroke/click.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const autoSubmitTriggeredRef = useRef(false);

  // Soft Timer — also owns auto-submit once the grace deadline passes.
  useEffect(() => {
    if (!exam || exam.submitted_at) return;

    // Calculate elapsed based on started_at to be resilient to reloads
    const started = new Date(exam.started_at).getTime();
    const deadlineMs = started + (exam.time_limit_s + GRACE_SECONDS) * 1000;

    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000));

      // R30: the backend never rejects a late submit — submit_exam() in
      // backend/api/v1/exams.py grades whatever was sent and just flags
      // `expired: true`. So once the grace deadline passes, auto-submitting
      // whatever's been answered so far is safe and matches what the
      // backend already does, instead of leaving the exam stuck open with
      // no countdown and no way for the student to know time is long gone.
      if (Date.now() >= deadlineMs && !autoSubmitTriggeredRef.current) {
        autoSubmitTriggeredRef.current = true;
        void submitExam
          .mutateAsync({ answers: answersRef.current })
          .then(() => navigate(`/exam/report/${exam.exam_id}`))
          .catch((err: unknown) => {
            console.error('Auto-submit at expiry failed', err);
            toast.error(getExamErrorMessage(err, t, 'submit'));
          });
      }
    };

    tick();
    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LunaLoader type="pixel-dash" size={72} />
      </div>
    );
  }

  // R9: a failed attempt fetch (403/404/500, or an offline refresh mid-exam)
  // used to fall straight through to `!exam || !exam.questions` returning
  // `null` — a blank page inside the console shell, no message, no retry,
  // no way back except manual navigation. Give it a real error state.
  if (isError || (isPaused && !exam)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-center px-6">
        <div className="glass-card max-w-md w-full p-8 rounded-[32px] border border-white/10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto mb-5 text-rose-400">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black text-foreground mb-2">{t('runner.loadErrorTitle')}</h2>
          <p className="text-sm text-muted-foreground mb-8">{t('runner.loadErrorSubtitle')}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => refetch()}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-black text-sm tracking-widest uppercase hover:scale-105 active:scale-95 transition-all shadow-glow-primary"
            >
              <RefreshCw className="w-4 h-4" />
              {t('runner.retry')}
            </button>
            <button
              onClick={() => navigate(StudentRoutes.HOME)}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-muted-foreground font-bold text-sm tracking-wider uppercase hover:bg-white/10 hover:text-foreground transition-all"
            >
              {t('report.backToDashboard')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!exam || !exam.questions) return null;

  // If already submitted, redirect to report. Rendering a <Navigate> element
  // (rather than calling navigate() directly in the render body) keeps the
  // side effect out of render — calling navigate() here triggers React's
  // "Cannot update a component while rendering a different component"
  // warning, since it synchronously updates router state mid-render.
  if (exam.submitted_at) {
    return <Navigate to={`/exam/report/${exam.exam_id}`} replace />;
  }

  const questions = exam.questions;
  const currentQ = questions[currentIndex];

  const timeLimit = exam.time_limit_s;
  const isOverTime = elapsedSeconds > timeLimit;
  const isInGracePeriod = isOverTime && elapsedSeconds <= timeLimit + GRACE_SECONDS;

  const handleOptionSelect = (optIndex: number) => {
    // Defensive: the timer effect above auto-submits once the grace
    // deadline passes, but there's up to a ~1s window each tick — don't let
    // a click register a change after time is truly up.
    if (elapsedSeconds > timeLimit + GRACE_SECONDS) return;
    const newAnswers = { ...answers, [currentQ.id]: optIndex };
    setAnswers(newAnswers);
    saveAnswer.mutate({ question_id: currentQ.id, selected: optIndex });
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    const answeredCount = Object.keys(answers).length;
    const confirmMessage = `${t('runner.submitConfirmTitle')}\n\n${t('runner.submitConfirmBody', { answered: answeredCount, total: questions.length })}`;
    if (window.confirm(confirmMessage)) {
      try {
        await submitExam.mutateAsync({ answers });
        if (user?.id) {
          void recordOnboardingEvent(user.id, 'learning_activity_completed', {
            activity_type: 'mock_exam',
            course_id: exam.course_id,
            exam_id: exam.exam_id,
          });
        }
        navigate(`/exam/report/${exam.exam_id}`);
      } catch (err: unknown) {
        console.error("Submit failed", err);
        toast.error(getExamErrorMessage(err, t, 'submit'));
      }
    }
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // R30: show time REMAINING (timeLimit - elapsed), not elapsed — clamped
  // to 0 so it never prints a negative value once time is used up. The
  // underlying `elapsedSeconds` state itself is untouched (still recomputed
  // from the server's `started_at` every tick, so it stays correct across
  // reloads/backgrounding) — only what's displayed changes here.
  const remainingSeconds = Math.max(timeLimit - elapsedSeconds, 0);
  const progressPercent = ((currentIndex + 1) / questions.length) * 100;

  return (
    <DepthScene status="progress" gradientIndex={1}>
      <div className="min-h-screen relative z-10">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 pt-8">
        
        {/* Header / Top Bar */}
        <div className="flex items-center justify-between mb-8 glass-card p-4 rounded-2xl border border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary border border-primary/30 shadow-glow-primary">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-foreground">{t('widget.title')}</h2>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t('runner.question', { current: currentIndex + 1, total: questions.length })}
              </div>
            </div>
          </div>
          
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
              isOverTime
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                : 'bg-white/5 border-white/10 text-muted-foreground'
            }`}
            title={t('runner.timeRemaining')}
          >
            <Clock className={`w-4 h-4 ${isOverTime ? 'animate-pulse' : ''}`} />
            <span className="sr-only">{t('runner.timeRemaining')}</span>
            <span className="font-mono text-sm font-bold tracking-wider">
              {formatTime(remainingSeconds)}
            </span>
          </div>
        </div>

        {/* Time's up / grace-period warning */}
        {isInGracePeriod && (
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-rose-300 text-sm font-bold">
            <Clock className="w-4 h-4 shrink-0 animate-pulse" />
            {t('runner.expiredWarning')}
          </div>
        )}

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-12">
          <motion.div 
            className="h-full bg-primary shadow-[0_0_10px_theme(colors.primary.DEFAULT)]"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Question Area */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQ.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="glass-card p-8 sm:p-12 rounded-[32px] border border-white/5 mb-8 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-2 h-full bg-primary opacity-50" />
            
            <h3 className="text-2xl sm:text-3xl font-medium text-foreground leading-relaxed mb-10">
              {currentQ.question_text}
            </h3>

            <div className="space-y-3">
              {currentQ.options.map((opt, i) => {
                const isSelected = answers[currentQ.id] === i;
                return (
                  <button
                    key={i}
                    onClick={() => handleOptionSelect(i)}
                    className={`w-full text-left p-5 rounded-2xl border transition-all duration-200 flex items-center gap-4 ${
                      isSelected
                        ? 'bg-primary/10 border-primary shadow-glow-primary/20 text-foreground'
                        : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:border-white/20 hover:text-foreground'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isSelected ? 'border-primary bg-primary/20' : 'border-white/20'
                    }`}>
                      {isSelected && <div className="w-2.5 h-2.5 bg-primary rounded-full" />}
                    </div>
                    <span className="text-lg leading-snug">{opt}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Bottom Controls */}
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-white/5 text-muted-foreground font-bold text-sm tracking-wider uppercase hover:bg-white/10 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
            {t('runner.previous')}
          </button>

          {currentIndex === questions.length - 1 ? (
            <button
              onClick={handleSubmit}
              disabled={submitExam.isPending}
              className="flex items-center gap-2 px-8 py-3 rounded-xl bg-primary text-white font-black text-sm tracking-widest uppercase hover:scale-105 active:scale-95 transition-all shadow-glow-primary disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {submitExam.isPending ? t('runner.submitting') : t('runner.submit')}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-white/5 text-muted-foreground font-bold text-sm tracking-wider uppercase hover:bg-white/10 hover:text-foreground transition-all"
            >
              {t('runner.next')}
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation Dots */}
        <div className="mt-12 flex flex-wrap justify-center gap-2">
          {questions.map((q, i) => {
            const isAnswered = answers[q.id] !== undefined;
            const isCurrent = i === currentIndex;
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIndex(i)}
                aria-label={t('runner.goToQuestion', { n: i + 1 })}
                aria-current={isCurrent ? 'true' : undefined}
                className="p-1.5 -m-1.5"
              >
                <span
                  className={`block w-3 h-3 rounded-full transition-all ${
                    isCurrent
                      ? 'bg-primary scale-125 ring-2 ring-primary/40'
                      : isAnswered
                        ? 'bg-primary/50 hover:bg-primary/70'
                        : 'bg-transparent ring-1 ring-inset ring-white/25 hover:ring-white/40'
                  }`}
                />
              </button>
            );
          })}
        </div>

      </div>
      </div>
    </DepthScene>
  );
}
