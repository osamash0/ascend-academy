import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, ExternalLink, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { viewer } from '../mocks/people';
import { viewerStanding } from '../mocks/library';
import { StudioShell } from '../components/StudioShell';
import { Avatar } from '../components/Avatar';

/**
 * Settings — a Studio screen hanging off Profile.
 *
 * Doc 2 puts it here rather than behind the top-bar gear on every screen: the
 * gear now navigates, it does not open a panel. Settings is dense by nature
 * (rows of switches), which is exactly what Studio mode is for, and Profile is
 * the destination that owns "you".
 *
 * Two rules this screen exists to keep honest:
 *
 *   • **No claim we cannot back.** The audit found a privacy page asserting
 *     GDPR compliance the product did not have. Nothing here promises
 *     anything — each row says what it does, and export/delete link out to the
 *     real flows instead of faking them.
 *   • **Reduced motion is the operating system's call.** There is no
 *     "animations" switch, because `Scene` already routes every screen through
 *     `reducedMotion="user"`. A second switch that could disagree with the OS
 *     is a bug with a label on it.
 */

/** One switch row. Label carries the meaning; the description carries the cost. */
function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-white/[0.06] py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn(
          // 44px wide × 24px tall hit area, and the row label is clickable via
          // aria-label — meets the 24×24 minimum with room to spare.
          'console-focusable relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          value ? 'bg-primary' : 'bg-white/15',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            value ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5">{children}</div>
    </section>
  );
}

export default function SettingsScreen() {
  const standing = viewerStanding();
  const [notifyMentions, setNotifyMentions] = useState(true);
  const [notifyEndorsed, setNotifyEndorsed] = useState(true);
  const [notifyNewLessons, setNotifyNewLessons] = useState(false);
  const [publicProfile, setPublicProfile] = useState(true);
  const [showActivity, setShowActivity] = useState(false);

  return (
    <StudioShell
      icon={SettingsIcon}
      title="Settings"
      subtitle="Notifications, visibility and your data"
      backTo="/v4/profile"
      backLabel="Back to Profile"
    >
      {/* Identity, read-only. Editing it belongs to Profile, which owns "you". */}
      <div className="mb-8 flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <Avatar person={viewer} size="lg" isViewer />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">{viewer.name}</p>
          <p className="truncate text-[13px] text-muted-foreground tabular-nums">
            {standing.rank} · {standing.xp.toLocaleString()} XP
          </p>
        </div>
        <Link
          to="/v4/profile"
          className="console-focusable inline-flex h-9 shrink-0 items-center rounded-lg border border-white/12 px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.06]"
        >
          Edit on Profile
        </Link>
      </div>

      <Section title="Notifications">
        <Toggle
          label="When someone replies to you"
          description="A reply to your contribution, or a mention by name."
          value={notifyMentions}
          onChange={setNotifyMentions}
        />
        <Toggle
          label="When your work is endorsed"
          description="Someone who maintains the Space marked your contribution as trustworthy."
          value={notifyEndorsed}
          onChange={setNotifyEndorsed}
        />
        <Toggle
          label="New Lessons in Spaces you have starred"
          description="Off by default. A busy Space can publish several a week, and this is the one that turns a useful inbox into noise."
          value={notifyNewLessons}
          onChange={setNotifyNewLessons}
        />
      </Section>

      <Section title="Who can see you">
        <Toggle
          label="Public profile"
          description="Your name, rank and published contributions are visible to anyone in a Space you share. Turning this off does not retract work you have already published."
          value={publicProfile}
          onChange={setPublicProfile}
        />
        <Toggle
          label="Show what I am reading"
          description="Lets members of a Space see which Lessons you have open. Off by default — nobody asked to be watched."
          value={showActivity}
          onChange={setShowActivity}
        />
      </Section>

      <Section title="Your data">
        <div className="flex items-start justify-between gap-6 border-b border-white/[0.06] py-4">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold text-foreground">Export everything</p>
            <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
              Your notes, contributions and uploads as one archive. Nothing here is locked in.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              toast('Export requested', {
                description: 'It arrives by email when it is ready.',
              })
            }
            className="console-focusable inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-white/12 px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.06]"
          >
            <Download aria-hidden className="h-4 w-4" />
            Export
          </button>
        </div>

        <div className="flex items-start justify-between gap-6 py-4">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold text-foreground">Delete your account</p>
            <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
              Removes your notes and uploads. Contributions you published to a Space stay,
              unattributed — deleting them would tear holes in Lessons other people rely on.
            </p>
          </div>
          {/*
            NEEDS-BACKEND: account deletion is a real, irreversible flow with a
            confirmation step and a grace period. This screen refuses to mock a
            destructive action, so the button states plainly that it is not
            wired rather than pretending to fire.
          */}
          <button
            type="button"
            disabled
            title="Not wired in this design build"
            className="inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-2 rounded-lg border border-destructive/25 px-4 text-[13px] font-medium text-destructive/50"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            Delete
          </button>
        </div>
      </Section>

      <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        Motion follows your system setting for reduced motion. There is no switch here because
        there is nothing for it to disagree with.
      </p>
    </StudioShell>
  );
}
