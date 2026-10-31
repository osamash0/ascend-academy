import { useEffect, useState } from "react";
import { Locked, api, type ComparisonSummary, type Results } from "../api";
import { axis, dash, pct } from "../lib";

interface Props {
  comparisons: ComparisonSummary[];
  names: Record<string, string>;
  onChange: () => void;
}

const TYPES = ["layout", "lists", "table_formula", "diagram", "dense_text"];

/** Ranking with intervals, the check table, quality versus speed, self-consistency. */
export function Scoreboard({ comparisons, names, onChange }: Props) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [data, setData] = useState<Results | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const chosen = comparisons.find((c) => c.run_id === chosenId) ?? comparisons[0] ?? null;
  const id = chosen?.run_id;
  const state = `${chosen?.status}-${chosen?.done}-${chosen?.unlocked_early?.at ?? ""}`;

  useEffect(() => {
    if (!id) return;
    let current = true; // an answer for a comparison that is no longer selected is dropped
    setData(null);
    setLocked(false);
    setError(null);
    api
      .results(id)
      .then((r) => current && setData(r))
      .catch((e: Error) => {
        if (!current) return;
        if (e instanceof Locked) setLocked(true);
        else setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [id, state]);

  if (!chosen) return <p className="sub">No comparison yet.</p>;
  const name = (entrant: string) => names[entrant] ?? entrant;
  const picker =
    comparisons.length > 1 ? (
      <select className="pick" value={chosen.run_id} onChange={(e) => setChosenId(e.target.value)}>
        {comparisons.map((c) => (
          <option key={c.run_id} value={c.run_id}>
            {c.run_id} · {c.status}
          </option>
        ))}
      </select>
    ) : null;

  if (locked) {
    const unlock = () => {
      if (!window.confirm("Unlock the scoreboard before judging is finished? This is written to the lab log and cannot be undone.")) return;
      setUnlocking(true);
      setError(null);
      api
        .unlock(chosen.run_id, reason.trim())
        .then(onChange)
        .catch((e: Error) => setError(e.message))
        .finally(() => setUnlocking(false));
    };
    return (
      <div className="locked">
        {picker}
        <h2>The scoreboard opens when judging is finished</h2>
        <p className="sub">
          {chosen.done} of {chosen.total} duels judged. The ranking is recalculated from your raw votes every time, never
          edited by hand.
        </p>
        <p className="sub">Unlocking early is allowed, and it is written to the lab log as a deviation.</p>
        <div className="bar">
          <input
            className="note"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why unlock early? (goes into the lab log)"
          />
          <button className="vote" disabled={!reason.trim() || unlocking} onClick={unlock}>
            Unlock early
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="sub">Computing the ranking…</p>;
  if (!data.ranking.length) return <p className="sub">No votes yet.</p>;

  const scale = axis(data.ranking);
  const sc = data.self_consistency;
  const tools = data.ranking.map((r) => r.entrant);
  return (
    <section>
      {picker}
      <h2>Ranking</h2>
      <p className="sub">
        Bradley–Terry points from {data.pooled?.votes ?? data.votes} blind duels, with our current extraction at 1000. The bar is the 95%
        interval from {data.bootstrap.resamples.toLocaleString("en")} resamples. A whole bar right of the line is
        necessary for a method to beat today, but not enough: H1 is decided on the corrected lower bound in the next
        column (Bonferroni over {data.h1_k ?? "k"} challengers), which sits further left than the bar's edge.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Method</th>
            <th>Points (95% interval)</th>
            <th />
            <th>Corrected lower bound{data.h1_k ? ` (k = ${data.h1_k})` : ""}</th>
            <th>Duels</th>
            <th>Both unusable</th>
          </tr>
        </thead>
        <tbody>
          {data.ranking.map((r, i) => (
            <tr key={r.entrant}>
              <td>{i + 1}</td>
              <td className="ink">{name(r.entrant)}</td>
              <td>
                {r.points.toFixed(0)}{" "}
                <span className="small">
                  ({r.lo.toFixed(0)}–{r.hi.toFixed(0)})
                </span>
              </td>
              <td className="cicell">
                <div className="ci">
                  <span className="base" style={{ left: `${pct(1000, scale)}%` }} />
                  <span className="r" style={{ left: `${pct(r.lo, scale)}%`, width: `${pct(r.hi, scale) - pct(r.lo, scale)}%` }} />
                  <span className="p" style={{ left: `${pct(r.points, scale)}%` }} />
                </div>
              </td>
              <td>
                {r.h1_lower === null ? (
                  "—"
                ) : (
                  // "above" is the server's own verdict (unrounded), never re-derived from the rounded figure
                  <span className={data.h1.above_anchor.includes(r.entrant) ? "ink" : "small"}>
                    {r.h1_lower.toFixed(0)}
                    {data.h1.above_anchor.includes(r.entrant) ? " · above" : ""}
                  </span>
                )}
              </td>
              <td>{r.duels}</td>
              <td>{r.both_bad}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        H1{" "}
        {data.h1.holds
          ? `holds: ${data.h1.above_anchor.map(name).join(", ")} lie${data.h1.above_anchor.length === 1 ? "s" : ""} above our current extraction after correcting for ${data.h1_k ?? "k"} comparisons (Bonferroni).`
          : `does not hold: no method's Bonferroni-corrected lower bound (k = ${data.h1_k ?? "unknown"}) lies above our current extraction.`}{" "}
        Self-consistency on {sc.total} hidden repeats: {sc.agree} of {sc.total}
        {sc.share === null ? "" : ` (${Math.round(sc.share * 100)}%)`}. Median decision time: {data.median_seconds === null ? "—" : `${dash(data.median_seconds)} s`}.
        {data.round2_duels ? ` Round 2 added ${data.round2_duels} duels.` : ""}
      </p>
      {data.pooled ? (
        <p className="small">
          One scale: these ratings pool this comparison's {data.votes} votes with those of {data.pooled.builds_on.join(", ")} (
          {data.pooled.votes} votes in all), with our current extraction at 1000
          {Object.entries(data.pooled.sources).some(([, s]) => s.unlocked_early)
            ? `; ${Object.entries(data.pooled.sources)
                .filter(([, s]) => s.unlocked_early)
                .map(([cid]) => cid)
                .join(", ")} was unlocked early`
            : ""}
          . New in this comparison: {data.pooled.new_entrants.map(name).join(", ") || "none"}. Self-consistency and decision
          time are this comparison's own.
          {data.sensitivity
            ? ` Descriptive only, because round 2 depends on round 1: on round-1 duels alone (${data.sensitivity.round1_only.votes} votes), ${
                data.sensitivity.round1_only.h1_above.length
                  ? `H1 holds for ${data.sensitivity.round1_only.h1_above.map(name).join(", ")}.`
                  : "no method's corrected lower bound lies above our current extraction."
              }`
            : ""}
        </p>
      ) : null}

      <h2 className="gap">Automatic checks</h2>
      <p className="sub">
        Over the comparison's pages. † Dropped and invented words use PyMuPDF's own text layer as the reference, so these
        methods score near-perfect there by construction.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Method</th>
            <th>Footer leaks</th>
            <th>Pages leaking</th>
            <th>Footer share</th>
            <th>Title first</th>
            <th>Wrong symbols</th>
            <th>Broken lines</th>
            <th>Dropped</th>
            <th>Invented</th>
            <th>s / page</th>
            <th>Peak MB</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => {
            const c = data.checks[t];
            return (
              <tr key={t}>
                <td className="ink">
                  {name(t)}
                  {c.reference_biased ? " †" : ""}
                </td>
                <td>{c.footer_leaks}</td>
                <td>
                  {c.pages_with_footer_leak} / {c.pages}
                </td>
                <td>{c.footer_token_share === null ? "—" : `${Math.round(c.footer_token_share * 100)}%`}</td>
                <td>{c.title_first === null ? "—" : `${Math.round(c.title_first * 100)}%`}</td>
                <td>{c.wrong_symbols}</td>
                <td>{c.broken_line_pct === null ? "—" : `${dash(c.broken_line_pct, 1)}%`}</td>
                <td>{c.dropped_words_pct === null ? "—" : `${dash(c.dropped_words_pct, 1)}%`}</td>
                <td>{c.invented_words_pct === null ? "—" : `${dash(c.invented_words_pct, 1)}%`}</td>
                <td>{dash(c.seconds_per_page)}</td>
                <td>{dash(c.peak_memory_mb)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="gap">Quality versus speed</h2>
      <QualitySpeed
        points={data.ranking.map((r) => ({ label: name(r.entrant), y: r.points, x: data.checks[r.entrant]?.seconds_per_page ?? null }))}
      />

      <h2 className="gap">Win rate by page type</h2>
      <p className="sub">Wins plus half the draws, per duel. Descriptive only.</p>
      <table className="data">
        <thead>
          <tr>
            <th>Method</th>
            {TYPES.map((t) => (
              <th key={t}>{t.replace("_", " / ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => (
            <tr key={t}>
              <td className="ink">{name(t)}</td>
              {TYPES.map((type) => {
                const cell = data.win_rate_by_type[t]?.[type];
                return <td key={type}>{cell ? `${Math.round(cell.score * 100)}% (${cell.duels})` : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Points against seconds per page (log scale); methods without a time are left out. */
function QualitySpeed({ points }: { points: { label: string; x: number | null; y: number }[] }) {
  const shown = points.filter((p): p is { label: string; x: number; y: number } => p.x !== null && p.x > 0);
  if (!shown.length) return <p className="sub">No timings yet.</p>;
  const W = 640;
  const H = 280;
  const M = 44;
  const xs = shown.map((p) => Math.log10(p.x));
  const [x0, x1] = [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3];
  const [y0, y1] = axis(shown.map((p) => ({ lo: p.y, hi: p.y })));
  const sx = (v: number) => M + ((Math.log10(v) - x0) / (x1 - x0)) * (W - 2 * M);
  const sy = (v: number) => H - M - ((v - y0) / (y1 - y0)) * (H - 2 * M);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points against seconds per page">
      <line x1={M} x2={W - M} y1={sy(1000)} y2={sy(1000)} className="base" />
      <text x={M} y={H - 12} className="axis">
        faster ←  seconds per page (log scale)  → slower
      </text>
      <text x={8} y={M - 16} className="axis">
        points
      </text>
      {shown.map((p) => (
        <g key={p.label}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={5} />
          <text x={sx(p.x) + 8} y={sy(p.y) + 4}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
