import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import { Scene, SURFACES } from '../components/Scene';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Pressable } from '../components/Pressable';
import { DetailSkeleton, NotFound, SpacesError } from '../components/states';
import { loadLiveRepository } from '../data/liveRepository';
import { useScreenState } from '../data/useSpaces';
import { useRefreshWorld, useViewer } from '../data/viewer';
import { publishedLessonsForSpace, spaceById } from '../data/world';

/**
 * A live Space you have not joined.
 *
 * It shows what is *inside* — the Lessons, in order — so nobody joins blind,
 * and one action: Join. Joining enrols you in the course; the world reloads
 * and this same URL becomes the Space itself. Who is in it stays visible to
 * members only, as everywhere else.
 */
export default function JoinSpaceScreen({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation('v4Spaces');
  const viewer = useViewer();
  const refreshWorld = useRefreshWorld();
  const space = spaceById(spaceId);
  const screenState = useScreenState();
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState(false);

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.course} status="progress" motionKey={spaceId}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  if (screenState === 'loading') return chrome(<DetailSkeleton />);
  if (screenState === 'error') return chrome(<SpacesError what="space" />);
  if (!space) return chrome(<NotFound what="space" back={{ to: "/v4/spaces", place: "spaces" }} />);
  const lessons = publishedLessonsForSpace(space.id);

  const join = async () => {
    setJoining(true);
    setFailed(false);
    try {
      await (await loadLiveRepository()).joinSpace(space.id);
      await refreshWorld();
    } catch {
      setFailed(true);
      setJoining(false);
    }
  };

  return chrome(
    <div className="mx-auto max-w-[680px] px-[22px] pb-36 pt-16 sm:pt-24">
      <p className="text-[13px] text-quiet">
        {space.owner.name} · <b className="font-medium">{space.memberCount.toLocaleString()}</b>{' '}
        {space.memberCount === 1 ? 'member' : 'members'}
      </p>
      <h1 className="mt-3 text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
        {space.name}
      </h1>
      {space.description && <p className="mt-4 text-[16px] leading-relaxed text-quiet">{space.description}</p>}

      <Pressable
        type="button"
        onClick={join}
        disabled={joining}
        className="console-focusable mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-white px-8 text-[14px] font-semibold text-slate-900 disabled:opacity-60"
      >
        {joining ? t('join.joining') : t('join.join')}
      </Pressable>
      {failed && (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {t('join.failed')}
        </p>
      )}

      <h2 className="mt-14 text-[13px] font-medium text-quiet">{t('join.inside')}</h2>
      <ol className="mt-4 space-y-1">
        {lessons.map((l) => (
          <li key={l.id} className="flex items-center gap-3 rounded-xl px-3 py-3 text-[15px]">
            <span className="w-6 shrink-0 text-right tabular-nums text-quiet">{l.order}</span>
            <BookOpen aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
            <span className="truncate">{l.title}</span>
          </li>
        ))}
      </ol>
    </div>,
  );
}
