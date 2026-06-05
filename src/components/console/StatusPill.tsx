import { cn } from '@/lib/utils';
import type { ConsoleStatus } from './constants';

const STYLES: Record<ConsoleStatus, string> = {
  done: 'bg-emerald-500/15 text-emerald-400',
  progress: 'bg-primary/15 text-primary',
  new: 'bg-purple-500/15 text-purple-300',
};

const DEFAULT_LABELS: Record<ConsoleStatus, string> = {
  done: 'Completed',
  progress: 'In Progress',
  new: 'New',
};

interface StatusPillProps {
  status: ConsoleStatus;
  /** Override the default label text. */
  label?: string;
  className?: string;
}

/** Rounded-full status pill (done / progress / new). */
export function StatusPill({ status, label, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        'rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider',
        STYLES[status],
        className
      )}
    >
      {label ?? DEFAULT_LABELS[status]}
    </span>
  );
}
