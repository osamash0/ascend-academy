/** "page 12" above each page; page 0 (notes above the first page) has none. */
export function PageDivider({ page, original }: { page: number; original?: boolean }) {
  if (page === 0) return null;
  return (
    <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
      page {page}
      {original ? ' · original' : ''}
    </p>
  );
}
