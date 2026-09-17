import { useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { viewer } from '../mocks/people';
import { viewerStanding } from '../mocks/library';
import { StudioShell } from '../components/StudioShell';
import { ListSkeleton, SpacesError } from '../components/states';
import { useScreenState } from '../data/useSpaces';
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
 *     "animations" switch: `Scene` carries `reducedMotion="user"` for Learn
 *     screens and `StudioShell` carries it for Studio ones, so both modes obey
 *     the same setting. A second switch that could disagree with the OS is a
 *     bug with a label on it.
 *
 *     This paragraph used to name only `Scene` — which this screen does not go
 *     through, so the justification for having no switch was false in its own
 *     file. Studio screens ignored the setting entirely until the shell took
 *     it on.
 */

/** One switch row. Label carries the meaning; the description carries the cost. */
function Toggle({
  id,
  label,
  description,
  value,
  onChange,
}: {
  /** Stable id, so the label and the hint can be pointed at. */
  id: string;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-white/[0.06] py-4 last:border-0">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[14.5px] font-semibold text-foreground">
          {label}
        </p>
        <p
          id={`${id}-hint`}
          className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground"
        >
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby={`${id}-label`}
        /*
          The description is the *cost* of the switch — "a busy Space can
          publish several a week, and this is the one that turns a useful inbox
          into noise" is exactly what you need before flipping it, and it was
          unreachable: `aria-label` names a control and says nothing else, so
          every explanation on this screen was invisible to a screen reader.
        */
        aria-describedby={`${id}-hint`}
        onClick={() => onChange(!value)}
        className={cn(
          // 44 × 24, at the target-size floor.
          //
          // A comment here used to claim "the row label is clickable via
          // aria-label". It is not: `aria-label` makes nothing clickable, and
          // the visible label was a plain <p> with no association at all. The
          // label is wired properly now, via aria-labelledby.
          'console-focusable relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          value ? 'bg-primary' : 'bg-white/15',
        )}
      >
        {/*
          The knob is Motion's, not the stylesheet's. It moved with
          `transition-transform`, which ignores `prefers-reduced-motion` — on
          the one screen that tells the reader motion follows their system
          setting. `initial={false}` so the switch does not slide on mount:
          this reflects loaded state, and replaying it would animate a value
          the user never changed.
        */}
        <motion.span
          initial={false}
          animate={{ x: value ? 22 : 2 }}
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
        />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-[13px] font-semibold text-muted-foreground">
        {title}
      </h2>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5">{children}</div>
    </section>
  );
}

export default function SettingsScreen() {
  const screenState = useScreenState();
  const standing = viewerStanding();
  const [notifyMentions, setNotifyMentions] = useState(true);
  const [notifyEndorsed, setNotifyEndorsed] = useState(true);
  const [notifyNewLessons, setNotifyNewLessons] = useState(false);
  const [publicProfile, setPublicProfile] = useState(true);
  const [showActivity, setShowActivity] = useState(false);

  if (screenState === 'loading' || screenState === 'error') {
    return (
      <StudioShell
        icon={SettingsIcon}
        title="Settings"
        subtitle={screenState === 'error' ? 'Something went wrong' : 'Loading…'}
        backTo="/v4/profile"
        backLabel="Back to Profile"
      >
        {screenState === 'error' ? <SpacesError what="your settings" /> : <ListSkeleton />}
      </StudioShell>
    );
  }

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

      {/*
        Said once, plainly, rather than a marker on every row.
        The five switches below move and nothing behind them exists — no store,
        no persistence, so navigating away and back resets them. That is the
        same class of claim this screen's own docblock argues against, and the
        switches had neither a note nor the `disabled` + reason treatment the
        Delete button two sections down gets right.
        NEEDS-BACKEND: notification and visibility preferences.
      */}
      <p className="mb-8 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
        Nothing on this screen is saved yet. The switches show what will be
        adjustable; they do not change anything, and they reset when you leave.
      </p>

      <Section title="Notifications">
        <Toggle
          id="notify-replies"
          label="When someone replies to you"
          description="A reply to your contribution, or a mention by name."
          value={notifyMentions}
          onChange={setNotifyMentions}
        />
        <Toggle
          id="notify-endorsed"
          label="When your work is endorsed"
          description="Someone who maintains the Space marked your contribution as trustworthy."
          value={notifyEndorsed}
          onChange={setNotifyEndorsed}
        />
        <Toggle
          id="notify-new-lessons"
          label="New Lessons in Spaces you have starred"
          description="Off by default. A busy Space can publish several a week, and this is the one that turns a useful inbox into noise."
          value={notifyNewLessons}
          onChange={setNotifyNewLessons}
        />
      </Section>

      <Section title="Who can see you">
        <Toggle
          id="public-profile"
          label="Public profile"
          description="Your name, rank and published contributions are visible to anyone in a Space you share. Turning this off does not retract work you have already published."
          value={publicProfile}
          onChange={setPublicProfile}
        />
        <Toggle
          id="show-activity"
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
              // It promised "It arrives by email when it is ready", which is a
              // delivery mechanism this build does not have. The button still
              // responds — silence would read as a failure — but it says only
              // what is true.
              toast('Not wired yet', {
                description: 'Export is designed but not built in this version.',
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
            /*
              `text-quiet`, not `text-destructive/50` — which measured 1.87:1,
              the worst contrast in the build. WCAG exempts inactive controls,
              but the word "Delete" on an account-deletion row being
              unreadable is not a thing to lean on an exemption for. The
              destructive intent is carried by the border and the trash glyph.
            */
            className="inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-2 rounded-lg border border-destructive/25 px-4 text-[13px] font-medium text-quiet"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            Delete
          </button>
        </div>
      </Section>

      {/* No link icon: this paragraph goes nowhere, and an ExternalLink glyph
          beside it told sighted users otherwise. */}
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Motion follows your system setting for reduced motion — both the animated
        transitions and the hover effects. There is no switch here because there is
        nothing for it to disagree with.
      </p>
    </StudioShell>
  );
}
