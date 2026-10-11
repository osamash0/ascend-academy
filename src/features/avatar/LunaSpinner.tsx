/**
 * LunaSpinner — the app's loading state, drawn as *your* Luna thinking.
 *
 * Replaces the old learnstation-luna loaders, so waiting shows the same
 * character (in the same outfit) the student sees everywhere else. A slow
 * orbit ring carries the "something is happening" signal; Luna herself just
 * ponders. Reduced motion keeps her still and stops the ring.
 */
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { MyLuna } from './MyLuna';

export function LunaSpinner({ size = 64, label = 'Loading', className }: { size?: number; label?: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span role="status" aria-label={label} className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <span
        aria-hidden
        className={cn('absolute inset-0 rounded-full border border-white/10 border-t-white/60', !reduce && 'animate-spin [animation-duration:1.6s]')}
      />
      <span className="block" style={{ width: size * 0.8, height: size * 0.8 }}>
        <MyLuna size={size * 0.8} mood="thinking" animated={!reduce} className="h-full w-full" />
      </span>
    </span>
  );
}
