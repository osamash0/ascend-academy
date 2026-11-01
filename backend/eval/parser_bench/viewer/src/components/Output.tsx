import { Prose } from "@/components/markdown";
import { htmlToMarkdown, splitFooter } from "../lib";

/**
 * One method's output, through the reading face's own renderer. In a duel it is the plain text
 * (no marks, so both sides look alike); in Compare and Runs the footer lines are marked.
 *
 * HTML in an output (tables, <br>, <sup>/<sub>) is shown as formatting, for every method alike (Plan 3b ruling M1);
 * the footer lines are found on the stored text first, so their numbers stay valid.
 *
 * Every line break a method wrote is shown (`keep-breaks`), for every method alike: Markdown would
 * join a plain-text method's lines into one paragraph, which no method wrote (protocol deviation 1).
 */
export function Output({ markdown, footerLines = [] }: { markdown: string; footerLines?: number[] }) {
  if (!markdown.trim()) return <p className="empty">This method wrote nothing for this page.</p>;
  if (footerLines.length === 0)
    return (
      <div className="keep-breaks">
        <Prose>{htmlToMarkdown(markdown)}</Prose>
      </div>
    );
  return (
    <div className="keep-breaks">
      {splitFooter(markdown, footerLines).map((segment, i) =>
        segment.kind === "footer" ? (
          <div key={i} className="junk-line" title="A footer line: the rule that cleans the page's own text removes it">
            {segment.text}
          </div>
        ) : (
          <Prose key={i}>{htmlToMarkdown(segment.text)}</Prose>
        ),
      )}
    </div>
  );
}
