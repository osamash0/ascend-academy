export interface MetricTile {
  label: string;
  value: string;
}

/** A calm row of metric tiles — the default Layer-2 body for scalar insights. */
export function MetricTiles({ tiles }: { tiles: MetricTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="text-2xl font-semibold text-foreground">{t.value}</div>
          <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
