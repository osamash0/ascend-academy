import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: number;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'xp';
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
  default: 'bg-muted text-muted-foreground',
  primary: 'gradient-primary text-primary-foreground',
  success: 'gradient-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  xp: 'gradient-xp text-xp-foreground',
};

function AnimatedNumber({ value }: { value: number }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));
  const displayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 1.2,
      ease: 'easeOut',
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
  trend,
  variant = 'default',
  onClick,
}: StatsCardProps) {
  // Determine if value is a pure number or a percentage string
  const isPercent = typeof value === 'string' && value.endsWith('%');
  const numericValue = isPercent
    ? parseInt(value as string, 10)
    : typeof value === 'number'
      ? value
      : null;

  return (
    <motion.div
      onClick={onClick}
      className={`rounded-2xl border p-6 shadow-sm transition-all ${variantStyles[variant]} ${onClick ? 'cursor-pointer' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={onClick ? { 
        y: -4, 
        boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
        borderColor: 'var(--primary)'
      } : { y: -2, boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold text-foreground mt-1">
            {numericValue !== null ? (
              <>
                <AnimatedNumber value={numericValue} />
                {isPercent && '%'}
              </>
            ) : (
              value
            )}
          </p>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
          {trend !== undefined && (
            <div
              className={`flex items-center gap-1 mt-2 text-sm ${trend >= 0 ? 'text-success' : 'text-destructive'
                }`}
            >
              <span>{trend >= 0 ? '↑' : '↓'}</span>
              <span>{Math.abs(trend)}% from last week</span>
            </div>
          )}
        </div>

        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center ${iconStyles[variant]}`}
        >
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </motion.div>
  );
}
