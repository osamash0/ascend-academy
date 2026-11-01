import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Choice, type ComparisonSummary, type NextDuel } from "../api";
import { Output } from "../components/Output";
import { Zoom } from "../components/Zoom";
import { CHOICE_LABEL, KEY_CHOICE, RULE, RULE_DETAIL, minutesLeft, newSession } from "../lib";
import { MyVotes } from "./MyVotes";

interface Props {
  comparison: ComparisonSummary | null;
  names: Record<string, string>;
  notify: (message: string) => void;
  onProgress: () => void;
}

/** Blind duels: the page and two unnamed outputs. Keys 1–4 vote, N note, Z enlarge, U undo. */
export function Judge({ comparison, names, notify, onProgress }: Props) {
  const session = useMemo(newSession, []);
  const [duel, setDuel] = useState<NextDuel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Choice | null>(null);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(performance.now());
  const paces = useRef<number[]>([]);
  const noteRef = useRef<HTMLInputElement>(null);
  // Checked synchronously: a state flag would still read "free" between two key events.
  const busyRef = useRef(false);
  const loadSeq = useRef(0);
  const cid = comparison?.run_id ?? null;

  const setBusyBoth = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  /** Fetch the next duel. Returns whether it worked; an answer for an older request is dropped. */
  const load = useCallback(async (): Promise<boolean> => {
    if (!cid) return false;
    const mine = ++loadSeq.current;
    try {
      const next = await api.next(cid);
      if (mine !== loadSeq.current) return false;
      setDuel(next);
      setPicked(null);
      setNote("");
      setError(null);
      started.current = performance.now();
      setElapsed(0);
      return true;
    } catch (e) {
      if (mine !== loadSeq.current) return false;
      setDuel(null); // never leave an already-judged duel on screen
      setError((e as Error).message);
      return false;
    }
  }, [cid]);

  useEffect(() => {
    // a different comparison: nothing of the old one stays on screen
    setDuel(null);
    setPicked(null);
    setError(null);
    busyRef.current = false;
    setBusy(false);
    paces.current = [];
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.round((performance.now() - started.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const vote = useCallback(
    async (choice: Choice) => {
      if (!cid || !duel || duel.duel === undefined || busyRef.current) return;
      setBusyBoth(true);
      const seconds = (performance.now() - started.current) / 1000;
      try {
        await api.vote(cid, { duel: duel.duel, choice, seconds, session, note: note.trim() || null });
        paces.current.push(seconds);
        setPicked(choice);
        notify("Saved");
        onProgress();
        setTimeout(() => {
          load().finally(() => setBusyBoth(false));
        }, 260);
      } catch (e) {
        // a lost answer or a stale duel: show what the server said, then resync with its idea of "next"
        const message = (e as Error).message;
        const ok = await load();
        if (ok) setError(message);
        setBusyBoth(false);
      }
    },
    [cid, duel, session, note, notify, onProgress, load, setBusyBoth],
  );

  const undo = useCallback(async () => {
    if (!cid || busyRef.current) return;
    setBusyBoth(true);
    try {
      const r = await api.undo(cid, session);
      if (r.retracted === null) {
        // nothing was withdrawn: keep this duel, its timer and the typed note
        notify("Nothing to undo");
        setError(null);
      } else {
        paces.current.pop();
        notify("Last vote withdrawn (kept in the log as a retraction)");
        onProgress();
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyBoth(false);
    }
  }, [cid, session, notify, onProgress, load, setBusyBoth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // a held key is one press
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        if (e.key === "Escape" || e.key === "Enter") target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (zoom) {
        if (key === "z" || key === "escape") setZoom(false);
        return;
      }
      if (KEY_CHOICE[e.key]) vote(KEY_CHOICE[e.key]);
      else if (key === "u") undo();
      else if (key === "z") setZoom(true);
      else if (key === "n") {
        e.preventDefault();
        noteRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vote, undo, zoom]);

  if (!comparison) {
    return (
      <div className="locked">
        <h2>No comparison yet</h2>
        <p className="sub">
          Make benchmark runs, then create one: <code>python -m backend.eval.parser_bench compare create</code>.
        </p>
      </div>
    );
  }
  if (!duel) return <p className="sub">{error ?? "Loading…"}</p>;
  if (duel.duel === undefined || !duel.page || !duel.left || !duel.right) {
    return (
      <section>
        <h2>{duel.finished ? "Judging finished" : "Nothing left to judge"}</h2>
        <p className="sub">{duel.done} votes saved. Names are shown now, never earlier.</p>
        {error ? <p className="error">{error}</p> : null}
        {comparison.locked ? null : <MyVotes cid={comparison.run_id} names={names} />}
      </section>
    );
  }

  const page = duel.page;
  const sides = { left: duel.left.markdown, right: duel.right.markdown };
  return (
    <section>
      <div className="progress">
        <span>
          Duel {duel.done + 1} of {duel.total}
        </span>
        <div className="track">
          <i style={{ width: `${(100 * duel.done) / duel.total}%` }} />
        </div>
        <span>about {minutesLeft(duel.total - duel.done, paces.current)} min left</span>
      </div>
      <div className="judge">
        <div className="slide">
          <img src={page.png} alt="The page being judged" onClick={() => setZoom(true)} />
          <div className="meta">
            <span>
              {page.file} · page {page.number}
            </span>
            <span className="tag">{page.type}</span>
          </div>
          <div className="small">
            Click the page or press Z to enlarge it. Method names are hidden, and the sides are shuffled for every duel.
          </div>
        </div>
        {(["left", "right"] as const).map((side) => (
          <div key={side} className={`out ${picked === side ? "picked" : ""}`}>
            <div className="hd">
              <b>{side.toUpperCase()}</b>
            </div>
            <div className="bd">
              <Output markdown={sides[side]} />
            </div>
          </div>
        ))}
      </div>
      <div className="bar">
        <div className="rule">
          <b>{RULE}</b> {RULE_DETAIL}
        </div>
        {Object.entries(KEY_CHOICE).map(([key, choice]) => (
          <button key={key} className="vote" disabled={busy} onClick={() => vote(choice)}>
            <kbd>{key}</kbd> {CHOICE_LABEL[choice]}
          </button>
        ))}
      </div>
      <div className="bar">
        <input
          ref={noteRef}
          className="note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (N to focus)"
        />
        <button className="linkbtn" onClick={undo}>
          Undo last vote (U)
        </button>
        <span className="small">{elapsed} s on this duel</span>
        {error ? <span className="error">{error}</span> : null}
      </div>
      <Zoom src={zoom ? page.png : null} onClose={() => setZoom(false)} />
    </section>
  );
}
