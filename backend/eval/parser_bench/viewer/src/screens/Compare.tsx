import { useEffect, useState } from "react";
import { Locked, api, pngUrl, type NamedOutput, type SourceInfo } from "../api";
import { CheckChips } from "../components/CheckChips";
import { Output } from "../components/Output";
import { Zoom } from "../components/Zoom";
import { shortDate } from "../lib";

/** Any page of any file, the page image and every finished run's output side by side, with names. */
export function Compare({ names }: { names: Record<string, string> }) {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sha, setSha] = useState<string | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [outputs, setOutputs] = useState<NamedOutput[]>([]);
  const [withheld, setWithheld] = useState(0); // outputs (runs) of this page whose method is still hidden
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    api
      .sources()
      .then((r) => {
        setSources(r.sources);
        setSha((current) => current ?? r.sources[0]?.sha256 ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const source = sources.find((s) => s.sha256 === sha) ?? null;

  useEffect(() => {
    if (source && (page === null || !source.pages.includes(page))) {
      setPage(source.pages.find((p) => !source.locked.includes(p)) ?? source.pages[0] ?? null);
    }
  }, [source, page]);

  useEffect(() => {
    if (!sha || page === null) return;
    let current = true; // a slower answer for a page the judge already left must not land on the new one
    setLocked(false);
    setOutputs([]);
    setWithheld(0);
    api
      .outputs(sha, page)
      .then((r) => {
        if (!current) return;
        setOutputs(r.outputs);
        setWithheld(r.hidden ?? 0);
      })
      .catch((e: Error) => {
        if (!current) return;
        if (e instanceof Locked) setLocked(true);
        else setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [sha, page]);

  const toggle = (runId: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });

  if (error) return <p className="error">{error}</p>;
  if (!sources.length) return <p className="sub">No finished runs yet. Start one on New run.</p>;
  return (
    <section>
      <div className="chips">
        <select
          className="pick"
          value={sha ?? ""}
          onChange={(e) => {
            setSha(e.target.value);
            setPage(null);
          }}
        >
          {sources.map((s) => (
            <option key={s.sha256} value={s.sha256}>
              {s.name} · {s.runs} run{s.runs === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </div>
      <div className="strip">
        {source?.pages.map((p) => {
          const isLocked = source.locked.includes(p);
          return (
            <button key={p} className={`thumb ${p === page ? "on" : ""} ${isLocked ? "is-locked" : ""}`} onClick={() => setPage(p)}>
              <img src={pngUrl(source.sha256, p)} alt="" loading="lazy" />
              Page {p}
              {isLocked ? " · locked" : ""}
            </button>
          );
        })}
      </div>
      {locked ? (
        <div className="locked">
          <h2>This page is locked while you judge</h2>
          <p className="sub">
            Seeing outputs with their names would teach you each method's style, and the duels would stop being blind. It
            opens when judging is finished.
          </p>
        </div>
      ) : sha && page !== null ? (
        <>
          <div className="chips">
            {outputs.map((o) => (
              <button key={o.run_id} className={`chip ${hidden.has(o.run_id) ? "" : "on"}`} onClick={() => toggle(o.run_id)}>
                {names[o.tool ?? ""] ?? o.tool} {o.version ?? ""}
              </button>
            ))}
            <span className="legend">
              <mark className="junk">footer</mark> a footer line in the output
            </span>
          </div>
          {withheld ? (
            <p className="small">
              {withheld} output{withheld === 1 ? "" : "s"} hidden until judged
            </p>
          ) : null}
          <div className="cols">
            <div className="out">
              <div className="hd">
                <b>THE PAGE</b>
                <span>page {page}</span>
              </div>
              <div className="bd">
                <img className="page-img" src={pngUrl(sha, page)} alt="" onClick={() => setZoom(pngUrl(sha, page))} />
              </div>
            </div>
            {outputs
              .filter((o) => !hidden.has(o.run_id))
              .map((o) => (
                <div key={o.run_id} className="out">
                  <div className="hd">
                    <b>{(names[o.tool ?? ""] ?? o.tool ?? "").toUpperCase()}</b>
                    <span className="small">
                      {o.version ? `${o.version} · ` : ""}{o.purpose} · {shortDate(o.started_at)}
                    </span>
                  </div>
                  <CheckChips checks={o.checks} />
                  <div className="bd">
                    <Output markdown={o.markdown} footerLines={o.footer_lines} />
                  </div>
                </div>
              ))}
          </div>
        </>
      ) : null}
      <Zoom src={zoom} onClose={() => setZoom(null)} />
    </section>
  );
}
