import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderInput, Plus, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LibraryItem } from '../types';
import type { ShelfItem, WordEntry } from '../studio/shelf';
import { NoteEditor } from '../components/NoteEditor';
import { Pressable } from '../components/Pressable';
import { ReanchorDialog } from '../components/ReanchorDialog';
import { whitePillSm } from '../components/stage';
import { addNote, updateNote } from '../mocks/notes';
import { myContributionById } from '../mocks/library';

/**
 * Your words (spec §3.3, §5.7): every note and every answer, newest first,
 * each still attached to its page. Notes are read *and written* here (Doc 2
 * rule 5), so they keep their editor and "New note". Contributions whose
 * Lesson was removed wait under "Needs a new home" with their re-anchor.
 */

const KIND_LABEL: Record<WordEntry['kind'], string> = {
  note: 'Note',
  written: 'Note',
  answer: 'Answer',
};

/** Markdown read as plain lines: the row is a glimpse, the page has the rest. */
const plain = (md: string) =>
  md
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function YourWords({
  words,
  items,
  orphans,
  onMoved,
}: {
  words: WordEntry[];
  items: ShelfItem[];
  /** Your contributions whose Lesson was removed. */
  orphans: LibraryItem[];
  /** After a re-anchor: the store changed outside React, so the screen re-reads. */
  onMoved: () => void;
}) {
  /** Writing a new note. Unanchored: it belongs to no Lesson until you put it in one. */
  const [composing, setComposing] = useState(false);
  /** The orphan being re-filed, if the dialog is open. */
  const [reanchoring, setReanchoring] = useState<LibraryItem | null>(null);
  const filename = (id: string | null) => items.find((i) => i.id === id)?.filename ?? 'Your page';

  return (
    <section aria-labelledby="your-words" className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="your-words" className="text-[24px] font-medium tracking-[-0.02em]">
            Your words
          </h2>
          <p className="mt-1 text-[13.5px] text-quiet">
            Every note and every answer you asked for, each one still attached to its page.
          </p>
        </div>
        <Pressable
          type="button"
          onClick={() => setComposing(true)}
          disabled={composing}
          className={cn(whitePillSm, 'shrink-0')}
        >
          <Plus aria-hidden className="h-4 w-4" />
          New note
        </Pressable>
      </div>

      {composing && (
        <div className="mt-6">
          <NoteEditor
            autoOpen
            placeholder="Write it down while it is fresh…"
            onSave={(body) => {
              addNote({ lessonId: '', body });
              setComposing(false);
            }}
          />
        </div>
      )}

      {words.length === 0 && !composing ? (
        <p className="mt-8 text-[14px] text-quiet">
          Nothing written yet. Notes you write and answers you ask for gather here.
        </p>
      ) : (
        <ul className="mt-6 space-y-5">
          {words.map((w) => {
            const place = w.kind === 'note' ? w.title : filename(w.itemId);
            return (
              <li
                key={`${w.kind}-${w.id}`}
                className={cn(
                  'border-l-2 py-1 pl-4',
                  w.kind === 'answer' ? 'border-[rgb(159,211,199)]' : 'border-indigo-400/40',
                )}
              >
                <p className="text-[12px] text-faint">
                  {KIND_LABEL[w.kind]} ·{' '}
                  {w.href ? (
                    <Link
                      to={w.href}
                      className="console-focusable rounded text-quiet underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {place || 'its Lesson'}
                    </Link>
                  ) : (
                    'Not filed in a Space yet'
                  )}
                  {w.page !== null && ` · page ${w.page}`}
                </p>
                {w.kind === 'answer' && (
                  <p className="mt-1 text-[14.5px] font-medium text-foreground">{w.title}</p>
                )}
                {w.kind === 'note' ? (
                  <div className="mt-1.5">
                    <NoteEditor value={w.body} onSave={(body) => updateNote(w.id, body)} />
                  </div>
                ) : (
                  <p className="mt-1 line-clamp-3 text-[14.5px] leading-relaxed text-quiet">{plain(w.body)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {orphans.length > 0 && (
        <section aria-labelledby="needs-a-home" className="mt-14">
          <h3 id="needs-a-home" className="text-[17px] font-medium">
            Needs a new home
          </h3>
          <ul className="mt-4 space-y-3">
            {orphans.map((o) => (
              <li key={o.id}>
                <article className="rounded-2xl border border-warning/25 bg-warning/[0.04] px-5 py-4">
                  <p className="text-[15px] font-medium text-foreground">{o.title}</p>
                  {o.spaceName && <p className="mt-0.5 text-[13px] text-quiet">{o.spaceName}</p>}
                  <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-quiet">
                    <Unlink aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    The Lesson this was attached to was removed. Your work is safe, and it keeps
                    its likes — but it has nowhere to open until it is given a new home.
                  </p>
                  <Pressable
                    type="button"
                    onClick={() => setReanchoring(o)}
                    className="console-focusable mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.10] px-4 text-[13px] font-semibold text-foreground hover:bg-white/[0.16]"
                  >
                    <FolderInput aria-hidden className="h-3.5 w-3.5" />
                    Find it a new home
                  </Pressable>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Given the real contribution, not its Library projection: the dialog
        needs `orphaned` to refuse a move it should not make. Library lists only
        your own work, so the author branch of `canReanchor` authorises this;
        the Space's role is not known here and is not guessed (`null`).
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
              viewerRole={null}
              open
              onOpenChange={(v) => !v && setReanchoring(null)}
              onMoved={() => {
                setReanchoring(null);
                onMoved();
              }}
            />
          );
        })()}
    </section>
  );
}
