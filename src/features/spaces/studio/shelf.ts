import { phrase, type Phrase } from '../components/course/phrase';

/**
 * The shelf's model: one object for everything you bring in.
 * Pure functions only — the store lives in `mocks/shelf.ts`.
 *
 * Anything these say is a `Phrase` ({ key, params } in `v4Library`), never a
 * finished sentence: the screen says it with `t`, so the model stays
 * language-free and German can order the words its own way.
 */

export type ShareAs = 'lesson' | 'community-lesson' | 'contribution';
export type ShareState =
  | { kind: 'private' }
  | { kind: 'draft'; spaceId: string; as: ShareAs }
  | { kind: 'shared'; spaceId: string; as: ShareAs; likes: number; endorsed: boolean; cleared: number };

export interface ShelfItem {
  id: string;
  filename: string;
  pageCount: number;
  cover: string;
  stage: 'developing' | 'ready' | 'failed';
  share: ShareState;
  opens: { kind: 'canvas'; canvasId: string } | { kind: 'lesson'; spaceId: string; lessonId: string };
  progress: { pagesRead: number; recallKnew: number; recallTotal: number; answers: number; notes: number };
  lastOpenedAt: string | null;
  lastPage: number | null;
  addedAt: string;
  /** Preview honesty: true when the item opens the sample pages, not its own. */
  sample?: boolean;
  /** Brought in during this visit: only these develop in front of you. Seeded items never carry it. */
  broughtIn?: boolean;
}

export type JourneyStep = 'brought' | 'understood' | 'shared' | 'landed';
export type StepState = 'done' | 'now' | 'todo';

export function journeyOf(item: ShelfItem): Record<JourneyStep, StepState> {
  const { stage, share, progress } = item;
  const understood: StepState =
    stage === 'ready' && (progress.pagesRead >= 1 || progress.answers >= 1) ? 'done' : 'now';
  let shared: StepState = 'todo';
  if (share.kind === 'shared') shared = 'done';
  else if (share.kind === 'draft') shared = 'now';
  else if (understood === 'done') shared = 'now';
  let landed: StepState = 'todo';
  if (share.kind === 'shared') {
    landed = share.likes > 0 || share.endorsed || share.cleared > 0 ? 'done' : 'now';
  }
  return { brought: 'done', understood, shared, landed };
}

export type Role = 'owner' | 'editor' | 'member';
export type Mode = 'guided' | 'open';

export function shareOutcome(
  role: Role,
  mode: Mode,
): { as: ShareAs; kind: 'draft' | 'shared'; copy: (space: string) => Phrase } {
  if (role === 'owner' || role === 'editor') {
    return {
      as: 'lesson',
      kind: 'draft',
      copy: (space) => phrase('share.outcome.draft', { space }),
    };
  }
  if (mode === 'open') {
    return {
      as: 'community-lesson',
      kind: 'shared',
      copy: () => phrase('share.outcome.open'),
    };
  }
  return {
    as: 'contribution',
    kind: 'shared',
    copy: () => phrase('share.outcome.contribution'),
  };
}

/** "Read 6/12 · Recall 9/31 · 2 answers · 1 note" as phrases — zeros left out. */
export function lifeLine(item: ShelfItem): Phrase[] {
  const p = item.progress;
  const out: Phrase[] = [];
  if (p.pagesRead > 0) out.push(phrase('life.read', { read: p.pagesRead, total: item.pageCount }));
  if (p.recallTotal > 0) out.push(phrase('life.recall', { knew: p.recallKnew, total: p.recallTotal }));
  if (p.answers > 0) out.push(phrase('life.answers', { count: p.answers }));
  if (p.notes > 0) out.push(phrase('life.notes', { count: p.notes }));
  return out;
}

export type ShelfFilter = 'all' | 'reading' | 'shared' | 'words';

/** `title` is the name a cover shows; search finds it or the filename. */
export function filterItems(
  items: ShelfItem[],
  f: ShelfFilter,
  q: string,
  title: (i: ShelfItem) => string = (i) => i.filename,
): ShelfItem[] {
  if (f === 'words') return [];
  const needle = q.trim().toLowerCase();
  return items.filter((i) => {
    if (needle && !`${title(i)}\n${i.filename}`.toLowerCase().includes(needle)) return false;
    if (f === 'reading') {
      return i.share.kind !== 'shared' || i.progress.pagesRead < i.pageCount;
    }
    if (f === 'shared') return i.share.kind !== 'private';
    return true;
  });
}

/**
 * Sharing several at once (Select): only ready, private files go; the rest stay
 * as they are, and `left` names why, e.g. "1 still being prepared", "1 already in a Space".
 */
export function shareSplit(items: ShelfItem[]): { go: ShelfItem[]; left: Phrase[] } {
  const go = items.filter((i) => i.stage === 'ready' && i.share.kind === 'private');
  const preparing = items.filter((i) => i.stage === 'developing').length;
  const unread = items.filter((i) => i.stage === 'failed').length;
  const inSpace = items.filter((i) => i.stage === 'ready' && i.share.kind !== 'private').length;
  const left = [
    preparing && phrase('share.preparing', { count: preparing }),
    unread && phrase('share.unread', { count: unread }),
    inSpace && phrase('share.inSpace', { count: inSpace }),
  ].filter((p): p is Phrase => !!p);
  return { go, left };
}

export type ShelfSort = 'recent' | 'added' | 'az';

const byDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/** A–Z goes by `title`, the name a cover shows. */
export function sortItems(
  items: ShelfItem[],
  s: ShelfSort,
  title: (i: ShelfItem) => string = (i) => i.filename,
): ShelfItem[] {
  const out = [...items];
  if (s === 'az') return out.sort((a, b) => title(a).localeCompare(title(b)));
  if (s === 'added') return out.sort((a, b) => byDesc(a.addedAt, b.addedAt));
  return out.sort((a, b) => {
    // A file still being read (or that failed) leads, newest first: what you just brought in is where you look.
    const aLive = a.stage !== 'ready';
    if (aLive !== (b.stage !== 'ready')) return aLive ? -1 : 1;
    if (aLive) return byDesc(a.addedAt, b.addedAt);
    if (a.lastOpenedAt && b.lastOpenedAt) return byDesc(a.lastOpenedAt, b.lastOpenedAt);
    if (a.lastOpenedAt) return -1;
    if (b.lastOpenedAt) return 1;
    return byDesc(a.addedAt, b.addedAt);
  });
}

/** `private` is the group of what is only yours: its `title` is a stable name, said in the reader's language by the screen. */
export interface ShelfGroup {
  title: string;
  items: ShelfItem[];
  private?: true;
}

export function groupBySpace(items: ShelfItem[], spaceName: (id: string) => string): ShelfGroup[] {
  const groups = new Map<string, ShelfItem[]>();
  const priv: ShelfItem[] = [];
  for (const i of items) {
    if (i.share.kind === 'private') {
      priv.push(i);
      continue;
    }
    const title = spaceName(i.share.spaceId);
    groups.set(title, [...(groups.get(title) ?? []), i]);
  }
  const out = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, its]): ShelfGroup => ({ title, items: its }));
  if (priv.length) out.push({ title: 'Only you', items: priv, private: true });
  return out;
}

/** The page to pick up: a ready canvas with a page to show. A Lesson opens elsewhere, so it is never one. */
export function continueItem(items: ShelfItem[]): ShelfItem | null {
  let best: ShelfItem | null = null;
  for (const i of items) {
    if (i.stage !== 'ready' || !i.lastOpenedAt || i.opens.kind !== 'canvas' || !i.cover) continue;
    if (!best || i.lastOpenedAt > best.lastOpenedAt!) best = i;
  }
  return best;
}

export interface WordEntry {
  kind: 'note' | 'answer' | 'written';
  id: string;
  itemId: string | null;
  page: number | null;
  title: string;
  body: string;
  at: string;
  href: string;
}

export function yourWords(entries: WordEntry[]): WordEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.at === b.e.at ? a.i - b.i : byDesc(a.e.at, b.e.at)))
    .map(({ e }) => e);
}
