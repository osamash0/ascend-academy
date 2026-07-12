import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Clock, CheckCircle2, AlertCircle, Send, BrainCircuit, Rocket } from 'lucide-react';
import { useGenerateExam, useExamAttempt, useSaveExamAnswer, useSubmitExam } from '@/features/student/hooks/useExamMode';
import { DepthScene } from '@/components/console';
import { toast } from 'sonner';
import { PixelSpark, LunaLoader } from '../../learnstation-luna';

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
      navigate(`/exam/take/${res.exam_id}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || t('generate.notEnoughQuestions'));
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
  const { data: exam, isLoading } = useExamAttempt(examId);
  const saveAnswer = useSaveExamAnswer(examId || '');
  const submitExam = useSubmitExam(examId || '');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (exam && exam.answers) {
      setAnswers(exam.answers);
    }
  }, [exam]);

  // Soft Timer
  useEffect(() => {
    if (!exam || exam.submitted_at) return;
    
    // Calculate elapsed based on started_at to be resilient to reloads
    const started = new Date(exam.started_at).getTime();
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - started) / 1000));

    tick();
    const interval = setInterval(tick, 1000);
    
    return () => clearInterval(interval);
  }, [exam]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LunaLoader type="pixel-dash" size={72} />
      </div>
    );
  }

  if (!exam || !exam.questions) return null;

  // If already submitted, redirect to report
  if (exam.submitted_at) {
    navigate(`/exam/report/${exam.exam_id}`, { replace: true });
    return null;
  }

  const questions = exam.questions;
  const currentQ = questions[currentIndex];
  
  const handleOptionSelect = (optIndex: number) => {
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
        navigate(`/exam/report/${exam.exam_id}`);
      } catch (err) {
        console.error("Submit failed", err);
      }
    }
  };

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const timeLimit = exam.time_limit_s;
  const isOverTime = elapsedSeconds > timeLimit;
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
          
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
            isOverTime 
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)]' 
              : 'bg-white/5 border-white/10 text-muted-foreground'
          }`}>
            <Clock className={`w-4 h-4 ${isOverTime ? 'animate-pulse' : ''}`} />
            <span className="font-mono text-sm font-bold tracking-wider">
              {formatTime(elapsedSeconds)}
            </span>
          </div>
        </div>

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
                className={`w-3 h-3 rounded-full transition-all ${
                  isCurrent ? 'bg-primary scale-125' : isAnswered ? 'bg-primary/40 hover:bg-primary/60' : 'bg-white/10 hover:bg-white/20'
                }`}
                aria-label={t('runner.goToQuestion', { n: i + 1 })}
              />
            );
          })}
        </div>

      </div>
      </div>
    </DepthScene>
  );
}
