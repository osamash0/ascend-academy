import { useCallback, useEffect, useState } from "react";
import { Locked, api, type DiffOp, type Job, type PageOutput, type RunDetail, type RunRow } from "../api";
import { CheckChips } from "../components/CheckChips";
import { Output } from "../components/Output";
import { costLine, dash, jobLabel, shortDate } from "../lib";

interface Props {
  names: Record<string, string>;
  notify: (message: string) => void;
}

/** Every run, the jobs still running, one run's outputs and checks, and two runs' differences. */
export function Runs({ names, notify }: Props) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [pair, setPair] = useState<string[]>([]);
  const load = useCallback(() => {
    api.runs().then((r) => setRows(r.runs)).catch(() => undefined);
    api.jobs().then((r) => setJobs(r.jobs)).catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  const active = jobs.filter((j) => j.state === "queued" || j.state === "running");
  useEffect(() => {
    if (!active.length) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [active.length, load]);

  const name = (tool: string | null) => (tool ? names[tool] ?? tool : "—");
  const toggle = (id: string) => setPair((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const [a, b] = pair.map((id) => rows.find((r) => r.run_id === id));
  // A running install cannot be cancelled and the server answers 400 with its reason: show it.
  const cancel = (id: string) =>
    api
      .cancel(id)
      .then(load)
      .catch((e: Error) => notify(e.message));

  return (
    <section>
      <h2>Runs</h2>
      <p className="sub">
        Every extraction and every comparison is a permanent record. Tick two runs of the same method on the same file to
        see what changed.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th />
            <th>Run</th>
            <th>Started</th>
            <th>Method</th>
            <th>File</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>Pages</th>
            <th>s / page</th>
            <th>Peak MB</th>
            <th>Commit</th>
          </tr>
        </thead>
        <tbody>
          {active.map((j) => (
            <tr key={j.job_id}>
              <td />
              <td className="k">{j.job_id}</td>
              <td>now</td>
              <td className="ink">{name(j.tool)}</td>
              <td>{j.file_name ?? "—"}</td>
              <td>{j.purpose ?? "install"}</td>
              <td>
                <span className="status running">{jobLabel(j)}</span>
              </td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>
                <button className="linkbtn" onClick={() => cancel(j.job_id)}>
                  Cancel
                </button>
              </td>
            </tr>
          ))}
          {rows.map((r) => (
            <tr key={r.run_id} className={open === r.run_id ? "open" : ""}>
              <td>
                {r.kind === "extract" ? (
                  <input type="checkbox" checked={pair.includes(r.run_id)} onChange={() => toggle(r.run_id)} aria-label="Pick to compare" />
                ) : null}
              </td>
              <td className="k">
                {r.kind === "extract" ? (
                  <button className="linkbtn" onClick={() => setOpen(open === r.run_id ? null : r.run_id)}>
                    {r.run_id}
                  </button>
                ) : (
                  r.run_id
                )}
              </td>
              <td>{shortDate(r.started_at)}</td>
              <td className="ink">{r.kind === "compare" ? "Comparison" : `${name(r.tool)} ${r.version ?? ""}`}</td>
              <td>{r.file ?? "—"}</td>
              <td>{r.purpose ?? "—"}</td>
              <td>
                <span className={`status ${r.status}`} title={r.reason ?? undefined}>
                  {r.kind === "compare" ? `${r.status} · ${r.done} / ${r.total}` : r.status}
                </span>
              </td>
              <td>{r.kind === "compare" ? r.pages_total : r.pages.length}</td>
              <td>{dash(r.seconds_per_page)}</td>
              <td>{dash(r.peak_memory_mb)}</td>
              <td className="k">
                {r.commit ? r.commit.slice(0, 8) : "—"}
                {r.dirty ? "*" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open ? <RunView runId={open} name={name} /> : null}
      {a && b ? (
        a.tool === b.tool && a.sha256 === b.sha256 ? (
          <DiffView key={`${a.run_id}:${b.run_id}`} a={a} b={b} name={name} />
        ) : (
          <p className="sub gap">Pick two runs of the same method on the same file.</p>
        )
      ) : null}
    </section>
  );
}

function RunView({ runId, name }: { runId: string; name: (tool: string | null) => string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [output, setOutput] = useState<PageOutput | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setRun(null);
    setOutput(null);
    setError(null);
    api
      .run(runId)
      .then((r) => {
        if (!current) return;
        setRun(r);
        setPage(r.page_list.find((p) => !p.locked)?.page ?? r.page_list[0]?.page ?? null);
      })
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [runId]);

  useEffect(() => {
    if (page === null) return;
    let current = true;
    setLocked(false);
    setOutput(null);
    api
      .page(runId, page)
      .then((r) => current && setOutput(r))
      .catch((e: Error) => {
        if (!current) return;
        if (e instanceof Locked) setLocked(true);
        else setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [runId, page]);

  if (error) return <p className="error gap">{error}</p>;
  if (!run) return null;
  return (
    <div className="panel gap">
      <h2>
        {name(run.tool)} {run.version ?? ""} <span className="dim">· {run.file} · {shortDate(run.started_at)}</span>
      </h2>
      <p className="small">
        {run.status}
        {run.reason ? `: ${run.reason}` : ""} · {dash(run.seconds_per_page)} s/page · peak {dash(run.peak_memory_mb)} MB ·
        warm-up {dash(run.warmup_seconds)} s · checks v{run.checks_version} · record v{run.record_version}
        {run.protocol_commit ? ` · protocol ${run.protocol_commit.slice(0, 8)}` : ""}
      </p>
      {run.environment ? <p className="small mono">{run.environment.join("  ·  ")}</p> : null}
      {run.cost ? (
        <p className="small">
          OpenAI: {costLine(run.cost)}
          {run.pages_sent === null ? " · pages sent: unknown" : run.pages_sent ? ` · ${run.pages_sent.length} page${run.pages_sent.length === 1 ? "" : "s"} sent` : ""}
        </p>
      ) : null}
      <div className="chips">
        {run.page_list.map((p) => (
          <button key={p.page} className={`chip ${p.page === page ? "on" : ""} ${p.locked ? "na" : ""}`} onClick={() => setPage(p.page)}>
            Page {p.page}
            {p.locked ? " · locked" : ""}
          </button>
        ))}
      </div>
      {locked ? (
        <p className="sub">This page is in the benchmark set and still being judged blind; its output opens when judging is finished.</p>
      ) : output ? (
        <div className="out">
          <CheckChips checks={output.checks} />
          <div className="bd">
            <Output markdown={output.markdown} footerLines={output.footer_lines} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiffView({ a, b, name }: { a: RunRow; b: RunRow; name: (tool: string | null) => string }) {
  const [older, newer] = (a.started_at ?? "") <= (b.started_at ?? "") ? [a, b] : [b, a];
  const pages = older.pages.filter((p) => newer.pages.includes(p));
  const [page, setPage] = useState<number | null>(pages[0] ?? null);
  const [ops, setOps] = useState<DiffOp[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (page === null) return;
    let current = true;
    setOps(null);
    setMessage(null);
    api
      .diff(older.run_id, newer.run_id, page)
      .then((r) => current && setOps(r.ops))
      .catch((e: Error) => {
        if (!current) return;
        setMessage(e instanceof Locked ? "This page is still being judged blind; the difference opens afterwards." : e.message);
      });
    return () => {
      current = false;
    };
  }, [older.run_id, newer.run_id, page]);

  return (
    <div className="panel gap">
      <h2>
        What changed: <span className="dim">{name(older.tool)}, {shortDate(older.started_at)} → {shortDate(newer.started_at)}</span>
      </h2>
      <div className="chips">
        {pages.map((p) => (
          <button key={p} className={`chip ${p === page ? "on" : ""}`} onClick={() => setPage(p)}>
            Page {p}
          </button>
        ))}
      </div>
      {message ? <p className="sub">{message}</p> : null}
      {ops ? (
        <div className="diffbox">
          {ops.map((op, i) =>
            op.op === "equal" ? <span key={i}>{op.text}</span> : op.op === "delete" ? <del key={i}>{op.text}</del> : <ins key={i}>{op.text}</ins>,
          )}
        </div>
      ) : null}
    </div>
  );
}
