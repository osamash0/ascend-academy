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
  lunaSuitColor?: string | null;
  lunaVisorTint?: string | null;
  lunaPatch?: string | null;
}

const TypewriterText = ({ text }: { text: string }) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  let charIndex = 0;

  return (
    <>
      {parts.map((part, i) => {
        const isBold = part.startsWith('**') && part.endsWith('**');
        const content = isBold ? part.slice(2, -2) : part;
        if (!content) return null;
        
        return (
          <span key={i} className={isBold ? "font-bold text-primary drop-shadow-sm" : ""}>
            {content.split('').map((char) => {
              const delay = 0.6 + charIndex * 0.03; 
              charIndex++;
              return (
                <motion.span
                  key={charIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay }}
                >
                  {char}
                </motion.span>
              );
            })}
          </span>
        );
      })}
    </>
  );
};

export const BadgeEarnedModal = memo(function BadgeEarnedModal({
  isOpen,
  onClose,
  badgeName,
  badgeDescription,
  lunaSuitColor,
  lunaVisorTint,
  lunaPatch,
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
            <div className="glass-card p-6 md:p-10 shadow-glow-primary/20 max-w-md w-full mx-4 pointer-events-auto border-white/10 rounded-[40px] relative overflow-hidden text-center group flex flex-col items-center">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,var(--primary)_0%,transparent_70%)] opacity-10" />

              <div className="relative z-10 flex flex-col items-center w-full">
                
                <div className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 mb-4">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                  <span className="text-[11px] font-bold uppercase tracking-widest">{t('badgeModal.eyebrow')}</span>
                </div>
                
                {/* Luna Pops Up */}
                <motion.div
                  className="relative inline-block mb-1"
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', damping: 15 }}
                >
                  <LunaAstronaut
                    variant="head"
                    phase="full"
                    size="lg"
                    animated
                    showShadow={false}
                    suitColor={lunaSuitColor || undefined}
                    visorTint={lunaVisorTint || undefined}
                    patchImage={lunaPatch || undefined}
                  />
                </motion.div>

                {/* Speech Bubble */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: 0.4, type: 'spring', damping: 20 }}
                  className="relative w-full bg-white/5 border border-white/10 p-6 rounded-[32px] mb-8 flex flex-col items-center shadow-xl"
                >
                  {/* CSS Tail pointing up to Luna */}
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 bg-[#181926] border-t border-l border-white/10 rotate-45 rounded-tl-sm pointer-events-none" />
                  
                  {/* Greeting Text */}
                  <div className="relative z-10 text-lg md:text-xl text-foreground font-medium mb-6 min-h-[3rem] leading-relaxed px-2">
                    <TypewriterText text={t('badgeModal.lunaGreeting', { badgeName })} />
                  </div>

                  {/* Big Badge Icon */}
                  <motion.div 
                    className="w-24 h-24 bg-white/10 border border-white/20 backdrop-blur-xl rounded-[24px] flex items-center justify-center shadow-glow-primary/30 overflow-hidden mb-4 relative z-10"
                    initial={{ scale: 0, rotate: -15 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 1.2, type: 'spring', damping: 12 }}
                  >
                    {badgeIcon?.startsWith('/') || badgeIcon?.startsWith('http') ? (
                      <img src={badgeIcon} alt={badgeName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-5xl drop-shadow-md">{badgeIcon}</span>
                    )}
                  </motion.div>

                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.5 }}
                    id="badge-desc" 
                    className="text-muted-foreground font-medium text-sm px-4 relative z-10"
                  >
                    {badgeDescription}
                  </motion.p>
                </motion.div>

                <Button 
                  size="lg" 
                  className="w-full bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl shadow-glow-primary text-lg border-none transition-all active:scale-95 h-14" 
                  onClick={handleClose}
                >
                  {t('badgeModal.cta')}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});
