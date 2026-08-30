import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Archive,
  Settings2,
  ShieldAlert,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Role, SpaceMode } from '../types';
import { canDelete, spaceById } from '../mocks/spaces';
import { membersForSpace } from '../mocks/contributions';
import { viewer } from '../mocks/people';
import { StudioAction, StudioPill, StudioShell } from '../components/StudioShell';
import { JoinCodeBlock } from '../components/SpaceDialogs';
import { AuthorLine } from '../components/badges';

/**
 * Manage a Space — the Owner's Studio screen.
 *
 * Doc 2 puts settings on a **separate Studio screen**, never as a fourth tab:
 * "Tabs hold only genuinely different objects. Settings is a separate Studio
 * screen." So this is dense on purpose — toolbars, rows, visible secondary
 * controls — and the Learn chrome (`SpacesTopBar`) is deliberately absent.
 *
 * // NEEDS-BACKEND: member roles. Owner/Editor/Member is a v4 concept with no
 * counterpart in the current schema; join codes exist on courses today, so the
 * invite half mirrors something real and the role half does not.
 */

const ROLE_ORDER: Role[] = ['owner', 'editor', 'member'];
const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  member: 'Member',
};

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-9">
      <h2 className="mb-1 text-[15px] font-semibold text-foreground">{title}</h2>
      {blurb && <p className="mb-4 max-w-[70ch] text-sm leading-6 text-muted-foreground">{blurb}</p>}
      {children}
    </section>
  );
}

export default function SpaceManageScreen() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const space = spaceId ? spaceById(spaceId) : undefined;

  const [name, setName] = useState(space?.name ?? '');
  const [description, setDescription] = useState(space?.description ?? '');
  const [mode, setMode] = useState<SpaceMode>(space?.mode ?? 'guided');
  const [grounding, setGrounding] = useState(space?.groundingEnabled ?? false);
  const [strict, setStrict] = useState(space?.strictMode ?? false);
  const [confirmName, setConfirmName] = useState('');

  if (!space) {
    return (
      <StudioShell icon={Settings2} title="Manage" subtitle="Space not found">
        <p className="text-sm text-muted-foreground">
          That Space does not exist, or you cannot reach it.
        </p>
      </StudioShell>
    );
  }

  // Only the Owner manages a Space. A Member landing here by URL gets told so,
  // rather than a screen full of controls that would fail.
  if (space.viewerRole !== 'owner') {
    return (
      <StudioShell icon={ShieldAlert} title="Manage" subtitle={space.name}>
        <div className="depth-card flex flex-col items-center gap-3 p-12 text-center">
          <ShieldAlert aria-hidden className="h-9 w-9 text-muted-foreground/50" />
          <p className="text-sm font-semibold text-foreground">This isn’t your Space</p>
          <p className="max-w-[46ch] text-sm text-muted-foreground">
            {space.owner.name} owns {space.name}. Only the Owner can change its settings
            or its Members.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/v4/space/${space.id}`)}
            className="console-focusable mt-2 h-9 rounded-lg border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.08]"
          >
            Back to the Space
          </button>
        </div>
      </StudioShell>
    );
  }

  const members = membersForSpace(space.id);
  const deletable = canDelete(space, confirmName);

  return (
    <StudioShell
      icon={Settings2}
      title="Manage Space"
      subtitle={space.name}
      actions={
        <StudioAction tone="emerald" onClick={() => toast.success('Changes saved')}>
          Save changes
        </StudioAction>
      }
    >
      <Section title="Details">
        <div className="space-y-4">
          <div>
            <label htmlFor="m-name" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Name
            </label>
            <input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="console-focusable h-10 w-full max-w-md rounded-lg border border-white/12 bg-white/[0.04] px-3 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="m-desc" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Description
            </label>
            <textarea
              id="m-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="console-focusable w-full max-w-2xl resize-y rounded-lg border border-white/12 bg-white/[0.04] p-3 text-sm leading-6 outline-none"
            />
          </div>
        </div>
      </Section>

      <Section
        title="Who can publish"
        blurb="Switching is lossless: it changes only who may publish from now on. Every Lesson keeps its place, its author and everyone's progress."
      >
        <div className="flex flex-wrap gap-2">
          {(['guided', 'open'] as SpaceMode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                toast(`Now ${m === 'guided' ? 'Guided' : 'Open'}`, {
                  description:
                    m === 'guided'
                      ? 'Only you and your Editors publish Lessons from now on.'
                      : 'Every Member can publish Lessons from now on.',
                });
              }}
              className={cn(
                'console-focusable h-9 rounded-lg border px-4 text-[13px] font-semibold capitalize transition-colors',
                mode === m
                  ? 'border-primary/45 bg-primary/[0.12] text-foreground'
                  : 'border-white/12 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06]',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Source of truth"
        blurb="Off by default. Turning it on nominates published Lessons as the reference, and everything else in the Space then shows whether it traces back to them. It never blocks anything — it labels."
      >
        <div className="space-y-2">
          <label className="flex max-w-2xl cursor-pointer items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <input
              type="checkbox"
              checked={grounding}
              onChange={(e) => {
                setGrounding(e.target.checked);
                if (!e.target.checked) setStrict(false);
              }}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm">
              <span className="font-semibold text-foreground">Show grounding</span>
              <span className="ml-2 text-muted-foreground">
                Mark what traces back to this Space’s material.
              </span>
            </span>
          </label>

          {/* Strict mode requires grounding — Doc 1 Grounding rule 5. */}
          <label
            className={cn(
              'flex max-w-2xl items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3',
              grounding ? 'cursor-pointer' : 'cursor-not-allowed opacity-45',
            )}
          >
            <input
              type="checkbox"
              checked={strict}
              disabled={!grounding}
              onChange={(e) => setStrict(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm">
              <span className="font-semibold text-foreground">Grounded content only</span>
              <span className="ml-2 text-muted-foreground">
                Keep the path to material that traces back. Needs grounding on.
              </span>
            </span>
          </label>
        </div>
      </Section>

      <Section
        title="Members"
        blurb="Editors can add and edit content. Members learn, and can always contribute."
      >
        <div className="mb-4 space-y-2">
          {members.map((m) => (
            <div
              key={m.person.id}
              className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <AuthorLine person={m.person} />
              </div>
              <span className="hidden w-16 text-right text-xs text-muted-foreground tabular-nums sm:block">
                {m.progress}%
              </span>
              {m.role === 'owner' ? (
                <StudioPill tone="ready">Owner</StudioPill>
              ) : (
                <>
                  <select
                    aria-label={`Role for ${m.person.name}`}
                    defaultValue={m.role}
                    onChange={(e) =>
                      toast.success(`${m.person.name} is now ${ROLE_LABEL[e.target.value as Role]}`)
                    }
                    className="console-focusable h-8 rounded-lg border border-white/12 bg-white/[0.05] px-2 text-xs font-semibold text-foreground outline-none"
                  >
                    {ROLE_ORDER.filter((r) => r !== 'owner').map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${m.person.name}`}
                    onClick={() =>
                      toast(`Removed ${m.person.name}`, {
                        description: 'Their contributions and credit stay in the Space.',
                        action: { label: 'Undo', onClick: () => toast.success('Restored') },
                      })
                    }
                    className="console-focusable flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <UserMinus aria-hidden className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Only you so far. Share the code below to bring people in.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users aria-hidden className="h-4 w-4" />
            Invite with a code
          </p>
          <p className="mb-3 text-sm text-muted-foreground">
            Anyone with this joins directly. There is no approval step.
          </p>
          <JoinCodeBlock spaceId={space.id} />
        </div>
      </Section>

      <Section
        title="Archive"
        blurb="Archived is read-only. Progress is kept and nothing is lost, but it earns no XP and drops to the bottom of your Spaces."
      >
        <StudioAction onClick={() => toast('Space archived', { description: `${space.name} is now read-only.` })}>
          <Archive aria-hidden className="h-4 w-4" />
          Archive this Space
        </StudioAction>
      </Section>

      {/* Destructive, irreversible, and therefore behind an exact name match. */}
      <section className="mt-12 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-destructive">
          <Trash2 aria-hidden className="h-4 w-4" />
          Delete this Space
        </h2>
        <p className="mb-4 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          Every Lesson, every contribution and everyone’s progress goes with it. This
          cannot be undone. Type <span className="font-semibold text-foreground">{space.name}</span>{' '}
          to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Type the Space name to confirm deletion"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={space.name}
            className="console-focusable h-10 w-full max-w-sm rounded-lg border border-white/12 bg-white/[0.04] px-3 text-sm outline-none"
          />
          <button
            type="button"
            disabled={!deletable}
            onClick={() => {
              toast.error(`Deleted ${space.name}`);
              navigate('/v4/spaces');
            }}
            className={cn(
              'console-focusable inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition-colors',
              deletable
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'cursor-not-allowed bg-white/[0.05] text-muted-foreground',
            )}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            Delete permanently
          </button>
        </div>
      </section>
    </StudioShell>
  );
}
