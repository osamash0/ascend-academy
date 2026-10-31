import { useEffect, useState } from "react";
import {
  api,
  type ComparisonSummary,
  type Method,
  type Results as ResultsData,
  type RunRow,
} from "../api";
import {
  PAGE_TYPES,
  axis,
  costCell,
  dash,
  heat,
  memoryLabel,
  paidCosts,
  pct,
  pooledIds,
  readyComparisons,
  recordShares,
  resultsLine,
  secondsCell,
  sortRanking,
  unranked,
  verdict,
} from "../lib";

interface Props {
  comparisons: ComparisonSummary[];
  loaded: boolean;
}

const GROUP_NOTE =
  "lower bound: memory the models use on the Mac's GPU is not counted";

/** Every method and its result on one page: numbers only, never a page's text. */
export function Results({ comparisons, loaded }: Props) {
  const ready = readyComparisons(comparisons);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = ready.find((c) => c.run_id === chosenId) ?? ready[0] ?? null;
  const id = chosen?.run_id;
  const [data, setData] = useState<ResultsData | null>(null);
  const [methods, setMethods] = useState<Method[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .methods()
      .then((r) => current && setMethods(r.methods))
      .catch(() => undefined);
    api
      .runs()
      .then((r) => current && setRuns(r.runs))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let current = true; // an answer for a comparison that is no longer selected is dropped
    setData(null);
    setError(null);
    api
      .results(id)
      .then((r) => current && setData(r))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [id]);

  if (!loaded) return <p className="sub">Loading…</p>;
  if (!chosen) {
    // Names stay hidden while a comparison is being judged (blinding): nothing but this message.
    const judging = comparisons.find((c) => c.locked);
    return (
      <div className="locked">
        <h2>The results open when judging is finished</h2>
        <p className="sub">
          {judging ? `${judging.done} of ${judging.total} duels judged. ` : ""}
          Method names and scores stay hidden until then, so nothing can bias
          the votes.
        </p>
      </div>
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="sub">Computing the results…</p>;
  if (!data.ranking.length) return <p className="sub">No votes yet.</p>;

  const byId = new Map(methods.map((m) => [m.id, m]));
  const name = (m: string) => byId.get(m)?.label ?? m;
  const rows = sortRanking(data.ranking);
  const tools = rows.map((r) => r.entrant);
  const scale = axis(rows);
  const paid = methods.filter((m) => m.paid).map((m) => m.id);
  const costs = paidCosts(runs, paid);
  const sc = data.self_consistency;
  const round1 = data.sensitivity?.round1_only;
  const pages = data.checks[tools[0]]?.pages;
  const missing = unranked(methods, tools);

  const picker =
    ready.length > 1 ? (
      <select
        className="pick"
        value={chosen.run_id}
        onChange={(e) => setChosenId(e.target.value)}
      >
        {ready.map((c) => (
          <option key={c.run_id} value={c.run_id}>
            {c.run_id} · {c.status}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <section>
      {picker}
      <h2>Results</h2>
      <p className="sub">{resultsLine(data)}</p>
      <p className="small spaced">
        Clearly better = its lowest plausible score (Bonferroni, k ={" "}
        {data.h1_k ?? "?"}) is still above the current pipeline&apos;s 1000. The
        bar is the 95% interval; the dot is the score.
      </p>

      <div className="scroll spaced">
        <table className="data results">
          <thead>
            <tr>
              <th>#</th>
              <th>Method</th>
              <th>Points</th>
              <th>95% interval</th>
              <th>vs current</th>
              <th>Record (W / L / = / both unusable)</th>
              <th>Speed</th>
              <th>Memory</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const m = byId.get(r.entrant);
              const v = verdict(r, data.anchor, data.h1.above_anchor);
              const c = data.checks[r.entrant];
              const s = recordShares(r);
              return (
                <tr
                  key={r.entrant}
                  className={v.kind === "baseline" ? "anchor" : ""}
                >
                  <td>{i + 1}</td>
                  <td>
                    <span className="ink">{name(r.entrant)}</span>{" "}
                    {m ? <span className="tag">{m.group}</span> : null}
                    {m?.paid && m.model ? (
                      <div className="small">{m.model}</div>
                    ) : null}
                  </td>
                  <td className="ink">{r.points.toFixed(0)}</td>
                  <td className="cicell">
                    <div
                      className="ci"
                      title={`${r.lo.toFixed(0)}–${r.hi.toFixed(0)}`}
                    >
                      <span
                        className="base"
                        style={{ left: `${pct(1000, scale)}%` }}
                      />
                      <span
                        className="r"
                        style={{
                          left: `${pct(r.lo, scale)}%`,
                          width: `${pct(r.hi, scale) - pct(r.lo, scale)}%`,
                        }}
                      />
                      <span
                        className="p"
                        style={{ left: `${pct(r.points, scale)}%` }}
                      />
                    </div>
                  </td>
                  <td className={`verdict ${v.kind}`}>{v.label}</td>
                  <td>
                    <div className="rec">
                      {r.wins} / {r.losses} / {r.same} / {r.both_bad}{" "}
                      <span className="small">of {r.duels}</span>
                    </div>
                    <div
                      className="split"
                      role="img"
                      aria-label={`won ${r.wins}, lost ${r.losses}, same ${r.same}, both unusable ${r.both_bad}`}
                    >
                      <i className="w" style={{ width: `${s.wins * 100}%` }} />
                      <i
                        className="l"
                        style={{ width: `${s.losses * 100}%` }}
                      />
                      <i className="s" style={{ width: `${s.same * 100}%` }} />
                      <i
                        className="b"
                        style={{ width: `${s.both_bad * 100}%` }}
                      />
                    </div>
                  </td>
                  <td>{secondsCell(c?.seconds_per_page)}</td>
                  <td title={m?.group === "heavy" ? GROUP_NOTE : undefined}>
                    {memoryLabel(c?.peak_memory_mb, m?.group)}
                  </td>
                  <td
                    title={
                      costs[r.entrant] === undefined
                        ? undefined
                        : `for the ${pages ?? "benchmark"} pages`
                    }
                  >
                    {costCell(costs[r.entrant])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="gap">By page type</h2>
      <p className="sub">
        Wins plus half the draws, per duel. Shade = score; the small number is
        the duels behind it. Descriptive only.
      </p>
      <div className="scroll">
        <table className="data results">
          <thead>
            <tr>
              <th>Method</th>
              {PAGE_TYPES.map(([t, label]) => (
                <th key={t}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t}>
                <td className="ink">{name(t)}</td>
                {PAGE_TYPES.map(([type]) => {
                  const cell = data.win_rate_by_type[t]?.[type];
                  return (
                    <td
                      key={type}
                      className="heat"
                      style={
                        cell
                          ? {
                              background: `rgba(255, 255, 255, ${heat(cell.score)})`,
                            }
                          : undefined
                      }
                    >
                      {cell ? (
                        <>
                          <span className="ink">
                            {Math.round(cell.score * 100)}%
                          </span>{" "}
                          <span className="tiny">{cell.duels}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="gap">Automatic checks</h2>
      <p className="sub">
        Over the comparison&apos;s {pages ?? ""} pages, no judging involved.
      </p>
      <div className="scroll">
        <table className="data results">
          <thead>
            <tr>
              <th>Method</th>
              <th>Footer leak (pages of {pages ?? "?"})</th>
              <th>Title first</th>
              <th>Wrong symbols</th>
              <th>Broken lines</th>
              <th>Invented words</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => {
              const c = data.checks[t];
              return (
                <tr key={t}>
                  <td className="ink">{name(t)}</td>
                  <td>{c ? c.pages_with_footer_leak : "—"}</td>
                  <td>
                    {c?.title_first == null
                      ? "—"
                      : `${Math.round(c.title_first * 100)}%`}
                  </td>
                  <td>{c ? c.wrong_symbols : "—"}</td>
                  <td>
                    {c?.broken_line_pct == null
                      ? "—"
                      : `${dash(c.broken_line_pct, 1)}%`}
                  </td>
                  <td>
                    {c?.invented_words_pct == null
                      ? "—"
                      : `${dash(c.invented_words_pct, 1)}%`}
                    {c?.reference_biased ? " †" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small spaced">
        Invented words include HTML tag names. † Measured against PyMuPDF&apos;s
        own text layer, so near zero by construction for the current pipeline
        and read with care for pymupdf4llm.
      </p>

      {missing.length ? (
        <>
          <h2 className="gap">Not ranked</h2>
          <div className="scroll">
            <table className="data results">
              <tbody>
                {missing.map(({ method, status, note }) => (
                  <tr key={method.id}>
                    <td className="ink">
                      {method.label} <span className="tag">{method.group}</span>
                    </td>
                    <td>{status}</td>
                    <td className="small">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <p className="small gap">
        Self-consistency: on {sc.total} hidden repeats the verdict agreed{" "}
        {sc.agree} times
        {sc.share === null ? "" : ` (${Math.round(sc.share * 100)}%)`}.{" "}
        {round1
          ? `Round-1-only check (${round1.votes} votes, descriptive): ${
              round1.h1_above.length
                ? `${round1.h1_above.map(name).join("; ")} still clearly better.`
                : "no method is still clearly better."
            } `
          : ""}
        Pools {pooledIds(data).join(", ")}.
      </p>
    </section>
  );
}
