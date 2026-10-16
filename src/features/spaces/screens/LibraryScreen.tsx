import { useMemo, useReducer, useState } from 'react';
import {
  FileText,
  FolderInput,
  Heart,
  NotebookPen,
  Plus,
  Sparkles,
  Unlink,
  Upload,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatMegabytes, formatTimestamp } from '../i18n/format';
import { EnterList, EnterListItem } from '../components/Enter';
import { cn } from '@/lib/utils';
import { Pressable, PressableLink } from '../components/Pressable';
import type { LibraryItem, LibraryKind } from '../types';
import { useLibrary } from '../data/useSpaces';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { NoteEditor } from '../components/NoteEditor';
import { addNote, updateNote } from '../mocks/notes';
import { myContributionById } from '../mocks/library';
import { ReanchorDialog } from '../components/ReanchorDialog';
import { Masthead, Skylight, ghostPillSm } from '../components/stage';
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

/* Labels live in the translations, at `library.filter.<key>`. */
const FILTERS: Filter[] = ['all', 'note', 'material', 'contribution'];

const KIND_ICON = {
  note: NotebookPen,
  material: Upload,
  contribution: Sparkles,
} as const;

/* A translate function bound to v4Library. */
type Say = (key: string, params?: Record<string, string | number>) => string;

const formatSize = (t: Say, bytes?: number) => (bytes === undefined ? null : t('library.size', { size: formatMegabytes(bytes) }));

/**
 * Where a note lives, or an honest admission that it does not live anywhere.
 *
 * A note written in Library belongs to no Lesson until you put it in one, so
 * both anchor fields are empty. Interpolating them regardless produced
 * "Unknown Lesson · No Space yet" — two invented strings joined by a separator
 * for a note that had simply not been filed.
 */
const noteContext = (t: Say, lessonTitle?: string, spaceName?: string) => {
  const parts = [lessonTitle, spaceName].filter((p) => p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(' · ') : t('library.unfiled');
};


const LIBRARY_ACCENT = null;

export default function LibraryScreen() {
  const { t } = useTranslation('v4Library');
  /** Bodies edited this session, so the row shows the edit immediately. */
  const [noteBodies, setNoteBodies] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('all');
  /*
   * Library could edit a note but never write one — the empty state's only
   * control was inert, so the surface Doc 2 calls "read and written in Library
   * directly" could only be read.
   */
  const [composing, setComposing] = useState(false);
  /** The orphan being re-filed, if the dialog is open. */
  const [reanchoring, setReanchoring] = useState<LibraryItem | null>(null);
  /*
   * A re-anchor mutates a store outside React, and `useLibrary` recomputes on
   * render — so the list needs a nudge to re-read it. `useReducer` rather than
   * a counter in `useState`: the value is never read, and an unread `useState`
   * pair is the dead `writeTick` that was just removed from this file.
   */
  const [, reread] = useReducer((n: number) => n + 1, 0);
  const { state, items, pending } = useLibrary();


  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

  /*
   * The empty state already invites you to write, on the two filters where
   * writing is the answer — so the toolbar action would be the same button
   * twice, 270px apart. On Uploads and Published the empty state sends you to
   * your Spaces instead, which is a different action, so the toolbar keeps its
   * own.
   */
  const emptyAlreadyOffersNote =
    shown.length === 0 && !composing && (filter === 'note' || filter === 'all');

  // Library stands on the stage. It has no subject of its own, so its light
  // is the brand's — neutral white — never a colour (monochrome brand).
  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.library} status="progress" motionKey="library" accent={LIBRARY_ACCENT}>
      <SpacesTopBar active="library" viewer={viewer} />
      <div className="relative">
        <Skylight accent={LIBRARY_ACCENT} />
        {body}
      </div>
    </Scene>
  );

  if (state === 'loading') return chrome(<SpacesSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="library" />);

  return chrome(
    <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-10 lg:px-8">
      <header>
        <Masthead
          title={t('library.title')}
          lede={t('library.lede')}
        />
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
      {/*
        The doors into Studio, as doors. This was a bento whose cells repeated
        the list beneath it — the latest note is the list's first row, the
        upload count is the Uploads filter (Abi, 2026-10-10: one fact, once).
        What only these said was *where the dense work opens*, so that is all
        that is left; a dot marks the one with something waiting.
      */}
      <nav aria-label={t('library.studio.label')} className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <Link to="/v4/library/uploads" className={ghostPillSm}>
          <Upload aria-hidden className="h-3.5 w-3.5" />
          {t('library.studio.uploads')}
          {pending.length > 0 && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-white" aria-label={t('library.studio.pending', { count: pending.length })} />
          )}
        </Link>
        <Link to="/v4/library/drafts" className={ghostPillSm}>
          <FileText aria-hidden className="h-3.5 w-3.5" />
          {t('library.studio.drafts')}
        </Link>
        <Link to="/v4/library/impact" className={ghostPillSm}>
          <Sparkles aria-hidden className="h-3.5 w-3.5" />
          {t('library.studio.impact')}
        </Link>
      </nav>

      {/*
        Filters, and the one action this screen owns.

        "New note" used to exist only inside the empty state, so it disappeared
        the moment you had a single note — and Library is the surface Doc 2
        rule 5 says notes are *written* in. Writing your second note meant
        opening a Lesson to do it.

        Beside the filters rather than in the header, because this is where the
        list begins and the note appears at the top of it. Same `h-9` white
        pill as SpaceScreen's "Add Lesson"; the empty state keeps the larger
        `h-11` form, which is that screen's precedent too.
      */}
      <h2 className="mt-20 text-[26px] font-medium tracking-[-0.02em]">{t('library.heading')}</h2>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label={t('library.filter.label')} className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((key) => {
          const count = key === 'all' ? items.length : items.filter((i) => i.kind === key).length;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'console-focusable h-9 rounded-full px-4 text-[13.5px] font-medium transition-colors',
                filter === key
                  ? 'bg-white/[0.10] text-foreground'
                  : 'text-quiet hover:bg-white/[0.05] hover:text-foreground',
              )}
            >
              {t(`library.filter.${key}`)}
              <span className="ml-1.5 tabular-nums text-faint">{count}</span>
            </button>
          );
        })}
      </div>

        {!emptyAlreadyOffersNote && (
        <Pressable
          type="button"
          onClick={() => setComposing(true)}
          disabled={composing}
          className="console-focusable inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-slate-900"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {t('library.newNote')}
        </Pressable>
        )}
      </div>

      {/* Writing a new note. Unanchored: it is yours and belongs to no Lesson
          until you put it in one. */}
      {composing && (
        <div className="mt-6">
          <NoteEditor
            autoOpen
            onSave={(body) => {
              addNote({ lessonId: '', body });
              setComposing(false);
            }}
          />
        </div>
      )}

      {shown.length === 0 && !composing ? (
        <EmptyLibrary filter={filter} onWriteNote={() => setComposing(true)} />
      ) : (
        <EnterList whenVisible className="mt-6 space-y-2.5">
          {shown.map((item) => (
            <EnterListItem key={item.id} id={`item-${item.id}`}>
              {/* Doc 2 rule 5: everything here is a pointer into its Space —
                  except Notes, which are read *and written* in Library. */}
              {item.kind === 'note' ? (
                <div>
                  <NoteEditor
                    value={noteBodies[item.id] ?? item.body}
                    onSave={(body) => {
                      const id = item.id.replace(/^lib-note-/, '');
                      updateNote(id, body);
                      setNoteBodies((m) => ({ ...m, [item.id]: body }));
                    }}
                  />
                  {/* Where it is filed — said here, on the note, now that the
                      "latest note" cell that used to say it is gone. */}
                  <p className="mt-1.5 px-1 text-[12.5px] text-faint">
                    {noteContext(t, item.lessonTitle, item.spaceName ?? undefined)}
                  </p>
                </div>
              ) : (
                <LibraryRow item={item} onReanchor={() => setReanchoring(item)} />
              )}
            </EnterListItem>
          ))}
        </EnterList>
      )}

      {/*
        Mounted from the id on the row. A Library item is a projection of a
        contribution, not the contribution itself, so the dialog is given the
        real one — it needs `orphaned` to refuse a move it should not make.
      */}
      {reanchoring &&
        (() => {
          const c = myContributionById(reanchoring.id.replace(/^lib-con-/, ''));
          if (!c) return null;
          return (
            <ReanchorDialog
              contribution={c}
              spaceId={reanchoring.spaceId}
              spaceName={reanchoring.spaceName}
              /*
               * Library only ever lists your own work, so the author branch of
               * `canReanchor` is what authorises this. The Space's role is not
               * known on this screen and must not be guessed at — passing
               * `null` says exactly that.
               */
              viewerRole={null}
              open
              onOpenChange={(v) => !v && setReanchoring(null)}
              onMoved={() => {
                setReanchoring(null);
                reread();
              }}
            />
          );
        })()}
    </div>,
  );
}

function LibraryRow({
  item,
  onReanchor,
}: {
  item: LibraryItem;
  /** Only offered on an orphan, and only for your own contributions. */
  onReanchor?: () => void;
}) {
  const { t } = useTranslation('v4Library');
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
            {t(`library.kind.${item.kind}`)}
          </span>
          {item.endorsed && <EndorsedBadge />}
          {item.pending && (
            <span className="rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-quiet">
              {t('library.notPublished')}
            </span>
          )}
        </div>

        <h3 className="mt-2 line-clamp-2 text-[15.5px] font-semibold leading-relaxed text-foreground">
          {item.title}
        </h3>

        {/* Context, never a Space card — this names where it lives. */}
        {/*
          Built from the parts that exist rather than concatenated blindly. An
          orphan has no Space to name, and the previous form left its separator
          behind — a row opening "· 12 Mar", punctuation for a word that is not
          there.
        */}
        <p className="mt-1.5 text-[13.5px] text-quiet">
          {[item.lessonTitle, item.spaceName].filter(Boolean).join(' · ')}
          <span className="text-faint">
            {[item.lessonTitle, item.spaceName].some(Boolean) ? ' · ' : ''}
            {formatTimestamp(item.updatedAt)}
          </span>
          {item.sizeBytes !== undefined && (
            <span className="text-faint"> · {formatSize(t, item.sizeBytes)}</span>
          )}
        </p>

        {item.orphaned && (
          <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-quiet">
            <Unlink aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            {/*
              Main's wording, kept over mine. I had written it to avoid
              instructing an action that did not exist — there was no control
              anywhere that gave an orphan a new home, so "pick a new place for
              it" failed `deadends.test.tsx`'s rule with no control to point
              at. That is no longer true: the button directly below this does
              exactly what the sentence describes, so the sentence can say so.
            */}
            {t('library.orphan.body')}
          </p>
        )}

        {/*
          `relative z-10`, because the row is covered by an `absolute inset-0`
          link and anything below it is unclickable. This is the same trap the
          Studio rows hit from the other side, where a title link would have
          swallowed the checkbox — an overlay makes every later control a
          layering question.
        */}
        {item.orphaned && onReanchor && (
          <Pressable
            type="button"
            onClick={onReanchor}
            className="console-focusable relative z-10 mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.10] px-4 text-[13px] font-semibold text-foreground hover:bg-white/[0.16]"
          >
            <FolderInput aria-hidden className="h-3.5 w-3.5" />
            {t('library.orphan.rehome')}
          </Pressable>
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
          aria-label={
            item.spaceName
              ? t(`library.open.${item.kind}.inSpace`, { title: item.title, space: item.spaceName })
              : t(`library.open.${item.kind}.plain`, { title: item.title })
          }
        >
          <span className="sr-only">{t('library.open.label')}</span>
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
  const { t } = useTranslation('v4Library');
  const title = t(`library.empty.${filter}.title`);
  const body = t(`library.empty.${filter}.body`);
  const cta =
    filter === 'all'
      ? t('library.empty.all.cta')
      : filter === 'note'
        ? t('v4Spaces:notes.write')
        : t('library.empty.toSpaces');

  return (
    <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
      <NotebookPen aria-hidden className="mx-auto mb-4 h-6 w-6 text-quiet" />
      <p className="mb-2 text-[17px] font-semibold">{title}</p>
      <p className="mx-auto mb-7 max-w-[48ch] text-[14.5px] leading-relaxed text-quiet">{body}</p>
      {/* The only control in this state; it used to do nothing. Notes are
          written here, so that one calls back; the rest send you to Spaces,
          because you cannot upload or publish from Library. */}
      {filter === 'note' || filter === 'all' ? (
        <Pressable
          type="button"
          onClick={onWriteNote}
          className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-slate-900"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {cta}
        </Pressable>
      ) : (
        <PressableLink
          to="/v4/spaces"
          className="console-focusable inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-slate-900"
        >
          {cta}
        </PressableLink>
      )}
    </div>
  );
}
