import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The §5.3 rules, enforced instead of eyeballed.
 *
 * Every one of these was written down in `BUILD-PROMPT.md` and checked by
 * hand — "grep for font-black", "flag anything under 24px", "an audit found 30
 * exposed icons in one pass". All three had drifted back by the time the
 * discovery pass looked, which is what a hand-check always does: it is correct
 * on the day it is run and decays quietly afterwards.
 */

const SRC = join(process.cwd(), 'src/features/spaces');

const read = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const files = (['screens', 'components'] as const).flatMap((dir) =>
  readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    .map((f) => ({ name: `${dir}/${f}`, body: read(join(SRC, dir, f)) })),
);

describe('decorative icons are hidden from screen readers', () => {
  it('marks every icon that sits beside its own label', () => {
    /*
     * A lucide glyph next to the word it depicts is read twice. The rule is
     * `aria-hidden` on anything whose meaning is already in adjacent text —
     * which, in this namespace, is every icon: the ones that stand alone are
     * inside a button that carries the `aria-label`.
     */
    const offenders: string[] = [];
    for (const { name, body } of files) {
      // Self-closing JSX tags starting with a capital, that take a className
      // with an h-N w-N — i.e. a rendered icon rather than a component.
      const tags = body.match(/<[A-Z]\w*[^>]*className="[^"]*\bh-\d[^"]*"[^>]*\/>/g) ?? [];
      for (const tag of tags) {
        if (/aria-hidden/.test(tag)) continue;
        // A component that takes `person`/`space` is not an icon.
        if (/\b(person|space|lesson|item|contribution)=/.test(tag)) continue;
        offenders.push(`${name}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(offenders, `exposed icons:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the calm table holds', () => {
  it('never shouts with font-black', () => {
    // "Never font-black on labels, chips, meta." The heavier weight is what
    // made the first pass read as "very robotic", and it creeps back.
    for (const { name, body } of files) {
      expect(body, `${name} uses font-black`).not.toContain('font-black');
    }
  });

  it('never uses uppercase as a style', () => {
    for (const { name, body } of files) {
      expect(body, `${name} uppercases a label`).not.toMatch(/\buppercase\b/);
    }
  });

  it('draws information-bearing text from the quiet scale, not raw alpha', () => {
    /*
     * `text-white/40` and `text-primary/80` both measured as AA failures. The
     * `text-quiet / text-label / text-faint` scale exists so those cannot
     * happen; raw alpha on *text* means someone bypassed it.
     *
     * Icons are exempt: they are decorative, `aria-hidden`, and carry no
     * information that contrast could hide.
     */
    const offenders: string[] = [];
    for (const { name, body } of files) {
      const lines = body.split('\n');
      lines.forEach((line, i) => {
        if (!/text-white\/\d/.test(line)) return;
        // An icon line — decorative, exempt.
        if (/<[A-Z]\w*\b/.test(line) && /\bh-\d/.test(line)) return;
        offenders.push(`${name}:${i + 1} ${line.trim().slice(0, 76)}`);
      });
    }
    expect(offenders, `raw alpha on text:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('targets are big enough to hit', () => {
  it('never renders a bare 16px control', () => {
    /*
     * 24×24 CSS px minimum. A 16px checkbox is fine *if* something around it
     * makes the target bigger — a padded <label> counts, and the two on the
     * manage screen were already wrapped that way. This checks the box is not
     * left standing on its own.
     */
    for (const { name, body } of files) {
      const boxes = body.match(/<input[^>]*type="checkbox"[^>]*>/gs) ?? [];
      for (const box of boxes) {
        if (!/h-4|h-3/.test(box)) continue;
        const at = body.indexOf(box);
        const before = body.slice(Math.max(0, at - 300), at);
        expect(
          /<label[^>]*\b(p-|py-|px-|p\d)/.test(before) || /-m-1/.test(before),
          `${name}: a 16px checkbox with no padded label around it`,
        ).toBe(true);
      }
    }
  });
});

describe('motion follows the operating system everywhere', () => {
  it('wraps both modes in reducedMotion="user"', () => {
    // Learn goes through Scene; Studio goes through StudioShell. Until the
    // shell carried it, three screens ignored the setting entirely — while
    // Settings cited it as the reason for having no motion switch.
    for (const f of ['components/Scene.tsx', 'components/StudioShell.tsx']) {
      const body = read(join(SRC, f));
      expect(body, `${f} does not carry reducedMotion`).toContain('reducedMotion="user"');
    }
  });
});

describe('one person, one face', () => {
  it('never draws initials by hand', () => {
    /*
     * `Avatar` names this failure mode in its own doc comment, and it had
     * already happened three times. The effect was concrete: the viewer, the
     * one person with a Luna, rendered as "Ab" in the Social friends stack
     * and on every notification they caused.
     */
    for (const { name, body } of files) {
      if (name.endsWith('Avatar.tsx')) continue;
      expect(body, `${name} builds its own initials instead of mounting Avatar`).not.toMatch(
        /\.split\(' '\)[\s\S]{0,120}?\.map\(\(w\) => w\[0\]\)/,
      );
    }
  });
});
