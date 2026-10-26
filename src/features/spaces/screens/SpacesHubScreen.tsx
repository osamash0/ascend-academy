import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Trans, useTranslation } from 'react-i18next';
import { useViewer } from '../data/viewer';
import { formatNumber } from '../i18n/format';
import {
  actionFor,
  hubInitialSelection,
  hubSpaceById,
  jumpBackIn,
  membershipOf,
  myHubSpaces,
  newThisWeek,
  popularNow,
  sortSpaces,
  worthALook,
  spaceOfTheWeek,
  type SpaceSort,
} from '../data/hub';
import { archivedForViewer } from '../data/hub';
import { Archive, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ProfessorRoutes } from '@/lib/routes';
import { NewSpaceDialog } from '../components/SpaceDialogs';
import { dataMode } from '../data/liveRepository';
import { cn } from '@/lib/utils';
import { Pressable } from '../components/Pressable';
import { useScreenState } from '../data/useSpaces';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { HeroCover } from '../components/hub/HeroCover';
import { Scene, SURFACES } from '../components/Scene';
import { StarField } from '../components/sky/StarField';
import { DISCOVER_ID, SpaceChipRow } from '../components/hub/SpaceChipRow';
import {
  CompactCard,
  FeatureBanner,
  GUTTER,
  HubPill,
  Rail,
  StandardCard,
  WideCard,
} from '../components/hub/Rails';
import { ListSkeleton, SpacesError } from '../components/states';

/**
 * The Spaces hub.
 *
 * Built to `docs/SPACES-HUB-HANDOFF.md` and `spaces-hub-mock.html`. The page's
 * logic is one sentence from the handoff — **chip row selects → hero reacts →
 * rails discover** — and everything here serves that order.
 *
 * **One page, no membership split.** The previous Spaces screen had Mine and
 * Discover tabs; the spec deletes them, because *membership is a property of a
 * card, never a section split*. "Popular right now" is where that earns its
 * keep: a Space you are in sits beside one you are not, distinguished by a
 * badge and nothing else. The old screen is parked at `/v4/spaces-legacy` so
 * the two can be compared before it goes.
 *
 * **"Spaces" is a hub, not a container.** Abi, 2026-08-31, confirming Doc 1
 * line 42: a Space never contains another Space. So the mock's meta line
 * "9 spaces inside" is rendered as **Lessons** — the same shape, and the only
 * reading that does not invent nesting the model forbids.
 *
 * Two deliberate departures from the mock, both flagged in the plan and both
 * about not losing something the app already has:
 *
 *   • **The top bar stays ours.** The mock's bar is an app mark, "Spaces",
 *     search and an overflow menu. Rendering that exactly would remove the
 *     only route to Home, Library, Social and Profile from this page. The
 *     spec's scroll behaviour is worth having; its navigation is not.
 *   • **Presence renders only where it is real.** `online` is optional and
 *     absent means unknown, not zero. NEEDS-BACKEND.
 *
 * **A night sky, on the stage** (Abi, 2026-10-26). The hashed cover gradients
 * are gone: they washed the page in a colour per Space and broke the
 * monochrome black stage every other room stands on. Each Space is now a
 * planet whose moons are its Lessons, lit gold as you finish them, over a
 * faint field of stars. The page renders through `Scene` on the stage like
 * the other rooms, so the ground, the top bar's scroll pane and the phone's
 * bottom-bar spacer all come from the one place.
 */

export default function SpacesHubScreen() {
  const viewer = useViewer();
  const { t } = useTranslation('v4Spaces');
  const screenState = useScreenState();
  const [selected, setSelected] = useState(() => hubInitialSelection());

  /*
   * The spec's empty case, made inspectable.
   *
   * "New user with 0 joins: chip row shows only Discover, hero shows featured
   * space with Join, rails = discover content only." That is a real state with
   * its own layout, not a guard — but `?mock=empty` did nothing here, so it was
   * a state nobody could look at. Treating the empty scenario as "no
   * memberships" renders exactly what the spec describes, and makes the Join
   * and Request-access hero states reachable, which the chip row alone cannot
   * do because it only ever holds Spaces you are already in.
   */
  const asNewAccount = screenState === 'empty';
  const mine = useMemo(() => (asNewAccount ? [] : myHubSpaces()), [asNewAccount]);
  const backIn = useMemo(() => (asNewAccount ? [] : jumpBackIn()), [asNewAccount]);
  const popular = useMemo(() => popularNow(), []);
  const archived = useMemo(() => archivedForViewer(), []);
  const [sort, setSort] = useState<SpaceSort>('active');
  const [newOpen, setNewOpen] = useState(false);
  const navigate = useNavigate();
  /*
   * Create lives where your Spaces are listed. Live, a Space is a course,
   * and courses are made in the existing manager (as Manage already hands
   * off there), so New Space opens its create dialog; the demo keeps its
   * own dialog.
   */
  const newSpace = () =>
    dataMode(import.meta.env.VITE_V4_DATA_MODE) === 'live'
      ? navigate(`${ProfessorRoutes.COURSES}?new=1`)
      : setNewOpen(true);
  const sortedMine = useMemo(() => sortSpaces(mine, sort), [mine, sort]);
  const fresh = useMemo(() => newThisWeek(), []);
  const featured = useMemo(() => spaceOfTheWeek(), []);
  const discoverable = useMemo(() => worthALook(), []);

  /*
   * With no memberships the chip row cannot hold the selection, so the hero
   * falls back to the featured Space — landing a new account on something
   * joinable rather than on an empty stage.
   */
  const effective = asNewAccount && selected !== DISCOVER_ID ? featured?.id ?? DISCOVER_ID : selected;

  /*
   * `shown` lags `effective` by one 180ms beat: the copy fades out, the content
   * is replaced, and it fades back in. The art behind it changes immediately
   * and takes 0.75s, so the two are deliberately out of step.
   */
  const [shown, setShown] = useState(effective);
  const swapping = shown !== effective;
  useEffect(() => {
    if (shown === effective) return;
    const t = window.setTimeout(() => setShown(effective), 180);
    return () => window.clearTimeout(t);
  }, [effective, shown]);

  const space = shown === DISCOVER_ID ? undefined : hubSpaceById(shown);

  /*
   * "Last opened" is said only when it is true: the Space of yours you were
   * most recently active in. Any other selection is a Space you are looking
   * at, not one you last opened, so it gets no label.
   */
  const lastOpenedId = useMemo(
    () =>
      mine.reduce<(typeof mine)[number] | undefined>(
        (best, s) => (!best || +new Date(s.lastActiveAt) > +new Date(best.lastActiveAt) ? s : best),
        undefined,
      )?.id,
    [mine],
  );

  /*
   * Discover is a scope for the whole page, not a section inside it.
   *
   * "chip row selects → hero reacts → rails discover" is the page's stated
   * order, and the rails were the part that never reacted: selecting Discover
   * changed the hero copy and the cover art while "Jump back in" carried on
   * listing the Spaces you are already in. The spec says what this state holds
   * for a new account — "rails = discover content only" — and the chip is the
   * same scope chosen deliberately rather than reached by having joined
   * nothing.
   *
   * Keyed off `shown` rather than `selected` so the rails turn over on the
   * same 180ms beat as the hero copy instead of a frame ahead of it.
   */
  const onDiscover = shown === DISCOVER_ID;
  const railsRef = useRef<HTMLDivElement>(null);

  /*
   * The hero's copy. Discover is a state of this page, not a Space, so it gets
   * its own content rather than a Space-shaped placeholder.
   */
  const hero =
    shown === DISCOVER_ID || !space
      ? {
          title: t('hub.discover.title'),
          desc: t('hub.discover.desc'),
          /*
           * Counts what the rails below actually hold.
           *
           * This read `popular.length` and called them "public Spaces", and
           * `popularNow` includes both invite-only Spaces and ones you are
           * already a member of — so the number was wrong twice over, on the
           * one line whose whole job is to say how much there is to look at.
           * "curated weekly" went with it: nothing curates anything weekly.
           */
          meta: (
            <Trans
              t={t}
              i18nKey="hub.discover.notJoined"
              count={discoverable.length}
              components={{ b: <b className="font-medium text-quiet" /> }}
            />
          ),
          /*
           * Stays on this page. It used to be a Link to `/v4/spaces-legacy` —
           * the screen this hub replaced — so the one action on Discover was
           * to leave. The content is the rails below the fold, and this is the
           * hero's only affordance for reaching them on a 100vh stage.
           */
          action: { label: t('hub.discover.browse'), disabled: discoverable.length === 0 },
          to: undefined,
          onPress: () => railsRef.current?.scrollIntoView({ block: 'start' }),
        }
      : {
          title: space.name,
          desc: space.description ?? '',
          meta: (
            <>
              {space.visibility === 'public' ? t('hub.meta.public') : t('hub.meta.invite')} ·{' '}
              <Trans
                t={t}
                i18nKey="hub.meta.members"
                count={space.memberCount}
                values={{ n: formatNumber(space.memberCount) }}
                components={{ b: <b className="font-medium text-quiet" /> }}
              />
              {space.online !== undefined && space.online > 0 && (
                <>
                  {' · '}
                  <Trans
                    t={t}
                    i18nKey="hub.meta.online"
                    values={{ n: formatNumber(space.online) }}
                    components={{ b: <b className="font-medium text-quiet" /> }}
                  />
                </>
              )}
              {' · '}
              {t('badges.lessons', { count: space.lessonCount })}
            </>
          ),
          /* The mock's state machine decides; the label is said here. */
          action: {
            ...actionFor(membershipOf(space)),
            label: t(`hub.action.${membershipOf(space)}`),
          },
          to: `/v4/space/${space.id}`,
          onPress: undefined,
        };

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.spaces} status="progress" motionKey="spaces" accent={null}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  if (screenState === 'loading') return chrome(<ListSkeleton label="spaces" />);
  if (screenState === 'error') return chrome(<SpacesError what="spaces" />);

  return (
    <Scene surface={SURFACES.spaces} status="progress" motionKey="spaces" accent={null}>
      {/* The sky stays put while the page scrolls over it. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <StarField seed="spaces-hub" count={70} />
      </div>

      {/*
        The bar floats over the hero rather than sitting above it.

        Ours is `sticky`, so it occupies flow height — which pushed the hero
        down by 38px and left the chip row 4px below the fold, on a page whose
        entire premise is that the row is visible without scrolling. The mock's
        bar is `position: fixed` for exactly this reason. Fixed here keeps the
        hero a true 100vh *and* keeps the bar in place while the rails scroll
        under it, which is what "blurs and darkens on scroll" needs.
      */}
      <div className="fixed inset-x-0 top-0 z-40">
        <SpacesTopBar active="spaces" viewer={viewer} />
      </div>

      <div data-hub className="relative z-[2]">
        {/* ── Calm hero: 100vh, copy anchored left at ~34vh ── */}
        <section className="relative flex h-screen flex-col justify-end px-[22px] sm:px-16">
          {/* The selected Space as a planet, right of the copy. */}
          <HeroCover space={space} swapping={swapping} />
          <div className="relative mb-auto max-w-[560px] pt-[30vh] sm:pt-[34vh]">
            {/*
              Out fast, swap, in — the spec's phrasing, and the mock's actual
              mechanism: one element that dips to transparent, has its content
              replaced at the trough, and comes back.

              Not `AnimatePresence mode="wait"`, which was the obvious reading
              and is wrong here. Wait-mode holds the incoming content until the
              outgoing *exit* finishes, so scrubbing the chip row queues swaps
              and the hero crawls through every Space you passed. Worse, if an
              exit never completes the new copy never mounts at all — which is
              precisely what happened in this preview browser: the selection
              reached Cryptography while the title sat on Linear Algebra, with
              a single `h1` in the DOM.

              One element cannot deadlock, and the last change always wins.
            */}
              <motion.div
                initial={false}
                animate={{ opacity: swapping ? 0 : 1, y: swapping ? 8 : 0 }}
                transition={{ duration: 0.2 }}
              >
                {/*
                  One quiet line above the name, and only when it is true.
                  The slot keeps its height either way, so the title does not
                  jump as the selection moves.
                */}
                <p className="mb-3 min-h-[1.25em] text-[13px] text-label">
                  {space && space.id === lastOpenedId ? t('hub.hero.lastOpened') : null}
                </p>
                {/* Weight 300 — the one light weight in the product. */}
                <h1 className="mb-[22px] text-[clamp(46px,5.6vw,74px)] font-light leading-[1.03] tracking-[-1px]">
                  {hero.title}
                </h1>
                {hero.desc && (
                  <p className="mb-2 max-w-[44ch] text-[16px] leading-[1.6] text-quiet">
                    {hero.desc}
                  </p>
                )}
                {/*
                  `text-label` (0.58), not `text-white/40`.
                  BUILD-PROMPT §4: "do not reintroduce raw text-white/40
                  … measured as AA failures". This is the hero's meta
                  line — information, not decoration — and it sits beside
                  the planet, on the stage. Still below the
                  0.62 emphasis nested inside it, so the hierarchy holds.
                */}
                <p className="mb-[30px] text-[13.5px] text-label">{hero.meta}</p>
                <HubPill
                  to={hero.to}
                  onPress={hero.onPress}
                  label={hero.action.label}
                  disabled={hero.action.disabled}
                />
              </motion.div>
          </div>

          {/*
            The chip row is pinned to the bottom of the hero viewport, not to
            the window — it belongs to the hero, and a fixed row would sit over
            the rails you scrolled down to read.
          */}
          {/*
            Sorted, with the control beside the row rather than gated on a
            count.
            `notes-spaces-screen.md` says "sort control … past ~8 Spaces", and
            a threshold was the first thing I wrote. Two problems: the viewer
            has five, so the control would never have rendered and the whole
            path would have shipped unexercised — and a control that appears at
            eight and vanishes at seven is a moving target in a row whose job
            is to be the one stable thing on the page.
          */}
          {/* No GUTTER here: the section already has it, and twice put New Space a gutter right of "Your Spaces". */}
          <div className="flex items-center justify-end gap-1">
            <Pressable
              type="button"
              onClick={newSpace}
              className="console-focusable mr-auto flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 text-[12.5px] font-semibold text-slate-900"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
              {t('hub.legacy.newSpace')}
            </Pressable>
            {(['active', 'name'] as const).map((by) => (
              <Pressable
                key={by}
                subtle
                type="button"
                aria-pressed={sort === by}
                onClick={() => setSort(by)}
                className={cn(
                  'console-focusable rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors',
                  sort === by
                    ? 'bg-white/[0.14] text-foreground'
                    : 'text-quiet hover:bg-white/[0.06] hover:text-foreground',
                )}
              >
                {by === 'active' ? t('hub.sort.active') : t('hub.sort.name')}
              </Pressable>
            ))}
          </div>
          <SpaceChipRow spaces={sortedMine} selected={selected} onSelect={setSelected} />
          <NewSpaceDialog open={newOpen} onOpenChange={setNewOpen} />
        </section>

        {/*
          The rails stand on the same stage and the same sky as the hero —
          one night, no section boundary drawn across it.
        */}
        <div ref={railsRef} className="relative z-[2] pb-[110px] pt-14">
          {/* Empty rails are not rendered. Each of these can legitimately be
              empty — a new account has no Spaces and nothing to jump back to. */}
          {/*
            "Jump back in" is your Spaces, which is the one thing Discover is
            not. It is the rail that made selecting Discover read as a no-op.
          */}
          {!onDiscover && backIn.length > 0 && (
            <Rail title={t('hub.rail.jumpBackIn')}>
              {backIn.map((s) => (
                <WideCard key={s.id} space={s} />
              ))}
            </Rail>
          )}

          {/* Already discover content: the most-starred Space you are not in. */}
          {featured && <FeatureBanner space={featured} />}

          {onDiscover
            ? discoverable.length > 0 && (
                <Rail title={t('hub.rail.worthALook')}>
                  {discoverable.map((s) => (
                    <StandardCard key={s.id} space={s} />
                  ))}
                </Rail>
              )
            : popular.length > 0 && (
                <Rail title={t('hub.rail.popular')}>
                  {popular.map((s) => (
                    <StandardCard key={s.id} space={s} />
                  ))}
                </Rail>
              )}

          {fresh.length > 0 && (
            <Rail title={t('hub.rail.newThisWeek')} grid>
              {fresh.map((s) => (
                <CompactCard key={s.id} space={s} />
              ))}
            </Rail>
          )}

          {/*
            Archived Spaces — collapsed, at the bottom, never absent.
            `myHubSpaces` filters on `state === 'active'`, so these appeared
            nowhere on this screen: not in the chip row, not in a rail. The
            viewer's "Statistik I" was unreachable from Spaces entirely, and
            Doc 1 defines archived as "read-only, **keeps progress**, earns no
            XP" — so the progress recorded there was unreachable with it.
            `notes-spaces-screen.md`: "collapsed section at bottom, never
            hidden (progress lives there)".
            A `<details>` rather than state: it is a disclosure, it works
            before hydration, and the browser gives it the right semantics for
            free.
          */}
          {archived.length > 0 && (
            <details className={cn('mt-4', GUTTER)}>
              <summary className="console-focusable inline-flex cursor-pointer items-center gap-2 rounded-full text-[13.5px] text-quiet transition-colors hover:text-foreground">
                <Archive aria-hidden className="h-4 w-4" />
                {t('hub.archived.summary', { count: archived.length })}
              </summary>
              <p className="mt-3 max-w-[60ch] text-[13px] text-faint">
                {t('hub.archived.body')}
              </p>
              <div className="mt-4 flex flex-wrap gap-4">
                {archived.map((s) => (
                  <CompactCard key={s.id} space={s} />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </Scene>
  );
}
