/**
 * The end of the canvas in Recall (Learn, deeper §2.2): how many terms are
 * left to try again, with Try again, and Start over once anything is marked.
 * Renders nothing while there is neither.
 */
export function RecallFooter({
  notYet,
  anyMarked,
  onTryAgain,
  onStartOver,
}: {
  /** Terms marked "Not yet" across the Material. */
  notYet: number;
  anyMarked: boolean;
  onTryAgain(): void;
  onStartOver(): void;
}) {
  if (notYet === 0 && !anyMarked) return null;
  return (
    <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-quiet">
      {notYet > 0 && (
        <>
          <p>
            {notYet} {notYet === 1 ? 'term' : 'terms'} to try again
          </p>
          <button
            type="button"
            onClick={onTryAgain}
            className="console-focusable min-h-6 rounded-full bg-[rgb(var(--studio-chip))] px-3 py-1 text-foreground"
          >
            Try again
          </button>
        </>
      )}
      {anyMarked && (
        <button
          type="button"
          onClick={onStartOver}
          className="console-focusable min-h-6 rounded-full px-2 py-1 text-faint hover:text-foreground"
        >
          Start over
        </button>
      )}
    </div>
  );
}
