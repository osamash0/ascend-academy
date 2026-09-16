#!/usr/bin/env node
/**
 * Vocabulary law check — docs/design-v4/01-foundations.md rule 6.
 *
 * One word, one meaning. These words are banned in Learnstation's UI:
 *
 *   professor · student · teacher · instructor · course · classroom
 *   module · folder · lecture · LMS
 *
 * The law governs **UI copy**, not all text. Three things are deliberately
 * NOT flagged, because flagging them makes the check useless and people
 * switch it off:
 *
 *   1. Code comments. Explaining *why* folders are banned requires the word
 *      "folder". The reasoning has to survive.
 *   2. Imports and identifiers. The old product's modules are named with the
 *      old vocabulary and are not being renamed.
 *   3. User-authored content at runtime. A real Lesson description in the
 *      database says "students will learn basic operations" — that is
 *      someone's writing, not our chrome, and it is not ours to rewrite.
 *
 * What IS flagged: string and template literals, and JSX text nodes — the
 * things that actually become words on screen.
 *
 * Usage:  node scripts/check-vocabulary.mjs [dir ...]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BANNED = [
  'professor', 'student', 'teacher', 'instructor', 'course',
  'classroom', 'module', 'folder', 'lecture', 'lms',
  'slide', 'deck', 'document',
];

const ROOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['src/features/spaces'];

/**
 * Blank out comments and import lines so only shippable text remains.
 *
 * Blanked, not deleted. The offsets of what survives are what the reported
 * line number is computed from, so removing a block comment shifts every
 * violation below it upwards — and in this namespace comments outnumber code,
 * so the reported line was 40 to 90 lines above the real one. A gate that
 * sends you to the wrong line is worse than one that prints no line at all,
 * and this gate only recently started catching anything.
 *
 * Replacing each stripped run with spaces of the same length, newlines kept,
 * makes indices into the stripped text indices into the real file.
 */
const blank = (m) => m.replace(/[^\n]/g, ' ');

function stripNonCopy(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)       // block comments
    .replace(/^\s*\/\/.*$/gm, blank)            // line comments
    .replace(/^\s*import[\s\S]*?from\s+['"].*?['"];?$/gm, blank) // imports
    .replace(/\bfrom\s+['"][^'"]*['"]/g, blank)    // any residual module paths
    .replace(/\b(?:className|data-[\w-]+|key|id)\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, blank);
}

/** Pull out the substrings that actually render: literals and JSX text. */
function extractCopy(src) {
  const out = [];
  // String / template literals.
  for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    out.push({ text: m[2], index: m.index });
  }
  /*
   * JSX text nodes.
   *
   * A run of text ends at `<` *or* at `{`, and begins after `>` *or* after
   * `}` — because interpolation splits one sentence into several text nodes,
   * and the earlier version only recognised the shape `>text<`.
   *
   * That is not a corner case, it is the common one. `This page belongs to{' '}`
   * is text terminated by an expression, so the whole phrase was skipped, and
   * `lecture` — banned since the first version of this file — went undetected
   * there. The gate reported "vocabulary clean" over seventy files while a rule
   * the project calls its most important was unenforced on every line of copy
   * that happens to be followed by a value.
   *
   * The terminator is a lookahead so it stays available as the next run's
   * opener: in `}a{b}c<`, consuming the `{` would swallow the start of `b`.
   */
  for (const m of src.matchAll(/[>}]\s*([^<>{}]{3,}?)\s*(?=[<{])/g)) {
    // Offset of the text itself, not of the `>` that opened it — that bracket
    // usually closes the previous line, which would report every JSX
    // violation one line early.
    out.push({ text: m[1], index: m.index + m[0].indexOf(m[1]) });
  }
  return out;
}

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
  }
};
for (const r of ROOTS) walk(r);

let violations = 0;
for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const src = stripNonCopy(raw);
  for (const { text, index } of extractCopy(src)) {
    for (const word of BANNED) {
      const re = new RegExp(`\\b${word}s?\\b`, 'i');
      if (!re.test(text)) continue;
      const line = src.slice(0, index).split('\n').length;
      console.error(
        `${relative(process.cwd(), file)}:${line}  banned word "${word}" in UI copy:\n    ${text.trim().slice(0, 90)}`,
      );
      violations++;
    }
  }
}

if (violations) {
  console.error(`\n✗ ${violations} vocabulary violation(s). See docs/design-v4/01-foundations.md rule 6.`);
  process.exit(1);
}
console.log(`✓ vocabulary clean — ${files.length} file(s) checked`);
