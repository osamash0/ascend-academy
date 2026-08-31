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
    /*
     * The first version matched only `text-white/NN`, and pass 2 found four
     * things it therefore could not see: `text-foreground/90` on the reader's
     * body prose, `text-destructive/50` on the Delete label (1.87:1, the worst
     * number in the build), and two raw `fill="rgba(...)"` values carrying the
     * map's counts. A guard scoped to one spelling of a mistake finds one
     * spelling of it.
     */
    const offenders: string[] = [];
    for (const { name, body } of files) {
      body.split('\n').forEach((line, i) => {
        const alphaClass = /\btext-(white|foreground|primary|secondary|destructive|success|warning)\/\d/.test(
          line,
        );
        const alphaFill = /fill="rgba\(\d+,\s*\d+,\s*\d+,\s*0?\.\d+\)"/.test(line);
        if (!alphaClass && !alphaFill) return;
        // A decorative glyph — exempt, it carries no information.
        if (/<[A-Z]\w*\b/.test(line) && /\bh-\d/.test(line)) return;
        if (/aria-hidden/.test(line)) return;
        /*
         * An SVG *shape* fill is not text. The rule is about contrast of
         * things you read, and `<circle fill="rgba(255,255,255,0.05)">` is a
         * hit target. Only `<text>` fills count — checked by looking at the
         * surrounding element rather than the line alone.
         */
        if (alphaFill && !alphaClass) {
          const at = body.indexOf(line);
          const around = body.slice(Math.max(0, at - 220), at);
          if (!/<text\b/.test(around)) return;
        }
        offenders.push(`${name}:${i + 1} ${line.trim().slice(0, 76)}`);
      });
    }
    expect(offenders, `raw alpha on text:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('targets are big enough to hit', () => {
  it('never renders a small icon-only button without padding', () => {
    /*
     * The first version inspected `<input type="checkbox">` only, so it could
     * not see the 16×16 dialog close button that pass 2 found — a control
     * sitting on top of the search input and eating clicks at the right end of
     * the field. Any button whose only child is a small glyph needs either a
     * fixed box of 24px+ or padding to get there.
     */
    for (const { name, body } of files) {
      const tags = body.match(/<button[^>]*className="[^"]*"[^>]*>/gs) ?? [];
      for (const tag of tags) {
        const cls = tag.match(/className="([^"]*)"/)?.[1] ?? '';
        const box = cls.match(/\bh-(\d+(?:\.\d+)?)\b/);
        if (!box) continue;
        const rem = Number(box[1]);
        if (rem >= 6) continue; // h-6 = 24px
        const padded = /\b[pm][xy]?-\d/.test(cls);
        expect(padded, `${name}: h-${box[1]} button with no padding — under 24px`).toBe(true);
      }
    }
  });

  it('never renders a bare 16px checkbox', () => {
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
  it('never nudges on hover with a raw CSS transform', () => {
    /*
     * `MotionConfig reducedMotion="user"` governs Motion and nothing else. A
     * Tailwind `hover:scale-[1.02]` is a plain CSS transform and sails straight
     * past it — so nineteen controls across the namespace grew on hover
     * regardless of the OS setting, while Settings told the reader "motion
     * follows your system setting for reduced motion".
     *
     * The first fix was a `.lift` CSS class with its own media query. The spec
     * then made the rule simpler: Motion owns animation, full stop. `Pressable`
     * carries `whileHover` / `whileFocus` / `whileTap`, so reduced motion is
     * handled once, by the library, and there is no second mechanism to keep in
     * step.
     */
    for (const { name, body } of files) {
      expect(body, `${name} scales on hover in CSS`).not.toMatch(/hover:scale-/);
      expect(body, `${name} still uses the removed .lift class`).not.toMatch(/["' ]lift["' ]/);
    }
  });

  it('animates through Motion rather than CSS transitions', () => {
    /*
     * Transform and opacity are Motion's. A `transition-transform` or
     * `transition-opacity` utility is the stylesheet animating something the
     * library is supposed to own — and, unlike Motion, it ignores
     * `prefers-reduced-motion` unless somebody remembers a media query.
     *
     * Colour transitions are left alone deliberately: `transition-colors` is a
     * hover affordance on a property the spec does not let Motion animate
     * anyway, so forbidding it would mean either instant colour swaps or
     * animating colour through Motion against the rule. Flagged in the report
     * rather than decided here.
     */
    for (const { name, body } of files) {
      expect(body, `${name} animates transform in CSS`).not.toMatch(/transition-transform/);
      expect(body, `${name} animates opacity in CSS`).not.toMatch(/transition-opacity/);
    }
  });

  it('keeps the press feel in one component', () => {
    // Fifteen call sites carried their own hover scale. One `Pressable` now
    // owns the spring, the scale and the disabled case.
    const press = read(join(SRC, 'components/Pressable.tsx'));
    expect(press).toContain('whileHover');
    expect(press).toContain('whileFocus');
    expect(press).toContain('whileTap');
    // Transform only — never width, height or margin.
    expect(press).not.toMatch(/whileHover=\{\{[^}]*\b(width|height|margin|padding)\b/);
  });

  it('carries reducedMotion once, above both modes', () => {
    /*
     * It used to be mounted twice — `Scene` for Learn, `StudioShell` for Studio
     * — which is two places to change one default. Before *that* it was mounted
     * once, in `Scene`, and Studio screens ignored the setting entirely while
     * Settings cited that mechanism as its reason for having no motion switch.
     *
     * `MotionRoot` is a layout route above every v4 screen, so there is exactly
     * one, and this asserts the other two do not grow another.
     */
    const root = read(join(SRC, 'components/MotionRoot.tsx'));
    expect(root).toContain('reducedMotion="user"');
    for (const f of ['components/Scene.tsx', 'components/StudioShell.tsx']) {
      expect(read(join(SRC, f)), `${f} mounts a second MotionConfig`).not.toContain(
        '<MotionConfig',
      );
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
