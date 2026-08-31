import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { viewer } from '../mocks/people';
import {
  actionFor,
  hubInitialSelection,
  hubSpaceById,
  jumpBackIn,
  membershipOf,
  myHubSpaces,
  newThisWeek,
  popularNow,
  spaceOfTheWeek,
} from '../mocks/hub';
import { useScreenState } from '../data/useSpaces';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { HeroCover } from '../components/hub/HeroCover';
import { DISCOVER_ID, SpaceChipRow } from '../components/hub/SpaceChipRow';
import {
  CompactCard,
  FeatureBanner,
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
 */

export default function SpacesHubScreen() {
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
  const fresh = useMemo(() => newThisWeek(), []);
  const featured = useMemo(() => spaceOfTheWeek(), []);

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
   * The hero's copy. Discover is a state of this page, not a Space, so it gets
   * its own content rather than a Space-shaped placeholder.
   */
  const hero =
    shown === DISCOVER_ID || !space
      ? {
          title: 'Find your next space',
          desc: 'Browse Spaces across every subject people here are learning. Join in one click — leave whenever you want.',
          meta: (
            <>
              <b className="font-medium text-quiet">{popular.length}</b> public Spaces ·
              curated weekly
            </>
          ),
          action: { label: 'Browse all', disabled: false },
          to: '/v4/spaces-legacy',
        }
      : {
          title: space.name,
          desc: space.description ?? '',
          meta: (
            <>
              {space.visibility === 'public' ? 'Public' : 'Invite only'} ·{' '}
              <b className="font-medium text-quiet">
                {space.memberCount.toLocaleString()}
              </b>{' '}
              members
              {space.online !== undefined && space.online > 0 && (
                <>
                  {' · '}
                  <b className="font-medium text-quiet">{space.online}</b> online
                </>
              )}
              {' · '}
              {space.lessonCount} {space.lessonCount === 1 ? 'Lesson' : 'Lessons'}
            </>
          ),
          action: actionFor(membershipOf(space)),
          to: `/v4/space/${space.id}`,
        };

  const chrome = (body: React.ReactNode) => (
    <div className="min-h-screen bg-[#0a0b0d] text-white">
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </div>
  );

  if (screenState === 'loading') return chrome(<ListSkeleton label="Loading your Spaces" />);
  if (screenState === 'error') return chrome(<SpacesError what="your Spaces" />);

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-white">
      <HeroCover spaceId={effective} name={hero.title} />

      {/*
        The bar floats over the art rather than sitting above it.

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

      <div className="relative z-[2]">
        {/* ── Calm hero: 100vh, copy anchored left at ~34vh ── */}
        <section className="flex h-screen flex-col justify-end px-[22px] sm:px-16">
          <div className="mb-auto max-w-[560px] pt-[20vh] sm:pt-[34vh]">
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
                  line — information, not decoration — and it sits over
                  artwork, where the backdrop is lightest. Still below the
                  0.62 emphasis nested inside it, so the hierarchy holds.
                */}
                <p className="mb-[30px] text-[13.5px] text-label">{hero.meta}</p>
                <HubPill
                  to={hero.to}
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
          <SpaceChipRow spaces={mine} selected={selected} onSelect={setSelected} />
        </section>

        {/*
          The rails sit on the flat background with a soft top shadow, so
          scrolling past the hero feels like the art ending rather than a
          section boundary.
        */}
        <div
          className="relative z-[2] bg-[#0a0b0d] pb-[110px] pt-14"
          style={{ boxShadow: '0 -60px 80px -20px rgba(10,11,13,.9)' }}
        >
          {/* Empty rails are not rendered. Each of these can legitimately be
              empty — a new account has no Spaces and nothing to jump back to. */}
          {backIn.length > 0 && (
            <Rail title="Jump back in">
              {backIn.map((s) => (
                <WideCard key={s.id} space={s} />
              ))}
            </Rail>
          )}

          {featured && <FeatureBanner space={featured} />}

          {popular.length > 0 && (
            <Rail title="Popular right now">
              {popular.map((s) => (
                <StandardCard key={s.id} space={s} />
              ))}
            </Rail>
          )}

          {fresh.length > 0 && (
            <Rail title="New this week" grid>
              {fresh.map((s) => (
                <CompactCard key={s.id} space={s} />
              ))}
            </Rail>
          )}
        </div>
      </div>
    </div>
  );
}
