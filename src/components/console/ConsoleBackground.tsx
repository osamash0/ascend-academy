import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { GLOW_BY_STATUS, accentGlowFor, gradientFor, type ConsoleStatus } from './constants';

interface ConsoleBackgroundProps {
  /** Cycles through COVER_GRADIENTS for the large key-art wash. */
  gradientIndex?: number;
  /** Status that tints the ambient glow. */
  status?: ConsoleStatus;
  /** Key that triggers a cross-fade when the featured item changes. */
  motionKey?: string;
  className?: string;
}

/**
 * Full-bleed cinematic "key-art" background, generated since lectures have no
 * cover images: a large gradient wash + grid texture + ambient glow, with a
 * left/bottom vignette so overlaid hero text stays legible.
 */
export function ConsoleBackground({
  gradientIndex = 0,
  status = 'progress',
  motionKey,
  className,
}: ConsoleBackgroundProps) {
  const grad = gradientFor(gradientIndex);
  const accent = accentGlowFor(gradientIndex);
  const statusGlow = GLOW_BY_STATUS[status];

  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {/* Large gradient key-art that cross-fades when the feature changes */}
      <AnimatePresence mode="wait">
        <motion.div
          key={motionKey ?? gradientIndex}
          className={cn('absolute inset-0 bg-gradient-to-br opacity-40', grad)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        />
      </AnimatePresence>

      {/* Grid texture */}
      <div className="absolute inset-0 bg-[size:28px_28px] bg-[linear-gradient(to_right,rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.025)_1px,transparent_1px)]" />

      {/* Faint status base glow (semantic hint, stays put). */}
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(120% 80% at 70% 10%, ${statusGlow}, transparent 70%)` }}
      />

      {/* Ambient accent glow — cross-fades to the focused item's color so the
          whole scene responds to which card is selected. Two pools (top-right
          and lower-left, behind the hero text) carry the color across the page. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`glow-${motionKey ?? gradientIndex}`}
          className="absolute inset-0"
          style={{
            background: `radial-gradient(115% 85% at 78% 6%, ${accent}, transparent 60%), radial-gradient(95% 75% at 10% 96%, ${accent}, transparent 58%)`,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        />
      </AnimatePresence>

      {/* Legibility vignette: darken left and bottom where text sits */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#070b14] via-[#070b14]/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#070b14] via-transparent to-transparent" />
    </div>
  );
}
