import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Scene, SURFACES } from '../components/Scene';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { NotFound } from '../components/states';
import { Masthead, Skylight, StageRow, backLink, whitePill } from '../components/stage';
import { useViewer } from '../data/viewer';
import { useLanding } from '../data/landing';
import { ledeKey } from './copy';
import { Figures } from './Figures';
import { LessonMap } from './LessonMap';
import { LunaBubble } from './LunaBubble';
import { QuestionsRow } from './QuestionsRow';
import type { LandingLesson } from './types';

/**
 * How it's landing — the owner's door.
 *
 * One room off the Space, for the one person who runs it. Luna names the one
 * page to open, beside the one white action; three figures say how the
 * Space is going, each with its last weeks; then the map, every Lesson drawn
 * as its pages and lit where people needed help, each finding a sentence
 * that opens onto its evidence. The questions people sent come last.
 *
 * It stands on the stage like every other room of the Space, lit by the
 * colour of the Lesson that needs the owner most, and it never names a
 * person the owner didn't hear from: everything but the questions is an
 * aggregate over at least `floor` people, with the owner's own reading left
 * out. Under the floor it says so once, and shows no figures and no light.
 */
export default function LandingScreen({ spaceId }: { spaceId: string }) {
  const viewer = useViewer();
  const { t } = useTranslation('v4Landing');
  const { state, landing, answer } = useLanding(spaceId);

  if (state !== 'ready' || !landing) {
    return (
      <Scene surface={SURFACES.course} status="progress" motionKey={`landing-${spaceId}`}>
        <SpacesTopBar active="spaces" viewer={viewer} />
        <NotFound what="space" back={{ to: '/v4/spaces', place: 'spaces' }} />
      </Scene>
    );
  }

  const lessons = new Map<string, LandingLesson>(landing.lessons.map((l) => [l.id, l]));
  const lede = ledeKey(landing.insights, landing.readers, landing.floor);
  const loudest = lede === 'floor' ? undefined : landing.insights[0];
  const loudestLesson = loudest ? lessons.get(loudest.lessonId) : undefined;
  const accent = loudestLesson?.color ?? landing.accent;
  const open = landing.questions.filter((q) => !q.answer).length;
  const onePage = lede === 'act' && loudest?.page && loudestLesson;

  const ledeText = onePage
    ? t('door.lede.actPage', { lesson: loudestLesson.title, page: loudest.page! })
    : t(`door.lede.${lede}`, { count: landing.readers });

  return (
    <Scene surface={SURFACES.course} status="progress" motionKey={`landing-${spaceId}`} accent={accent}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      <div className="relative pb-36">
        <Skylight accent={accent} />
        <div className="relative mx-auto max-w-4xl px-6 pt-10 lg:px-8">
          {/* The Space's name rides on the way back, so the title needs no label above it. */}
          <Link to={`/v4/space/${spaceId}`} className={backLink}>
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {landing.spaceName}
          </Link>

          <Masthead className="mt-6" title={t('door.title')} />

          <div className="mt-8 flex flex-col items-center gap-5">
            <LunaBubble text={ledeText} />
            {onePage && (
              <Link to={`/v4/space/${spaceId}/lesson/${loudest.lessonId}/faces?page=${loudest.page}`} className={whitePill}>
                {t('feed.openPage', { page: loudest.page })}
              </Link>
            )}
          </div>

          {lede !== 'floor' && (
            <div className="mt-14">
              <Figures landing={landing} accent={accent} />
            </div>
          )}

          <StageRow id="landing-lessons" title={t('lessons.title')} lede={lede === 'floor' ? undefined : t('lessons.mapLede')}>
            <LessonMap spaceId={spaceId} lessons={landing.lessons} insights={landing.insights} themes={landing.themes} />
          </StageRow>

          <StageRow id="landing-questions" title={t('questions.title')} count={open || undefined}>
            <QuestionsRow questions={landing.questions} lessons={lessons} spaceId={spaceId} accent={accent} onAnswer={answer} />
          </StageRow>

          <p className="mt-16 text-center text-[12.5px] text-quiet">{t('door.ownOnly')}</p>
        </div>
      </div>
    </Scene>
  );
}
