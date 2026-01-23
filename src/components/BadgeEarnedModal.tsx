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
                  className="w-28 h-28 gradient-primary rounded-full mx-auto mb-6 flex items-center justify-center shadow-xl relative"
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.2, type: 'spring', damping: 10 }}
                >
                  <span className="text-5xl">
                    {badgeIcons[badgeIcon] || badgeIcon}
                  </span>
                  <motion.div
                    className="absolute inset-0 gradient-primary rounded-full opacity-50"
                    initial={{ scale: 1 }}
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Sparkles className="w-5 h-5 text-xp" />
                    <span className="text-lg font-medium text-muted-foreground">
                      New Achievement!
                    </span>
                    <Sparkles className="w-5 h-5 text-xp" />
                  </div>
                  
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    {badgeName}
                  </h2>
                  
                  <p className="text-muted-foreground mb-6">
                    {badgeDescription}
                  </p>

                  <div className="flex items-center justify-center gap-2 p-3 bg-secondary rounded-xl mb-6">
                    <Award className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium text-secondary-foreground">
                      Added to your achievements
                    </span>
                  </div>

                  <Button variant="hero" size="lg" onClick={onClose}>
                    Awesome!
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
