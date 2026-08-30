import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2,
  FileText,
  Heart,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { draftsAcrossSpaces, impactRows, uploadRows } from '../mocks/library';
import { StudioAction, StudioPill, StudioShell } from '../components/StudioShell';

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

const formatSize = (b?: number) => (b === undefined ? '—' : `${(b / 1_000_000).toFixed(1)} MB`);
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Dense list row shared by all three views. */
function Row({
  selected,
  onToggle,
  children,
}: {
  selected?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors',
        selected
          ? 'border-primary/40 bg-primary/[0.07]'
          : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]',
      )}
    >
      {onToggle && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
        />
      )}
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
  const { view } = useParams<{ view: View }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const uploads = useMemo(() => uploadRows(), []);
  const drafts = useMemo(() => draftsAcrossSpaces(), []);
  const impact = useMemo(() => impactRows(), []);

  /* ── Manage uploads ── */
  if (view === 'uploads') {
    return (
      <StudioShell
        icon={Upload}
        title="Manage uploads"
        subtitle={`${uploads.length} files across your Spaces`}
        actions={
          <>
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {selected.size} selected
            </span>
            <StudioAction disabled={selected.size === 0} tone="emerald">
              <Send aria-hidden className="h-4 w-4" />
              Publish
            </StudioAction>
            <StudioAction disabled={selected.size === 0}>
              <Trash2 aria-hidden className="h-4 w-4" />
              Delete
            </StudioAction>
          </>
        }
      >
        <p className="mb-5 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          The original files you uploaded. Deleting one never breaks the Lesson built from
          it — the Lesson keeps working and says the source was removed.
        </p>

        {uploads.length === 0 ? (
          <EmptyState
            icon={Upload}
            title="Nothing uploaded yet"
            body="Upload material inside a Space and a Lesson builds itself from it."
          />
        ) : (
          <div className="space-y-2">
            {uploads.map((u) => (
              <Row key={u.id} selected={selected.has(u.id)} onToggle={() => toggle(u.id)}>
                <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{u.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.lessonTitle ? `${u.lessonTitle} · ` : ''}
                    {u.spaceName}
                  </p>
                </div>
                <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                  {formatSize(u.sizeBytes)}
                </span>
                <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums md:block">
                  {formatDate(u.updatedAt)}
                </span>
                <div className="w-24 shrink-0 text-right">
                  {u.pending ? (
                    <StudioPill tone="processing">
                      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Working
                    </StudioPill>
                  ) : (
                    <StudioPill tone="ready">
                      <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Ready
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
        title="Your drafts"
        subtitle={`${drafts.length} unpublished across every Space`}
        actions={
          <>
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {selected.size} selected
            </span>
            <StudioAction disabled={selected.size === 0} tone="emerald">
              <Send aria-hidden className="h-4 w-4" />
              Publish
            </StudioAction>
          </>
        }
      >
        <p className="mb-5 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          Only you can see these. Drafts and Lessons still processing stay private to their
          author until published — this is the one screen that gathers yours from every
          Space at once.
        </p>

        {drafts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No drafts"
            body="Everything you've started is published. Nothing waiting on you."
          />
        ) : (
          <div className="space-y-2">
            {drafts.map((d) => (
              <Row
                key={d.lessonId}
                selected={selected.has(d.lessonId)}
                onToggle={d.state === 'draft' ? () => toggle(d.lessonId) : undefined}
              >
                <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {d.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{d.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{d.spaceName}</p>
                </div>
                <div className="w-28 shrink-0 text-right">
                  {d.state === 'processing' ? (
                    <StudioPill tone="processing">
                      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Processing
                    </StudioPill>
                  ) : d.state === 'needs-review' ? (
                    <StudioPill tone="warn">Needs review</StudioPill>
                  ) : (
                    <StudioPill tone="draft">Draft</StudioPill>
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
      title="How your work landed"
      subtitle={`${impact.length} published contributions`}
    >
      <p className="mb-5 max-w-[70ch] text-sm leading-6 text-muted-foreground">
        Every contribution you’ve published, and what happened to it. Likes are shown per
        item — they say what people found useful, and never add up to a score.
      </p>

      {impact.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing published yet"
          body="Share a summary, a worked example or a set of practice questions with a Space, and it will show up here with how it landed."
        />
      ) : (
        <div className="space-y-2">
          {impact.map((r) => (
            <Row key={r.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.lessonTitle ? `${r.lessonTitle} · ` : ''}
                  {r.spaceName} · {formatDate(r.createdAt)}
                </p>
              </div>

              {r.orphaned && (
                <StudioPill tone="warn">
                  <Unlink aria-hidden className="h-3.5 w-3.5" /> Needs a new home
                </StudioPill>
              )}
              {r.endorsed && (
                <StudioPill tone="ready">
                  <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Endorsed
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
