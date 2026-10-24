import { Flame, PartyPopper, Play, Plus, RotateCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { LunaHero } from '@/features/avatar/LunaHero';
import { useViewerLight, useViewerLoadout } from '@/features/avatar/viewerLoadout';
import { cn } from '@/lib/utils';
import { Pressable, PressableLink } from '../components/Pressable';
import { topicIcon } from '@/lib/topicIcon';
import { AskBar } from '../components/AskBar';
import { LessonTile } from '../components/LessonTile';
import type { HomeItem } from '../data/home';
import { askAcknowledgement, askModel, askNow, askSuggestionsNow, type AskAnswer } from '../data/assistant';
import { say } from '../data/phrases';
import { liveWorld } from '../data/world';
import { useHome } from '../data/useSpaces';
import { useViewer } from '../data/viewer';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Masthead, Sep, Skylight, StageRow, UpNext, ghostPill, stageAccentFor } from '../components/stage';
import { Scene, SURFACES } from '../components/Scene';
import { JoinSpaceDialog, NewSpaceDialog } from '../components/SpaceDialogs';
import { SpacesError, SpacesSkeleton } from '../components/states';

/**
 * Home — "what do I do now?"
 *
 * Your next action, assembled across every Space. The landing screen after
 * login and the daily driver.
 *
 * The rule that shapes it: **Home links to Lessons and practice, never to a
 * Space card.** A Home item names its Space as context and opens the Lesson.
 * Home ranks across all Spaces and answers "the one thing"; the Spaces list
 * shows per-Space progress and resumes that Space. Same information at two
 * altitudes — Home is a decision, a Space card is a status.
 *
 * Learn mode: this is where a tired person lands, so it stays calm. One
 * primary action, and everything else subordinate to it.
 */

/**
 * What a row *is*. Every entry names a state, never an instruction.
 *
 * `continue` used to read "Pick up where you left off", and that one word of
 * difference put the same sentence on two items at once: the hero said it about
 * `Basics`, and a row in "Also waiting" said it about `Differential
 * Cryptanalysis`. Both were true — you can be part-way through two Lessons —
 * which is why the fix is not to drop one of them. The hero's Lesson was never
 * in the feed to begin with, so there was nothing to deduplicate.
 *
 * The tell is the register. "Up next", "Due for review" and "New since you were
 * here" all name a state; "Pick up where you left off" issues a command. It was
 * written for the hero, where an instruction is exactly right, and then reused
 * as a row label by one shared map read at two altitudes. A list says what
 * something is and lets you choose; the hero says what to do, because its whole
 * job is to be "the one thing".
 */
const REASON_LABEL: Record<HomeItem['reason'], string> = {
  continue: 'home.reason.continue',
  next: 'home.reason.next',
  review: 'home.reason.review',
  new: 'home.reason.new',
};

/**
 * What the hero says instead, where it differs.
 *
 * Only `continue` needs its own phrasing — the other three read the same at
 * either altitude, and duplicating them here would create the second place that
 * can disagree. Falls back to `REASON_LABEL`, so a new reason is a row label
 * first and gains a hero voice only if it earns one.
 */
const HERO_LABEL: Partial<Record<HomeItem['reason'], string>> = {
  continue: 'home.heroContinue',
};

/* Both tables hold keys; the screen says them in the reader's language. */
const heroLabel = (reason: HomeItem['reason']) => HERO_LABEL[reason] ?? REASON_LABEL[reason];

const REASON_ICON: Record<HomeItem['reason'], typeof Play> = {
  continue: Play,
  next: Play,
  review: RotateCw,
  new: Sparkles,
};

/*
 * Home states no progression of its own: the top bar carries Rank and XP on
 * every screen, and the streak is said once, in the greeting.
 */

/** Which greeting the hour calls for — a key, said whole with the name in it. */
const greetingKey = () => {
  const h = new Date().getHours();
  if (h < 5) return 'home.greeting.night';
  if (h < 12) return 'home.greeting.morning';
  if (h < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
};

export default function HomeScreen() {
  const viewer = useViewer();
  const { t } = useTranslation('v4Spaces');
  const navigate = useNavigate();
  const greeting = t(greetingKey(), { name: viewer.name });
  const { state, kind, next, feed, recent, streakDays } = useHome();
  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  /** The most recent thing you touched — the target for "Review something". */
  const lastTouched = recent[0] ?? feed[0];
  /*
   * Recently viewed shows only what nothing else on Home already offers — the
   * hero and the queue each name a Lesson once, so the rail does not repeat
   * them (it used to show Introduction three times over).
   */
  const inQueue = new Set([next?.lessonId, ...feed.map((i) => i.lessonId)]);
  const unseenRecent = recent.filter((r) => !inQueue.has(r.lessonId));


  /*
   * What you asked Luna, echoed back.
   *
   * Deliberately not an answer. There is no assistant behind this yet, and a
   * fabricated reply from something billed as grounded on your own material is
   * indistinguishable from a wrong one — the same reason Grounding renders no
   * marker at all until an Owner switches it on.
   */
  const [asked, setAsked] = useState<string | null>(null);
  /* Live: what the tutor said. Demo keeps the honest acknowledgement. */
  const [answer, setAnswer] = useState<
    { state: 'thinking' } | { state: 'done'; a: AskAnswer } | { state: 'failed' } | null
  >(null);
  const live = liveWorld() !== null;
  /* What Luna watches: the ask bar's focus, each keystroke, each send. */
  const [asking, setAsking] = useState(false);
  const [keys, setKeys] = useState(0);
  const [sent, setSent] = useState(0);
  /* Big, but never crowding a phone. */
  const viewerLoadout = useViewerLoadout();
  const [sizeLuna, setSizeLuna] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 230 : 340));
  useEffect(() => {
    const on = () => setSizeLuna(window.innerWidth < 640 ? 230 : 340);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  /*
   * Home is lit by the one thing it points at: the next Lesson's colour. With
   * nothing to point at yet — a brand-new account, straight out of first run —
   * it is lit by the light they picked for Luna, so the room they arrive in is
   * the one they just switched on.
   */
  const viewerLight = useViewerLight();
  const accent = next ? stageAccentFor(next.lessonOrder) : state === 'ready' ? viewerLight : null;

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.home} status="progress" motionKey="home" accent={accent}>
      <SpacesTopBar active="home" viewer={viewer} />
      <div className="relative">
        <Skylight accent={accent} />
        {body}
      </div>
    </Scene>
  );

  if (state === 'loading') return chrome(<SpacesSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="next" />);

  // Brand-new account: nothing to continue. One action, join or create — and
  // this is the only place Home may point at Spaces rather than a Lesson,
  // because there is no Lesson to point at yet.

  if (kind === 'review' && next) {
    return chrome(
      <div className="relative mx-auto max-w-3xl px-6 pb-24 pt-20 text-center lg:px-8">
        <PartyPopper aria-hidden className="mx-auto mb-6 h-9 w-9 text-xp" />
        <h1 className="text-[44px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[56px]">
          {t('home.caughtUp.title', { name: viewer.name })}
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15.5px] leading-[1.75] text-quiet">
          {t('home.caughtUp.body')}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {/* Reviewing means reopening something you have finished. With
              nothing left to do, the most recent thing you touched is the
              honest target. */}
          <Pressable
            type="button"
            onClick={() =>
              navigate(
                lastTouched
                  ? `/v4/space/${lastTouched.spaceId}/lesson/${lastTouched.lessonId}`
                  : '/v4/spaces',
              )
            }
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-slate-900"
          >
            <RotateCw aria-hidden className="h-4 w-4" />
            {t('home.caughtUp.review')}
          </Pressable>
          <button
            type="button"
            onClick={() => navigate('/v4/spaces')}
            className={ghostPill}
          >
            {t('home.caughtUp.find')}
          </button>
        </div>
      </div>,
    );
  }

  if (!next && live) {
    /*
     * Live, a new account's first step is the catalog. Creating a Space would
     * make an empty course v4 cannot fill yet (no upload here), and courses
     * carry no join code — so both of the demo's buttons would lead nowhere
     * real. They come back when v4 can upload and invite.
     */
    return chrome(
      <div className="relative mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 pb-16 text-center">
        <LunaHero loadout={viewerLoadout} size={sizeLuna} accent={accent} className="mb-6" />
        <h1 className="mb-4 text-[44px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[56px]">
          {greeting}
        </h1>
        <p className="mb-8 max-w-[46ch] text-[15.5px] leading-[1.75] text-quiet">
          {t('home.empty.liveBody')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Pressable
            type="button"
            onClick={() => navigate('/v4/spaces')}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-slate-900"
          >
            {t('home.empty.find')}
          </Pressable>
          {/* Your own material: the Library is the one place v4 brings files in. */}
          <Link to="/v4/library" className={ghostPill}>
            {t('home.empty.bring')}
          </Link>
        </div>
      </div>,
    );
  }

  if (!next) {
    return chrome(
      <div className="relative mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 pb-16 text-center">
        <LunaHero loadout={viewerLoadout} size={sizeLuna} accent={accent} className="mb-6" />
        <h1 className="mb-4 text-[44px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[56px]">
          {greeting}
        </h1>
        <p className="mb-8 max-w-[46ch] text-[15.5px] leading-[1.75] text-quiet">
          {t('home.empty.body')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Pressable
            type="button"
            onClick={() => setNewOpen(true)}
            className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[14px] font-semibold text-slate-900"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {t('home.empty.create')}
          </Pressable>
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className={ghostPill}
          >
            {t('home.empty.join')}
          </button>
        </div>
        <NewSpaceDialog open={newOpen} onOpenChange={setNewOpen} />
        <JoinSpaceDialog open={joinOpen} onOpenChange={setJoinOpen} />
      </div>,
    );
  }

  return chrome(
    <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-10 lg:px-8">
      <section aria-labelledby="home-greeting" className="flex flex-col items-center text-center">
        {/*
          Luna, alive (Abi, 2026-10-11): only her head, big, in the space above
          the greeting. Her halo is the next Lesson's light; she follows the
          pointer, looks down at the ask bar when you write, nods as you type,
          cheers when you send, and droops a little when it is very late.
        */}
        <LunaHero
          loadout={viewerLoadout}
          size={sizeLuna}
          accent={accent}
          attention={asking ? 'listening' : 'idle'}
          nudge={keys}
          cheer={sent}
          sleepy={new Date().getHours() < 5}
        />
        {/*
          No plates any more. They existed because the browse ground glowed
          and drifted behind the text; on the stage the ground is black, so
          the contrast is constant without them.
        */}
        <Masthead
          className="mt-4"
          eyebrow={
            <>
              {greeting}
              {/* The streak, said once, where you are greeted — it was a
                  bento cell repeating a number the Profile also shows. */}
              {streakDays > 0 && (
                <>
                  <Sep />
                  <Flame aria-hidden className="mb-0.5 mr-1 inline h-3.5 w-3.5 text-streak" />
                  {t('home.streak', { count: streakDays })}
                </>
              )}
            </>
          }
          title={<span id="home-greeting">{t('home.focus')}</span>}
        />
      </section>

      {/*
        The prompt. Live, the grounded course tutor answers from the material
        in the Space you are working in, with its sources as Lesson pages
        (data/assistant.ts → POST /v4/ask). In demo there is no tutor, so
        `askAcknowledgement` names the question back rather than invent a reply.
      */}
      <div
        className="mt-10"
        onFocusCapture={() => setAsking(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAsking(false);
        }}
        onKeyDownCapture={() => setKeys((k) => k + 1)}
      >
        <AskBar
          placeholder={t('home.askPlaceholder')}
          suggestions={askSuggestionsNow().map((p) => say(t, p))}
          model={askModel}
          onSubmit={(q) => {
            setAsked(q);
            setSent((n) => n + 1);
            if (!live) return;
            setAnswer({ state: 'thinking' });
            askNow(q)
              .then((a) => setAnswer({ state: 'done', a }))
              .catch(() => setAnswer({ state: 'failed' }));
          }}
        />
        {asked && !live && (
          <p
            role="status"
            className="mx-auto mt-3 max-w-2xl rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[13px] leading-6 text-quiet"
          >
            {say(t, askAcknowledgement(asked))}
          </p>
        )}
        {asked && live && answer && (
          <div
            role="status"
            aria-live="polite"
            className="mx-auto mt-3 max-w-2xl rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-[14px] leading-6"
          >
            {answer.state === 'thinking' && <p className="text-quiet">{t('home.answer.thinking')}</p>}
            {answer.state === 'failed' && (
              <p className="text-quiet">{t('home.answer.failed')}</p>
            )}
            {answer.state === 'done' && (
              <>
                {answer.a.spaceName && <p className="mb-1.5 text-[12px] text-quiet">{t('home.answer.from', { space: answer.a.spaceName })}</p>}
                <p className="whitespace-pre-line text-foreground">{answer.a.reply}</p>
                {answer.a.citations.length > 0 && answer.a.spaceId && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {answer.a.citations.map((c) => (
                      <Link
                        key={`${c.lessonId}-${c.page}`}
                        to={`/v4/space/${answer.a.spaceId}/lesson/${c.lessonId}/faces?page=${c.page}`}
                        className="console-focusable rounded-full bg-white/[0.06] px-3 py-1 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.1] hover:text-foreground"
                      >
                        {t('home.answer.citation', { lesson: c.lessonTitle ?? t('home.answer.lesson'), page: c.page })}
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/*
        ── The one thing ──
        Home was three layers saying the same things: bento cells (Due for
        review, New since you were here), a Recently viewed rail, and an "Also
        waiting" list — the same Lessons in each (Abi, 2026-10-10: one fact,
        once). Now: the one thing, as the same Up next card a Space shows,
        then one queue where every item says why it is there.

        Doc 2: "Home links to Lessons and practice, never to a Space card." The
        Space is named as context; the card opens the Lesson.
      */}
      <div className="mt-14">
        <UpNext
          to={`/v4/space/${next.spaceId}/lesson/${next.lessonId}`}
          number={next.lessonOrder}
          kicker={`${next.spaceName} · ${
            next.percentComplete > 0
              ? t('home.percentRead', { percent: next.percentComplete })
              : t(heroLabel(next.reason))
          }`}
          title={next.lessonTitle}
          percent={next.percentComplete}
          accent={accent ?? '#ffffff'}
          verb={next.percentComplete > 0 ? t('home.continue') : t('home.start')}
        />
      </div>

      {/* Everything else, still Lesson-level. Never a Space card. */}
      {feed.length > 0 && (
        <StageRow id="feed-heading" title={t('home.alsoToday')} count={feed.length}>
          <ul className="space-y-2.5">
            {feed.map((item) => {
              const Icon = REASON_ICON[item.reason];
              return (
                <li key={`${item.lessonId}-${item.reason}`}>
                  <article className="group relative flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-quiet">
                      <Icon aria-hidden className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-faint">{t(REASON_LABEL[item.reason])}</p>
                      <h3 className="mt-0.5 truncate text-[15.5px] font-semibold">
                        {item.lessonTitle}
                      </h3>
                      {/* Context, not an entry point. */}
                      <p className="mt-0.5 text-[13px] text-quiet">
                        {t('home.lessonIn', { space: item.spaceName, order: item.lessonOrder })}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-quiet transition-colors sm:flex',
                        'group-hover:bg-white/[0.12]',
                      )}
                    >
                      <Play aria-hidden className="h-3.5 w-3.5 fill-current" />
                    </span>
                    {/* The whole card is the target — it announced itself as
                        one and had no handler. The rail above it navigated
                        correctly, so this was one live row pattern and one
                        dead one on the same screen. */}
                    <Link
                      to={`/v4/space/${item.spaceId}/lesson/${item.lessonId}`}
                      className="console-focusable absolute inset-0 rounded-2xl"
                      aria-label={t('home.feedLabel', {
                        reason: t(REASON_LABEL[item.reason]),
                        title: item.lessonTitle,
                        order: item.lessonOrder,
                        space: item.spaceName,
                      })}
                    >
                      <span className="sr-only">{t('home.open')}</span>
                    </Link>
                  </article>
                </li>
              );
            })}
          </ul>
        </StageRow>
      )}
      {unseenRecent.length > 0 && (
        <StageRow id="recent-heading" title={t('home.recent')}>
          {/* A rail, like the Spaces rows — and Lesson-level, like everything
              else on Home. Excludes whatever "Continue" already offers. */}
          <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {unseenRecent.map((r) => {
              const Icon = topicIcon(r.lessonTitle, r.lessonId);
              return (
                /*
                 * A link, not a button. Both opened the Lesson, but these four
                 * covers were the only Lesson targets on Home that carried no
                 * `href` — "Also waiting" below is already `<Link>`. So the
                 * same act had two implementations, and the button half lost
                 * cmd-click, middle-click, open-in-new-tab and the status-bar
                 * preview. `PressableLink` keeps the identical press feel and
                 * was already in use on three other screens; Home was the
                 * outlier, not the pattern.
                 */
                <PressableLink
                  key={r.lessonId}
                  to={`/v4/space/${r.spaceId}/lesson/${r.lessonId}`}
                  aria-label={t('home.recentLabel', {
                    title: r.lessonTitle,
                    order: r.lessonOrder,
                    space: r.spaceName,
                  })}
                  className="console-focusable block h-[150px] w-[13.5rem] shrink-0 rounded-2xl text-left"
                >
                  {/*
                    Cover art, not a plain card. `LessonTile` existed, matched
                    this product's console language, and nothing in the repo
                    imported it — so its progress bar, its watermark and its
                    "Done" badge had never rendered against anything. A
                    component with no call site is written, not built.
                  */}
                  <LessonTile
                    title={r.lessonTitle}
                    eyebrow={r.spaceName}
                    gradientIndex={r.lessonOrder}
                    progress={r.percentComplete}
                    done={r.percentComplete === 100}
                    watermark={<Icon aria-hidden className="h-16 w-16 text-white/[0.10]" />}
                  />
                </PressableLink>
              );
            })}
          </div>
        </StageRow>
      )}

    </div>,
  );
}
