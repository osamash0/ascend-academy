import { useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export const ThemeToggle = memo(function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const toggleTheme = useCallback(() => {
    setTheme(isDark ? 'light' : 'dark');
  }, [isDark, setTheme]);

  return (
    <motion.button
      onClick={toggleTheme}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      className="relative w-14 h-7 rounded-full border border-border bg-surface-2 flex items-center px-1 transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 overflow-hidden"
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      aria-pressed={isDark}
    >
      {/* Background gradient */}
      <motion.span
        className="absolute inset-0 rounded-full"
        animate={{
          background: !isDark
            ? 'linear-gradient(90deg, hsl(45 90% 80%), hsl(38 92% 75%))'
            : 'linear-gradient(90deg, hsl(234 89% 25%), hsl(270 60% 25%))',
        }}
        transition={{ duration: 0.3 }}
      />

      {/* Sliding knob */}
      <motion.span
        className="relative z-10 w-5 h-5 rounded-full flex items-center justify-center shadow-md"
        animate={{
          x: !isDark ? 28 : 0,
          background: !isDark ? 'hsl(45 90% 55%)' : 'hsl(234 89% 68%)',
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      >
        <AnimatePresence mode="wait">
          {isDark ? (
            <motion.div
              key="moon"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Moon className="w-3 h-3 text-white" aria-hidden="true" />
            </motion.div>
          ) : (
            <motion.div
              key="sun"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Sun className="w-3 h-3 text-white" aria-hidden="true" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.span>
    </motion.button>
  );
});
