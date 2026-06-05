import { useRef, type PointerEvent, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import { ConsoleBackground } from './ConsoleBackground';
import { Particles } from './Particles';
import type { ConsoleStatus } from './constants';

interface DepthSceneProps {
  /** Tints the wallpaper + ambient glow to the focused item's status. */
  status?: ConsoleStatus;
  /** Cycles the wallpaper gradient. */
  gradientIndex?: number;
  /** Cross-fades the wallpaper when the focused item changes. */
  motionKey?: string;
  /** Netflix-style key art layered over the wallpaper (e.g. lecture slide). */
  backdrop?: ReactNode;
  /** Foreground content (rail, hero, bento, rows). */
  children: ReactNode;
}

/**
 * Layered "depth" scene à la the PS5 home screen. Five stacked planes that move
 * at different rates on pointer travel to read as physical depth:
 *
 *   wallpaper (−8px) · particles (−16px) · vignette · content (+4px)
 *
 * Parallax is a small, damped transform-only effect and is disabled under
 * prefers-reduced-motion. The fixed backdrop bleeds behind the floating nav.
 */
export function DepthScene({ status = 'progress', gradientIndex = 0, motionKey, backdrop, children }: DepthSceneProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  // Pointer position normalised to roughly −0.5…0.5, smoothed by a soft spring.
  const px = useSpring(useMotionValue(0), { stiffness: 60, damping: 20 });
  const py = useSpring(useMotionValue(0), { stiffness: 60, damping: 20 });

  // Each plane translates by a different magnitude (and the foreground opposes).
  const wallX = useTransform(px, (v) => v * -16);
  const wallY = useTransform(py, (v) => v * -10);
  const dustX = useTransform(px, (v) => v * -32);
  const dustY = useTransform(py, (v) => v * -20);
  const fgX = useTransform(px, (v) => v * 8);
  const fgY = useTransform(py, (v) => v * 5);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };

  const resetPointer = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <div ref={ref} className="relative" onPointerMove={onPointerMove} onPointerLeave={resetPointer}>
      {/* Layers 1–3: fixed backdrop that bleeds behind the floating nav. Expanded vertically to prevent black bar gap when transforming during route transitions. */}
      <div className="fixed -inset-y-32 inset-x-0 z-0">
        <motion.div className="absolute inset-0" style={{ x: wallX, y: wallY, scale: 1.06 }}>
          <ConsoleBackground gradientIndex={gradientIndex} status={status} motionKey={motionKey} />
          {backdrop}
        </motion.div>
        <motion.div className="absolute inset-0" style={{ x: dustX, y: dustY }}>
          <Particles />
        </motion.div>
        <div className="depth-vignette pointer-events-none absolute inset-0" />
      </div>

      {/* Layer 4: foreground content, nudged the opposite way. */}
      <motion.div className="relative z-10" style={reduceMotion ? undefined : { x: fgX, y: fgY }}>
        {children}
      </motion.div>
    </div>
  );
}
