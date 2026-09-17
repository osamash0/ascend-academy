import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A mock must preserve the identity stability of what it replaces.
 *
 * `useToast: () => ({ toast: vi.fn() })` reads as harmless and is not. The
 * factory passed to `vi.mock` runs once, but the arrow function it installs as
 * the hook runs on *every render* — so every render handed the component a
 * brand-new `vi.fn()`.
 *
 * The real `useToast` returns a fresh wrapper object each render too, but its
 * `toast` is a module-level function, so that identity never changes. Callers
 * rely on it: `PreferencesSettings` lists `[user, toast, t]` on its
 * preferences-loading effect, and `toast` holding still is the only reason that
 * effect runs once.
 *
 * With the unstable mock it ran on every render, each pass resetting
 * `preferencesLoading`, so a Switch bound to
 * `disabled={!user || preferencesLoading || savingNudges}` flickered between
 * enabled and disabled. Instrumenting the query boundary showed **87** SELECTs
 * against `notification_preferences` in one run and **3** in another — that
 * variance being the flakiness itself. `userEvent.click` on a disabled control
 * is a silent no-op, so the write never happened and the assertion blamed a
 * component that had behaved correctly throughout. It failed roughly four runs
 * in five, on `main` as well, and cost a `git bisect` that converged
 * confidently on a commit which touches only test files.
 *
 * Hence this file rather than a note in a review. Twelve test files carried the
 * shape; eleven were latent only because their components happen not to list a
 * mocked function in an effect's dependencies. That is luck, not design, and it
 * changes the first time somebody adds a dependency array.
 *
 * The fix is `vi.hoisted`:
 *
 *     const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
 *     vi.mock("@/hooks/use-toast", () => ({
 *       useToast: () => ({ toast: toastFn }),
 *     }));
 *
 * A new object per call, exactly like the real hook — but stable functions.
 * `vi.hoisted` is required because `vi.mock` factories are lifted above module
 * scope and cannot close over an ordinary `const`.
 *
 * There is deliberately **no allowlist**. Every occurrence in the repo was
 * fixed before this landed, so the set is empty and stays falsifiable. An
 * exemption list here would repeat the mistake `openable.test.tsx` made: two of
 * its four original entries named cells on screens it never read, exempting
 * nothing while implying those screens had been reviewed.
 */

const SRC = join(process.cwd(), "src");

/** This file. Excluded below — see `SELF`. */
const SELF = "__tests__/mock-stability.test.ts";

const testFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...testFiles(p));
    else if (/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

/**
 * Source with block and line comments removed.
 *
 * `modes.test.tsx` already wrote this lesson down and I still had to learn it
 * twice: on its first run this file reported four offenders, and every one was
 * *itself* — two in the doc comment above, which quotes the bad shape in order
 * to explain it, and two in the self-check below, which needs the shape as
 * literal data to prove the regex works. A rule that fires on the prose
 * explaining it is a rule people switch off.
 *
 * Stripping comments handles the first pair. The second needs the file skipped
 * outright, because those two occurrences are load-bearing string arguments
 * rather than commentary — and a check that cannot describe its own subject is
 * worse than one exception, provided the exception is this narrow and this
 * visible.
 */
const stripComments = (s: string) =>
  s
    /*
     * Each block comment becomes the same number of blank lines it occupied.
     *
     * Deleting them outright is what the other source-reading tests here do,
     * and it is fine for them because they only ask yes/no questions. This file
     * reports a file:line for a human to open, and collapsing a 20-line doc
     * comment silently shifts every line after it — the first run of this
     * mutation check pointed at `Auth.test.tsx:15` for a line that is really at
     * 28, while the comment right here claimed the numbers matched.
     */
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) ?? []).length))
    .replace(/^(\s*)\/\/.*$/gm, "$1");

/**
 * A hook mock whose returned object builds a fresh `vi.fn()` on every call.
 *
 * Scoped to `useXxx: () => ({ … vi.fn() … })` on purpose. A `vi.fn()` sitting
 * directly in a factory's returned object — `vi.mock('sonner', () => ({ toast:
 * { error: vi.fn() } }))` — is created once when the module is mocked and is
 * perfectly stable, so matching that would be noise. What makes this shape a
 * defect is specifically that the arrow function is the *hook*, called per
 * render.
 */
const PER_RENDER_FN = /\buse[A-Z][A-Za-z0-9]*\s*:\s*\(\)\s*=>\s*\(\{[^}]*\bvi\.fn\(\)/;

describe("mocks keep the identity stability of what they replace", () => {
  const files = testFiles(SRC);

  it("finds the test files to check", () => {
    // Guards against a broken walker silently checking nothing.
    expect(files.length).toBeGreaterThan(60);
  });

  it("never mints a fresh vi.fn() on every render of a mocked hook", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(SRC.length + 1);
      if (rel === SELF) continue;
      // `stripComments` is line-count preserving, so `i + 1` is the line number
      // in the real file — see the note on it, which this once got wrong.
      const stripped = stripComments(readFileSync(f, "utf8")).split("\n");
      for (const [i, line] of stripped.entries()) {
        if (PER_RENDER_FN.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `these mocked hooks return a new function identity per render — hoist it ` +
        `with vi.hoisted so effect dependency arrays hold still:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("detects the shape it is meant to detect", () => {
    // Without this, a regex that matches nothing would pass the test above
    // forever while claiming the repo is clean.
    expect(PER_RENDER_FN.test("  useToast: () => ({ toast: vi.fn() }),")).toBe(true);
    expect(
      PER_RENDER_FN.test('  useAiModel: () => ({ aiModel: "groq", setAiModel: vi.fn() }),'),
    ).toBe(true);
    // …and not the stable forms it must leave alone.
    expect(PER_RENDER_FN.test("  useToast: () => ({ toast: toastFn }),")).toBe(false);
    expect(PER_RENDER_FN.test("vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));")).toBe(
      false,
    );
  });
});
