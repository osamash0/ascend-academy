import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * The guard that keeps v4 translated (scripts/check-v4-strings.mjs, run by
 * `npm run lint`) — checked against files written to fail it, so a change
 * that quietly stops it catching anything fails here first.
 */

const run = (code: string, de: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'v4strings-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'de'));
  writeFileSync(join(dir, 'src', 'Screen.tsx'), code);
  writeFileSync(join(dir, 'de', 'v4Test.json'), JSON.stringify(de));
  try {
    execFileSync('node', ['scripts/check-v4-strings.mjs', join(dir, 'src'), join(dir, 'de')], { stdio: 'pipe' });
    return '';
  } catch (e) {
    return String((e as { stderr: Buffer }).stderr);
  }
};

describe('the v4 strings guard', () => {
  it('passes the real v4 namespace', () => {
    expect(() => execFileSync('node', ['scripts/check-v4-strings.mjs'], { stdio: 'pipe' })).not.toThrow();
  });

  it('fails on words written into JSX and its labels', () => {
    const out = run(
      `export const A = () => (
        <div aria-label="Close the studio" title="Night paper">
          Back to the Lesson
          <input placeholder="Ask anything" />
        </div>
      );`,
      {},
    );
    expect(out).toMatch(/words in JSX: "Back to the Lesson"/);
    expect(out).toMatch(/aria-label=: "Close the studio"/);
    expect(out).toMatch(/title=: "Night paper"/);
    expect(out).toMatch(/placeholder=: "Ask anything"/);
  });

  it('lets through what is not words, keys, loanwords and marked exceptions', () => {
    const out = run(
      `export const A = ({ t, n }) => (
        <p aria-label={t('x.y')} title="spaces">
          {n} / 82 · — XP {t('z')}
          <span>Studio</span>
          {/* i18n-ignore: the code format, not a word */}
          <i>ABC 123</i>
        </p>
      );`,
      {},
    );
    expect(out).toBe('');
  });

  it('fails on German that breaks the glossary or the register', () => {
    const out = run('export const A = () => null;', {
      a: 'Ordnen Sie die Seiten.',
      b: 'Diese Folie',
      c: 'Gut gemacht!',
      d: 'Frag den Dozenten.',
      e: 'Wir senden Ihnen eine Mail.',
    });
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(out).toMatch(new RegExp(`\\s${k}: `));
  });

  it('keeps German that only looks formal', () => {
    const out = run('export const A = () => null;', {
      they: 'Sie lernen gemeinsam.',
      plural: 'Ihr lernt dasselbe.',
      inclusive: 'Frag deine Dozent:in.',
      filled: '{{name}} hat das empfohlen.',
    });
    expect(out).toBe('');
  });
});
