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

/*
 * The size of each piece pdf.js asks for. Opening a deck and drawing its
 * first page touches small objects scattered across the whole file; at the
 * default 64 KB, every one of them costs a 64 KB request. 16 KB pieces
 * halved the bytes and the time to the first page on the 82-page
 * Normalization deck (1.9 MB → 0.95 MB, 1.8 s → 0.9 s at 10 Mbit). Pieces
 * that sit side by side are still asked for in one request.
 */
const RANGE_CHUNK_SIZE = 16 * 1024;

type PdfOptions = { worker?: InstanceType<typeof pdfjs.PDFWorker>; rangeChunkSize: number };

let worker: InstanceType<typeof pdfjs.PDFWorker> | null = null;
let options: PdfOptions = { rangeChunkSize: RANGE_CHUNK_SIZE };

/** Start the worker now. Safe to call often; a no-op where there are no workers (tests). */
export function warmPdfWorker(): void {
  if (typeof Worker === 'undefined') return;
  if (worker && !worker.destroyed) return;
  worker = new pdfjs.PDFWorker();
  options = { worker, rangeChunkSize: RANGE_CHUNK_SIZE };
}

/**
 * The `options` for `<Document>`: the shared worker and the piece size, the
 * same object every render (a new object would make react-pdf load the file
 * again).
 */
export function pdfOptions(): PdfOptions {
  warmPdfWorker();
  return options;
}
