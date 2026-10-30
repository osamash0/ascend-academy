/**
 * The reading session: one per open reader.
 *
 * The server needs to tell one sitting from the next (turning back within a
 * sitting, how long a sitting runs), and nothing else in the browser draws
 * that line. The reader opens a session when it mounts and closes it when it
 * goes; Explain, Ask, practice and the checkpoint read it from here, so each
 * request says which sitting it belongs to.
 */
const sessions = new Map<string, string>();

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function startSession(lessonId: string): string {
  const id = newId();
  sessions.set(lessonId, id);
  return id;
}

/** Ends this session only: a reader opened again since keeps its own. */
export function endSession(lessonId: string, id: string): void {
  if (sessions.get(lessonId) === id) sessions.delete(lessonId);
}

export function currentSession(lessonId: string | undefined): string | null {
  return (lessonId && sessions.get(lessonId)) || null;
}
