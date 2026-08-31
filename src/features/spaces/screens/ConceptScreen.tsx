import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ListChecks, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import type { ConceptProgress } from '../types';
import { spaceById } from '../mocks/spaces';
import { visibleLessonsForSpace } from '../mocks/lessons';
import { conceptById, contributionsForConcept } from '../mocks/concepts';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Scene, SURFACES } from '../components/Scene';
import { ContributionCard } from '../components/ContributionCard';
import { SpacesError } from '../components/states';

/**
 * One Concept — "a single idea inside a Lesson" (Doc 1). The map's planet.
 *
 * Laid out from the Ratings-Details inspo: the focused object stated plainly on
 * the left, its context behind and beside it. What that means here is that the
 * *state of the idea* is the headline — cleared, read, or not yet — because
 * that is the only question a learner opens a Concept to answer.
 *
 * Three things live here and nowhere else:
 *   • which Lessons touch it (`RelatedLecture` in the backend — a Concept
 *     genuinely recurs across Lessons, so this is a list, not a single link);
 *   • its practice;
 *   • the community section at **Concept** anchor level — the third anchor
 *     Doc 1 defines, and the one that had no fixtures until now.
 *
 * Browse surface: you are choosing what to do with this idea, not reading it.
 */

const STATE: Record<ConceptProgress, { label: string; blurb: string; cls: string }> = {
  cleared: {
    label: 'Cleared',
    blurb: 'You have answered practice on this correctly.',
    cls: 'border-success/40 bg-success/12 text-success',
  },
  discovered: {
    label: 'Read',
    blurb: 'You have met this idea but not yet proved it.',
    cls: 'border-white/15 bg-white/[0.06] text-quiet',
  },
  untouched: {
    label: 'Not yet',
    blurb: 'You have not reached this idea.',
    cls: 'border-white/12 bg-transparent text-faint',
  },
};

export default function ConceptScreen() {
  const { spaceId, conceptId } = useParams<{ spaceId: string; conceptId: string }>();
  const space = spaceId ? spaceById(spaceId) : undefined;
  const concept = conceptId ? conceptById(conceptId) : undefined;

  const lessons = useMemo(() => {
    if (!space || !concept) return [];
    // Rule 1: a Concept must not name a Lesson this viewer cannot open.
    return visibleLessonsForSpace(space).filter((l) => concept.lessonIds.includes(l.id));
  }, [space, concept]);

  const contributions = useMemo(
    () => (concept ? contributionsForConcept(concept.id) : []),
    [concept],
  );

  const chrome = (body: React.ReactNode, gradientIndex = 0) => (
    <Scene
      surface={SURFACES.spaceOverview}
      status="progress"
      gradientIndex={gradientIndex}
      motionKey={conceptId}
    >
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  if (!space || !concept) return chrome(<SpacesError />);

  const Icon = topicIcon(concept.name, concept.id);
  const state = STATE[concept.progress];
  const practiceTotal = lessons.reduce((n, l) => n + l.practiceCount, 0);

  return chrome(
    <div className="pb-24">
      {/* Context behind, object in front — the Ratings-Details shape. */}
      <div className="relative">
        <div
          aria-hidden
          className={cn(
            'absolute left-1/2 top-0 h-[280px] w-screen -translate-x-1/2 bg-gradient-to-br opacity-30',
            gradientFor(concept.name.length),
          )}
        />
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-[280px] w-screen -translate-x-1/2 bg-gradient-to-t from-[#070b14] via-[#070b14]/60 to-transparent"
        />
        <Icon
          aria-hidden
          className="pointer-events-none absolute right-8 top-10 hidden h-32 w-32 text-white/[0.05] lg:block"
        />

        <div className="relative mx-auto max-w-4xl px-6 pt-6 lg:px-8">
          <Link
            to={`/v4/space/${space.id}`}
            className="console-focusable -ml-2 mb-8 inline-flex h-9 items-center gap-2 rounded-full px-2 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {space.name}
          </Link>

          <p className="text-[13px] text-quiet">Idea in {space.name}</p>
          <h1 className="mt-2 max-w-[18ch] text-4xl font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
            {concept.name}
          </h1>

          {/* The state is the headline — it is why you opened this. */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium',
                state.cls,
              )}
            >
              {concept.progress === 'cleared' && <Check aria-hidden className="h-3.5 w-3.5" />}
              {state.label}
            </span>
            <span className="text-[14px] text-quiet">{state.blurb}</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        {/* Where it appears. A Concept crosses Lessons — that is what
            RelatedLecture exists for — so this is a list, not one link. */}
        <section className="mt-10">
          <h2 className="mb-4 text-[14px] font-medium text-quiet">
            Appears in
            <span className="ml-2 tabular-nums text-faint">{lessons.length}</span>
          </h2>
          <ul className="space-y-2.5">
            {lessons.map((l) => (
              <li key={l.id}>
                <Link
                  to={`/v4/space/${space.id}/lesson/${l.id}`}
                  className="console-focusable flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-4 transition-colors hover:bg-white/[0.05]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[13px] font-semibold tabular-nums text-quiet">
                    {l.order}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15.5px] font-semibold">{l.title}</span>
                    <span className="mt-0.5 block text-[13px] text-quiet">
                      {l.author.name}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {practiceTotal > 0 && (
          <section className="mt-9">
            <h2 className="mb-4 text-[14px] font-medium text-quiet">Practice</h2>
            <button
              type="button"
              className="console-focusable flex w-full items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-4 text-left transition-colors hover:bg-white/[0.05]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-quiet">
                <ListChecks aria-hidden className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-semibold">
                  Practise this idea
                </span>
                <span className="mt-0.5 block text-[13px] text-quiet tabular-nums">
                  {practiceTotal} questions across{' '}
                  {lessons.length === 1 ? 'its Lesson' : `${lessons.length} Lessons`}
                </span>
              </span>
            </button>
          </section>
        )}

        {/* Concept-level community — Doc 1's third anchor. */}
        <section className="mt-10">
          <h2 className="mb-1 text-[14px] font-medium text-origin-community">
            From the community
            <span className="ml-2 tabular-nums">{contributions.length}</span>
          </h2>
          <p className="mb-5 text-[13px] text-faint">
            What members made for this one idea. Sorted by what people found most useful.
          </p>

          {contributions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center">
              <Sparkles aria-hidden className="mx-auto mb-3 h-5 w-5 text-quiet" />
              <p className="mb-1.5 text-[15px] font-semibold">Nothing here yet</p>
              <p className="mx-auto max-w-[44ch] text-[14px] leading-relaxed text-quiet">
                A worked example or a mnemonic for this idea would help whoever meets it
                next.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {contributions.map((c, i) => (
                <ContributionCard
                  key={c.id}
                  contribution={c}
                  space={space}
                  isOwn={c.author.id === viewer.id}
                  featured={i === 0 && contributions.length > 1}
                  className={i === 0 && contributions.length > 1 ? 'sm:col-span-2' : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>,
    concept.name.length,
  );
}
