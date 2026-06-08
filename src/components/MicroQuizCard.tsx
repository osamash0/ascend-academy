import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Check, X } from 'lucide-react';
import { useMicroQuiz } from '@/features/student/hooks/useMicroQuiz';

interface MicroQuizCardProps {
  lectureId: string;
  targetSlideNumber: number;
}

export function MicroQuizCard({ lectureId, targetSlideNumber }: MicroQuizCardProps) {
  const navigate = useNavigate();
  const { data: quizData, isLoading, isError } = useMicroQuiz(lectureId, targetSlideNumber);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  // A fetch failure is distinct from "no quiz available" — show a quiet note on
  // error so the widget doesn't vanish indistinguishably from the empty case.
  if (isError) {
    return (
      <div className="border-l border-white/[0.06] pl-6 flex items-center flex-1">
        <span className="text-[11px] text-white/30">Quick check unavailable right now.</span>
      </div>
    );
  }

  // Loading, or genuinely no quiz for this lecture/slide — render nothing.
  if (isLoading || !quizData) return null;

  const { question, slide } = quizData;

  const handleSelect = (idx: number) => {
    if (selectedOption !== null) return;
    setSelectedOption(idx);
    setIsCorrect(idx === question.correct_answer);
  };

  return (
    <div className="border-l border-white/[0.06] pl-6 flex flex-col justify-between flex-1">
      {/* Label */}
      <div className="flex items-center gap-1.5 mb-3">
        <Zap className="w-3 h-3 text-primary" fill="currentColor" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">Quick check</span>
        <span className="ml-auto text-[10px] text-white/20">slide {slide.slide_number}</span>
      </div>

      {/* Question */}
      <p className="text-[13px] font-medium text-white/90 leading-snug mb-4">
        {question.question_text}
      </p>

      {/* Options or Result */}
      <AnimatePresence mode="wait">
        {selectedOption === null ? (
          <motion.div
            key="options"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="flex flex-col gap-2"
          >
            {question.options.map((opt, idx) => (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                className="group w-full text-left px-3 py-2 rounded-lg text-xs text-white/70 bg-white/[0.04] border border-white/[0.06] hover:border-primary/40 hover:text-white hover:bg-primary/10 transition-all duration-200 flex items-start gap-2"
              >
                <span className="w-4 h-4 mt-0.5 flex-shrink-0 rounded text-[9px] font-bold flex items-center justify-center bg-white/5 text-white/30 group-hover:text-white/60">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="leading-snug">{opt}</span>
              </button>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3"
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isCorrect ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-amber-500/15 border border-amber-500/30'}`}>
              {isCorrect
                ? <Check className="w-4 h-4 text-emerald-400" />
                : <X className="w-4 h-4 text-amber-400" />
              }
            </div>
            <div>
              <p className={`text-xs font-semibold ${isCorrect ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isCorrect ? 'Correct!' : 'Not quite'}
              </p>
              {!isCorrect && (
                <button
                  onClick={() => navigate(`/lecture/${lectureId}?slide=${slide.slide_number}`)}
                  className="text-[11px] text-primary/80 hover:text-primary underline underline-offset-2 transition-colors mt-0.5"
                >
                  Review slide →
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
