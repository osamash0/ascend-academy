import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Heart,
  NotebookPen,
  Plus,
  Sparkles,
  Unlink,
  Upload,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { LibraryItem, LibraryKind } from '../types';
import { useLibrary } from '../data/useSpaces';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { NoteEditor } from '../components/NoteEditor';
import { addNote, updateNote } from '../mocks/notes';
import { BentoCell } from '../components/BentoCell';
import { Scene, SURFACES } from '../components/Scene';
import { EndorsedBadge } from '../components/badges';
import { SpacesError, SpacesSkeleton } from '../components/states';

/**
 * Library — "what's mine?"
 *
 * Filtered by **author**, not by content type: the objects you made, wherever
 * they live. A Space shows everyone's work in one room; Library shows only
 * yours across every room — the one view Spaces structurally cannot give.
 *
 * Two rules shape everything here:
 *
 *   • **No Space cards.** Items name the Space they live in as context, but a
 *     Space is never an entry point from here. That is what keeps "one screen,
 *     one object" true.
 *   • **Items are pointers, except Notes.** Opening a contribution or a
 *     material takes you to it in its Space; Library never re-renders Space
 *     content, which is what made the rejected version a duplicate index.
 *     Notes are read and written here directly — they are private, appear
 *     nowhere else, and are the thing you most want across Spaces at once.
 *
 * Learn mode: calm and browsable. The dense work — managing uploads, drafts
 * across Spaces, how your work landed — hangs off this screen as separate
 * Studio screens, never mixed in.
 */

type Filter = 'all' | LibraryKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'note', label: 'Notes' },
  { key: 'material', label: 'Uploads' },
  { key: 'contribution', label: 'Published' },
];

const KIND_ICON = {
  note: NotebookPen,
  material: Upload,
  contribution: Sparkles,
} as const;

const KIND_LABEL = {
  note: 'Note',
  material: 'Upload',
  contribution: 'Published',
} as const;

const formatSize = (bytes?: number) =>
  bytes === undefined ? null : `${(bytes / 1_000_000).toFixed(1)} MB`;

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function LibraryScreen() {
  const navigate = useNavigate();
  /** Bodies edited this session, so the row shows the edit immediately. */
  const [noteBodies, setNoteBodies] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('all');
  /*
   * Library could edit a note but never write one — the empty state's only
   * control was inert, so the surface Doc 2 calls "read and written in Library
   * directly" could only be read.
   */
  const [composing, setComposing] = useState(false);
  const [writeTick, setWriteTick] = useState(0);
  const { state, items, notes, pending } = useLibrary();

  const latestNote = notes[0];
  const uploadCount = items.filter((i) => i.kind === 'material').length;
  const contributions = items.filter((i) => i.kind === 'contribution');
  const likesReceived = contributions.reduce((n, i) => n + (i.likeCount ?? 0), 0);
  const endorsedCount = contributions.filter((i) => i.endorsed).length;

  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

  // Library is a browse surface — you are choosing what to revisit.
  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.library} status="progress" motionKey="library">
      <SpacesTopBar active="library" viewer={viewer} />
      {body}
    </Scene>
  );

  if (state === 'loading') return chrome(<SpacesSkeleton />);
  if (state === 'error') return chrome(<SpacesError />);

  return chrome(
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-8 lg:px-8">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-[-0.02em] sm:text-[44px]">Library</h1>
        <p className="max-w-[58ch] text-[15.5px] leading-[1.75] text-quiet">
          Everything you’ve made, across every Space — your notes, your uploads and the
          work you’ve published.
        </p>
      </header>

      {/*
        At a glance, and the doors into Studio.

        Deliberately *not* a row of counts: the filter tabs below already show
        Notes / Uploads / Published, and repeating them here would be the same
        redundancy that made the Spaces hero and the Home streak chip worth
        cutting. These cells each say something the list cannot —

          • the latest note, in full, because Doc 2 rule 5 makes Notes the one
            Library item that is read and written *here* rather than being a
            pointer into a Space;
          • what is waiting on you in uploads and drafts;
          • how your published work landed.

        The last three are also the doors into the Studio screens. Library
        itself stays Learn — calm and browsable — and the dense work opens
        *from* here as its own screen.
      */}
      <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {latestNote && (
          <BentoCell icon={NotebookPen} label="Your latest note" className="sm:col-span-2">
            <p className="line-clamp-3 text-[14.5px] leading-relaxed text-foreground">
              {latestNote.body}
            </p>
            <p className="mt-3 text-[12.5px] text-faint">
              {latestNote.lessonTitle} · {latestNote.spaceName}
            </p>
          </BentoCell>
        )}

        <BentoCell icon={Upload} label="Manage uploads" onClick={() => navigate('/v4/library/uploads')}>
          <p className="text-[28px] font-semibold leading-none tabular-nums">
            {uploadCount}
          </p>
          <p
            className={cn(
              'mt-2 text-[13px]',
              pending.length > 0 ? 'text-primary' : 'text-quiet',
            )}
          >
            {pending.length > 0
              ? `${pending.length} still being prepared`
              : 'All ready'}
          </p>
        </BentoCell>

        <BentoCell icon={FileText} label="Your drafts" onClick={() => navigate('/v4/library/drafts')}>
          <p className="text-[28px] font-semibold leading-none tabular-nums">
            {pending.length}
          </p>
          <p className="mt-2 text-[13px] text-quiet">Across every Space</p>
        </BentoCell>

        <BentoCell
          icon={Sparkles}
          label="How your work landed"
          className="sm:col-span-2"
          onClick={() => navigate('/v4/library/impact')}
        >
          <p className="text-[28px] font-semibold leading-none tabular-nums">
            {likesReceived}
            <span className="ml-2 text-[16px] text-quiet">
              {likesReceived === 1 ? 'like' : 'likes'}
            </span>
          </p>
          <p className="mt-2 text-[13px] text-quiet">
            {endorsedCount > 0
              ? `${endorsedCount} endorsed by an Owner`
              : 'Across everything you have published'}
          </p>
        </BentoCell>
      </div>

      <div role="tablist" aria-label="Filter" className="mt-8 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? items.length : items.filter((i) => i.kind === f.key).length;
          return (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'console-focusable h-9 rounded-full px-4 text-[13.5px] font-medium transition-colors',
                filter === f.key
                  ? 'bg-white/[0.10] text-foreground'
                  : 'text-quiet hover:bg-white/[0.05] hover:text-foreground',
              )}
            >
              {f.label}
              <span className="ml-1.5 tabular-nums text-faint">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Writing a new note. Unanchored: it is yours and belongs to no Lesson
          until you put it in one. */}
      {composing && (
        <div className="mt-6">
          <NoteEditor
            autoOpen
            placeholder="Write it down while it is fresh…"
            onSave={(body) => {
              addNote({ lessonId: '', body, spaceName: 'No Space yet' });
              setComposing(false);
              setWriteTick((n) => n + 1);
            }}
          />
        </div>
      )}

      {shown.length === 0 && !composing ? (
        <EmptyLibrary filter={filter} onWriteNote={() => setComposing(true)} />
      ) : (
        <ul className="mt-6 space-y-2.5">
          {shown.map((item) => (
            <li key={item.id}>
              {/* Doc 2 rule 5: everything here is a pointer into its Space —
                  except Notes, which are read *and written* in Library. */}
              {item.kind === 'note' ? (
                <NoteEditor
                  value={noteBodies[item.id] ?? item.title}
                  onSave={(body) => {
                    const id = item.id.replace(/^lib-note-/, '');
                    updateNote(id, body);
                    setNoteBodies((m) => ({ ...m, [item.id]: body }));
                  }}
                />
              ) : (
                <LibraryRow item={item} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>,
  );
}

function LibraryRow({ item }: { item: LibraryItem }) {
  const Icon = KIND_ICON[item.kind];
  // Notes open here; everything else is a pointer into its Space.

  return (
    <article
      className={cn(
        'group relative flex items-start gap-4 rounded-2xl border px-5 py-4 transition-colors',
        item.orphaned
          ? 'border-warning/25 bg-warning/[0.04]'
          : 'border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.05]',
      )}
    >
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-quiet">
        <Icon aria-hidden className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-quiet">
            {KIND_LABEL[item.kind]}
          </span>
          {item.endorsed && <EndorsedBadge />}
          {item.pending && (
            <span className="rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-quiet">
              Not published yet
            </span>
          )}
        </div>

        <h3 className="mt-2 line-clamp-2 text-[15.5px] font-semibold leading-relaxed text-foreground">
          {item.title}
        </h3>

        {/* Context, never a Space card — this names where it lives. */}
        <p className="mt-1.5 text-[13.5px] text-quiet">
          {item.lessonTitle ? `${item.lessonTitle} · ` : ''}
          {item.spaceName}
          <span className="text-faint"> · {formatWhen(item.updatedAt)}</span>
          {item.sizeBytes !== undefined && (
            <span className="text-faint"> · {formatSize(item.sizeBytes)}</span>
          )}
        </p>

        {item.orphaned && (
          <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-quiet">
            <Unlink aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            The Lesson this was attached to was removed. Your work is safe — pick a new
            place for it.
          </p>
        )}
      </div>

      {/* Library doubles as your creator record: how the work landed. */}
      {item.likeCount !== undefined && (
        <span className="flex shrink-0 items-center gap-1.5 self-center text-[13.5px] font-medium text-quiet tabular-nums">
          <Heart aria-hidden className="h-3.5 w-3.5" />
          {item.likeCount}
        </span>
      )}

      {/*
        Notes open in place; everything else opens the object in its Space.
        This was a full-card target with an aria-label promising
        "Open … in Database Systems" and no destination of any kind — the
        `href` its own type comment described did not exist on the type.
      */}
      {item.href && (
        <Link
          to={item.href}
          className="console-focusable absolute inset-0 rounded-2xl"
          aria-label={`Open ${KIND_LABEL[item.kind].toLowerCase()} “${item.title}” in ${item.spaceName}`}
        >
          <span className="sr-only">Open</span>
        </Link>
      )}
    </article>
  );
}

/**
 * The likely state for a new member for weeks, so it carries an invitation to
 * write a first note — not an error, and not a shrug.
 */
function EmptyLibrary({ filter, onWriteNote }: { filter: Filter; onWriteNote: () => void }) {
  const copy: Record<Filter, { title: string; body: string; cta: string }> = {
    all: {
      title: 'Nothing here yet',
      body: 'Anything you write, upload or publish shows up here — gathered from every Space you’re in.',
      cta: 'Write your first note',
    },
    note: {
      title: 'No notes yet',
      body: 'Notes are private. Write one while you read and it will be waiting here, next to every other note you’ve made.',
      cta: 'Write a note',
    },
    material: {
      title: 'Nothing uploaded yet',
      body: 'Upload material inside a Space and a Lesson builds itself from it. The file stays yours, and it lists here.',
      cta: 'Go to your Spaces',
    },
    contribution: {
      title: 'Nothing published yet',
      body: 'Share a summary, a worked example or a set of practice questions with a Space. Whatever you publish lands here, with how it landed.',
      cta: 'Go to your Spaces',
    },
  };
  const { title, body, cta } = copy[filter];

  return (
    <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
      <NotebookPen aria-hidden className="mx-auto mb-4 h-6 w-6 text-quiet" />
      <p className="mb-2 text-[17px] font-semibold">{title}</p>
      <p className="mx-auto mb-7 max-w-[48ch] text-[14.5px] leading-relaxed text-quiet">{body}</p>
      {/* The only control in this state; it used to do nothing. Notes are
          written here, so that one calls back; the rest send you to Spaces,
          because you cannot upload or publish from Library. */}
      {filter === 'note' || filter === 'all' ? (
        <button
          type="button"
          onClick={onWriteNote}
          className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-slate-900 transition-transform hover:scale-[1.03]"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {cta}
        </button>
      ) : (
        <Link
          to="/v4/spaces"
          className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-slate-900 transition-transform hover:scale-[1.03]"
        >
          {cta}
        </Link>
      )}
    </div>
  );
}
