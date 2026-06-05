import { motion } from 'framer-motion';

interface AmbientGlowProps {
  /** rgba color for the animated radial glow. */
  color: string;
  /** Animation duration in ms when the color changes. */
  transitionMs?: number;
}

/**
 * Two-layer ambient glow: an animated radial gradient near the top that shifts
 * color, plus a subtle static white top-highlight. Sits behind page content.
 */
export function AmbientGlow({ color, transitionMs = 800 }: AmbientGlowProps) {
  return (
    <>
      <motion.div
        className="ambient-glow"
        animate={{ background: `radial-gradient(120% 80% at 50% 8%, ${color}, transparent 70%)` }}
        transition={{ duration: transitionMs / 1000 }}
      />
      <div className="ambient-glow bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.04),transparent_60%)]" />
    </>
  );
}
