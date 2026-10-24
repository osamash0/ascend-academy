import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguagePreference } from '@/hooks/useLanguagePreference';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewer } from '../data/viewer';
import { standingNow } from '../data/standing';
import { StudioShell } from '../components/StudioShell';
import { ListSkeleton, SpacesError } from '../components/states';
import { useScreenState } from '../data/useSpaces';
import { Avatar } from '../components/Avatar';
import { formatNumber } from '../i18n/format';
import { dataMode } from '../data/liveRepository';
import { LiveAccountData } from '../components/LiveAccountData';

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

/**
 * The app's one language setting, the same one the rest of Learnstation and
 * the server use — so the pages, the AI's answers and the checkpoints all
 * follow it together. Saved to the profile (and this browser) at once.
 */
function LanguageSection() {
  const { t } = useTranslation('v4Settings');
  const { language, setLanguage } = useLanguagePreference();
  const current = (language || 'en').split('-')[0];
  return (
    <section className="mb-8" aria-labelledby="settings-language">
      <h2 id="settings-language" className="mb-1 text-[13px] font-semibold text-muted-foreground">
        {t('language.title')}
      </h2>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <div role="radiogroup" aria-labelledby="settings-language" className="flex flex-wrap gap-2">
          {(['en', 'de'] as const).map((lng) => (
            <button
              key={lng}
              type="button"
              role="radio"
              aria-checked={current === lng}
              lang={lng}
              onClick={() => setLanguage(lng)}
              className={cn(
                'console-focusable h-10 rounded-full px-5 text-[14px] transition-colors',
                current === lng ? 'bg-white font-medium text-background' : 'bg-white/[0.06] text-foreground hover:bg-white/[0.1]',
              )}
            >
              {t(`language.${lng}`)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{t('language.hint')}</p>
      </div>
    </section>
  );
}

export default function SettingsScreen() {
  const viewer = useViewer();
  const { t } = useTranslation('v4Settings');
  const screenState = useScreenState();
  const standing = standingNow();
  const [notifyMentions, setNotifyMentions] = useState(true);
  const [notifyEndorsed, setNotifyEndorsed] = useState(true);
  const [notifyNewLessons, setNotifyNewLessons] = useState(false);
  const [publicProfile, setPublicProfile] = useState(true);
  const [showActivity, setShowActivity] = useState(false);

  if (screenState === 'loading' || screenState === 'error') {
    return (
      <StudioShell
        icon={SettingsIcon}
        title={t('title')}
        subtitle={screenState === 'error' ? t('sections.status.failed') : t('sections.status.loading')}
        backTo="/v4/profile"
        backLabel={t('sections.status.back')}
      >
        {screenState === 'error' ? <SpacesError what="settings" /> : <ListSkeleton />}
      </StudioShell>
    );
  }

  return (
    <StudioShell
      icon={SettingsIcon}
      title={t('title')}
      subtitle={t('subtitle')}
      backTo="/v4/profile"
      backLabel={t('sections.status.back')}
    >
      {/* Identity, read-only. Editing it belongs to Profile, which owns "you". */}
      <div className="mb-8 flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <Avatar person={viewer} size="lg" isViewer />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">{viewer.name}</p>
          <p className="truncate text-[13px] text-muted-foreground tabular-nums">
            {t('sections.account.standing', { rank: standing.rank, xp: formatNumber(standing.xp) })}
          </p>
        </div>
        <Link
          to="/v4/profile"
          className="console-focusable inline-flex h-9 shrink-0 items-center rounded-lg border border-white/12 px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.06]"
        >
          {t('sections.account.edit')}
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
      <LanguageSection />

      <p className="mb-8 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
        {t('sections.notice')}
      </p>

      <Section title={t('sections.notifications.title')}>
        <Toggle
          id="notify-replies"
          label={t('sections.notifications.replies.label')}
          description={t('sections.notifications.replies.hint')}
          value={notifyMentions}
          onChange={setNotifyMentions}
        />
        <Toggle
          id="notify-endorsed"
          label={t('sections.notifications.endorsed.label')}
          description={t('sections.notifications.endorsed.hint')}
          value={notifyEndorsed}
          onChange={setNotifyEndorsed}
        />
        <Toggle
          id="notify-new-lessons"
          label={t('sections.notifications.newLessons.label')}
          description={t('sections.notifications.newLessons.hint')}
          value={notifyNewLessons}
          onChange={setNotifyNewLessons}
        />
      </Section>

      <Section title={t('sections.visibility.title')}>
        <Toggle
          id="public-profile"
          label={t('sections.visibility.publicProfile.label')}
          description={t('sections.visibility.publicProfile.hint')}
          value={publicProfile}
          onChange={setPublicProfile}
        />
        <Toggle
          id="show-activity"
          label={t('sections.visibility.activity.label')}
          description={t('sections.visibility.activity.hint')}
          value={showActivity}
          onChange={setShowActivity}
        />
      </Section>

      <Section title={t('sections.data.title')}>
        {dataMode(import.meta.env.VITE_V4_DATA_MODE) === 'live' ? (
          <LiveAccountData />
        ) : (
          <>
          <div className="flex items-start justify-between gap-6 border-b border-white/[0.06] py-4">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-foreground">{t('sections.data.export.label')}</p>
              <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
                {t('sections.data.export.hint')}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                // It promised "It arrives by email when it is ready", which is a
                // delivery mechanism this build does not have. The button still
                // responds — silence would read as a failure — but it says only
                // what is true.
                toast(t('sections.data.export.notWired'), {
                  description: t('sections.data.export.notWiredHint'),
                })
              }
              className="console-focusable inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-white/12 px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.06]"
            >
              <Download aria-hidden className="h-4 w-4" />
              {t('sections.data.export.action')}
            </button>
          </div>

          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-foreground">{t('sections.data.delete.label')}</p>
              <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
                {t('sections.data.delete.hint')}
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
              title={t('v4Spaces:nav.notWired')}
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
              {t('sections.data.delete.action')}
            </button>
          </div>
          </>
        )}
      </Section>

      {/* No link icon: this paragraph goes nowhere, and an ExternalLink glyph
          beside it told sighted users otherwise. */}
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {t('sections.motion')}
      </p>
    </StudioShell>
  );
}
