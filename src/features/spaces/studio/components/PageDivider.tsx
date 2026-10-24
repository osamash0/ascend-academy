import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The reader's quiet page label, with a hairline: "page 12". Page 0 (notes above the first page) has none.
 * In Recall a small ring sits at its right end; in Learn, the Depth dial after it.
 */
export function PageDivider({
  page,
  original,
  ring,
  dial,
}: {
  page: number;
  original?: boolean;
  ring?: ReactNode;
  dial?: ReactNode;
}) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'studio.canvas.page' });
  if (page === 0) return null;
  return (
    <p className="mb-4 flex items-center gap-3 text-[12px] tabular-nums text-faint">
      <span>{t(original ? 'dividerSource' : 'divider', { page })}</span>
      <span aria-hidden className="h-px flex-1 bg-[rgb(var(--studio-hairline))]" />
      {ring}
      {dial}
    </p>
  );
}
