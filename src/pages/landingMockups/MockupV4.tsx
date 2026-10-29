/**
 * Mockup D — the v4 edition, after the Hallmark and Impeccable floors.
 *
 * Built only from v4's own pieces (skylight, centred masthead, journey line,
 * UpNext, stage rows) and held to both floors: no eyebrow and no middle-dot
 * meta, figures instead of gauges and each with its recent history, no glow
 * on dark, a hairline list where cards would have been the lazy container,
 * numbers in ink with a swatch for the Lesson, one authored motion, copy
 * without dashes. The one signature move: the Space's journey line with the
 * pages that need you lit in their deck's colour.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Scene, SURFACES } from '@/features/spaces/components/Scene';
import { SpacesTopBar } from '@/features/spaces/components/SpacesTopBar';
import { Masthead, Skylight, StageRow, UpNext, backLink } from '@/features/spaces/components/stage';
import { useViewer } from '@/features/spaces/data/viewer';
import { useLanding } from '@/features/spaces/data/landing';
import { QuestionsRow } from '@/features/spaces/landing/QuestionsRow';
import { cardCopy } from '@/features/spaces/landing/copy';
import type { LandingLesson } from '@/features/spaces/landing/types';
import { History, LunaSays, METERS, bigNumber, findingsFor, lessonColor } from './shared';

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const STRENGTH = { act: 100, watch: 55, calm: 28, few: 0 } as const;
const INK = 'hsl(var(--foreground))';

export default function MockupV4() {
  const viewer = useViewer();
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  const { landing, answer } = useLanding('s-dbs');
  if (!landing) return null;

  const lessons = new Map<string, LandingLesson>(landing.lessons.map((l) => [l.id, l]));
  const loudest = landing.insights[0];
  const loudestLesson = lessons.get(loudest.lessonId)!;
  const accent = lessonColor(loudestLesson);
  const open = landing.questions.filter((q) => !q.answer).length;
  const rest = landing.insights.slice(1);
  const n0 = bigNumber(loudest);

  return (
    <Scene surface={SURFACES.course} status="progress" motionKey="mock-v4" accent={accent}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      <div className="relative pb-36">
        <Skylight accent={accent} />
        <div className="relative mx-auto max-w-4xl px-6 pt-10 lg:px-8">
          {/* The Space's name rides on the way back, so the title needs no label above it. */}
          <Link to="/v4/space/s-dbs" className={backLink}>
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {landing.spaceName}
          </Link>

          <Masthead className="mt-6" title={t('door.title')} />

          <div className="mt-8 flex justify-center">
            <LunaSays text={t('door.lede.act')} size={64} />
          </div>

          {/* Three figures, each with its last eight weeks. Hairlines between them, no gauges. */}
          <motion.dl
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-14 grid max-w-3xl grid-cols-3 divide-x divide-white/[0.08]"
          >
            {[
              { m: METERS.reading, color: INK },
              { m: METERS.landing, color: accent },
              { m: METERS.cleared, color: 'hsl(var(--success))' },
            ].map(({ m, color }, i) => (
              <div key={m.of} className={cn('flex flex-col px-5 sm:px-8', i === 0 && 'pl-0', i === 2 && 'pr-0')}>
                <dd className="text-[40px] font-medium leading-none tabular-nums tracking-[-0.03em] sm:text-[48px]">{m.number}</dd>
                <dt className="mt-2 max-w-[16ch] text-[13px] leading-snug text-quiet">{m.of}</dt>
                <History values={m.history} color={color} className="mt-4" />
              </div>
            ))}
          </motion.dl>

          {/* The page that needs you most: the card Home and the Space already use for what is next. */}
          <div className="mt-14">
            <UpNext
              to={`/v4/space/s-dbs/lesson/${loudest.lessonId}/faces?page=${loudest.page}`}
              number={loudest.page ?? loudestLesson.order}
              kicker={`${loudestLesson.title}, page ${loudest.page}. ${n0.value} ${n0.word}.`}
              title={cardCopy(t, loudest, loudestLesson.title).headline}
              accent={accent}
              verb={t('feed.openPage', { page: loudest.page })}
            />
          </div>

          <StageRow id="v4-questions" title={t('questions.title')} count={open || undefined}>
            <QuestionsRow questions={landing.questions} lessons={lessons} spaceId="s-dbs" accent={accent} onAnswer={answer} />
          </StageRow>

          {/* The signature move: the journey line, each Lesson ringed in its deck colour, the pages that need you lit. */}
          <StageRow id="v4-lessons" title={t('lessons.title')}>
            <ol className="relative">
              <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-px bg-gradient-to-b from-white/[0.18] via-white/[0.08] to-transparent" />
              {landing.lessons.map((l) => {
                const color = lessonColor(l);
                const few = l.light === 'few';
                const finds = findingsFor(l.id).filter((f) => f.page);
                return (
                  <li key={l.id} className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-5 pb-9">
                    <LessonRing order={l.order} color={color} strength={STRENGTH[l.light]} reduce={Boolean(reduce)} />
                    <div className="min-w-0 pt-1">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6">
                        <h3 className="text-[21px] font-medium leading-tight tracking-[-0.015em]">
                          <Link to={`/v4/space/s-dbs/lesson/${l.id}`} className="console-focusable rounded-sm hover:underline hover:decoration-white/30 hover:underline-offset-4">
                            {l.title}
                          </Link>
                        </h3>
                        <span className="text-[13px] tabular-nums text-quiet">{few ? t('light.few') : t('lessons.readers', { count: l.readers })}</span>
                      </div>
                      {finds.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {finds.map((f) => {
                            const n = bigNumber(f);
                            const strong = f.attention === 'act';
                            return (
                              <Link
                                key={f.id}
                                to={`/v4/space/s-dbs/lesson/${l.id}/faces?page=${f.page}`}
                                className="console-focusable inline-flex h-9 items-center gap-2.5 rounded-full pl-3.5 pr-4 text-[13px] transition-colors hover:brightness-125"
                                style={{ background: mix(color, strong ? 20 : 10) }}
                              >
                                <span className="tabular-nums">{t('picture.page', { page: f.page })}</span>
                                <span className="tabular-nums text-quiet">
                                  {n.value} {n.word}
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </StageRow>

          {/* The rest of what needs you: a list parted by hairlines, the number in ink, a swatch for the Lesson. */}
          <StageRow id="v4-feed" title={t('feed.title')}>
            <ol className="divide-y divide-white/[0.08]">
              {rest.map((f) => {
                const l = lessons.get(f.lessonId);
                if (!l) return null;
                const color = lessonColor(l);
                const n = bigNumber(f);
                const copy = cardCopy(t, f, l.title);
                const strong = f.attention === 'act';
                return (
                  <li
                    key={f.id}
                    className={cn('-mx-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 rounded-xl px-4 py-5', strong && 'my-1')}
                    style={strong ? { background: mix(color, 7) } : undefined}
                  >
                    <div className="min-w-0">
                      <p className="text-[19px] font-medium leading-snug tracking-[-0.015em]">{copy.headline}</p>
                      <p className="mt-1 flex items-center gap-2 text-[13px] text-quiet">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
                        {l.title}
                        {f.page ? `, ${t('questions.page', { page: f.page }).toLowerCase()}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[26px] font-medium leading-none tabular-nums tracking-[-0.03em]">{n.value}</p>
                      <p className="mt-1 text-[12.5px] text-quiet">{n.word}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </StageRow>

          <p className="mt-16 text-center text-[12.5px] text-quiet">{t('door.ownOnly')}</p>
        </div>
      </div>
    </Scene>
  );
}

/** A Lesson's marker on the line: a ring in its deck colour, as strong as its light. Drawn once, no glow. */
function LessonRing({ order, color, strength, reduce }: { order: number; color: string; strength: number; reduce: boolean }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative flex h-10 w-10 items-center justify-center">
      <svg aria-hidden width={40} height={40} className="absolute inset-0 -rotate-90">
        <circle cx={20} cy={20} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={2.5} />
        {strength > 0 && (
          <motion.circle
            cx={20}
            cy={20}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: reduce ? c * (1 - strength / 100) : c }}
            animate={{ strokeDashoffset: c * (1 - strength / 100) }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </svg>
      <span className={cn('relative text-[14px] font-medium tabular-nums', strength > 0 ? 'text-foreground' : 'text-quiet')}>{order}</span>
    </span>
  );
}
