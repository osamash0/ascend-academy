import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No control may render enabled and do nothing.
 *
 * The discovery pass found **eighteen**. Not one was a typo: each was written
 * as a real control, styled as a real control, given an `aria-label` — and
 * left without a handler because the destination did not exist yet. Two of
 * them announced `aria-pressed` and "Tap to remove", which is a screen reader
 * being told a state changed that did not.
 *
 * The rule this enforces: **a control either does the thing, or says why it
 * cannot.** A `disabled` button with a `title` is fine and is not reported;
 * an enabled one with no handler is the defect.
 *
 * This is a source guard rather than a render test because it is a rule about
 * what every screen must not contain, and a render test would need each
 * screen's data and would still miss the one that was never mounted.
 */

const SRC = join(process.cwd(), 'src/features/spaces');

const read = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Every .tsx under screens/ and components/. */
/**
 * Every source file under `screens/` and `components/`, **recursively**.
 *
 * These guards used to read one level with `readdirSync`, so an entire
 * subdirectory of new UI — `components/hub/` — was invisible to all of them.
 * It carried a `text-white/40` that `BUILD-PROMPT.md` names by value as a
 * measured AA failure, plus a dozen off-scale alphas, and every check here
 * passed. A guard that silently stops at a directory boundary is worse than a
 * missing one: the green tick says the whole namespace was checked.
 */
const walkFiles = (dir: string, prefix = dir): { name: string; body: string }[] =>
  readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === '__tests__'
        ? []
        : walkFiles(`${dir}/${e.name}`, `${prefix}/${e.name}`)
      : e.name.endsWith('.tsx') && !e.name.includes('.test.')
        ? [{ name: `${dir}/${e.name}`, body: read(join(SRC, dir, e.name)) }]
        : [],
  );

const files = (['screens', 'components'] as const).flatMap((dir) => walkFiles(dir));

/**
 * Splits a file into `<button ...>` open tags.
 *
 * Hand-scanned rather than matched with `/<button\b[^>]*>/`, because that
 * stops at the first `>` — including the one inside `aria-label={unread > 0 …}`
 * and inside every arrow function. Its first run reported two buttons that
 * were correctly wired, and a guard whose false positives outnumber its real
 * ones gets muted within a week.
 */
const buttonTags = (body: string): string[] => {
  const tags: string[] = [];
  /*
   * Radix `asChild` triggers clone their handler onto the child, so a button
   * inside one is wired even though its own tag shows nothing. Skipping them
   * is not a loophole: the wrapper is what makes it work, and treating it as
   * a dead end would push someone to add a redundant onClick to silence this.
   */
  const wiredByWrapper = (at: number) => /asChild/.test(body.slice(Math.max(0, at - 160), at));
  let i = 0;
  while ((i = body.indexOf('<button', i)) !== -1) {
    let depth = 0;
    let quote: string | null = null;
    let j = i;
    for (; j < body.length; j++) {
      const ch = body[j];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    if (!wiredByWrapper(i)) tags.push(body.slice(i, j + 1));
    i = j + 1;
  }
  return tags;
};

describe('no enabled control does nothing', () => {
  it('finds files to check', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('gives every <button> a handler, a submit role, or a disabled reason', () => {
    const offenders: string[] = [];
    for (const { name, body } of files) {
      for (const tag of buttonTags(body)) {
        const wired =
          /onClick|onMouseDown|onPointerDown|type="submit"/.test(tag) ||
          // Disabled and explained is a decision, not a dead end.
          (/\bdisabled\b/.test(tag) && /title=/.test(tag));
        // A prop-driven button takes its handler from the caller.
        const fromProps = /onClick=\{on[A-Z]/.test(tag) || /onClick=\{\w+\}/.test(tag);
        if (!wired && !fromProps) offenders.push(`${name}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(offenders, `dead controls:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('never leaves an onClick that resolves to nothing', () => {
    // `onClick={() => undefined}` is a dead end wearing a handler's clothes:
    // it satisfies every lint rule and the button still does nothing.
    for (const { name, body } of files) {
      expect(body, `${name} has a no-op handler`).not.toMatch(
        /onClick=\{\(\)\s*=>\s*(undefined|null|\{\s*\})\s*\}/,
      );
    }
  });

  it('never announces a pressed state it cannot change', () => {
    /*
     * Star and Like both carried `aria-pressed` with no handler. They are
     * self-wiring now — they take an id rather than an optional callback — so
     * the unwired version cannot be written.
     */
    for (const { name, body } of files) {
      for (const tag of buttonTags(body)) {
        if (!/aria-pressed/.test(tag)) continue;
        expect(
          /onClick/.test(tag) || /\bdisabled\b/.test(tag),
          `${name}: aria-pressed without a way to change it`,
        ).toBe(true);
      }
    }
  });
});
