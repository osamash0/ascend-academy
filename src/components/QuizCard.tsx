import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Zap } from 'lucide-react';

interface QuizCardProps {
  question: string;
  options: string[];
  correctAnswer: number;
  onAnswer: (isCorrect: boolean, selectedIndex: number) => void;
  questionNumber: number;
  totalQuestions: number;
  initialSelectedAnswer?: number | null;
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

export function QuizCard({
  question,
  options,
  correctAnswer,
  onAnswer,
  questionNumber,
  totalQuestions,
  initialSelectedAnswer = null,
}: QuizCardProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(initialSelectedAnswer);
  const [showResult, setShowResult] = useState(initialSelectedAnswer !== null);
  const [showXP, setShowXP] = useState(false);

  // Keep state synced if props change
  useEffect(() => {
    setSelectedAnswer(initialSelectedAnswer);
    setShowResult(initialSelectedAnswer !== null);
  }, [initialSelectedAnswer, question]);

  const handleAnswer = (index: number) => {
    if (showResult) return;

    setSelectedAnswer(index);
    setShowResult(true);

    const correct = index === correctAnswer;
    if (correct) {
      setShowXP(true);
      setTimeout(() => setShowXP(false), 1200);
    }

    setTimeout(() => {
      onAnswer(correct, index);
    }, 1600);
  };

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
        <div className="flex items-center gap-2 bg-xp/10 px-3 py-1.5 rounded-xl border border-xp/20">
          <Zap className="w-4 h-4 text-xp fill-xp" />
          <span className="text-xs font-bold text-xp uppercase tracking-tighter">+10 XP Potential</span>
        </div>
      </div>

      <h3 className="text-2xl font-bold text-foreground mb-10 tracking-tight leading-tight">
        {question}
      </h3>

      <div className="grid grid-cols-1 gap-4">
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
              className={`w-full p-6 rounded-2xl border-2 text-left transition-all duration-300 ${optionClass} ${showResult ? 'cursor-default' : 'cursor-pointer'
                } relative overflow-hidden group/option`}
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

      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-10 p-6 rounded-2xl border flex items-center justify-between overflow-hidden relative ${isCorrect
                ? 'bg-success/10 border-success/20'
                : 'bg-destructive/10 border-destructive/20'
              }`}
          >
            <div className="flex items-center gap-4 relative z-10">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isCorrect ? 'bg-success text-white shadow-glow-success' : 'bg-destructive text-white shadow-glow-destructive'}`}>
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
    </div>
  );
}
