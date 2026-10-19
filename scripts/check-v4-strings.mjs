#!/usr/bin/env node
/**
 * v4 speaks the reader's language — docs/V4_TRANSLATION_PLAN.md, "Guards".
 *
 * Two checks, both failing `npm run lint`:
 *
 *   1. No hard-coded words in v4 JSX. Every JSX text node and every
 *      aria-label, title, placeholder, alt and label attribute under
 *      src/features/spaces must come from i18n (`t(...)`), not be written
 *      in the file. Read with the TypeScript parser, so comments, imports,
 *      class names and code identifiers can never trip it — only what would
 *      actually be rendered as words.
 *
 *   2. The German says it the way we decided (docs/V4_GLOSSARY.md and the
 *      "German register" of docs/BRAND_VOICE.md): no Folie, Vorlesung, Kurs,
 *      Konzept, Student(en), Dozent without ":in"; du, never Sie; no
 *      exclamation marks.
 *
 * What is NOT a word: text with no letters ("·", "—", "/ 82", "→"), and the
 * few loanwords that are the same in every language (ALLOWED below). A
 * deliberate exception in code is marked on its line with `i18n-ignore`, and
 * says why.
 *
 * Usage:  node scripts/check-v4-strings.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/* A directory to check instead, for testing the checker itself. */
const ROOT = process.argv[2] ?? 'src/features/spaces';
const LOCALES = process.argv[3] ?? 'src/i18n/locales/de';
const SKIP_DIRS = new Set(['__tests__', 'mocks']);
const ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'aria-description', 'aria-valuetext']);

/* Words that are the same in English and German — product nouns and units. */
const ALLOWED = new Set(['Spaces', 'Space', 'XP', 'MB', 'Studio', 'Material', 'Checkpoint', 'Level', 'Badge', 'Quiz', 'BCNF', 'ABC123', 'auto', 'OK']);

const hasWords = (s) => /\p{L}{2,}/u.test(s);
/* A lone lowercase identifier ("spaces", "history") is a key or a value for code, not words. */
const identifier = (s) => /^[a-z][a-zA-Z0-9]*$/.test(s.trim());
const allowed = (s) => {
  const words = s.match(/\p{L}[\p{L}\d+#-]*/gu) ?? [];
  return words.length > 0 && words.every((w) => ALLOWED.has(w));
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* files(p);
    } else if (p.endsWith('.tsx')) yield p;
  }
}

const problems = [];

/* ── 1. JSX ────────────────────────────────────────────────────── */

for (const file of files(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report = (node, text, what) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    if (/i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '')) return;
    problems.push(`${relative('.', file)}:${line + 1}  ${what}: "${text.trim().replace(/\s+/g, ' ').slice(0, 70)}"`);
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf);
      if (hasWords(text) && !allowed(text)) report(node, text, 'words in JSX');
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (ATTRS.has(name)) {
        const init = node.initializer;
        const lit = ts.isStringLiteral(init)
          ? init
          : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
            ? init.expression
            : null;
        if (lit && hasWords(lit.text) && !identifier(lit.text) && !allowed(lit.text)) report(node, lit.text, `${name}=`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/* ── 2. German vocabulary and register ─────────────────────────── */

const RULES = [
  [/\bFolien?\b/, 'Folie → Seite'],
  [/\bVorlesung(en)?\b/, 'Vorlesung → Lektion'],
  [/\bKurs(e|en)?\b/, 'Kurs → Space / Lektion'],
  [/\bKonzept(e)?\b/, 'Konzept → Idee'],
  [/\bStudent(en|in|innen)?\b/, 'Student → Studierende'],
  [/\bDozent(?!:in)(en)?\b/, 'Dozent → Dozent:in'],
  [/!/, 'no exclamation marks'],
];
/*
 * Capitalised mid-sentence, Sie / Ihnen / Ihr is the formal you. At a
 * sentence's start it is usually "they" or the informal plural "ihr" — fine.
 */
const FORMAL_SIE = /(?<![.?:–—]\s|^|„)\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/;

const walk = (value, at, out) => {
  if (typeof value === 'string') out.push([at, value]);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, at ? `${at}.${k}` : k, out);
};

for (const name of readdirSync(LOCALES)) {
  if (!name.startsWith('v4') || !name.endsWith('.json')) continue;
  const strings = [];
  walk(JSON.parse(readFileSync(join(LOCALES, name), 'utf8')), '', strings);
  for (const [key, text] of strings) {
    if (key === '_about') continue;
    const bare = text.replace(/\{\{[^}]+\}\}/g, '').replace(/<\/?\w+>/g, '');
    for (const [re, why] of RULES) if (re.test(bare)) problems.push(`${LOCALES}/${name}  ${key}: ${why} — "${text.slice(0, 70)}"`);
    if (FORMAL_SIE.test(bare)) problems.push(`${LOCALES}/${name}  ${key}: Sie → du — "${text.slice(0, 70)}"`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n✗ ${problems.length} v4 string problem(s). Put words in src/i18n/locales/{en,de}/v4*.json and say them with t(); see docs/V4_TRANSLATION_PLAN.md.`);
  process.exit(1);
}
console.log('v4 strings check passed');
