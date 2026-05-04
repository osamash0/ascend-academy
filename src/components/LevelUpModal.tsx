import { useEffect, useState, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Sparkles, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LevelUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  newLevel: number;
}

const confettiColors = [
  'hsl(234, 89%, 54%)',
  'hsl(270, 70%, 60%)',
  'hsl(45, 93%, 47%)',
  'hsl(158, 64%, 42%)',
  'hsl(280, 85%, 58%)',
];

function Confetti() {
  const confetti = useMemo(() => 
    Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 2 + Math.random() * 2,
      color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      size: 4 + Math.random() * 8,
    })),
    []
  );

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50" aria-hidden="true">
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

export const LevelUpModal = memo(function LevelUpModal({ isOpen, onClose, newLevel }: LevelUpModalProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setShowConfetti(false);
    onClose();
  }, [onClose]);

  const filledStars = newLevel % 5 || 5;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {showConfetti && <Confetti />}
          <motion.div
            className="fixed inset-0 bg-background/80 backdrop-blur-md z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            aria-hidden="true"
          />
          <motion.div
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="levelup-title"
            aria-describedby="levelup-desc"
          >
            <div className="glass-card p-12 shadow-glow-primary/20 max-w-md w-full mx-4 pointer-events-auto border-white/10 rounded-[48px] relative overflow-hidden text-center group">
              <div className="absolute inset-0 bg-gradient-to-b from-primary/20 via-transparent to-transparent opacity-50" />

              <div className="relative z-10">
                <motion.div
                  className="w-32 h-32 bg-gradient-to-br from-primary to-secondary rounded-[32px] mx-auto mb-10 flex items-center justify-center shadow-glow-primary relative group-hover:scale-110 transition-transform duration-500"
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.2, type: 'spring', damping: 12 }}
                >
                  <Trophy className="w-16 h-16 text-white drop-shadow-glow-white/50" aria-hidden="true" />
                  <motion.div 
                    className="absolute -top-4 -right-4 bg-xp rounded-full p-2 border-4 border-background shadow-lg"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.6 }}
                  >
                    <Sparkles className="w-6 h-6 text-white fill-white" aria-hidden="true" />
                  </motion.div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <div className="flex flex-col gap-2 mb-8">
                    <span className="text-[10px] font-bold text-primary uppercase tracking-[0.3em]">Synapse Evolution Confirmed</span>
                    <h2 id="levelup-title" className="text-5xl lg:text-6xl font-bold text-foreground tracking-tighter">
                      Level <span className="text-primary">{newLevel}</span>
                    </h2>
                  </div>

                  <p id="levelup-desc" className="text-muted-foreground font-medium mb-10 leading-relaxed text-sm">
                    Cognitive architecture upgraded. Your integration with the Orbital protocol has reached the next phase.
                  </p>

                  <div className="flex justify-center gap-3 mb-10" role="img" aria-label={`${filledStars} out of 5 stars`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 + i * 0.1 }}
                      >
                        <Star
                          className={`w-10 h-10 ${
                            i < filledStars
                              ? 'text-xp fill-xp shadow-glow-xp'
                              : 'text-white/5'
                          }`}
                          aria-hidden="true"
                        />
                      </motion.div>
                    ))}
                  </div>

                  <Button 
                    size="lg" 
                    className="w-full bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl shadow-glow-primary text-lg border-none transition-all active:scale-95 h-16" 
                    onClick={handleClose}
                  >
                    Continue Mission
                  </Button>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});
