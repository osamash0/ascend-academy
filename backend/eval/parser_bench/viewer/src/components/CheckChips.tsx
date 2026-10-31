import type { Checks } from "../api";
import { checkChips } from "../lib";

export function CheckChips({ checks }: { checks: Checks | null }) {
  return (
    <div className="checks">
      {checkChips(checks).map((chip) => (
        <span key={chip.label} className={`ck ${chip.tone}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}
