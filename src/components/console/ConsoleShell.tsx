import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AmbientGlow } from './AmbientGlow';
import { GLOW_BY_STATUS } from './constants';

interface ConsoleShellProps {
  children: ReactNode;
  /** rgba glow color; defaults to the "progress" indigo. */
  glow?: string;
  /** Optional top-bar slot rendered above content (z-20). */
  topBar?: ReactNode;
  className?: string;
}

/**
 * Full-bleed console frame: the deep #070b14 base plus the ambient glow.
 * Pages compose their content (and an optional top bar) inside it.
 */
export function ConsoleShell({
  children,
  glow = GLOW_BY_STATUS.progress,
  topBar,
  className,
}: ConsoleShellProps) {
  return (
    <div className={cn('console-bg relative min-h-screen overflow-hidden select-none', className)}>
      <AmbientGlow color={glow} />
      {topBar && <div className="relative z-20">{topBar}</div>}
      {children}
    </div>
  );
}
