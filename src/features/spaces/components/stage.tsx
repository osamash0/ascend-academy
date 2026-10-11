import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The stage language, shared.
 *
 * Born on the lecture overview (LessonScreen, 2026-10-10): one black ground,
 * top bar included; a single light in the subject's own colour; a centred
 * masthead; one white pill as the primary action and quiet glass pills
 * beside it; sections spaced far apart under a plain 26px heading.
 *
 * Every screen that stands on `stage` builds from these pieces rather than
 * copying class strings, so the rooms cannot drift apart again — the way the
 * console screens and the lecture overview did.
 */

/**
 * Accent colours, aligned 1:1 with `COVER_GRADIENTS` (silver → cyan → rose →
 * amber → emerald → lime). No purple — the brand is monochrome.
 * A Space's light is the colour of its own cover,
 * so the room you enter is lit by the tile you just picked.
 */
export const STAGE_ACCENTS = ['#cbd5e1', '#06b6d4', '#f43f5e', '#f59e0b', '#10b981', '#84cc16'] as const;

export const stageAccentFor = (index: number) =>
  STAGE_ACCENTS[((index % STAGE_ACCENTS.length) + STAGE_ACCENTS.length) % STAGE_ACCENTS.length];

const tint = (accent: string | null | undefined, pct: number) =>
  `color-mix(in srgb, ${accent ?? 'hsl(var(--secondary))'} ${pct}%, transparent)`;

/**
 * The skylight: the stage's one light, starting *behind* the top bar so the
 * bar and the page are lit by the same light instead of meeting at a seam.
 * Place it as the first child of a `relative` screen wrapper.
 */
export function Skylight({ accent, strength = 14 }: { accent?: string | null; strength?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-[72px] left-1/2 h-[420px] w-screen -translate-x-1/2"
      style={{ background: `radial-gradient(55% 70% at 50% 0%, ${tint(accent, strength)}, transparent 72%)` }}
    />
  );
}

/** A pool of light under a focal object (the deck, a hero card). */
export function Pool({ accent, className }: { accent?: string | null; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute left-1/2 w-screen -translate-x-1/2', className)}
      style={{ background: `radial-gradient(48% 42% at 50% 48%, ${tint(accent, 26)}, transparent 72%)` }}
    />
  );
}

/**
 * The masthead: a quiet eyebrow, a large light-weight title, and a row of
 * meta beneath. Centred by default, as on the lecture overview.
 */
export function Masthead({
  eyebrow,
  title,
  lede,
  meta,
  align = 'center',
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  align?: 'center' | 'start';
  className?: string;
}) {
  const centred = align === 'center';
  return (
    <div className={cn(centred ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl', className)}>
      {eyebrow && <p className="text-[13px] tabular-nums text-quiet">{eyebrow}</p>}
      <h1 className="mt-3 text-[44px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[60px]">{title}</h1>
      {lede && (
        <p className={cn('mt-4 max-w-[60ch] text-[15.5px] leading-relaxed text-quiet', centred && 'mx-auto')}>
          {lede}
        </p>
      )}
      {meta && (
        <div
          className={cn(
            'mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5',
            centred ? 'justify-center' : 'justify-start',
          )}
        >
          {meta}
        </div>
      )}
    </div>
  );
}

/** A dot between eyebrow parts. */
export const Sep = () => (
  <span aria-hidden className="mx-2 text-faint">
    ·
  </span>
);

/** A section: generous space above, a plain heading, an optional lede. */
export function StageRow({
  title,
  lede,
  count,
  action,
  id,
  className,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  count?: number;
  /** Right-aligned control beside the heading — Add, Contribute, See all. */
  action?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn('mt-20 scroll-mt-24', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id={id} className="text-[26px] font-medium tracking-[-0.02em]">
            {title}
            {count !== undefined && <span className="ml-2.5 tabular-nums text-quiet">{count}</span>}
          </h2>
          {lede && <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-quiet">{lede}</p>}
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** The quiet pill that sits beside the one white primary action. */
export const ghostPill =
  'console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-6 text-[14px] font-medium transition-colors hover:bg-white/[0.09]';

/** Its small sibling, for actions beside a section heading. */
export const ghostPillSm =
  'console-focusable inline-flex h-9 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.09] hover:text-foreground';

/** The white primary, small — for "Add", "New note". */
export const whitePillSm =
  'console-focusable inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-slate-900';

/** The card every stage panel sits in. */
export const stageCard = 'rounded-2xl border border-white/[0.08] bg-white/[0.03]';
export const stageCardHover = 'transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]';

/** The back link above a masthead. */
export const backLink =
  'console-focusable -ml-2 inline-flex h-9 items-center gap-2 rounded-full px-2 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground';

/**
 * Up next — the one action a screen offers, as a thing rather than a button:
 * the Lesson itself, lit in its Space's colour, with a single verb on it.
 *
 * Shared by Space and Home so "the next thing" looks the same wherever it is
 * offered. It replaced a Continue button *and* a Continue bento cell that said
 * the same thing twice (Abi, 2026-10-10). A link, never a navigate() handler:
 * a Lesson target keeps cmd-click and open-in-new-tab.
 */
export function UpNext({
  to,
  number,
  kicker,
  title,
  percent = 0,
  accent,
  verb,
}: {
  to: string;
  number: number;
  /** One quiet line above the title — context, or how far you are. */
  kicker: string;
  title: string;
  percent?: number;
  accent: string;
  verb: string;
}) {
  return (
    <Link
      to={to}
      aria-label={`${verb}: ${title}. ${kicker}`}
      className="console-focusable group relative mx-auto flex max-w-2xl items-center gap-5 overflow-hidden rounded-3xl border p-4 pr-5 transition-colors hover:border-white/25 sm:p-5 sm:pr-6"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 32%, transparent)`,
        background: `linear-gradient(110deg, color-mix(in srgb, ${accent} 14%, transparent), color-mix(in srgb, ${accent} 3%, transparent) 70%)`,
      }}
    >
      <span
        aria-hidden
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-[26px] font-medium tabular-nums"
        style={{ background: `color-mix(in srgb, ${accent} 22%, transparent)`, color: accent }}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[12.5px] text-quiet">{kicker}</span>
        <span className="mt-0.5 block truncate text-[22px] font-medium tracking-[-0.02em]">{title}</span>
        {percent > 0 && (
          <span aria-hidden className="mt-2.5 block h-1 w-full max-w-[16rem] overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full" style={{ width: `${percent}%`, background: accent }} />
          </span>
        )}
      </span>
      <span
        aria-hidden
        className="hidden h-12 shrink-0 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-black transition-colors group-hover:bg-white/90 sm:inline-flex"
      >
        <Play aria-hidden className="h-4 w-4 fill-current" />
        {verb}
      </span>
    </Link>
  );
}
