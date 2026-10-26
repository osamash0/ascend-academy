import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Link2, Lock, Plus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pressable } from './Pressable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { ContributionType, Space, SpaceMode, Visibility } from '../types';
import { createSpace, joinCodeFor, spaceByJoinCode } from '../mocks/spaces';
import { addLesson } from '../mocks/lessons';
import { addContribution } from '../mocks/contributions';
import { useRefreshWorld, useViewer } from '../data/viewer';
import { dataMode, loadLiveRepository } from '../data/liveRepository';
import { AuthorLine, ClassificationChips, LessonCount } from './badges';
import { publishedLessonsForSpace } from '../data/world';
import { formatNumber } from '../i18n/format';

/**
 * Creating and joining a Space.
 *
 * Both are Studio work — they configure an object — but they are reached from
 * a Learn screen, so they open as dialogs rather than sending you to a
 * separate page. Doc 2's Create rule: the button "states what it will make and
 * where it will land", so neither flow ever asks "where should this go?".
 *
 * Landing follows Doc 2's table: creating or joining a Space lands you on that
 * Space's Overview — empty-state for a new one.
 */

/*
 * Labels and blurbs are said at render, in the reader's language. The mode
 * and visibility words are the badges' own, so the chip and the choice that
 * set it can never disagree.
 */
/** The translator, as the label tables need it. */
type Say = (key: string) => string;

const modes = (t: Say): { key: SpaceMode; label: string; blurb: string }[] => [
  { key: 'guided', label: t('badges.guided'), blurb: t('dialogs.mode.guided') },
  { key: 'open', label: t('badges.open'), blurb: t('dialogs.mode.open') },
];

const visibilities = (
  t: Say,
): { key: Visibility; label: string; blurb: string; icon: typeof Lock }[] => [
  { key: 'private', label: t('badges.visibility.private'), blurb: t('dialogs.visibility.private'), icon: Lock },
  { key: 'invite', label: t('badges.visibility.invite'), blurb: t('dialogs.visibility.invite'), icon: Link2 },
  { key: 'public', label: t('badges.visibility.public'), blurb: t('dialogs.visibility.public'), icon: Users },
];

/** A radio row — used for both mode and visibility so they read alike. */
function Choice<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: { key: T; label: string; blurb: string; icon?: typeof Lock }[];
  value: T;
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="space-y-2">
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'console-focusable flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
              active
                ? 'border-primary/45 bg-primary/[0.08]'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                active ? 'border-primary' : 'border-white/25',
              )}
            >
              {active && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                {Icon && <Icon aria-hidden className="h-3.5 w-3.5" />}
                {o.label}
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-quiet">
                {o.blurb}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── New Space ──────────────────────────────────────────────────── */

export function NewSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation('v4Spaces');
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<SpaceMode>('guided');
  const [visibility, setVisibility] = useState<Visibility>('private');
  /*
   * Live, a Space is a course you own, made here on the stage (LS-050) rather
   * than in the old console. Only the name is asked: mode and visibility are
   * not stored for real courses yet, and a choice that is thrown away is a
   * promise the product does not keep. It starts private and empty.
   */
  const live = dataMode(import.meta.env.VITE_V4_DATA_MODE) === 'live';
  const refreshWorld = useRefreshWorld();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
    if (live) {
      setBusy(true);
      setFailed(false);
      try {
        const { id } = await (await loadLiveRepository()).createSpace(name.trim());
        await refreshWorld();
        setName('');
        onOpenChange(false);
        navigate(`/v4/space/${id}`);
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
      return;
    }
    const s = createSpace({ name: name.trim(), mode, visibility });
    onOpenChange(false);
    setName('');
    // Doc 2 landing table: creating a Space lands on its Overview, empty.
    navigate(`/v4/space/${s.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">{t('dialogs.newSpace.title')}</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-quiet">
            {/* Live cannot change a Space's settings on the stage yet, so it does not say it can. */}
            {live ? t('dialogs.newSpace.descriptionLive') : t('dialogs.newSpace.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <div>
            <label htmlFor="space-name" className="mb-2 block text-[13.5px] font-medium">
              {t('dialogs.newSpace.name')}
            </label>
            <input
              id="space-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder={t('dialogs.newSpace.namePlaceholder')}
              autoFocus
              className="console-focusable h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[15px] outline-none placeholder:text-faint"
            />
          </div>

          {live ? (
            <p className="text-[13.5px] leading-relaxed text-quiet">{t('dialogs.newSpace.liveNote')}</p>
          ) : (
            <>
              <div>
                <p className="mb-2 text-[13.5px] font-medium">{t('dialogs.newSpace.whoPublishes')}</p>
                <Choice<SpaceMode>
                  name={t('dialogs.newSpace.modeGroup')}
                  options={modes(t)}
                  value={mode}
                  onChange={setMode}
                />
              </div>

              <div>
                <p className="mb-2 text-[13.5px] font-medium">{t('dialogs.newSpace.whoSees')}</p>
                <Choice<Visibility>
                  name={t('dialogs.newSpace.visibilityGroup')}
                  options={visibilities(t)}
                  value={visibility}
                  onChange={setVisibility}
                />
              </div>
            </>
          )}

          {/* The button says what it makes and where it lands. */}
          <Pressable
            type="button"
            onClick={() => void create()}
            disabled={!name.trim() || busy}
            className="console-focusable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {busy ? t('dialogs.newSpace.creating') : t('dialogs.newSpace.create')}
          </Pressable>
          {failed && (
            <p role="alert" className="text-center text-[13px] text-destructive">
              {t('dialogs.newSpace.failed')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Join with a code ───────────────────────────────────────────── */

export function JoinSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation('v4Spaces');
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const found = code.trim().length >= 4 ? spaceByJoinCode(code) : undefined;
  const tooShort = code.trim().length < 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">{t('dialogs.join.title')}</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-quiet">
            {t('dialogs.join.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <input
            aria-label={t('dialogs.join.codeLabel')}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoFocus
            maxLength={6}
            className="console-focusable h-14 w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 text-center text-[24px] font-semibold tracking-[0.3em] outline-none placeholder:text-faint"
          />

          {/* Preview before joining — Doc 1: no blind joins. */}
          {found ? (
            <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] p-4">
              <p className="text-[16px] font-semibold">{found.name}</p>
              <div className="mt-2">
                <AuthorLine person={found.owner} prefix={t('dialogs.join.owner')} />
              </div>
              {/*
                The *published* count, not `lessonCount`. Cryptography has 12
                Lessons of which one is unpublished, so this preview promised
                "12 Lessons" and the Space you landed in said "The path · 11".
                A join preview exists to stop blind joins; overstating what is
                inside is the thing it is there to prevent.
              */}
              <p className="mt-2 flex items-center gap-2 text-[13px] text-quiet tabular-nums">
                <LessonCount count={publishedLessonsForSpace(found.id).length} />
                <span aria-hidden className="text-decor">·</span>
                {t('dialogs.join.members', {
                  count: found.memberCount,
                  n: formatNumber(found.memberCount),
                })}
              </p>
              {/* The cap lives in the component; repeating its default here
                  would be a second place to change it. */}
              <ClassificationChips space={found} className="mt-3" />
            </div>
          ) : (
            !tooShort && (
              <p className="text-[13.5px] text-quiet">
                {t('dialogs.join.notFound')}
              </p>
            )
          )}

          <Pressable
            type="button"
            disabled={!found}
            onClick={() => {
              if (!found) return;
              onOpenChange(false);
              setCode('');
              navigate(`/v4/space/${found.id}`);
            }}
            className="console-focusable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <KeyRound aria-hidden className="h-4 w-4" />
            {found ? t('dialogs.join.joinNamed', { name: found.name }) : t('dialogs.join.join')}
          </Pressable>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Shown on the manage screen so an Owner can hand the code out. */
export function JoinCodeBlock({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation('v4Spaces');
  const [copied, setCopied] = useState(false);
  const code = joinCodeFor(spaceId);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-[18px] font-semibold tracking-[0.24em]">
        {code}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
        className="console-focusable h-10 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
      >
        {copied ? t('dialogs.code.copied') : t('dialogs.code.copy')}
      </button>
    </div>
  );
}

/* ── Add a Lesson ───────────────────────────────────────────────── */

/**
 * Add a Lesson to a Space's path.
 *
 * It lands as a **draft**, and the dialog says so before you press the button.
 * Uploading material starts a build; it does not publish. Getting that wrong
 * in the copy would make every new Lesson look like it had gone live to the
 * whole Space the moment it was named.
 *
 * Whether *you* may add one is decided by the screen — Open Spaces let any
 * Member, Guided Spaces do not — so this dialog does not re-litigate it.
 */
export function AddLessonDialog({
  space,
  open,
  onOpenChange,
  onAdded,
}: {
  space: Space;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded?: () => void;
}) {
  const viewer = useViewer();
  const { t } = useTranslation('v4Spaces');
  const navigate = useNavigate();
  const [title, setTitle] = useState('');

  const add = () => {
    if (!title.trim()) return;
    const l = addLesson(space.id, title, viewer);
    onOpenChange(false);
    setTitle('');
    onAdded?.();
    navigate(`/v4/space/${space.id}/lesson/${l.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">{t('dialogs.addLesson.title')}</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-quiet">
            {t('dialogs.addLesson.description', { space: space.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <div>
            <label htmlFor="lesson-title" className="mb-2 block text-[13.5px] font-medium">
              {t('dialogs.addLesson.titleLabel')}
            </label>
            <input
              id="lesson-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder={t('dialogs.addLesson.titlePlaceholder')}
              autoFocus
              className="console-focusable h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[15px] outline-none placeholder:text-faint"
            />
          </div>

          {/*
            NEEDS-BACKEND: the real flow uploads material and a Lesson builds
            itself from it. There is no upload here, so the dialog does not draw
            a file picker it cannot honour — it names the Lesson and leaves it
            in the state a real upload would leave it in.
          */}
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[13px] leading-relaxed text-quiet">
            {t('dialogs.addLesson.noUpload')}
          </p>

          <Pressable
            type="button"
            onClick={add}
            disabled={!title.trim()}
            className="console-focusable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {t('dialogs.addLesson.create')}
          </Pressable>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Contribute ─────────────────────────────────────────────────── */

const contributionTypes = (
  t: Say,
): { key: ContributionType; label: string; blurb: string }[] =>
  (['text', 'practice-set', 'link'] as const).map((key) => ({
    key,
    label: t(`dialogs.contribute.kinds.${key}.label`),
    blurb: t(`dialogs.contribute.kinds.${key}.blurb`),
  }));

/**
 * Publish something into a Space's community section.
 *
 * Always Community origin and always un-endorsed on the way in — endorsing is
 * an Owner's act, and a contribution that arrived pre-endorsed would make the
 * badge meaningless. The copy is explicit that this is public to the Space,
 * because the neighbouring object that is *not* public is a Note, and the two
 * are one click apart in Library.
 */
export function ContributeDialog({
  space,
  lessonId,
  open,
  onOpenChange,
  onAdded,
}: {
  space: Space;
  /** Anchors to a Lesson when opened from one; to the Space otherwise. */
  lessonId?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded?: () => void;
}) {
  const viewer = useViewer();
  const { t } = useTranslation('v4Spaces');
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [type, setType] = useState<ContributionType>('text');

  const publish = () => {
    if (!title.trim() || !excerpt.trim()) return;
    addContribution({
      title,
      excerpt,
      type,
      anchor: lessonId ? { level: 'lesson', lessonId } : { level: 'space', spaceId: space.id },
      author: viewer,
      // Grounding follows the Space's material, not the author.
      grounding: space.groundingEnabled ? 'not-grounded' : null,
    });
    onOpenChange(false);
    setTitle('');
    setExcerpt('');
    onAdded?.();
    toast(t('dialogs.contribute.published'), {
      description: t('dialogs.contribute.publishedHint'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">{t('dialogs.contribute.title')}</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-quiet">
            {t('dialogs.contribute.description', { space: space.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <div>
            <p className="mb-2 text-[13.5px] font-medium">{t('dialogs.contribute.kind')}</p>
            <Choice<ContributionType>
              name={t('dialogs.contribute.kindGroup')}
              options={contributionTypes(t)}
              value={type}
              onChange={setType}
            />
          </div>

          <div>
            <label htmlFor="con-title" className="mb-2 block text-[13.5px] font-medium">
              {t('dialogs.contribute.titleLabel')}
            </label>
            <input
              id="con-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('dialogs.contribute.titlePlaceholder')}
              autoFocus
              className="console-focusable h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[15px] outline-none placeholder:text-faint"
            />
          </div>

          <div>
            <label htmlFor="con-body" className="mb-2 block text-[13.5px] font-medium">
              {t('dialogs.contribute.body')}
            </label>
            <textarea
              id="con-body"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={4}
              placeholder={t('dialogs.contribute.bodyPlaceholder')}
              className="console-focusable w-full resize-y rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-faint"
            />
          </div>

          <Pressable
            type="button"
            onClick={publish}
            disabled={!title.trim() || !excerpt.trim()}
            className="console-focusable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {t('dialogs.contribute.publish', { space: space.name })}
          </Pressable>
        </div>
      </DialogContent>
    </Dialog>
  );
}
