import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Zap, Volume2, ArrowRight } from 'lucide-react';
import { useTTS } from '@/hooks/useTTS';

interface QuizCardProps {
  question: string;
  options: string[];
  correctAnswer: number;
  /** Called once the user picks an answer. The component does NOT auto-advance — the
   * parent decides what to do (e.g. record telemetry, update streak). It will then
   * receive `onContinue` when the user clicks the explicit "Continue" button below. */
  onAnswer: (isCorrect: boolean, selectedIndex: number) => void;
  /** Called when the user clicks the "Continue" button after reviewing the result. */
  onContinue?: () => void;
  /** Label for the continue button (e.g. "Continue", "Finish lecture"). */
  continueLabel?: string;
  questionNumber: number;
  totalQuestions: number;
  initialSelectedAnswer?: number | null;
  /** One-sentence justification rendered behind a "Show Explanation" toggle. */
  explanation?: string;
  /** Concept tested by the question; rendered as a small badge above the question. */
  concept?: string;
  /**
   * For cross-slide deck questions, the 1-based slide numbers a student needs
   * to combine. Rendered as a row of "Slide N" chips so students can jump
   * back to the source material.
   */
  linkedSlides?: number[];
  /** Click handler for a linked-slide chip. */
  onJumpToSlide?: (slideNumber: number) => void;
}

const shakeVariants = {
  shake: {
    opacity: 1,
    x: [0, -8, 8, -6, 6, -4, 4, 0],
    transition: { duration: 0.5 },
  },
  idle: { opacity: 1, x: 0 },
};

const bounceVariants = {
  bounce: {
    opacity: 1,
    x: 0,
    scale: [1, 1.08, 0.95, 1.04, 1],
    transition: { duration: 0.5 },
  },
  idle: { opacity: 1, scale: 1, x: 0 },
};

export const QuizCard = memo(function QuizCard({
  question,
  options,
  correctAnswer,
  onAnswer,
  onContinue,
  continueLabel = 'Continue',
  questionNumber,
  totalQuestions,
  initialSelectedAnswer = null,
  explanation,
  concept,
  linkedSlides,
  onJumpToSlide,
}: QuizCardProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(initialSelectedAnswer);
  const [showResult, setShowResult] = useState(initialSelectedAnswer !== null);
  const [showXP, setShowXP] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const continueRef = useRef<HTMLDivElement>(null);
  const { speak, isSpeaking } = useTTS();

  // Sync state when props change
  useEffect(() => {
    setSelectedAnswer(initialSelectedAnswer);
    setShowResult(initialSelectedAnswer !== null);
    setShowXP(false);
    setShowExplanation(false);
  }, [initialSelectedAnswer, question]);

  // Auto-scroll the Continue button into view once the result is revealed so
  // students on small screens never have to hunt for it.
  useEffect(() => {
    if (!showResult) return;
    const t = setTimeout(() => {
      continueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
    return () => clearTimeout(t);
  }, [showResult]);

  const handleAnswer = useCallback((index: number) => {
    if (showResult) return;

    setSelectedAnswer(index);
    setShowResult(true);

    const correct = index === correctAnswer;
    if (correct) {
      setShowXP(true);
      setTimeout(() => setShowXP(false), 1200);
    }

    // Notify parent immediately so XP/streak/telemetry persist while the user
    // reads the explanation. The parent must NOT auto-advance — advancement
    // is driven by the explicit "Continue" button below.
    onAnswer(correct, index);
  }, [showResult, correctAnswer, onAnswer]);

  const handleSpeakQuestion = useCallback(() => {
    const text = `${question}. Options: ${options.map((opt, i) => `${String.fromCharCode(65 + i)}: ${opt}`).join('. ')}`;
    speak(text);
  }, [question, options, speak]);

  const isCorrect = selectedAnswer === correctAnswer;

  return (
    <div className="glass-card p-8 border-white/5 rounded-[32px] shadow-2xl relative overflow-hidden group">
      {/* Dynamic Background Glow */}
      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.15 }}
            className={`absolute inset-0 -z-10 blur-[100px] ${isCorrect ? 'bg-success' : 'bg-destructive'}`}
          />
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between mb-8">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Neural Evaluation</p>
          <span className="text-sm font-bold text-foreground">
            Module {questionNumber} <span className="text-muted-foreground">/ {totalQuestions}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSpeakQuestion}
            disabled={isSpeaking}
            className="p-2 rounded-xl bg-surface-2 border border-white/5 text-muted-foreground hover:text-primary hover:border-primary/30 transition-all disabled:opacity-50"
            aria-label="Read question aloud"
          >
            <Volume2 className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 bg-xp/10 px-3 py-1.5 rounded-xl border border-xp/20">
            <Zap className="w-4 h-4 text-xp fill-xp" />
            <span className="text-xs font-bold text-xp uppercase tracking-tighter">+10 XP Potential</span>
          </div>
        </div>
      </div>

      {(concept || (linkedSlides && linkedSlides.length > 0)) && (
        <div
          className="flex flex-wrap items-center gap-2 mb-4"
          data-testid="quiz-meta-row"
        >
          {concept && (
            <span
              className="text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20"
              data-testid="quiz-concept-badge"
            >
              Concept · {concept}
            </span>
          )}
          {linkedSlides && linkedSlides.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-1.5"
              data-testid="quiz-linked-slides"
              aria-label="Linked slides"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Connects:
              </span>
              {linkedSlides.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onJumpToSlide?.(n)}
                  disabled={!onJumpToSlide}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-surface-2 border border-white/10 text-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:cursor-default disabled:hover:border-white/10 disabled:hover:text-foreground"
                  aria-label={`Jump to slide ${n}`}
                >
                  Slide {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <h3 className="text-2xl font-bold text-foreground mb-10 tracking-tight leading-tight">
        {question}
      </h3>

      <div className="grid grid-cols-1 gap-4" role="radiogroup" aria-label="Quiz options">
        {options.map((option, index) => {
          const isSelected = selectedAnswer === index;
          const isCorrectOption = index === correctAnswer;

          let optionClass = 'border-white/5 bg-white/2 hover:border-primary/50 hover:bg-primary/5 hover:translate-x-1';

          if (showResult) {
            if (isCorrectOption) {
              optionClass = 'border-success bg-success/10 shadow-glow-success/10 scale-[1.02]';
            } else if (isSelected && !isCorrect) {
              optionClass = 'border-destructive bg-destructive/10 shadow-glow-destructive/10';
            } else {
              optionClass = 'border-white/5 opacity-40';
            }
          } else if (isSelected) {
            optionClass = 'border-primary bg-primary/10';
          }

          const animState =
            showResult && isSelected && !isCorrect
              ? 'shake'
              : showResult && isCorrectOption
                ? 'bounce'
                : 'idle';

          return (
            <motion.button
              key={index}
              role="radio"
              aria-checked={isSelected}
              aria-label={`Option ${String.fromCharCode(65 + index)}: ${option}`}
              className={`w-full p-6 rounded-2xl border-2 text-left transition-all duration-300 ${optionClass} ${showResult ? 'cursor-default' : 'cursor-pointer'} relative overflow-hidden group/option`}
              onClick={() => handleAnswer(index)}
              disabled={showResult}
              initial={{ opacity: 0, y: 10 }}
              animate={
                animState === 'shake'
                  ? shakeVariants.shake
                  : animState === 'bounce'
                    ? bounceVariants.bounce
                    : { opacity: 1, y: 0 }
              }
              transition={{ delay: showResult ? 0 : index * 0.05 }}
            >
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-5">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-colors ${
                    isSelected ? 'bg-primary text-white' : 'bg-white/5 text-muted-foreground'
                  }`}>
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className={`text-base font-bold transition-colors ${
                    isSelected ? 'text-foreground' : 'text-muted-foreground group-hover/option:text-foreground'
                  }`}>{option}</span>
                </div>

                {showResult && isCorrectOption && (
                  <motion.div
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center text-success"
                  >
                    <CheckCircle2 className="w-6 h-6" />
                  </motion.div>
                )}

                {showResult && isSelected && !isCorrect && (
                  <motion.div
                    initial={{ scale: 0, rotate: 45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center text-destructive"
                  >
                    <XCircle className="w-6 h-6" />
                  </motion.div>
                )}

                {/* Floating +XP on correct answer */}
                <AnimatePresence>
                  {showXP && isCorrectOption && (
                    <motion.div
                      className="absolute right-0 flex items-center gap-2 text-xp font-bold text-lg pointer-events-none"
                      initial={{ opacity: 1, y: 0 }}
                      animate={{ opacity: 0, y: -50 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.2, ease: [0.34, 1.56, 0.64, 1] }}
                    >
                      <div className="w-8 h-8 rounded-lg bg-xp flex items-center justify-center shadow-glow-xp">
                        <Zap className="w-4 h-4 text-white fill-white" />
                      </div>
                      +10 XP
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {!showResult && (
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover/option:opacity-100 transition-opacity" />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Explanation section */}
      {showResult && explanation && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-6"
        >
          <button
            onClick={() => setShowExplanation(!showExplanation)}
            className="text-xs font-bold text-primary uppercase tracking-widest hover:underline"
          >
            {showExplanation ? 'Hide' : 'Show'} Explanation
          </button>
          <AnimatePresence>
            {showExplanation && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-3 p-4 rounded-xl bg-primary/5 border border-primary/20 text-sm text-muted-foreground"
              >
                {explanation}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-10 p-6 rounded-2xl border flex items-center justify-between overflow-hidden relative ${
              isCorrect
                ? 'bg-success/10 border-success/20'
                : 'bg-destructive/10 border-destructive/20'
            }`}
          >
            <div className="flex items-center gap-4 relative z-10">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                isCorrect ? 'bg-success text-white shadow-glow-success' : 'bg-destructive text-white shadow-glow-destructive'
              }`}>
                {isCorrect ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
              </div>
              <div className="flex flex-col">
                <span className={`text-xl font-bold ${isCorrect ? 'text-success' : 'text-destructive'}`}>
                  {isCorrect ? 'Neural Match Confirmed' : 'Synapse Misalignment'}
                </span>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                  {isCorrect ? 'Telemetric Data Integrated' : 'Resynchronization Required'}
                </span>
              </div>
            </div>

            {isCorrect && (
              <div className="flex items-center gap-2 bg-xp text-white px-4 py-2 rounded-xl font-bold shadow-glow-xp animate-bounce">
                <Zap className="w-4 h-4 fill-white" />
                +10 XP
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Explicit Continue button — replaces the old 1.5s auto-advance so
          students control the pace and have time to read the explanation. */}
      {showResult && onContinue && (
        <motion.div
          ref={continueRef}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-6 flex justify-end"
        >
          <button
            type="button"
            onClick={onContinue}
            data-testid="quiz-continue"
            className="flex items-center gap-2 px-6 h-12 rounded-xl bg-primary text-white font-bold shadow-glow-primary hover:opacity-90 transition-opacity"
          >
            {continueLabel}
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </div>
  );
});
