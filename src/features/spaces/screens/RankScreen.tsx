import { ArrowLeft, BookOpen, Check, Heart, Sparkles, Star, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { viewer } from '../mocks/people';
import { viewerStanding } from '../mocks/library';
import {
  standingFor,
  xpBySource,
  xpEvents,
  xpForRank,
  type XpSource,
} from '../mocks/rank';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { Skylight } from '../components/stage';
import { EnterGroup, EnterItem, EnterList, EnterListItem } from '../components/Enter';
import { useScreenState } from '../data/useSpaces';
import { ListSkeleton, SpacesError } from '../components/states';
import { formatNumber, formatTimestamp } from '../i18n/format';

/**
 * Rank — "why is this number what it is?"
 *
 * Profile reports a rank; this screen is the only place that explains one. It
 * exists because the Rank cell was a readout with nowhere to go, and the
 * honest reason it had nowhere to go was that nothing in the product could
 * answer the obvious next question.
 *
 * ## What it is allowed to show
 *
 * Doc 1, Engagement rule 4 is absolute: **"Ranks and the Ascent profile read
 * from XP only. Likes and stars are content signals; they don't have a second
 * progression bolted on."** So there is no like count, no star count and no
 * second bar anywhere here. Every number on this screen is XP or a rank.
 *
 * ## Why a ledger rather than a trophy case
 *
 * The rule people actually trip over is rule 2: **XP is engagement-gated.**
 * It is granted when a contribution is liked, endorsed or used — *never per
 * post*. Somebody who publishes five things and earns nothing has met a rule
 * the product never stated, and will read it as the product being broken.
 *
 * So the centre of this screen is where the XP came from, itemised, and a
 * plain statement of what earns nothing. That is the one thing a rank screen
 * can say that the Rank cell cannot, and it turns an opaque number into a
 * record of things the person actually did.
 *
 * Learn mode: a record of you, calm and browsable. No tables, no multi-select,
 * nothing to manage — the Studio screens are where dense work happens.
 */

/** Each source's label and meaning live in v4People `rank.sources.*`. */
const SOURCE_ICON: Record<XpSource, typeof BookOpen> = {
  learning: BookOpen,
  liked: Heart,
  endorsed: Check,
  used: Sparkles,
  milestone: Star,
};

export default function RankScreen() {
  const { t } = useTranslation('v4People');
  const screenState = useScreenState();
  const { xp } = viewerStanding();
  const { rank, into, span, toNext, pct } = standingFor(xp);
  const bySource = xpBySource();
  /** Newest first: what you did most recently is what you are asking about. */
  const events = [...xpEvents].sort((a, b) => b.at.localeCompare(a.at));

  /*
   * The ladder shown around you, not from Rank 1.
   *
   * Drawing every rank from the first would be a wall of ticks with the
   * interesting part — where you are and what is next — buried in it.
   */
  const ladder = [rank - 1, rank, rank + 1, rank + 2].filter((n) => n >= 1);

  const chrome = (body: React.ReactNode) => (
    // Profile's rooms share its stage and its neutral light (monochrome brand).
    <Scene surface={SURFACES.profile} status="progress" motionKey="rank" accent={null}>
      <SpacesTopBar active="profile" viewer={viewer} />
      <div className="relative">
        <Skylight accent={null} />
        {body}
      </div>
    </Scene>
  );

  if (screenState === 'loading') return chrome(<ListSkeleton label="rank" />);
  if (screenState === 'error') return chrome(<SpacesError what="rank" />);

  return chrome(
    <div className="relative mx-auto max-w-3xl px-6 pb-24 pt-8 lg:px-8">
      <Link
        to="/v4/profile"
        className="console-focusable inline-flex items-center gap-2 rounded-full text-[13.5px] text-quiet transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" />
        {t('v4Spaces:nav.profile')}
      </Link>

      <EnterGroup>
        <EnterItem>
          <header className="mt-6">
            <p className="flex items-center gap-2 text-[13px] font-medium text-quiet">
              <TrendingUp aria-hidden className="h-4 w-4" />
              {t('rank.eyebrow')}
            </p>
            <h1 className="mt-3 text-5xl font-medium tracking-[-0.035em] tabular-nums">
              {t('rank.title', { rank })}
            </h1>
            <p className="mt-3 text-[15px] text-quiet tabular-nums">
              {t('rank.standing', { xp: formatNumber(xp), toNext: formatNumber(toNext), next: rank + 1 })}
            </p>

            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('rank.progressLabel', { rank })}
              className="mt-5 h-2 w-full max-w-md overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[12.5px] text-faint tabular-nums">
              {t('rank.through', { into: formatNumber(into), span: formatNumber(span) })}
            </p>
          </header>
        </EnterItem>

        {/*
          The gate, stated before the ledger rather than after it. Somebody
          arrives here because a number surprised them; the answer should be
          above the evidence, not underneath it.
        */}
        <EnterItem>
          <section className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5">
            <h2 className="text-[15px] font-semibold">{t('rank.gate.title')}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-quiet">
              {t('rank.gate.body')}
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-quiet">
              {t('rank.gate.whoCounts')}
            </p>
          </section>
        </EnterItem>

        <EnterItem>
          <h2 className="mt-10 text-[15px] font-semibold">{t('rank.bySource')}</h2>
        </EnterItem>

        <EnterItem>
          <div className="mt-4 space-y-2">
            {bySource.map((s) => {
              const Icon = SOURCE_ICON[s.source];
              const share = Math.round((s.total / xp) * 100);
              return (
                <div
                  key={s.source}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon aria-hidden className="h-4 w-4 text-quiet" />
                    <span className="text-[14px] font-medium">{t(`rank.sources.${s.source}.label`)}</span>
                    <span className="ml-auto text-[15px] font-semibold tabular-nums">
                      {s.total} XP
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] text-quiet">{t(`rank.sources.${s.source}.meaning`)}</p>
                  {/*
                    A share of *this* total, not a second progression — Doc 1
                    rule 4. It says how one number was made up, and it moves
                    only because XP moved.
                  */}
                  <div
                    aria-hidden
                    className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
                  >
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </EnterItem>

        <EnterItem>
          <h2 className="mt-10 text-[15px] font-semibold">{t('rank.events')}</h2>
        </EnterItem>
      </EnterGroup>

      <EnterList whenVisible className="mt-4 space-y-2">
        {events.map((e) => {
          const Icon = SOURCE_ICON[e.source];
          return (
            <EnterListItem
              key={e.id}
              className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-3.5"
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-snug">{e.label}</p>
                <p className="mt-1 text-[12.5px] text-faint">
                  {/* An account-wide event names no Space, and must not
                      invent one — the orphan row's mistake. */}
                  {[e.spaceName, formatTimestamp(e.at)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums text-primary">
                +{e.amount}
              </span>
            </EnterListItem>
          );
        })}
      </EnterList>

      <EnterGroup whenVisible>
        <EnterItem>
          <h2 className="mt-10 text-[15px] font-semibold">{t('rank.ahead')}</h2>
        </EnterItem>
        <EnterItem>
          <ol className="mt-4 space-y-1.5">
            {ladder.map((n) => {
              const reached = n <= rank;
              const current = n === rank;
              return (
                <li
                  key={n}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-4 rounded-2xl border px-5 py-3',
                    current
                      ? 'border-primary/30 bg-primary/[0.07]'
                      : 'border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'text-[14px] font-medium tabular-nums',
                      reached ? 'text-foreground' : 'text-quiet',
                    )}
                  >
                    {t('rank.title', { rank: n })}
                  </span>
                  {current && (
                    <span className="text-[12.5px] font-medium text-primary">{t('rank.here')}</span>
                  )}
                  <span className="ml-auto text-[13px] text-faint tabular-nums">
                    {n <= 1 ? t('rank.fromStart') : t('rank.xp', { xp: formatNumber(xpForRank(n)) })}
                  </span>
                </li>
              );
            })}
          </ol>
        </EnterItem>
      </EnterGroup>
    </div>,
  );
}
