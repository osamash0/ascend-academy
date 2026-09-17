import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Floating glass cell — the panel every widget sits in.
 *
 * The PS5 home is a bento of heterogeneous cells: different spans, each with a
 * small icon-and-label header and its own kind of content — a stat, a list, a
 * bar, a slice of art. Size carries importance; nothing is a uniform grid.
 *
 * The product already ships this shape in `features/student/BentoGrid`, which
 * belongs to the old product and must not be imported. This is the same
 * language in the v4 namespace, shared by Home and the Space overview so the
 * two cannot drift apart.
 *
 * Three tags, chosen by what the cell actually is:
 *
 *   `to`      → a `Link`.   It goes somewhere. Give it an href.
 *   `onClick` → a `button`. It does something here — switches a tab, opens a
 *                           dialog. There is no URL to point at.
 *   neither   → a `div`.    It reports a number. Not a control at all.
 *
 * `to` was added because the alternative was a button whose handler called
 * `navigate()`, and that quietly costs a person cmd-click, middle-click,
 * open-in-new-tab and the status-bar preview — four behaviours a link gives for
 * free and a handler cannot give back. Existing callers pass `onClick` for tab
 * switches, which stays exactly right; navigation is what changes.
 */
export function BentoCell({
  icon: Icon,
  label,
  className,
  to,
  onClick,
  art,
  children,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  /** Where this cell goes. Mutually exclusive with `onClick` in practice. */
  to?: string;
  onClick?: () => void;
  /**
   * Background art. Rendered as a direct child of the cell so it fills the
   * whole panel — passing it through `children` put it inside the content
   * wrapper, below the header row, which gave it a hard top edge partway down
   * the cell. It is also masked so it fades out instead of ending on a seam.
   */
  art?: React.ReactNode;
  children: React.ReactNode;
}) {
  const shared = cn(
    'group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left transition-colors',
    (to || onClick) && 'console-focusable hover:bg-white/[0.06]',
    className,
  );

  const body = (
    <>
      {art && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black_25%,transparent_85%)]"
        >
          {art}
        </div>
      )}
      <div className="relative z-10 mb-3 flex items-center gap-2 text-quiet">
        <Icon aria-hidden className="h-4 w-4" />
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      <div className="relative z-10">{children}</div>
    </>
  );

  /*
   * Three returns rather than one `<Tag>` with a spread. A union tag type makes
   * TypeScript check the props against the *union* of all three elements'
   * attributes, so `to` reads as missing on the button branch and the whole
   * spread is rejected — the sort of error usually settled with a cast. Writing
   * the branches out keeps every prop checked against the element that actually
   * receives it, and costs three lines.
   *
   * `block` only on the Link: an anchor is inline by default, which would
   * collapse the cell to a text-line height inside the grid.
   */
  if (to) {
    return (
      <Link to={to} className={cn(shared, 'block')}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shared}>
        {body}
      </button>
    );
  }
  return <div className={shared}>{body}</div>;
}
