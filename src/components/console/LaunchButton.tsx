import { Play, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LaunchButtonProps {
  label: string;
  onClick?: () => void;
  /** Defaults to a filled Play icon. */
  icon?: LucideIcon;
  className?: string;
  type?: 'button' | 'submit';
  /** Mutes the pill and blocks the click — e.g. content isn't ready yet. */
  disabled?: boolean;
  title?: string;
}

/** White-pill mega CTA — the console "launch" button. */
export function LaunchButton({
  label,
  onClick,
  icon: Icon = Play,
  className,
  type = 'button',
  disabled = false,
  title,
}: LaunchButtonProps) {
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      aria-disabled={disabled}
      className={cn(
        'console-focusable group inline-flex items-center gap-3 rounded-full bg-white px-8 py-3.5 font-black text-slate-900 shadow-[0_0_40px_-8px_rgba(255,255,255,0.6)] hover:scale-[1.03] transition-transform',
        disabled && 'cursor-not-allowed opacity-40 hover:scale-100 shadow-none bg-white/40',
        className
      )}
    >
      <Icon className="w-5 h-5 fill-slate-900" />
      {label}
    </button>
  );
}
