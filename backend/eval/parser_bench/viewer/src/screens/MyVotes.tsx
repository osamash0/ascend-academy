import { useEffect, useState } from "react";
import { api, type MyVote } from "../api";
import { CHOICE_LABEL } from "../lib";

/** After judging: every duel with both names, the pick in bold, seconds, note, withdrawn votes marked. */
export function MyVotes({ cid, names }: { cid: string; names: Record<string, string> }) {
  const [votes, setVotes] = useState<MyVote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myVotes(cid)
      .then((r) => setVotes(r.votes))
      .catch((e: Error) => setError(e.message));
  }, [cid]);

  if (error) return <p className="error">{error}</p>;
  if (!votes) return null;
  const name = (id: string) => names[id] ?? id;
  return (
    <div className="myvotes">
      <h2>My votes</h2>
      <p className="sub">
        Every duel, now with both names. Your pick is in bold. Withdrawn votes stay in the log, marked as withdrawn.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Page</th>
            <th>Left</th>
            <th>Right</th>
            <th>Your vote</th>
            <th>Seconds</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {votes.map((v) => (
            <tr key={v.vote_id} className={v.withdrawn ? "withdrawn" : ""}>
              <td>{v.duel + 1}</td>
              <td>
                {v.page} · {v.type}
              </td>
              <td className={v.choice === "left" ? "pick" : ""}>{name(v.left)}</td>
              <td className={v.choice === "right" ? "pick" : ""}>{name(v.right)}</td>
              <td>
                {CHOICE_LABEL[v.choice]}
                {v.withdrawn ? " · withdrawn" : ""}
              </td>
              <td>{v.seconds}</td>
              <td>{v.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
