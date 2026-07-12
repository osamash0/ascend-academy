import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap } from 'lucide-react';

const BOOT_KEY = 'ascend-console-booted';

/**
 * A once-per-session console "power-on" splash: the logo boots up, a loading
 * bar fills, then "Press to continue" — dismissed by any key/click or after a
 * short delay. Sets the tone for the console experience without nagging on
 * every navigation.
 */
export function ConsoleBoot() {
  const [show, setShow] = useState(() => {
    try {
      return !sessionStorage.getItem(BOOT_KEY);
    } catch {
      return true;
    }
  });
  const [canContinue, setCanContinue] = useState(false);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(BOOT_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  }, []);

  useEffect(() => {
    if (!show) return;
    const ready = setTimeout(() => setCanContinue(true), 1000);
    const auto = setTimeout(dismiss, 2800);
    const onInput = () => dismiss();
    window.addEventListener('keydown', onInput);
    window.addEventListener('pointerdown', onInput);
    return () => {
      clearTimeout(ready);
      clearTimeout(auto);
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('pointerdown', onInput);
    };
  }, [show, dismiss]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] console-bg flex flex-col items-center justify-center select-none"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* ambient power-on glow */}
          <motion.div
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2 }}
            style={{ background: 'radial-gradient(60% 50% at 50% 45%, rgba(99,102,241,0.18), transparent 70%)' }}
          />

          {/* Logo power-on */}
          <motion.div
            className="relative flex h-24 w-24 items-center justify-center rounded-[28px] bg-gradient-to-br from-primary to-secondary shadow-glow-primary"
            initial={{ scale: 0.6, opacity: 0, filter: 'blur(8px)' }}
            animate={{
              scale: 1,
              opacity: 1,
              filter: 'blur(0px)',
              boxShadow: [
                '0 0 30px hsl(235 85% 65% / 0.2)',
                '0 0 60px hsl(235 85% 65% / 0.55)',
                '0 0 30px hsl(235 85% 65% / 0.2)',
              ],
            }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], boxShadow: { duration: 2, repeat: Infinity } }}
          >
            <GraduationCap className="h-12 w-12 text-white" />
          </motion.div>

          {/* Brand */}
          <motion.h1
            className="mt-8 text-2xl font-black uppercase tracking-[0.5em] text-foreground"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            Learnstation
          </motion.h1>

          {/* Loading bar */}
          <div className="mt-8 h-1 w-56 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-secondary"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.6, ease: 'easeInOut' }}
            />
          </div>

          {/* Press to continue */}
          <div className="mt-10 h-5">
            <AnimatePresence>
              {canContinue && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  exit={{ opacity: 0 }}
                  transition={{ opacity: { duration: 1.6, repeat: Infinity } }}
                  className="text-[11px] font-black uppercase tracking-[0.3em] text-muted-foreground"
                >
                  Press to continue
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
