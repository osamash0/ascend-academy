import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The namespace boundary.
 *
 * `BUILD-PROMPT.md` states it plainly — mock data only, no backend, no import
 * from the old product's feature folders — and **nothing checked it**. The one
 * script that reads every file, `check-vocabulary.mjs`, strips import lines
 * and module paths before matching, so it structurally cannot see one.
 *
 * Which meant any screen could add
 * `import { supabase } from '@/integrations/supabase/client'` and `tsc`,
 * `eslint --quiet`, `vitest` and the vocabulary check would all stay green.
 * The widest blast radius in the namespace and the weakest enforcement in it.
 *
 * Not a style rule. The v4 build is a design study running in a live app:
 * a stray backend import is a dev-only route firing real queries against a
 * production database.
 */

const ROOT = join(process.cwd(), 'src/features/spaces');

/** Every source file in the namespace, tests included. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Source with comments stripped.
 *
 * Necessary, not fussy. The first run of this guard reported *itself* — the
 * doc comment above names `@/integrations/supabase/client` as the example — and
 * reported `Scene.tsx` for the phrase "borrowed from 'X'" in a sentence. That
 * is the third time a rule here has fired on the prose explaining it, after
 * `modes.test.tsx` and the vocabulary checker. A rule that flags its own
 * documentation is a rule someone switches off.
 */
const strip = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const files = walk(ROOT).map((path) => ({
  name: path.slice(ROOT.length + 1),
  imports: [...strip(path).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
}));

/** Things this namespace may reach for outside itself. */
const ALLOWED = [
  /^react$/,
  /^react-dom$/,
  /^react-router-dom$/,
  /*
   * Motion (motion.dev). `framer-motion` is the same engine under its old
   * name and is still imported by 99 files in the old product — this namespace
   * uses the new entry point, and the old one is deliberately *not* on the
   * list, so a stray v4 import of it would fail here.
   */
  /^motion\/react$/,
  /^lucide-react$/,
  /^sonner$/,
  /^vitest$/,
  /^node:/,
  /^@testing-library\//,
  // Shared design system and pure helpers — no data, no network.
  /^@\/lib\/utils$/,
  /^@\/lib\/topicIcon$/,
  /^@\/components\/ui\//,
  /^@\/components\/console$/,
  // Luna is the product's astronaut illustration. Pure SVG.
  /learnstation-luna$/,
  // Anything inside this namespace.
  /^\.{1,2}\//,
];

/** Things it may never reach for, named so a failure explains itself. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /supabase/i, why: 'the backend client' },
  { pattern: /^@\/integrations\//, why: 'a backend integration' },
  { pattern: /^@\/features\/(courses|student|assignments|professor|review|exam|materials)/, why: 'the old product' },
  { pattern: /services?$/i, why: 'a data service' },
  { pattern: /^@\/lib\/auth$/, why: 'the auth session' },
  { pattern: /^@\/lib\/gamification/, why: 'the live XP engine' },
  { pattern: /^@tanstack\/react-query$/, why: 'a fetching layer' },
];

describe('the v4 namespace stays sealed', () => {
  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('imports nothing from the backend or the old product', () => {
    const breaches: string[] = [];
    for (const { name, imports } of files) {
      for (const spec of imports) {
        const hit = FORBIDDEN.find((f) => f.pattern.test(spec));
        if (hit) breaches.push(`${name} imports ${spec} — ${hit.why}`);
      }
    }
    expect(breaches, `boundary breaches:\n${breaches.join('\n')}`).toEqual([]);
  });

  it('imports nothing outside the allow-list', () => {
    /*
     * An allow-list rather than only a deny-list, because the deny-list can
     * only forbid what someone thought of. A new dependency should be a
     * deliberate act with a line added here, not something that slips in.
     */
    const unknown: string[] = [];
    for (const { name, imports } of files) {
      for (const spec of imports) {
        if (!ALLOWED.some((a) => a.test(spec))) unknown.push(`${name} → ${spec}`);
      }
    }
    expect(unknown, `unknown imports:\n${unknown.join('\n')}`).toEqual([]);
  });

  it('makes no network call of any kind', () => {
    // Mock data only. `fetch` in this namespace means the mocks stopped being
    // mocks, and the dev-only route started talking to something real.
    for (const path of walk(ROOT)) {
      // This file has to name the patterns it forbids, in code rather than in
      // a comment, so stripping comments cannot exempt it. Skipping the guard
      // itself is the honest fix; the alternative is obfuscating the strings
      // to hide them from the matcher, which makes the rule unreadable.
      if (path.endsWith('boundary.test.ts')) continue;
      const body = strip(path);
      const name = path.slice(ROOT.length + 1);
      expect(body, `${name} calls fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(body, `${name} opens a WebSocket`).not.toMatch(/new WebSocket/);
      expect(body, `${name} uses XMLHttpRequest`).not.toMatch(/XMLHttpRequest/);
    }
  });
});
