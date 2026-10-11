/**
 * The shelf's model: one object for everything you bring in.
 * Pure functions only — the store lives in `mocks/shelf.ts`.
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
): { as: ShareAs; kind: 'draft' | 'shared'; copy: (space: string) => string } {
  if (role === 'owner' || role === 'editor') {
    return {
      as: 'lesson',
      kind: 'draft',
      copy: (space) =>
        `It becomes a draft Lesson in ${space}. Only you and editors see it until you publish.`,
    };
  }
  if (mode === 'open') {
    return {
      as: 'community-lesson',
      kind: 'shared',
      copy: () => 'Open Space: it joins the path as a Community Lesson, with your name on it.',
    };
  }
  return {
    as: 'contribution',
    kind: 'shared',
    copy: () =>
      'It arrives as your Contribution, with your name on it. The owner can endorse it into the path.',
  };
}

export function lifeLine(item: ShelfItem): string[] {
  const p = item.progress;
  const out: string[] = [];
  if (p.pagesRead > 0) out.push(`Read ${p.pagesRead}/${item.pageCount}`);
  if (p.recallTotal > 0) out.push(`Recall ${p.recallKnew}/${p.recallTotal}`);
  if (p.answers > 0) out.push(`${p.answers} ${p.answers === 1 ? 'answer' : 'answers'}`);
  if (p.notes > 0) out.push(`${p.notes} ${p.notes === 1 ? 'note' : 'notes'}`);
  return out;
}

export type ShelfFilter = 'all' | 'reading' | 'shared' | 'words';

export function filterItems(items: ShelfItem[], f: ShelfFilter, q: string): ShelfItem[] {
  if (f === 'words') return [];
  const needle = q.trim().toLowerCase();
  return items.filter((i) => {
    if (needle && !i.filename.toLowerCase().includes(needle)) return false;
    if (f === 'reading') {
      return i.share.kind !== 'shared' || i.progress.pagesRead < i.pageCount;
    }
    if (f === 'shared') return i.share.kind !== 'private';
    return true;
  });
}

export type ShelfSort = 'recent' | 'added' | 'az';

const byDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

export function sortItems(items: ShelfItem[], s: ShelfSort): ShelfItem[] {
  const out = [...items];
  if (s === 'az') return out.sort((a, b) => a.filename.localeCompare(b.filename));
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

export function groupBySpace(
  items: ShelfItem[],
  spaceName: (id: string) => string,
): { title: string; items: ShelfItem[] }[] {
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
    .map(([title, its]) => ({ title, items: its }));
  if (priv.length) out.push({ title: 'Only you', items: priv });
  return out;
}

export function continueItem(items: ShelfItem[]): ShelfItem | null {
  let best: ShelfItem | null = null;
  for (const i of items) {
    if (i.stage !== 'ready' || !i.lastOpenedAt) continue;
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
