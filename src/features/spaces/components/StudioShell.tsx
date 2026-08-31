import type { LucideIcon } from 'lucide-react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * The chrome every Library Studio screen shares.
 *
 * Lifted from the shape `BatchReviewPage` already uses — sticky translucent
 * toolbar, a gradient icon tile, title over a one-line subtitle, actions
 * pushed right — because that is this product's established Studio pattern and
 * these screens should look like they were always part of it.
 *
 * Studio is deliberately *not* calm. Doc 2: "Studio — dense: toolbars, tables,
 * batch actions, secondary controls visible." The calm typography rules that
 * govern Learn screens are relaxed here on purpose; that contrast is the whole
 * point of having two modes, and it is the signal that you have moved from
 * reading to working.
 *
 * These hang off Library. Library itself stays Learn.
 */

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Batch actions and toolbar controls, right-aligned in the sticky bar. */
  actions?: React.ReactNode;
  /**
   * Where the back arrow goes. Studio screens hang off the Learn destination
   * that owns them — the three Library ones off Library, Settings off Profile —
   * so a Studio screen always returns you to where you opened it, never to a
   * shared "Studio" root that nobody navigated from.
   */
  backTo?: string;
  backLabel?: string;
  children: React.ReactNode;
}

export function StudioShell({
  icon: Icon,
  title,
  subtitle,
  actions,
  backTo = '/v4/library',
  backLabel = 'Back to Library',
  children,
}: Props) {
  /*
   * Studio screens do not go through `Scene`, which is where
   * `reducedMotion="user"` lives — so until now the three of them, and every
   * dialog opened from one, ignored the operating system's motion setting
   * entirely. `SettingsScreen` states as fact that "Scene already routes every
   * screen through reducedMotion" and uses that to justify having no motion
   * switch; its own file falsified the claim. The shell carries it now, so
   * both modes obey the same setting.
   */
  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={backTo}
              aria-label={backLabel}
              className="console-focusable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <ChevronLeft aria-hidden className="h-5 w-5" />
            </Link>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/20">
              <Icon aria-hidden className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-foreground">{title}</h1>
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
    </MotionConfig>
  );
}

/** The gradient primary action `BatchReviewPage` uses for batch operations. */
export function StudioAction({
  children,
  disabled,
  onClick,
  tone = 'violet',
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  tone?: 'violet' | 'emerald';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'console-focusable inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-white shadow-lg transition-opacity',
        tone === 'violet'
          ? 'bg-gradient-to-r from-violet-600 to-indigo-600 shadow-violet-500/25 hover:from-violet-700 hover:to-indigo-700'
          : 'bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-500/25 hover:from-emerald-700 hover:to-teal-700',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

/** Status pill in `MyMaterialsPage`'s vocabulary. */
export function StudioPill({
  tone,
  children,
}: {
  tone: 'ready' | 'processing' | 'draft' | 'warn';
  children: React.ReactNode;
}) {
  const tones = {
    ready: 'bg-emerald-500/15 text-emerald-400',
    processing: 'bg-violet-500/15 text-violet-400',
    draft: 'bg-white/[0.08] text-muted-foreground',
    warn: 'bg-amber-500/15 text-amber-400',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
