import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
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
  default: 'glass-card border-white/5',
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

function AnimatedNumber({ value }: { value: number }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  const displayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
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
  }, [value]);

  return <span ref={displayRef}>0</span>;
}

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  className = '',
  onClick,
}: StatsCardProps) {
  const isPercent = typeof value === 'string' && value.endsWith('%');
  const numericValue = isPercent
    ? parseInt(value as string, 10)
    : typeof value === 'number'
      ? value
      : null;

  return (
    <motion.div
      onClick={onClick}
      className={`glass-card p-6 flex flex-col gap-4 ${variantStyles[variant]} ${className} ${onClick ? 'cursor-pointer' : ''}`}
      whileHover={{ y: -4, transition: { type: 'spring', stiffness: 400, damping: 17 } }}
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
                <AnimatedNumber value={numericValue} />
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
}
