import { pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * One pdf.js worker for every document, started before it is needed.
 *
 * pdf.js asks for a file only once its worker is up, and the worker is a
 * 1 MB script. Left to `<Document>`, that download starts when the page
 * mounts — after the lesson's data — and the PDF waits behind it. Warmed on
 * the way in, the worker arrives while the data does, and the file is asked
 * for the moment there is somewhere to show it.
 *
 * Shared, the worker also outlives each document: a document destroys only
 * a worker it made itself, so turning to the next Lesson reuses this one.
 */

let worker: InstanceType<typeof pdfjs.PDFWorker> | null = null;
let options: { worker: InstanceType<typeof pdfjs.PDFWorker> } | undefined;

/** Start the worker now. Safe to call often; a no-op where there are no workers (tests). */
export function warmPdfWorker(): void {
  if (typeof Worker === 'undefined') return;
  if (worker && !worker.destroyed) return;
  worker = new pdfjs.PDFWorker();
  options = { worker };
}

/**
 * The `options` for `<Document>`: the shared worker, the same object every
 * render (a new object would make react-pdf load the file again).
 */
export function pdfOptions(): { worker: InstanceType<typeof pdfjs.PDFWorker> } | undefined {
  warmPdfWorker();
  return options;
}
