// `pdfjs`: the PDF.js text layer, as a browser builds it. A page's text is its
// text items joined, with a newline wherever PDF.js marks an end of line.
// Resolves pdfjs-dist from this repo's node_modules.
//
// Usage: node pdfjs_runner.mjs <in.pdf> <out.json>
import { readFile, writeFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [, , src, out] = process.argv;
const data = new Uint8Array(await readFile(src));
const settings = { isEvalSupported: false, verbosity: 0 };
const doc = await pdfjs.getDocument({ data, ...settings }).promise;
const pages = {};
for (let n = 1; n <= doc.numPages; n++) {
  const content = await (await doc.getPage(n)).getTextContent();
  pages[n] = content.items.map((item) => ('str' in item ? item.str : '') + (item.hasEOL ? '\n' : '')).join('');
}
await writeFile(
  out,
  JSON.stringify({
    version: pdfjs.version,
    settings: { call: 'getTextContent', join: 'items, newline on hasEOL', ...settings },
    pages,
  }),
);
