import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { memo, useCallback } from 'react';
import { LunaAstronaut } from '../../learnstation-luna';

interface BadgeEarnedModalProps {
  isOpen: boolean;
  onClose: () => void;
  badgeName: string;
  badgeDescription: string;
  badgeIcon?: string;
}

export const BadgeEarnedModal = memo(function BadgeEarnedModal({
  isOpen,
  onClose,
  badgeName,
  badgeDescription,
  badgeIcon = '🏆',
}: BadgeEarnedModalProps) {
  const { t } = useTranslation('gamification');
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
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
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 400 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="badge-title"
            aria-describedby="badge-desc"
          >
            <div className="glass-card p-8 md:p-12 shadow-glow-primary/20 max-w-md w-full mx-4 pointer-events-auto border-white/10 rounded-[40px] relative overflow-hidden text-center group flex flex-col items-center">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,var(--primary)_0%,transparent_70%)] opacity-10" />

              <div className="relative z-10 flex flex-col items-center w-full">
                
                {/* Luna Pops Up */}
                <motion.div
                  className="mb-8 relative"
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', damping: 15 }}
                >
                  <LunaAstronaut variant="head" phase="full" size="xl" animated showShadow={false} />
                  
                  {/* Floating Badge */}
                  <motion.div 
                    className="absolute -right-2 -bottom-2 w-14 h-14 bg-white/10 border border-white/20 backdrop-blur-xl rounded-full flex items-center justify-center shadow-lg overflow-hidden"
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 10 }}
                    transition={{ delay: 0.5, type: 'spring', damping: 12 }}
                  >
                    {badgeIcon?.startsWith('/') || badgeIcon?.startsWith('http') ? (
                      <img src={badgeIcon} alt={badgeName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl drop-shadow-md">{badgeIcon}</span>
                    )}
                  </motion.div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="w-full flex flex-col items-center"
                >
                  <div className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 mb-5">
                    <Sparkles className="w-4 h-4 animate-pulse" />
                    <span className="text-[11px] font-bold uppercase tracking-widest">{t('badgeModal.eyebrow')}</span>
                  </div>
                  
                  <h2 id="badge-title" className="text-3xl font-bold text-foreground tracking-tight mb-3">
                    {badgeName}
                  </h2>

                  <p id="badge-desc" className="text-muted-foreground font-medium mb-8 leading-relaxed text-sm px-2">
                    {badgeDescription}
                  </p>

                  <Button 
                    size="lg" 
                    className="w-full bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl shadow-glow-primary text-lg border-none transition-all active:scale-95 h-14" 
                    onClick={handleClose}
                  >
                    {t('badgeModal.cta')}
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
