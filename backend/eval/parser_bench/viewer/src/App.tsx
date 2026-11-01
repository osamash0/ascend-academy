import { useCallback, useEffect, useState } from "react";
import { api, type ComparisonSummary } from "./api";
import { Compare } from "./screens/Compare";
import { Judge } from "./screens/Judge";
import { NewRun } from "./screens/NewRun";
import { Results } from "./screens/Results";
import { Runs } from "./screens/Runs";
import { Scoreboard } from "./screens/Scoreboard";

type Screen = "results" | "new" | "judge" | "compare" | "score" | "runs";
const SCREENS: [Screen, string][] = [
  ["results", "Results"],
  ["new", "New run"],
  ["judge", "Judge"],
  ["compare", "Compare"],
  ["score", "Scoreboard"],
  ["runs", "Runs"],
];

export default function App() {
  const [picked, setPicked] = useState<Screen | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [comparisons, setComparisons] = useState<ComparisonSummary[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .comparisons()
      .then((r) => {
        setComparisons(r.comparisons);
        setLoaded(true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    api
      .methods()
      .then((r) => setNames(Object.fromEntries(r.methods.map((m) => [m.id, m.label]))))
      .catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(timer);
  }, [toast]);

  const judging = comparisons.find((c) => c.locked) ?? null;
  const active = judging ?? comparisons[0] ?? null;
  // Opens on Results, except while a comparison is being judged: then it opens on Judge.
  const screen: Screen = picked ?? (judging ? "judge" : "results");
  // The Scoreboard opens on its first comparison: the one being judged leads, so it never opens on an older result by accident.
  const ordered = judging ? [judging, ...comparisons.filter((c) => c.run_id !== judging.run_id)] : comparisons;
  const pill = active
    ? `${active.run_id} · ${active.status === "judging" ? `judging ${active.done}/${active.total}` : "finished"}`
    : "no comparison yet";

  return (
    <>
      <header>
        <div className="brand">
          Parser Bench<span>Learnstation</span>
        </div>
        <nav>
          {SCREENS.map(([id, label]) => (
            <button key={id} className={screen === id ? "on" : ""} onClick={() => setPicked(id)}>
              {label}
              {judging && (id === "compare" || id === "score") ? <span className="lock">locked</span> : null}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="runpill">{pill}</div>
      </header>
      <main>
        {screen === "results" && <Results comparisons={comparisons} loaded={loaded} />}
        {screen === "new" && <NewRun notify={setToast} />}
        {screen === "judge" && <Judge comparison={active} names={names} notify={setToast} onProgress={refresh} />}
        {screen === "compare" && <Compare names={names} />}
        {screen === "score" && <Scoreboard comparisons={ordered} names={names} onChange={refresh} />}
        {screen === "runs" && <Runs names={names} notify={setToast} />}
      </main>
      <div className={`toast ${toast ? "on" : ""}`} role="status">
        {toast}
      </div>
    </>
  );
}
