/**
 * Structured API error (R31).
 *
 * `apiClient`'s `request()` used to throw a plain `Error` with the status
 * code only embedded in the message string
 * (`` `${method} ${path} → ${status}: ${text}` ``), so every catch block
 * that wanted to distinguish "not enough questions" from "rate limited"
 * from "server exploded" had nothing to branch on except regexing that
 * string — nobody did, so every consumer just toasted the raw transport
 * string at students.
 *
 * `ApiError` carries the same `.message` (unchanged, so any existing
 * `catch (err) { ...err.message... }` call site keeps working byte-for-byte)
 * plus a real `.status` number and an optional `.detail` (the backend's
 * `detail` field, when the error body is JSON) so callers can map status
 * codes to friendly, translated copy instead.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** Returns the HTTP status code if `err` is an `ApiError`, else `undefined`. */
export function getErrorStatus(err: unknown): number | undefined {
  return err instanceof ApiError ? err.status : undefined;
}
