/* Pure helpers for the screens; tested in lib.test.ts. */
import type { Checks, Choice, Cost, Estimate, Job, Method } from "./api";

export const KEY_CHOICE: Record<string, Choice> = { "1": "left", "2": "right", "3": "same", "4": "both_bad" };
export const CHOICE_LABEL: Record<Choice, string> = {
  left: "Left better",
  right: "Right better",
  same: "Same",
  both_bad: "Both unusable",
};
// Word for word as in the protocol (spec "Duels").
export const RULE = "Which would you rather learn from?";
export const RULE_DETAIL = "Nothing missing, nothing invented, right order, no junk, clear structure.";

/** A measured number, or a dash where none was measured (never "null"). */
export function dash(value: number | null | undefined, digits = -1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return digits >= 0 ? value.toFixed(digits) : String(value);
}

// The line breaks Python's str.splitlines() knows, so line numbers match checks.footer_line_numbers.
const PY_LINES = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85" + String.fromCharCode(0x2028, 0x2029) + "]");

export interface Segment {
  kind: "md" | "footer";
  text: string;
}

/** The output cut into runs of ordinary lines and footer lines, so footer lines can be marked. */
export function splitFooter(markdown: string, footerLines: number[]): Segment[] {
  const marked = new Set(footerLines);
  const out: Segment[] = [];
  markdown.split(PY_LINES).forEach((line, i) => {
    const kind = marked.has(i) ? "footer" : "md";
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += "\n" + line;
    else out.push({ kind, text: line });
  });
  return out.filter((s) => s.kind === "footer" || s.text.trim() !== "");
}

export interface Chip {
  label: string;
  tone: "good" | "bad" | "";
}

export function checkChips(c: Checks | null): Chip[] {
  if (!c) return [{ label: "no checks", tone: "" }];
  const chips: Chip[] = [];
  const leaks = c.footer_leaks ?? 0;
  chips.push(leaks ? { label: `footer leaked ×${leaks}`, tone: "bad" } : { label: "no footer", tone: "good" });
  if (c.title_first !== null) {
    chips.push(c.title_first ? { label: "title first", tone: "good" } : { label: "title not first", tone: "bad" });
  }
  const symbols = c.wrong_symbols ?? 0;
  chips.push(symbols ? { label: `wrong symbols ×${symbols}`, tone: "bad" } : { label: "symbols ok", tone: "good" });
  if (c.broken_line_pct === null) chips.push({ label: "no line breaks to judge", tone: "" });
  else chips.push({ label: `broken lines ${dash(c.broken_line_pct)}%`, tone: c.broken_line_pct > 20 ? "bad" : "" });
  chips.push({ label: `dropped ${dash(c.dropped_words_pct)}% · invented ${dash(c.invented_words_pct)}%`, tone: "" });
  const parts = [`${c.headings ?? 0} headings`, `${c.list_items ?? 0} list items`];
  if (c.tables) parts.push(`${c.tables} table${c.tables === 1 ? "" : "s"}`);
  if (c.math_spans) parts.push(`${c.math_spans} maths`);
  chips.push({ label: parts.join(" · "), tone: "" });
  return chips;
}

export function newSession(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "s-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Minutes left at this session's median pace (11 s per duel before the first vote). */
export function minutesLeft(remaining: number, secondsSoFar: number[]): number {
  return Math.max(1, Math.round((remaining * (median(secondsSoFar) ?? 11)) / 60));
}

/** The scale of the interval chart: every interval and the 1000 line, with a margin. */
export function axis(rows: { lo: number; hi: number }[]): [number, number] {
  const lo = Math.min(1000, ...rows.map((r) => r.lo));
  const hi = Math.max(1000, ...rows.map((r) => r.hi));
  const pad = Math.max(20, (hi - lo) * 0.08);
  return [lo - pad, hi + pad];
}

export function pct(value: number, [lo, hi]: [number, number]): number {
  return Math.min(100, Math.max(0, (100 * (value - lo)) / (hi - lo)));
}

export function shortDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}

const STAGE: Record<string, string> = {
  starting: "starting",
  waiting: "waiting for the running method",
  warmup: "warming up",
  timed: "running",
  scoring: "scoring",
  cancelling: "cancelling",
};

export function jobLabel(job: Job): string {
  if (job.state === "queued") return "waiting";
  if (job.state === "running") return STAGE[job.stage ?? ""] ?? "running";
  if (job.state === "failed") return `failed: ${job.error ?? "no reason recorded"}`;
  return job.state;
}

/** Dollars as the cost OK shows them: to the cent, and "<$0.01" for less than half a cent (as paid.usd). A ceiling
 * (roundUp) is rounded up to the next cent, so "at most" is never understated. */
export function usd(value: number, roundUp = false): string {
  if (roundUp) return `$${(Math.ceil(Number((value * 100).toFixed(6))) / 100).toFixed(2)}`;
  if (value > 0 && value < 0.005) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** One line per paid method for the cost OK: what is sent where, and what it should cost. */
export function estimateLine(e: Estimate): string {
  const images = `${e.pages} page image${e.pages === 1 ? "" : "s"}`;
  return `${e.label}: ${images} to OpenAI (${e.model}), about ${usd(e.usd)}, at most ${usd(e.max_usd, true)}`;
}

/** What a paid run spent, from the API's own usage, at the recorded price. */
export function costLine(c: Cost): string {
  if (c.usd === null || c.usd === undefined || c.usage_lost) return "usage unknown — check the OpenAI usage page";
  const n = (v: number) => v.toLocaleString("en");
  const parts: string[] = [];
  if (c.requests !== undefined) parts.push(`${c.requests} request${c.requests === 1 ? "" : "s"}`);
  if (c.prompt_tokens !== undefined && c.completion_tokens !== undefined)
    parts.push(`${n(c.prompt_tokens)} input + ${n(c.completion_tokens)} output tokens`);
  const unbilled = c.pages_billed_without_usage ?? 0;
  if (c.usd_is_lower_bound) {
    parts.push(`at least ${usd(c.usd)}${unbilled ? ` (${unbilled} page${unbilled === 1 ? "" : "s"} billed without usage)` : ""}`);
  } else {
    parts.push(c.price ? `${usd(c.usd)} at the price of ${c.price.checked_on}` : usd(c.usd));
  }
  return parts.join(" · ");
}

/** What a run request is for: the file, the mode and the methods. */
export interface RunChoice {
  sha256: string;
  purpose: string;
  tools: string[];
}

/** True when a cost OK that was shown for `shown` is still for exactly what is chosen now (same file, mode and
 * methods, in any order); an OK is never carried over to anything else. */
export function confirmMatches(shown: RunChoice | null, current: RunChoice | null): boolean {
  if (!shown || !current) return false;
  const same = [...shown.tools].sort().join("\n") === [...current.tools].sort().join("\n");
  return shown.sha256 === current.sha256 && shown.purpose === current.purpose && same;
}

/** The status cell of a method on New run. */
export function methodState(m: Method): "ready" | "install" | "key" | "missing" {
  if (m.ready) return "ready";
  if (m.needs_install) return "install";
  if (m.paid && m.key_missing) return "key";
  return "missing";
}

// ---------------------------------------------------------------------------------------------------------
// HTML in an output, shown as formatting (Plan 3b, Task 10a). Display only: stored outputs, the checks and
// normalize.py never see this. It is a small scanner, not a DOM: the same text gives the same result in
// the browser, in vitest and in any later tool.
//
// The rule that matters most: a method that writes no HTML is never changed. So a tag only counts when it is
// spelled like a tag (strict attributes) AND is part of a pair (or is a void tag such as <br>): "if p<q>0",
// "a<b and b>c" and "P(A<B|C>D)" stay exactly as written.
// ---------------------------------------------------------------------------------------------------------

// Private-use characters that stand in for protected text (code, maths, finished table text), for "a paragraph
// break goes here" and for a "<" that an entity produced. Text that already holds one is returned unchanged.
const HOLD_OPEN = "";
const HOLD_CLOSE = "";
const BREAK = "";
const LT = "";
const HOLD_RE = new RegExp(`${HOLD_OPEN}(\\d+)${HOLD_CLOSE}`, "g");

// Only these names are treated as tags.
const KNOWN_TAGS =
  "a|abbr|b|big|blockquote|body|br|caption|center|cite|code|col|colgroup|dd|del|dfn|div|dl|dt|em|figcaption|figure|font|" +
  "h[1-6]|head|hr|html|i|img|ins|kbd|li|mark|ol|p|pre|q|s|small|span|strike|strong|sub|sup|table|tbody|td|tfoot|th|thead|" +
  "tr|tt|u|ul";
// Attributes: name, or name=value (quoted, or a bare word). Anything else ("," or "|" or "and 0 then") is not a tag.
const ATTRS = `(?:\\s+[A-Za-z_:][\\w:.-]*(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'<>=\`]+))?)*\\s*`;
const tagRe = () => new RegExp(`(?<!\\\\)<(/?)(${KNOWN_TAGS})(?![A-Za-z0-9])(${ATTRS})/?>`, "gi");
const tableRe = () => new RegExp(`(?<!\\\\)<table(?![A-Za-z0-9])${ATTRS}>([\\s\\S]*?)</table\\s*>`, "gi");
const cellTagRe = () => new RegExp(`<(/?)(tr|td|th)(?![A-Za-z0-9])(${ATTRS})/?>`, "gi");
// What would make a decoded "<" read as markup again (a tag or a comment).
const MARKUP_AFTER_LT = new RegExp(`^(?:!--|/?(?:${KNOWN_TAGS})(?![A-Za-z0-9])${ATTRS}/?>)`, "i");
// Text that can change at all: a tag-like start, a comment, or an entity.
const HAS_HTML = /<[A-Za-z/!]|&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
// Tags that need no partner (the others count only as an opening plus a closing tag).
const VOID = new Set(["br", "img", "hr", "li", "col", "tr", "td", "th"]);
const CLOSING_OK = new Set(["li", "tr", "td", "th"]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ndash: "–", mdash: "—", hellip: "…", copy: "©",
  reg: "®", trade: "™", deg: "°", times: "×", divide: "÷", minus: "−", plusmn: "±", laquo: "«", raquo: "»",
  middot: "·", bull: "•", rarr: "→", larr: "←", uarr: "↑", darr: "↓", harr: "↔", ne: "≠", le: "≤", ge: "≥",
  asymp: "≈", infin: "∞", sum: "∑", radic: "√", micro: "µ", para: "¶", sect: "§", euro: "€", pound: "£",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", shy: "­", thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω",
};

function codePoint(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
  return String.fromCodePoint(n);
}

/** Entities to characters. With `escape`, a decoded "&" that would read as an entity again and a decoded "<" that
 * would read as a tag or comment again are written with a backslash (Markdown shows them plain), so a second pass
 * finds nothing to change. Tags that were already in the text are left exactly as they were. */
function decodeEntities(text: string, escape = true): string {
  const decoded = text.replace(/(?<!\\)&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, name: string, at: number) => {
    let ch: string | null | undefined;
    if (name[0] === "#") ch = codePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    else ch = ENTITIES[name];
    if (ch === null || ch === undefined) return whole;
    if (!escape) return ch;
    if (ch === "&" && /^#?[A-Za-z0-9]+;/.test(text.slice(at + whole.length))) return "\\&";
    return ch === "<" ? LT : ch;
  });
  if (!decoded.includes(LT)) return decoded;
  return decoded.replace(new RegExp(LT, "g"), (_m, at: number) => (MARKUP_AFTER_LT.test(decoded.slice(at + 1)) ? "\\<" : "<"));
}

interface Tag {
  index: number;
  end: number;
  closing: boolean;
  name: string;
  valid: boolean;
}

/** The tags that count: void tags, and opening tags with a closing partner of the same name (and that partner). */
function scanTags(html: string): Tag[] {
  const re = tagRe();
  const all: Tag[] = [];
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    all.push({ index: m.index, end: m.index + m[0].length, closing: m[1] === "/", name: m[2].toLowerCase(), valid: false });
  }
  const open = new Map<string, number[]>();
  all.forEach((t) => {
    if (VOID.has(t.name)) {
      t.valid = !t.closing || CLOSING_OK.has(t.name);
    } else if (!t.closing) {
      open.set(t.name, [...(open.get(t.name) ?? []), all.indexOf(t)]);
    } else {
      const stack = open.get(t.name);
      if (stack && stack.length) {
        all[stack.pop()!].valid = true;
        t.valid = true;
      }
    }
  });
  return all.filter((t) => t.valid);
}

interface Frame {
  name: string;
  out: string;
}

const FORMATS = new Set(["sup", "sub", "b", "strong", "i", "em", "code", "h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCKS = new Set(["p", "div", "center", "ul", "ol", "hr", "blockquote"]);

/** Inline and block tags to Markdown. In a table cell, breaks and paragraphs become spaces. */
function convertFragment(html: string, inCell: boolean): string {
  const stack: Frame[] = [{ name: "", out: "" }];
  const top = () => stack[stack.length - 1];
  const emit = (s: string) => {
    top().out += s;
  };
  const inCode = () => top().name === "code";
  const text = (s: string) => emit(decodeEntities(s, !inCode()));
  // A <br> in a line that is already a pipe-table row must not split the row.
  const inPipeRow = () => {
    const so = stack.map((f) => f.out).join("");
    return /^[ \t]*\|/.test(so.slice(Math.max(so.lastIndexOf("\n"), so.lastIndexOf(BREAK)) + 1));
  };
  const wrap = (name: string, inner: string): string => {
    if (inner.trim() === "") return inner;
    const lead = inner.match(/^\s*/)![0];
    const trail = inner.match(/\s*$/)![0];
    const core = inner.trim();
    if (/^h[1-6]$/.test(name)) return inCell ? inner : `${BREAK}${"#".repeat(Number(name[1]))} ${core.replace(/\s+/g, " ")}${BREAK}`;
    switch (name) {
      case "sup": return `${lead}^${core}${trail}`;
      case "sub": return `${lead}_${core}${trail}`;
      case "b": case "strong": return `${lead}**${core}**${trail}`;
      case "i": case "em": return `${lead}*${core}*${trail}`;
      default: return inner;
    }
  };
  const codeSpan = (inner: string): string => {
    const flat = inner.replace(/\s+/g, " ");
    if (flat.trim() === "") return flat;
    const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((r) => r.length));
    const fence = "`".repeat(longest + 1);
    const pad = /^`|`$/.test(flat) ? " " : "";
    return `${fence}${pad}${flat}${pad}${fence}`;
  };
  let last = 0;
  for (const tag of scanTags(html)) {
    const between = html.slice(last, tag.index);
    last = tag.end;
    if (between) text(between);
    const { name, closing } = tag;
    if (inCode() && !(closing && name === "code")) continue; // inside <code> only its text counts
    if (name === "br") emit(inCell || inPipeRow() ? " " : "\n");
    else if (name === "img") emit("[figure]");
    else if (name === "li") {
      if (!closing) {
        if (!inCell) top().out = top().out.replace(/[ \t\r\n]+$/, ""); // one item per line, no blank line between
        emit(inCell ? " " : "\n- ");
      }
    } else if (BLOCKS.has(name)) emit(inCell ? " " : BREAK);
    else if (FORMATS.has(name)) {
      if (!closing) stack.push({ name, out: "" });
      else {
        let i = stack.length - 1;
        while (i > 0 && stack[i].name !== name) i--;
        if (i > 0) {
          // Frames opened inside it and never closed are dropped with their tags, their text kept.
          const inner = stack.slice(i).map((f) => f.out).join("");
          const opened = stack[i].name;
          stack.length = i;
          emit(opened === "code" ? codeSpan(inner) : wrap(opened, inner));
        }
      }
    }
    // any other known tag: removed, its text stays
  }
  const tail = html.slice(last);
  if (tail) text(tail);
  // Never-closed formats: tags dropped, text kept.
  return stack.map((f) => f.out).join("");
}

interface TableCell {
  html: string;
  colspan: number;
  rowspan: number;
}

function spanOf(attrs: string, key: string, max: number): number {
  const m = new RegExp(`${key}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  return m ? Math.min(max, Math.max(1, parseInt(m[1], 10))) : 1;
}

function parseRows(inner: string): TableCell[][] {
  const rows: TableCell[][] = [];
  let row: TableCell[] | null = null;
  let cell: { start: number; attrs: string } | null = null;
  const closeCell = (end: number) => {
    if (cell && row) {
      row.push({ html: inner.slice(cell.start, end), colspan: spanOf(cell.attrs, "colspan", 50), rowspan: spanOf(cell.attrs, "rowspan", 200) });
    }
    cell = null;
  };
  const closeRow = () => {
    if (row && row.length) rows.push(row);
    row = null;
  };
  const re = cellTagRe();
  for (let m = re.exec(inner); m !== null; m = re.exec(inner)) {
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (name === "tr") {
      closeCell(m.index);
      closeRow();
      if (!closing) row = [];
    } else if (closing) closeCell(m.index);
    else {
      closeCell(m.index);
      if (!row) row = [];
      cell = { start: m.index + m[0].length, attrs: m[3] };
    }
  }
  closeCell(inner.length);
  closeRow();
  return rows;
}

function cellText(html: string, restore: (s: string) => string): string {
  const flat = restore(convertFragment(html, true)).replace(/[\s\u00a0]+/g, " ").trim();
  return flat.replace(/(?<!\\)\|/g, "\\|");
}

/** One HTML table as a GFM table: the first row is the header; spans become empty cells. */
function tableToGfm(inner: string, restore: (s: string) => string): string {
  const rows = parseRows(inner);
  if (!rows.length) return "";
  const grid: (string | undefined)[][] = rows.map(() => []);
  rows.forEach((cells, r) => {
    let c = 0;
    for (const cell of cells) {
      while (grid[r][c] !== undefined) c++;
      const text = cellText(cell.html, restore);
      const down = Math.min(cell.rowspan, rows.length - r);
      for (let dr = 0; dr < down; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          if (grid[r + dr][c + dc] === undefined) grid[r + dr][c + dc] = dr === 0 && dc === 0 ? text : "";
        }
      }
      c += cell.colspan;
    }
  });
  const width = Math.max(...grid.map((r) => r.length));
  const line = (r: (string | undefined)[]) => "| " + Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") + " |";
  const header = line(grid[0]);
  const rule = "| " + Array.from({ length: width }, () => "---").join(" | ") + " |";
  return [header, rule, ...grid.slice(1).map(line)].join("\n");
}

/** Fenced code blocks, then inline code, then maths, replaced by placeholders so no tag inside them is touched. */
function protect(md: string, hold: (s: string) => string): string {
  const out: string[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}[^`]*|~{3,}.*)$/.exec(lines[i]);
    if (!open) {
      out.push(lines[i]);
      continue;
    }
    const fence = open[1][0];
    const size = /^[`~]+/.exec(open[1])![0].length;
    const close = new RegExp(`^ {0,3}\\${fence}{${size},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    const end = Math.min(j, lines.length - 1); // an unclosed fence runs to the end
    out.push(hold(lines.slice(i, end + 1).join("\n")));
    i = end;
  }
  return out
    .join("\n")
    .replace(/(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?[^`])\1(?!`)/g, (m) => hold(m))
    .replace(/\$\$[\s\S]+?\$\$/g, (m) => hold(m))
    .replace(/(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/g, (m) => hold(m));
}

/** Paragraph breaks: blank lines around each break, none at the very start or end. */
function resolveBreaks(s: string): string {
  if (!s.includes(BREAK)) return s;
  const pieces = s.split(BREAK);
  let out = "";
  let pending = false;
  pieces.forEach((piece, i) => {
    let p = piece;
    if (i > 0) p = p.replace(/^[ \t\r\n]+/, "");
    if (i < pieces.length - 1) p = p.replace(/[ \t\r\n]+$/, "");
    if (i > 0) pending = true;
    if (p === "") return;
    if (pending && out !== "") out += "\n\n";
    pending = false;
    out += p;
  });
  return out;
}

/**
 * An output with its HTML shown as formatting, the same for every method (Plan 3b ruling M1): tables become GFM
 * tables, <br> a newline (a space inside a pipe-table row), <sup>/<sub> ^x / _x, <p>/<div>/<center>/<ul>/<ol>/
 * <blockquote>/<hr> paragraphs, <li> a "- " line, <h1>-<h6> "#" headings, <b>/<i>/<code> Markdown, comments
 * removed, other tags lose the tag and keep the text, entities become characters. Code, maths and anything
 * that is not really HTML stay as written; text that comes out the same is returned as the very same string.
 * Running it twice changes nothing more.
 */
export function htmlToMarkdown(md: string): string {
  if (!HAS_HTML.test(md) || /[-]/.test(md)) return md;
  const source = md.replace(/\r\n/g, "\n");
  const held: string[] = [];
  const hold = (s: string) => {
    held.push(s);
    return `${HOLD_OPEN}${held.length - 1}${HOLD_CLOSE}`;
  };
  const restore = (s: string): string => s.replace(HOLD_RE, (_, i: string) => restore(held[Number(i)]));
  const text = protect(source, hold)
    .replace(/(?<!\\)<!--[\s\S]*?-->|(?<!\\)<!--[^\n]*/g, "")
    .replace(tableRe(), (_whole, inner: string) => BREAK + hold(tableToGfm(inner, restore)) + BREAK);
  const out = resolveBreaks(restore(convertFragment(text, false)));
  return out === source ? md : out;
}
