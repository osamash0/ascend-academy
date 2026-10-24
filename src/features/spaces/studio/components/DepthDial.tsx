import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DEPTHS, type Depth } from '../depth';

/**
 * How deep this page reads (Learn deeper spec §3.3): four dots on a hairline at
 * the end of the page divider, the current one filled. A radiogroup with a
 * roving tab stop; arrows move the choice. Shift (click, arrows or Space) sets every page.
 */
export function DepthDial({
  page,
  value,
  options,
  onChange,
}: {
  page: number;
  value: Depth;
  options: Depth[];
  onChange(d: Depth, all: boolean): void;
}) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'studio.canvas.depth' });
  const refs = useRef<Partial<Record<Depth, HTMLButtonElement | null>>>({});
  const offered = DEPTHS.filter((d) => options.includes(d));

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Space: this stop, for every page — the keyboard's Shift+click.
    if (e.key === ' ' && e.shiftKey) {
      const d = (e.target as HTMLElement).dataset.depth as Depth | undefined;
      if (!d || !options.includes(d)) return;
      e.preventDefault();
      onChange(d, true);
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    // The page's own keys (← →) must not turn the page while you move the dial.
    e.stopPropagation();
    const i = offered.indexOf(value);
    const next = offered[Math.min(offered.length - 1, Math.max(0, i + step))];
    if (!next || next === value) return;
    onChange(next, e.shiftKey);
    refs.current[next]?.focus();
  };

  return (
    <span
      role="radiogroup"
      aria-label={t('label', { page })}
      onKeyDown={onKeyDown}
      className="group/dial relative flex items-center"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute right-full mr-1 whitespace-nowrap text-[11px] text-faint opacity-0 transition-opacity duration-150 group-focus-within/dial:opacity-100 group-hover/dial:opacity-100"
      >
        {t(value)}
      </span>
      <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-[rgb(var(--studio-hairline))]" />
      {DEPTHS.map((d) => {
        const on = d === value;
        const can = options.includes(d);
        return (
          <button
            key={d}
            ref={(el) => {
              refs.current[d] = el;
            }}
            type="button"
            data-depth={d}
            role="radio"
            aria-checked={on}
            aria-label={t(d)}
            disabled={!can}
            tabIndex={on ? 0 : -1}
            onClick={(e) => onChange(d, e.shiftKey)}
            className="console-focusable relative flex h-6 w-6 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-30"
          >
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-colors',
                on ? 'bg-foreground' : 'bg-faint',
              )}
            />
          </button>
        );
      })}
    </span>
  );
}
