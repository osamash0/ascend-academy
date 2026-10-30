import { localUrlFor } from './uploads';
import { useRunReading } from './useRunReading';

/**
 * An upload you can read before its Lesson exists. The file on this device
 * opens at once (no network); otherwise the stored copy's signed link. Luna's
 * progress is re-read until she is done or the run has failed.
 */
export function useEarlyReading(uploadId: string) {
  /* One link per File, kept across the swap from `sending-N` to the run id: the PDF loads once. */
  const local = localUrlFor(uploadId);
  const reading = useRunReading(uploadId);
  return { reading, url: local ?? reading?.pdfUrl ?? null };
}
