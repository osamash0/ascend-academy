import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Eye, EyeOff, Loader2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ghostPill, ghostPillSm, whitePill } from '../stage';
import { loadLiveRepository } from '../../data/liveRepository';
import { addLessons, dismissPending, usePendingLessons } from '../../data/lessonUploads';
import { useRefreshWorld } from '../../data/viewer';
import { managerHref } from '../../data/world';

/** What the batch upload takes: PDFs, and slides it converts to PDF first. */
const ACCEPT = '.pdf,.ppt,.pptx,application/pdf';

/**
 * The owner's controls for their own Space, on the stage (LS-072).
 *
 * Three things an owner needs here and nowhere else: add Lessons, decide
 * who sees the Space, and a way to the course manager for everything rarer
 * (rename, reorder, remove, analytics). One white action — Add a Lesson
 * while the Space is empty, otherwise the quiet pill; the rest stay quiet.
 */
export function OwnerBar({
  spaceId,
  published,
  lessonCount,
}: {
  spaceId: string;
  published: boolean;
  lessonCount: number;
}) {
  const { t } = useTranslation('v4Space');
  const refreshWorld = useRefreshWorld();
  const pending = usePendingLessons(spaceId);
  const picker = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [failed, setFailed] = useState<null | 'upload' | 'publish'>(null);

  const empty = lessonCount === 0;
  const preparing = pending.filter((p) => p.state === 'preparing');

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setSending(true);
    setFailed(null);
    try {
      await addLessons(spaceId, Array.from(files), () => void refreshWorld());
    } catch {
      setFailed('upload');
    } finally {
      setSending(false);
      if (picker.current) picker.current.value = '';
    }
  };

  const toggle = async () => {
    setToggling(true);
    setFailed(null);
    try {
      await (await loadLiveRepository()).setSpacePublished(spaceId, !published);
      await refreshWorld();
    } catch {
      setFailed('publish');
      setToggling(false);
    }
  };

  return (
    <section aria-label={t('course.owner.label')} className="mx-auto mt-8 max-w-xl text-center">
      <p className="text-[13.5px] text-quiet">
        {published ? (empty ? t('course.owner.publishedEmpty') : t('course.owner.published')) : t('course.owner.draft')}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <input
          ref={picker}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void send(e.target.files)}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={sending}
          className={empty ? whitePill : ghostPill}
        >
          {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
          {sending ? t('course.owner.sending') : t('course.owner.add')}
        </button>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={toggling || (!published && empty)}
          aria-describedby={!published && empty ? `${spaceId}-publish-hint` : undefined}
          className={cn(ghostPill, 'disabled:pointer-events-none disabled:opacity-40')}
        >
          {published ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
          {published ? t('course.owner.makePrivate') : t('course.owner.makeVisible')}
        </button>
      </div>
      {!published && empty && (
        <p id={`${spaceId}-publish-hint`} className="mt-3 text-[12.5px] text-faint">
          {t('course.owner.publishHint')}
        </p>
      )}

      {pending.length > 0 && (
        <ul aria-live="polite" className="mx-auto mt-6 max-w-md space-y-2 text-left">
          {pending.map((p) => (
            <li
              key={p.key}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[13.5px]"
            >
              {p.state === 'preparing' ? (
                <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin text-quiet" />
              ) : (
                <X aria-hidden className="h-4 w-4 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.filename}</span>
                <span className="block text-[12.5px] text-quiet">
                  {p.state === 'preparing' ? t('course.owner.preparing') : t('course.owner.fileFailed')}
                </span>
              </span>
              {p.state === 'failed' && (
                <button
                  type="button"
                  onClick={() => dismissPending(spaceId, p.key)}
                  aria-label={t('course.owner.dismiss', { name: p.filename })}
                  className="console-focusable grid h-8 w-8 place-items-center rounded-full text-quiet hover:text-foreground"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {preparing.length > 0 && <p className="mt-3 text-[12.5px] text-faint">{t('course.owner.preparingHint')}</p>}

      {failed && (
        <p role="alert" className="mt-4 text-[13px] text-destructive">
          {failed === 'upload' ? t('course.owner.uploadFailed') : t('course.owner.publishFailed')}
        </p>
      )}

      <a href={managerHref(spaceId)} className={cn(ghostPillSm, 'mt-6 border-transparent bg-transparent')}>
        {t('course.owner.manager')}
        <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
      </a>
    </section>
  );
}
