import { toast } from 'sonner';
import { loadLiveRepository } from './liveRepository';
import { liveWorld, setLiveWorld, type Upload } from './world';

/**
 * Files brought into a real Library.
 *
 * The world carries the uploads as they were when it loaded. From then on this
 * store holds them: a file being sent shows at once (it has no run yet), the
 * list is re-read every few seconds while anything is still developing, and
 * when a file becomes a Lesson the world is reloaded quietly — no remount — so
 * its cover can open straight into the reader.
 *
 * A send that never reached the server (too big, not a PDF, the month's quota)
 * stays on the shelf as failed, with its File kept, so "Try again" can resend
 * it. A run that failed on the server has no file here to resend.
 */

const POLL_MS = 4000;

let fetched: Upload[] | null = null;
/** Files on their way up, or refused before they became a run. */
let sending: Upload[] = [];
const files = new Map<string, File>();
/** Brought in during this visit: these develop in front of you. */
const broughtIn = new Set<string>();
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

let version = 0;
let snapshot: Upload[] = [];
const listeners = new Set<() => void>();
/** Removed, but still inside their Undo window: off the shelf, not yet deleted. */
const hidden = new Set<string>();
const compose = () => [...sending, ...(fetched ?? liveWorld()?.uploads ?? [])].filter((u) => !hidden.has(u.id));
const notify = () => {
  version += 1;
  snapshot = compose();
  listeners.forEach((fn) => fn());
};

export function subscribeUploads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const uploadsVersion = (): number => version;

/** Every upload, newest first: what is being sent, then what the server has. */
export function uploadsNow(): Upload[] {
  if (version === 0) snapshot = compose();
  return snapshot;
}

export const wasBroughtIn = (id: string): boolean => broughtIn.has(id);

/** Can this failed upload be sent again from here? */
export const canResend = (id: string): boolean => files.has(id);

async function refresh(): Promise<void> {
  const repo = await loadLiveRepository();
  const { uploads } = await repo.uploads();
  const known = new Set(liveWorld()?.lessons.map((l) => l.id) ?? []);
  fetched = uploads;
  if (uploads.some((u) => u.lessonId && !known.has(u.lessonId))) {
    // A new Lesson: the world has to know it before its cover can open it.
    setLiveWorld(await repo.world());
    fetched = liveWorld()?.uploads ?? uploads;
  }
  notify();
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    try {
      await refresh();
    } catch {
      /* A missed poll is retried on the next tick. */
    }
    if (uploadsNow().some((u) => u.stage === 'developing' && !u.id.startsWith('sending-'))) schedule();
    else polling = false;
  }, POLL_MS);
}

/** Start watching if something is still developing — the Library calls this when it opens. */
export function watchUploads(): void {
  if (polling) return;
  if (!uploadsNow().some((u) => u.stage === 'developing')) return;
  polling = true;
  schedule();
}

async function send(id: string, file: File): Promise<void> {
  try {
    const repo = await loadLiveRepository();
    const r = await repo.bringIn(file);
    files.delete(id);
    sending = sending.filter((u) => u.id !== id);
    if (r.run_id) broughtIn.add(r.run_id);
    if (r.status === 'duplicate') toast(`${file.name} is already in your Library.`);
    await refresh();
    polling = true;
    schedule();
  } catch (e) {
    sending = sending.map((u) => (u.id === id ? { ...u, stage: 'failed' as const } : u));
    notify();
    toast.error(reason(e, file.name));
  }
}

/** The server's words, without the transport's prefix ("Upload /… → 403: {detail}"). */
function reason(e: unknown, name: string): string {
  const text = e instanceof Error ? e.message : '';
  const detail = /"detail"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  return detail ? `${name}: ${detail}` : `${name} could not be brought in.`;
}

/** Bring files in. Each shows at once and develops in front of you. Returns their shelf ids. */
export function bringInLive(list: File[]): string[] {
  const ids = list.map((file) => {
    const id = `sending-${++seq}`;
    files.set(id, file);
    broughtIn.add(id);
    sending = [
      {
        id,
        lessonId: null,
        filename: file.name,
        title: null,
        pageCount: 0,
        stage: 'developing',
        addedAt: new Date().toISOString(),
      },
      ...sending,
    ];
    return id;
  });
  notify();
  ids.forEach((id) => void send(id, files.get(id)!));
  return ids;
}

/** Send a refused file again. */
export function resend(id: string): void {
  const file = files.get(id);
  if (!file) return;
  sending = sending.map((u) => (u.id === id ? { ...u, stage: 'developing' as const } : u));
  notify();
  void send(id, file);
}

/** How long Undo is offered before a removal is carried out. */
export const UNDO_MS = 6000;

/** A file still being read cannot be removed: the pipeline would make its Lesson afterwards. */
export const canRemoveUpload = (u: Pick<Upload, 'stage'>): boolean => u.stage !== 'developing';

/**
 * Remove uploads from the shelf, for good once the Undo window closes.
 *
 * They leave the shelf at once. Nothing is deleted until `UNDO_MS` has passed
 * without Undo — so Undo is an honest undo, not a re-upload. Then each goes:
 * a refused send just drops (it never reached the server); anything else is
 * deleted on the server — its Lesson by lecture id, a failed run by its own
 * id — and the world reloads quietly, so the Lesson leaves My materials too.
 * A delete that fails puts the cover back and says so.
 */
export function removeUploads(ids: string[]): { removed: number; undo: () => void } {
  const targets = uploadsNow().filter((u) => ids.includes(u.id) && canRemoveUpload(u));
  targets.forEach((u) => hidden.add(u.id));
  notify();
  let undone = false;
  const commit = setTimeout(() => void carryOut(targets), UNDO_MS);
  return {
    removed: targets.length,
    undo: () => {
      if (undone) return;
      undone = true;
      clearTimeout(commit);
      targets.forEach((u) => hidden.delete(u.id));
      notify();
    },
  };
}

async function carryOut(targets: Upload[]): Promise<void> {
  const local = targets.filter((u) => u.id.startsWith('sending-'));
  for (const u of local) {
    sending = sending.filter((s) => s.id !== u.id);
    files.delete(u.id);
    hidden.delete(u.id);
  }
  const remote = targets.filter((u) => !u.id.startsWith('sending-'));
  if (!remote.length) return notify();
  const repo = await loadLiveRepository();
  const results = await Promise.allSettled(remote.map((u) => repo.removeUpload(u.lessonId ?? u.id)));
  const failed = remote.filter((_, i) => results[i].status === 'rejected');
  const gone = new Set(remote.filter((u) => !failed.includes(u)).map((u) => u.id));
  if (fetched) fetched = fetched.filter((u) => !gone.has(u.id));
  remote.forEach((u) => hidden.delete(u.id));
  if (gone.size) {
    try {
      setLiveWorld(await repo.world());
      fetched = liveWorld()?.uploads ?? fetched;
    } catch {
      /* The shelf is already right; the Space catches up on the next load. */
    }
  }
  notify();
  if (failed.length) {
    toast.error(
      failed.length === 1
        ? `${failed[0].filename} could not be removed. It is back on your shelf.`
        : `${failed.length} files could not be removed. They are back on your shelf.`,
    );
  }
}

/** Tests: forget everything. */
export function __resetUploads(): void {
  fetched = null;
  sending = [];
  files.clear();
  broughtIn.clear();
  hidden.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  polling = false;
  version = 0;
  snapshot = [];
}
