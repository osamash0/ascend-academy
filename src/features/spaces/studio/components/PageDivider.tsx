/** The reader's quiet page label, with a hairline: "page 12". Page 0 (notes above the first page) has none. */
export function PageDivider({ page, original }: { page: number; original?: boolean }) {
  if (page === 0) return null;
  return (
    <p className="mb-4 flex items-center gap-3 text-[12px] tabular-nums text-faint">
      <span>
        page {page}
        {original ? ' · source' : ''}
      </span>
      <span aria-hidden className="h-px flex-1 bg-[rgb(var(--studio-hairline))]" />
    </p>
  );
}
