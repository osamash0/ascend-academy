import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Estimate, type Job, type Method, type StoredFile } from "../api";
import { confirmMatches, estimateLine, jobLabel, methodState, type RunChoice } from "../lib";

const GROUPS: [Method["group"], string][] = [
  ["fast", "Fast (seconds, nothing to download)"],
  ["heavy", "Heavy (minutes, models download once)"],
  ["paid", "Costs money (sends page images to OpenAI)"],
];

/** What a method that cannot run yet is waiting for. A paid method says so in the server's own words (never the key). */
function MethodStatus({ m, onInstall }: { m: Method; onInstall: (id: string) => void }) {
  const state = methodState(m);
  if (state === "ready")
    return (
      <>
        <span className="dot ready" />
        ready
      </>
    );
  if (state === "install")
    return (
      <button
        className="linkbtn"
        title={m.missing.join("; ")}
        onClick={(e) => {
          e.preventDefault();
          onInstall(m.id);
        }}
      >
        install · {m.size_mb} MB
      </button>
    );
  const keyGap = m.missing.find((g) => g.startsWith("key file"));
  return (
    <span className="small" title={m.missing.join("; ")}>
      {state === "key" ? (keyGap?.startsWith("key file missing") ? "key file missing" : "key file not usable") : "not ready"}
    </span>
  );
}

/** Drop a PDF, tick methods, pick Explore or Benchmark set, run them as background jobs. A paid method is
 * never started by one click: its page count and estimated cost are shown first (spec "New run"). */
export function NewRun({ notify }: { notify: (message: string) => void }) {
  const [methods, setMethods] = useState<Method[]>([]);
  const [stored, setStored] = useState<StoredFile[]>([]);
  const [file, setFile] = useState<StoredFile | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(["current"]));
  const [purpose, setPurpose] = useState<"explore" | "benchmark">("explore");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const starting = useRef(false); // a double click must not queue the runs twice
  const [startingRuns, setStartingRuns] = useState(false);
  // what the cost OK was shown for: the file, the mode, the methods and their estimates; Send and run starts exactly these
  const [confirm, setConfirm] = useState<(RunChoice & { estimates: Estimate[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const loadMethods = useCallback(() => {
    api.methods().then((r) => setMethods(r.methods)).catch(() => undefined);
  }, []);
  const loadJobs = useCallback(() => {
    api.jobs().then((r) => setJobs(r.jobs)).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadMethods();
    loadJobs();
    api.files().then((r) => setStored(r.files)).catch(() => undefined);
  }, [loadMethods, loadJobs]);

  const busy = jobs.some((j) => j.state === "queued" || j.state === "running");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      loadJobs();
      loadMethods();
    }, 1500);
    return () => clearInterval(timer);
  }, [busy, loadJobs, loadMethods]);

  const benchmarkPages = file?.benchmark_pages ?? [];
  useEffect(() => {
    if (!benchmarkPages.length) setPurpose("explore");
  }, [benchmarkPages.length]);
  // an OK is for exactly what it showed: another file, mode or choice of methods needs a new one
  useEffect(() => {
    setConfirm(null);
  }, [file, purpose, picked]);

  const upload = async (f: File) => {
    setUploading(true);
    setError(null);
    try {
      const saved = await api.upload(f);
      setFile(saved);
      setStored((prev) => [saved, ...prev.filter((x) => x.sha256 !== saved.sha256)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const chosen = () => methods.filter((m) => m.ready && picked.has(m.id)).map((m) => m.id);
  // the choice as it is now, for an estimate that comes back after the choice changed
  const now = useRef<RunChoice | null>(null);
  useEffect(() => {
    now.current = file ? { sha256: file.sha256, purpose, tools: methods.filter((m) => m.ready && picked.has(m.id)).map((m) => m.id) } : null;
  }, [file, purpose, methods, picked]);

  const start = async ({ sha256, purpose: forPurpose, tools }: RunChoice, costOk: boolean) => {
    if (starting.current) return;
    starting.current = true;
    setStartingRuns(true);
    setError(null);
    try {
      const r = await api.startJobs({ sha256, tools, purpose: forPurpose, cost_ok: costOk });
      setMine(r.jobs.map((j) => j.job_id));
      setConfirm(null);
      loadJobs();
      notify(`${r.jobs.length} run${r.jobs.length === 1 ? "" : "s"} queued`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      starting.current = false;
      setStartingRuns(false);
    }
  };

  // Without a paid method the run starts at once. With one, nothing is queued: the estimate is asked for (only
  // for the paid methods that are ready and ticked) and the cost OK is shown first.
  const run = async () => {
    if (!file || starting.current) return;
    const asked: RunChoice = { sha256: file.sha256, purpose, tools: chosen() };
    const paidTools = asked.tools.filter((id) => methods.find((m) => m.id === id)?.paid);
    if (!paidTools.length) return start(asked, false);
    setError(null);
    try {
      const r = await api.estimate(asked.sha256, paidTools, asked.purpose);
      // the choice may have changed while the estimate was on its way: an OK is never shown for something else
      if (confirmMatches(asked, now.current)) setConfirm({ ...asked, estimates: r.estimates });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const install = (id: string) =>
    api
      .install(id)
      .then(() => {
        loadJobs();
        notify("Installing in the background");
      })
      .catch((e: Error) => setError(e.message));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const count = methods.filter((m) => m.ready && picked.has(m.id)).length;
  const shown = jobs.filter((j) => mine.includes(j.job_id) || j.state === "queued" || j.state === "running");
  return (
    <section>
      <h2>New run</h2>
      <p className="sub">Bring in a file, choose the methods, run them. Every run is kept, and nothing is overwritten.</p>
      <div className="two">
        <div>
          <div
            className={`drop ${file ? "has" : ""} ${dragging ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) upload(dropped);
            }}
          >
            {file ? (
              <div className="file">
                <div className="ic">PDF</div>
                <div>
                  <b>{file.name}</b>
                  <div className="small">
                    {file.pages} pages · {(file.size / 2 ** 20).toFixed(1)} MB · sha256 {file.sha256.slice(0, 4)}…
                    {file.sha256.slice(-4)}
                  </div>
                </div>
              </div>
            ) : (
              <b>Drop a PDF here</b>
            )}
            <div className="small spaced">
              {uploading ? (
                "Storing…"
              ) : (
                <>
                  Drop {file ? "another" : "a"} PDF here, or{" "}
                  <button className="linkbtn" onClick={() => input.current?.click()}>
                    choose a file
                  </button>
                  . It is kept under the data folder by its SHA-256, never in git.
                </>
              )}
            </div>
            <input
              ref={input}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) upload(selected);
                e.target.value = "";
              }}
            />
          </div>
          {stored.length ? (
            <select className="pick spaced" value={file?.sha256 ?? ""} onChange={(e) => setFile(stored.find((f) => f.sha256 === e.target.value) ?? null)}>
              <option value="">Or pick a file brought in before…</option>
              {stored.map((f) => (
                <option key={f.sha256} value={f.sha256}>
                  {f.name} · {f.pages} pages
                </option>
              ))}
            </select>
          ) : null}
          <div className="purpose">
            <button className={`seg ${purpose === "explore" ? "on" : ""}`} onClick={() => setPurpose("explore")}>
              <b>Explore</b>
              <small>Named outputs, any file. Doesn't count for the thesis.</small>
            </button>
            <button
              className={`seg ${purpose === "benchmark" ? "on" : ""}`}
              disabled={!benchmarkPages.length}
              onClick={() => setPurpose("benchmark")}
            >
              <b>Benchmark set</b>
              <small>
                {benchmarkPages.length
                  ? `This file's ${benchmarkPages.length} protocol pages. Feeds blind judging.`
                  : "Only for the protocol's source files."}
              </small>
            </button>
          </div>
          <div className="runbar">
            <button className="vote primary" disabled={!file || count === 0 || startingRuns || confirm !== null} onClick={run}>
              Run {count} method{count === 1 ? "" : "s"}
            </button>
            <span className="small">One method at a time, in the background.</span>
          </div>
          {confirm ? (
            <div className="panel spaced">
              <b>This sends page images to OpenAI and costs money.</b>
              {confirm.estimates.map((e) => (
                <div key={e.tool} className="small">
                  {estimateLine(e)}
                </div>
              ))}
              <div className="runbar">
                <button className="vote primary" disabled={startingRuns} onClick={() => start(confirm, true)}>
                  Send and run
                </button>
                <button className="linkbtn" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="prog">
            {shown.map((j) => (
              <div key={j.job_id} className="prow">
                <span>{methods.find((m) => m.id === j.tool)?.label ?? j.tool}</span>
                <span className={`small ${j.state}`}>{jobLabel(j)}</span>
                {j.state === "queued" || j.state === "running" ? (
                  <button className="linkbtn" onClick={() => api.cancel(j.job_id).then(loadJobs).catch((e: Error) => notify(e.message))}>
                    Cancel
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          {GROUPS.map(([group, title]) => {
            const listed = methods.filter((m) => m.group === group);
            if (!listed.length) return null;
            return (
              <div key={group} className="group">
                <h4>{title}</h4>
                {listed.map((m) => (
                  <label key={m.id} className={`method ${m.ready ? "" : "notready"}`}>
                    <input type="checkbox" disabled={!m.ready} checked={m.ready && picked.has(m.id)} onChange={() => toggle(m.id)} />
                    <div>
                      <div className="nm">{m.label}</div>
                      <div className="ds">
                        {m.description}
                        {m.model ? ` · ${m.model}` : ""}
                      </div>
                      {m.paid && !m.ready && !m.needs_install ? <div className="ds">{m.missing.join("; ")}</div> : null}
                    </div>
                    <div className="st">
                      <MethodStatus m={m} onInstall={install} />
                    </div>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
