import { motion, AnimatePresence } from 'framer-motion';
import { Award, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BadgeEarnedModalProps {
  isOpen: boolean;
  onClose: () => void;
  badgeName: string;
  badgeDescription: string;
  badgeIcon?: string;
}

const badgeIcons: Record<string, string> = {
  '🎯': '🎯',
  '🔥': '🔥',
  '⭐': '⭐',
  '🏆': '🏆',
  '📚': '📚',
  '🎓': '🎓',
  '💡': '💡',
  '🚀': '🚀',
};

export function BadgeEarnedModal({
  isOpen,
  onClose,
  badgeName,
  badgeDescription,
  badgeIcon = '🏆',
}: BadgeEarnedModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-background/80 backdrop-blur-md z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
          >
            <div className="glass-card p-12 shadow-glow-primary/20 max-w-md w-full mx-4 pointer-events-auto border-white/10 rounded-[48px] relative overflow-hidden text-center group">
              {/* Dynamic light rays */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,var(--primary)_0%,transparent_70%)] opacity-20" />
              
              <div className="relative z-10">
                <motion.div
                  className="w-36 h-36 bg-gradient-to-br from-primary via-secondary to-xp rounded-full mx-auto mb-10 flex items-center justify-center shadow-glow-primary relative overflow-hidden"
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.2, type: 'spring', damping: 15 }}
                >
                  <span className="text-6xl drop-shadow-glow-white/50 relative z-10">
                    {badgeIcon}
                  </span>
                  {/* Rotating shine */}
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                    animate={{ x: ['-200%', '200%'] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <div className="flex flex-col gap-2 mb-8">
                    <div className="flex items-center justify-center gap-2">
                      <Sparkles className="w-5 h-5 text-xp animate-pulse" />
                      <span className="text-[10px] font-bold text-primary uppercase tracking-[0.3em]">New Protocol Unlocked</span>
                      <Sparkles className="w-5 h-5 text-xp animate-pulse" />
                    </div>
                    <h2 className="text-4xl font-bold text-foreground tracking-tighter">
                      {badgeName}
                    </h2>
                  </div>
                  
                  <p className="text-muted-foreground font-medium mb-10 leading-relaxed text-sm">
                    {badgeDescription}
                  </p>

                  <div className="flex items-center justify-center gap-3 p-4 bg-white/2 border border-white/5 rounded-2xl mb-10 group-hover:border-primary/30 transition-colors">
                    <Award className="w-5 h-5 text-primary" />
                    <span className="text-xs font-bold text-foreground/80 uppercase tracking-widest">
                      Added to Orbital Profile
                    </span>
                  </div>

                  <Button 
                    size="xl" 
                    className="w-full bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl shadow-glow-primary text-lg border-none transition-all active:scale-95 h-16" 
                    onClick={onClose}
                  >
                    Confirm Access
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
