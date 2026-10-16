import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  Compass,
  FileText,
  Heart,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { formatMegabytes, formatTimestamp } from '../i18n/format';
import { cn } from '@/lib/utils';
import { draftsAcrossSpaces, impactRows, uploadRows } from '../mocks/library';
import { StudioAction, StudioPill, StudioShell } from '../components/StudioShell';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { useScreenState } from '../data/useSpaces';

/**
 * Library's Studio screens.
 *
 * Doc 2, Learn/Studio rule 6: "Studio screens hang off Library; Library itself
 * stays Learn. Dense work opens *from* it as its own screen: manage uploads,
 * review your drafts across every Space, see how your contributions landed.
 * One destination, two kinds of screen, never mixed."
 *
 * All three are author-filtered exactly like Library — the difference is mode,
 * not scope. Each is dense on purpose: multi-select, batch actions in the
 * sticky toolbar, secondary controls visible rather than tucked away.
 *
 * This is also the cross-Space creator dashboard parked in
 * `notes-spaces-screen.md` item 8.
 */

type View = 'uploads' | 'drafts' | 'impact';

/**
 * The three views, and the only three.
 *
 * `:view` used to be read straight off the URL and fall through to the impact
 * screen, so `/v4/library/anything` rendered "How your work landed" — title,
 * real counts, real rows. Not an error page: a *plausible* one, for a screen
 * you never asked for. The same mistake `NotFound` was added for, one step
 * further along, because here there was nothing to notice.
 *
 * A table rather than three ternaries. The loading branch had its own copy of
 * the title logic and defaulted an unknown view to "Manage uploads", so the
 * skeleton was already mislabelling the screen it was standing in for.
 */
const VIEWS = {
  uploads: { title: 'studio.views.uploads', icon: Upload },
  drafts: { title: 'studio.views.drafts', icon: FileText },
  impact: { title: 'studio.views.impact', icon: Sparkles },
} as const;

const isView = (v: string | undefined): v is View => v !== undefined && v in VIEWS;

/* A translate function bound to v4Library. */
type Say = (key: string, params?: Record<string, string | number>) => string;

const formatSize = (t: Say, b?: number) => (b === undefined ? '—' : t('studio.size', { mb: formatMegabytes(b) }));

/**
 * A row's title, linked to the object it names.
 *
 * The drafts view listed rows reading "Needs review" with nothing to click:
 * the screen told you work was waiting and gave you no way to reach it. Uploads
 * were the same, and worse — a `href` to the Lesson was already computed on
 * every material item and simply never used.
 *
 * The **title** is the link, not the row. A row-filling overlay is what Library
 * uses for its cards, but here the row already owns a checkbox, and an
 * `absolute inset-0` anchor would swallow every click meant for it. Selection
 * stays the row's job; opening is the title's.
 */
function RowTitle({ to, children, label }: { to?: string; children: string; label: string }) {
  if (!to) return <p className="truncate text-sm font-semibold text-foreground">{children}</p>;
  return (
    <Link
      to={to}
      aria-label={label}
      className="console-focusable block truncate rounded text-sm font-semibold text-foreground hover:underline"
    >
      {children}
    </Link>
  );
}

/** Dense list row shared by all three views. */
function Row({
  selected,
  onToggle,
  /**
   * Hold the checkbox's place on a row that has none.
   *
   * In a list where *some* rows can be selected, omitting the control shifts
   * everything after it left by its width — so the drafts view's order numbers
   * sat at two different x positions depending on whether the row happened to
   * be publishable. Dense lists are read down the column.
   *
   * Not automatic: the impact view has no selection on any row, and reserving
   * a gutter there would indent every row for a control that does not exist.
   */
  reserveToggle,
  children,
}: {
  selected?: boolean;
  onToggle?: () => void;
  reserveToggle?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('v4Library');
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors',
        selected
          ? 'border-primary/40 bg-primary/[0.07]'
          : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]',
      )}
    >
      {/*
        The box is 16px, which fails the 24×24 minimum. Padding the label
        around it gives a 24px target without making the control look
        oversized next to a dense row — the visual size and the hit size are
        allowed to differ, and only one of them is the accessibility rule.
      */}
      {onToggle ? (
        <label className="-m-1 flex shrink-0 cursor-pointer p-1">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggle}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
          <span className="sr-only">{t('studio.selectRow')}</span>
        </label>
      ) : reserveToggle ? (
        /* Same 16px the label nets to — its p-1 and -m-1 cancel out. */
        <span aria-hidden className="h-4 w-4 shrink-0" />
      ) : null}
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Upload; title: string; body: string }) {
  return (
    <div className="depth-card flex flex-col items-center gap-3 p-12 text-center">
      <Icon aria-hidden className="h-9 w-9 text-muted-foreground/50" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-[46ch] text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export default function LibraryStudioScreen() {
  const { t } = useTranslation('v4Library');
  const screenState = useScreenState();
  const { view } = useParams<{ view: View }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /**
   * Rows removed this session. Undo restores them, so nothing destructive is
   * one click from permanent — the same reason delete-a-Space demands the name
   * typed out. Kept as ids rather than filtering the source, so Undo is a
   * deletion from this set rather than a re-insert that would lose the order.
   */
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  /** Remove now, offer it back. */
  const removeRows = (ids: string[], verb: 'published' | 'deleted', describe: string) => {
    setRemoved((prev) => new Set([...prev, ...ids]));
    setSelected(new Set());
    toast(t(`studio.toast.${verb}`, { count: ids.length }), {
      description: describe,
      action: {
        label: t('studio.undo'),
        onClick: () =>
          setRemoved((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.delete(id);
            return next;
          }),
      },
    });
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const uploads = useMemo(() => uploadRows().filter((u) => !removed.has(u.id)), [removed]);
  const drafts = useMemo(
    () => draftsAcrossSpaces().filter((d) => !removed.has(d.lessonId)),
    [removed],
  );
  const impact = useMemo(() => impactRows(), []);

  /*
   * Checked before the load states, not after: a skeleton for a screen that
   * does not exist is still a promise that it does.
   */
  if (!isView(view)) {
    return (
      /*
       * The subtitle names the three real screens rather than repeating the
       * message. `NotFound` already says "That screen isn’t here", and having
       * the shell say it too printed the same sentence twice, one above the
       * other. Listing what does exist is the useful thing to say to someone
       * who has just mistyped one of them.
       */
      <StudioShell
        icon={Compass}
        title={t('v4Spaces:nav.library')}
        subtitle={Object.values(VIEWS)
          .map((v) => t(v.title))
          .join(' · ')}
      >
        <NotFound what="screen" back={{ to: '/v4/library', place: 'library' }} />
      </StudioShell>
    );
  }

  // Studio screens read fixtures synchronously and so had no loading or error
  // state at all — `?mock=` did nothing here. The shell is the chrome, so the
  // states render inside it rather than replacing it.
  if (screenState === 'loading' || screenState === 'error') {
    return (
      <StudioShell
        icon={VIEWS[view].icon}
        title={t(VIEWS[view].title)}
        subtitle={screenState === 'error' ? t('studio.failed') : t('studio.loading')}
      >
        {screenState === 'error' ? <SpacesError what="work" /> : <ListSkeleton />}
      </StudioShell>
    );
  }

  /* ── Manage uploads ── */
  if (view === 'uploads') {
    return (
      <StudioShell
        icon={Upload}
        title={t('studio.views.uploads')}
        subtitle={t('studio.uploads.subtitle', { count: uploads.length })}
        actions={
          <>
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {t('studio.selected', { count: selected.size })}
            </span>
            <StudioAction
              disabled={selected.size === 0}
              tone="emerald"
              onClick={() =>
                removeRows([...selected], 'published', t('studio.uploads.published'))
              }
            >
              <Send aria-hidden className="h-4 w-4" />
              {t('studio.publish')}
            </StudioAction>
            <StudioAction
              disabled={selected.size === 0}
              onClick={() =>
                removeRows([...selected], 'deleted', t('studio.uploads.deleted'))
              }
            >
              <Trash2 aria-hidden className="h-4 w-4" />
              {t('studio.delete')}
            </StudioAction>
          </>
        }
      >
        <p className="mb-5 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          {t('studio.uploads.intro')}
        </p>

        {uploads.length === 0 ? (
          <EmptyState
            icon={Upload}
            title={t('studio.uploads.emptyTitle')}
            body={t('studio.uploads.emptyBody')}
          />
        ) : (
          <div className="space-y-2">
            {uploads.map((u) => (
              <Row key={u.id} selected={selected.has(u.id)} onToggle={() => toggle(u.id)}>
                <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <RowTitle
                    to={u.href ?? undefined}
                    label={t('studio.open', { title: u.title, space: u.spaceName })}
                  >
                    {u.title}
                  </RowTitle>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.lessonTitle ? `${u.lessonTitle} · ` : ''}
                    {u.spaceName}
                  </p>
                </div>
                <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                  {formatSize(t, u.sizeBytes)}
                </span>
                <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums md:block">
                  {formatTimestamp(u.updatedAt, true)}
                </span>
                <div className="w-24 shrink-0 text-right">
                  {u.pending ? (
                    <StudioPill tone="processing">
                      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> {t('studio.uploads.working')}
                    </StudioPill>
                  ) : (
                    <StudioPill tone="ready">
                      <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> {t('studio.uploads.ready')}
                    </StudioPill>
                  )}
                </div>
              </Row>
            ))}
          </div>
        )}
      </StudioShell>
    );
  }

  /* ── Drafts across Spaces ── */
  if (view === 'drafts') {
    return (
      <StudioShell
        icon={FileText}
        title={t('studio.views.drafts')}
        subtitle={t('studio.drafts.subtitle', { count: drafts.length })}
        actions={
          <>
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {t('studio.selected', { count: selected.size })}
            </span>
            <StudioAction
              disabled={selected.size === 0}
              tone="emerald"
              onClick={() =>
                removeRows([...selected], 'published', t('studio.drafts.published'))
              }
            >
              <Send aria-hidden className="h-4 w-4" />
              {t('studio.publish')}
            </StudioAction>
          </>
        }
      >
        <p className="mb-5 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          {t('studio.drafts.intro')}
        </p>

        {drafts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t('studio.drafts.emptyTitle')}
            body={t('studio.drafts.emptyBody')}
          />
        ) : (
          <div className="space-y-2">
            {drafts.map((d) => (
              <Row
                key={d.lessonId}
                selected={selected.has(d.lessonId)}
                onToggle={d.state === 'draft' ? () => toggle(d.lessonId) : undefined}
                reserveToggle
              >
                <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {d.order}
                </span>
                <div className="min-w-0 flex-1">
                  <RowTitle
                    to={`/v4/space/${d.spaceId}/lesson/${d.lessonId}`}
                    label={t('studio.open', { title: d.title, space: d.spaceName })}
                  >
                    {d.title}
                  </RowTitle>
                  <p className="truncate text-xs text-muted-foreground">{d.spaceName}</p>
                </div>
                <div className="w-28 shrink-0 text-right">
                  {d.state === 'processing' ? (
                    <StudioPill tone="processing">
                      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> {t('studio.drafts.processing')}
                    </StudioPill>
                  ) : d.state === 'needs-review' ? (
                    <StudioPill tone="warn">{t('studio.drafts.needsReview')}</StudioPill>
                  ) : (
                    <StudioPill tone="draft">{t('studio.drafts.draft')}</StudioPill>
                  )}
                </div>
              </Row>
            ))}
          </div>
        )}
      </StudioShell>
    );
  }

  /* ── How your work landed ── */
  return (
    <StudioShell
      icon={Sparkles}
      title={t('studio.views.impact')}
      subtitle={t('studio.impact.subtitle', { count: impact.length })}
    >
      <p className="mb-5 max-w-[70ch] text-sm leading-6 text-muted-foreground">
        {t('studio.impact.intro')}
      </p>

      {impact.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={t('studio.impact.emptyTitle')}
          body={t('studio.impact.emptyBody')}
        />
      ) : (
        <div className="space-y-2">
          {impact.map((r) => (
            <Row key={r.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.lessonTitle, r.spaceName].filter(Boolean).join(' · ')}
                  {[r.lessonTitle, r.spaceName].some(Boolean) ? ' · ' : ''}
                  {formatTimestamp(r.createdAt, true)}
                </p>
              </div>

              {r.orphaned && (
                <StudioPill tone="warn">
                  <Unlink aria-hidden className="h-3.5 w-3.5" /> {t('studio.impact.needsNewHome')}
                </StudioPill>
              )}
              {r.endorsed && (
                <StudioPill tone="ready">
                  <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> {t('v4Spaces:badges.endorsed')}
                </StudioPill>
              )}

              <span className="flex w-16 shrink-0 items-center justify-end gap-1.5 text-sm font-semibold text-muted-foreground tabular-nums">
                <Heart aria-hidden className="h-3.5 w-3.5" />
                {r.likeCount}
              </span>
            </Row>
          ))}
        </div>
      )}
    </StudioShell>
  );
}
