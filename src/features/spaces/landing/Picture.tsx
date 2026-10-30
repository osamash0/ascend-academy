import { useTranslation } from 'react-i18next';
import { mix } from './light';
import type { Grid, Themes } from './types';

/**
 * The evidence a finding opens onto.
 *
 * Two kinds, both narrated rather than tabled: what people asked on a page,
 * as themes and a count (never word for word), and the check-in held against
 * the checkpoint, with the trap cell in the Lesson's colour.
 */

/** Check-in against checkpoint: four cells, the trap cell lit. */
export function GridPicture({ grid, page, color }: { grid: Grid; page: number; color: string }) {
  const { t } = useTranslation('v4Landing');
  const total = grid.clickedCleared + grid.clickedMissed + grid.foggyCleared + grid.foggyMissed;
  if (total === 0) return <p className="text-[14px] text-quiet">{t('grid.few')}</p>;
  const cells: { key: keyof Grid; trap?: boolean }[] = [
    { key: 'clickedCleared' },
    { key: 'clickedMissed', trap: true },
    { key: 'foggyCleared' },
    { key: 'foggyMissed' },
  ];
  return (
    <figure className="m-0">
      <figcaption className="text-[13px] text-quiet">{t('grid.title', { page })}</figcaption>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {cells.map(({ key, trap }) => {
          const count = grid[key];
          const pct = Math.round((count / total) * 100);
          return (
            <div
              key={key}
              className="rounded-xl bg-white/[0.04] p-4"
              style={trap ? { background: mix(color, 14) } : undefined}
            >
              <p className="text-[13px] leading-snug text-quiet">{t(`grid.${key}`)}</p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="text-[24px] font-medium tabular-nums tracking-[-0.02em]">{pct}%</span>
                <span className="text-[12.5px] tabular-nums text-quiet">{t('grid.people', { count })}</span>
              </p>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** What people asked on a page, as themes, with how many asked. */
export function ThemesPicture({ themes }: { themes: Themes }) {
  const { t } = useTranslation('v4Landing');
  return (
    <figure className="m-0">
      <figcaption className="text-[13px] text-quiet">{t('themes.title', { page: themes.page })}</figcaption>
      <ol className="mt-3 space-y-2">
        {themes.themes.map((theme) => (
          <li key={theme} className="flex gap-3 text-[15px] leading-snug">
            <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
            {theme}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12.5px] text-quiet">{t('themes.count', { count: themes.askers })}</p>
    </figure>
  );
}
