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
    <div className="bg-card rounded-2xl border border-border p-6 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-muted-foreground">
          Question {questionNumber} of {totalQuestions}
        </span>
        <div className="flex items-center gap-1 text-xp">
          <Zap className="w-4 h-4" />
          <span className="text-sm font-semibold">+10 XP</span>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-foreground mb-6">{question}</h3>

      <div className="space-y-3">
        {options.map((option, index) => {
          const isSelected = selectedAnswer === index;
          const isCorrectOption = index === correctAnswer;

          let optionClass = 'border-border hover:border-primary hover:bg-secondary/50';

          if (showResult) {
            if (isCorrectOption) {
              optionClass = 'border-success bg-success/10';
            } else if (isSelected && !isCorrect) {
              optionClass = 'border-destructive bg-destructive/10';
            }
          } else if (isSelected) {
            optionClass = 'border-primary bg-secondary';
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
              className={`w-full p-4 rounded-xl border-2 text-left transition-all duration-200 ${optionClass} ${showResult ? 'cursor-default' : 'cursor-pointer'
                } relative`}
              onClick={() => handleAnswer(index)}
              disabled={showResult}
              initial={{ opacity: 0, x: -10 }}
              animate={
                animState === 'shake'
                  ? shakeVariants.shake
                  : animState === 'bounce'
                    ? bounceVariants.bounce
                    : { opacity: 1, x: 0 }
              }
              transition={{ delay: showResult ? 0 : index * 0.1 }}
              whileHover={!showResult ? { scale: 1.01 } : {}}
              whileTap={!showResult ? { scale: 0.99 } : {}}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="font-medium text-foreground">{option}</span>
                </div>

                {showResult && isCorrectOption && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="text-success"
                  >
                    <CheckCircle2 className="w-6 h-6" />
                  </motion.div>
                )}

                {showResult && isSelected && !isCorrect && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="text-destructive"
                  >
                    <XCircle className="w-6 h-6" />
                  </motion.div>
                )}

                {/* Floating +XP on correct answer */}
                <AnimatePresence>
                  {showXP && isCorrectOption && (
                    <motion.div
                      className="absolute right-4 flex items-center gap-1 text-xp font-bold text-sm pointer-events-none"
                      initial={{ opacity: 1, y: 0 }}
                      animate={{ opacity: 0, y: -36 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    >
                      <Zap className="w-4 h-4" />
                      +10 XP
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-4 p-4 rounded-xl ${isCorrect
                ? 'bg-success/10 border border-success/20'
                : 'bg-destructive/10 border border-destructive/20'
              }`}
          >
            <div className="flex items-center gap-2">
              {isCorrect ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <span className="font-semibold text-success">Correct! +10 XP</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-destructive" />
                  <span className="font-semibold text-destructive">Incorrect</span>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
