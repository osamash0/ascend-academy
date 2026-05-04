import { useEffect, useRef, memo } from 'react';
import { motion, useMotionValue, useTransform, animate, useInView } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'xp';
  className?: string;
  onClick?: () => void;
}

const variantStyles = {
  default: 'glass-card border-border',
  primary: 'glass-card border-primary/20 shadow-glow-primary/10',
  success: 'glass-card border-success/20 shadow-glow-success/10',
  warning: 'glass-card border-warning/20 shadow-glow-warning/10',
  xp: 'glass-card border-xp/20 shadow-glow-xp/10',
};

const iconStyles = {
  default: 'bg-surface-2 text-muted-foreground',
  primary: 'bg-primary/20 text-primary shadow-glow-primary/20',
  success: 'bg-success/20 text-success shadow-glow-success/20',
  warning: 'bg-warning/20 text-warning',
  xp: 'bg-xp/20 text-xp shadow-glow-xp/20',
};

/** Animated number with intersection observer - only animates when visible */
function AnimatedNumber({ value, isInView }: { value: number; isInView: boolean }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  const displayRef = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isInView || hasAnimated.current) return;

    hasAnimated.current = true;
    const controls = animate(motionValue, value, {
      duration: 1.5,
      ease: [0.16, 1, 0.3, 1],
    });

    const unsubscribe = rounded.on('change', (v) => {
      if (displayRef.current) {
        displayRef.current.textContent = String(v);
      }
    });

    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [isInView, value, motionValue, rounded]);

  return <span ref={displayRef}>{isInView ? 0 : value}</span>;
}

export const StatsCard = memo(function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  className = '',
  onClick,
}: StatsCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  const isPercent = typeof value === 'string' && value.endsWith('%');
  const numericValue = isPercent
    ? parseInt(value as string, 10)
    : typeof value === 'number'
      ? value
      : null;

  return (
    <motion.div
      ref={ref}
      onClick={onClick}
      className={`glass-card p-6 flex flex-col gap-4 ${variantStyles[variant]} ${className} ${onClick ? 'cursor-pointer' : ''}`}
      whileHover={{ y: -4, transition: { type: 'spring', stiffness: 400, damping: 17 } }}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconStyles[variant]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-caption text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
        <div className="flex items-baseline gap-1">
          <p className="text-display-md font-bold text-foreground">
            {numericValue !== null ? (
              <>
                <AnimatedNumber value={numericValue} isInView={isInView} />
                {isPercent && <span className="text-heading-sm ml-0.5 text-muted-foreground">%</span>}
              </>
            ) : (
              value
            )}
          </p>
        </div>
        {subtitle && (
          <p className="text-body-sm text-muted-foreground/70">{subtitle}</p>
        )}
      </div>
    </motion.div>
  );
});
