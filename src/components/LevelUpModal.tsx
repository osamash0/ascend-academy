import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Sparkles, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LevelUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  newLevel: number;
}

const confettiColors = [
  'hsl(234, 89%, 54%)', // primary
  'hsl(270, 70%, 60%)', // accent
  'hsl(45, 93%, 47%)', // xp
  'hsl(158, 64%, 42%)', // success
  'hsl(280, 85%, 58%)', // level
];

function Confetti() {
  const confetti = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 2 + Math.random() * 2,
    color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
    size: 4 + Math.random() * 8,
  }));

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {confetti.map((c) => (
        <motion.div
          key={c.id}
          className="absolute rounded-sm"
          style={{
            left: `${c.x}%`,
            top: -20,
            width: c.size,
            height: c.size,
            backgroundColor: c.color,
          }}
          initial={{ y: -20, rotate: 0, opacity: 1 }}
          animate={{ y: '100vh', rotate: 720, opacity: 0 }}
          transition={{
            duration: c.duration,
            delay: c.delay,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
}

export function LevelUpModal({ isOpen, onClose, newLevel }: LevelUpModalProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {showConfetti && <Confetti />}
          <motion.div
            className="fixed inset-0 bg-foreground/50 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            <div className="bg-card rounded-3xl p-8 shadow-2xl max-w-md w-full mx-4 pointer-events-auto border border-border">
              <div className="text-center">
                <motion.div
                  className="w-24 h-24 gradient-level rounded-full mx-auto mb-6 flex items-center justify-center shadow-xl"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring', damping: 10 }}
                >
                  <Trophy className="w-12 h-12 text-level-foreground" />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Sparkles className="w-6 h-6 text-xp" />
                    <span className="text-lg font-medium text-muted-foreground">
                      Level Up!
                    </span>
                    <Sparkles className="w-6 h-6 text-xp" />
                  </div>
                  
                  <h2 className="text-4xl font-bold text-gradient mb-2">
                    Level {newLevel}
                  </h2>
                  
                  <p className="text-muted-foreground mb-6">
                    Amazing progress! Keep learning to unlock new achievements.
                  </p>

                  <div className="flex justify-center gap-1 mb-6">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5 + i * 0.1 }}
                      >
                        <Star
                          className={`w-8 h-8 ${
                            i < Math.min(newLevel, 5)
                              ? 'text-xp fill-xp'
                              : 'text-muted'
                          }`}
                        />
                      </motion.div>
                    ))}
                  </div>

                  <Button variant="hero" size="lg" onClick={onClose}>
                    Continue Learning
                  </Button>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
