import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, X, TrendingUp, ChevronRight, Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import { useLectureTagline } from '@/features/student/hooks/useLectureTagline';
import { STREAK_BANNER_DURATION_MS } from '@/lib/constants';
import { MicroQuizCard } from '@/components/MicroQuizCard';
import { AssignmentsPanel } from '@/features/assignments/AssignmentsPanel';
import { KnowledgeMapCard } from '@/components/KnowledgeMapCard';
import { NudgeBanner } from '@/components/NudgeBanner';
import { splitLectureTitle } from '@/lib/utils';
import { topicIcon } from '@/lib/topicIcon';
import {
  DepthScene,
  MediaRail,
  ConsoleTile,
  SectionHeader,
} from '@/components/console';
import { HeroStage } from '@/features/student/components/HeroStage';
import { BentoGrid } from '@/features/student/components/BentoGrid';
import { BrowseRow } from '@/features/student/components/BrowseRow';
import { OnboardPanel } from '@/features/student/components/OnboardPanel';
import { ReviewCelebration } from '@/features/student/components/ReviewCelebration';
import { RecentlyViewed } from '@/features/student/components/RecentlyViewed';
import {
  indexProgress,
  toLectureView,
  selectHero,
  buildWidgets,
  buildRows,
  buildRecentlyViewed,
} from '@/features/student/homeFeed';
import { recordCourseVisit, recordLectureVisit, recordDailyActivity } from '@/services/studentService';
import { SharedRoutes, StudentRoutes } from '@/lib/routes';

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation(['dashboard']);
  const [showStreakBanner, setShowStreakBanner] = useState(false);
  const [focused, setFocused] = useState(0);
  // Defer the heavy below-the-fold widgets until the route transition settles,
  // so the entrance animation (hero + rail) stays buttery instead of janking
  // while bento/rows/cards mount and fire their queries.
  const [showBelowFold, setShowBelowFold] = useState(false);

  const { data: dashboardData, isLoading: loading } = useStudentDashboard();

  // All courses now — no hardcoded course scoping.
  const lectures = useMemo(() => {
    const list = dashboardData?.lectures ?? [];
    return [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [dashboardData]);
  const progressList = useMemo(() => dashboardData?.progress ?? [], [dashboardData]);
  const achievements = useMemo(() => dashboardData?.achievements ?? [], [dashboardData]);
  const courseVisits = useMemo(() => dashboardData?.courseVisits ?? [], [dashboardData]);

  const byId = useMemo(() => indexProgress(progressList), [progressList]);

  // The "brains": hero / bento widgets / browse rows.
  const hero = useMemo(() => selectHero(lectures, byId), [lectures, byId]);
  const widgets = useMemo(
    () => buildWidgets(lectures, byId, achievements, profile),
    [lectures, byId, achievements, profile],
  );
  // Pass courseVisits so buildRows can apply LIFS ordering.
  const rows = useMemo(() => buildRows(lectures, byId, courseVisits), [lectures, byId, courseVisits]);

  // IDs already shown in the Continue Learning rail — used by buildRecentlyViewed.
  const continueIds = useMemo(() => {
    const rail = rows.find((r) => r.id === 'continue');
    return new Set((rail?.items ?? []).map((v) => v.lecture.id));
  }, [rows]);

  // Recently Viewed: deduplicated mix of lectures + courses, MRF ordered.
  const recentItems = useMemo(
    () => buildRecentlyViewed(lectures, byId, courseVisits, hero?.view.lecture.id ?? null, continueIds),
    [lectures, byId, courseVisits, hero, continueIds],
  );

  // The hero kind drives how much of the dashboard we surface: brand-new
  // students (`onboard`) get a focused "start here", all-done students
  // (`review`) get a celebration above their rails, everyone else the full feed.
  const heroKind = hero?.kind;
  const completedCount = useMemo(
    () => lectures.filter((l) => toLectureView(l, byId.get(l.id)).status === 'done').length,
    [lectures, byId],
  );

  // Quiz accuracy across everything the student has answered.
  const accuracy = useMemo(() => {
    const answered = progressList.reduce((s, p) => s + (p.total_questions_answered || 0), 0);
    const correct = progressList.reduce((s, p) => s + (p.correct_answers || 0), 0);
    return answered > 0 ? Math.round((correct / answered) * 100) : 0;
  }, [progressList]);

  // Top rail = all lectures.
  const railItems = lectures;

  // Start focus on the resolver's hero; clamp when the filter changes.
  useEffect(() => {
    if (!hero) return;
    const i = railItems.findIndex((l) => l.id === hero.view.lecture.id);
    setFocused(i >= 0 ? i : 0);
  }, [hero, railItems]);

  const focusedLec = railItems[focused];
  const focusedView = focusedLec ? toLectureView(focusedLec, byId.get(focusedLec.id)) : null;
  const { data: heroTagline } = useLectureTagline(focusedLec?.id);

  const continueLectures = useMemo(
    () => rows.find((r) => r.id === 'continue')?.items ?? [],
    [rows],
  );

  /**
   * Navigate to a lecture, firing recency-tracking writes as a side-effect.
   * Fire-and-forget: we intentionally don't await to keep navigation instant.
   */
  const openLecture = useCallback(
    (lectureId: string) => {
      const lecture = lectures.find((l) => l.id === lectureId);
      if (user?.id && lecture?.course_id) {
        // Non-blocking side effects — don't slow down navigation.
        recordLectureVisit(user.id, lectureId, lecture.course_id).catch(() => {});
        recordCourseVisit(user.id, lecture.course_id).catch(() => {});
      }
      navigate(SharedRoutes.LECTURE(lectureId));
    },
    [lectures, user?.id, navigate],
  );

  useEffect(() => {
    const streak = profile?.current_streak || 0;
    if (streak > 2) {
      setShowStreakBanner(true);
      const timer = setTimeout(() => setShowStreakBanner(false), STREAK_BANNER_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [profile?.current_streak]);

  // Record daily activity when the dashboard loads
  useEffect(() => {
    if (user?.id) {
      recordDailyActivity().catch(() => {});
    }
  }, [user?.id]);

  // Let the screen transition (~exit 0.18s + entrance spring) finish before
  // mounting the expensive below-the-fold section.
  useEffect(() => {
    const id = setTimeout(() => setShowBelowFold(true), 380);
    return () => clearTimeout(id);
  }, []);

  if (loading) {
    return (
      <div className="console-bg relative min-h-screen flex items-end p-6 lg:p-12">
        <div className="w-full space-y-8">
          <div className="h-12 w-1/2 rounded-2xl bg-white/[0.04] animate-pulse" />
          <div className="flex gap-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-[232px] w-[176px] rounded-2xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const streak = profile?.current_streak || 0;
  const displayName = profile?.full_name
    ? profile.full_name.split(' ')[0]
    : user?.email?.split('@')[0] || t('dashboard:fallbackName');

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dashboard:greeting.morning');
    if (hour < 17) return t('dashboard:greeting.afternoon');
    return t('dashboard:greeting.evening');
  };

  const ctaLabel = !focusedView
    ? 'Browse'
    : focusedView.status === 'new'
    ? 'Start'
    : focusedView.status === 'done'
    ? 'Review'
    : 'Continue';

  // Resume to the last viewed slide when continuing the focused lecture.
  const launchFocused = () => {
    if (!focusedLec) return;
    openLecture(focusedLec.id);
  };

  return (
    <DepthScene
      status={focusedView?.status ?? 'progress'}
      gradientIndex={focused}
      motionKey={focusedLec?.id}
    >
      {/* ── Diegetic first screen ── */}
      <section className="relative flex min-h-[calc(100svh-4rem)] flex-col">
        <div className="px-6 lg:px-12 pt-4 space-y-3">
          <NudgeBanner />
          <AnimatePresence>
            {showStreakBanner && (
              <motion.div
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="inline-flex items-center gap-3 rounded-full bg-black/40 backdrop-blur px-4 py-2 border border-warning/30"
              >
                <Flame className="w-4 h-4 text-warning" />
                <span className="text-sm font-bold text-warning">
                  {t('dashboard:streakBanner', { count: streak, defaultValue: `${streak} Day Streak!` })}
                </span>
                <button onClick={() => setShowStreakBanner(false)} className="text-warning/60 hover:text-warning">
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1" />

        {/* Lower third: hero metadata + floating rail */}
        <div className="px-6 lg:px-12 pb-8 space-y-7">
          {focusedLec && focusedView ? (
            <>
              <HeroStage
                view={focusedView}
                eyebrow={`${getGreeting()} · ${displayName}`}
                accuracy={accuracy}
                tagline={heroTagline}
                ctaLabel={ctaLabel}
                onLaunch={launchFocused}
              />
              
              <div className="mt-auto mb-12 relative min-h-[280px]">
                <MediaRail
                  items={railItems}
                  focused={focused}
                  onFocus={setFocused}
                  onActivate={(l) => openLecture(l.id)}
                  getKey={(l) => l.id}
                  getAriaLabel={(l) => splitLectureTitle(l.title).cleanTitle}
                  enableKeyboard
                  cardWidth={176}
                  cardHeight={232}
                  step={196}
                  renderTile={(l, { isActive, index }) => {
                    const m = toLectureView(l, byId.get(l.id));
                    const LectureIcon = topicIcon(m.cleanTitle, l.id);
                    return (
                      <ConsoleTile
                        isActive={isActive}
                        selection="scale"
                        gradientIndex={index}
                        title={m.cleanTitle}
                        progress={m.pct}
                        watermark={m.badge ?? <LectureIcon className="w-14 h-14 text-white/15" />}
                        badge={m.status === 'done' ? { kind: 'done', label: 'Done' } : undefined}
                      />
                    );
                  }}
                />
              </div>
            </>
          ) : (
            <div className="max-w-2xl space-y-4">
              <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/60">
                {getGreeting()} · {displayName}
              </span>
              <h1 className="text-5xl font-black tracking-tight">{t('dashboard:noCourses')}</h1>
              <p className="text-white/60">{t('dashboard:noCoursesDescription')}</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Below the fold: adapts to the hero kind ── */}
      {/* Brand-new student: a focused "start here", not the full firehose. */}
      {showBelowFold && heroKind === 'onboard' && <OnboardPanel />}

      {/* Everyone else (resume / next / review): the full feed, with a
          celebration banner leading the way when everything's done. */}
      {showBelowFold && heroKind !== 'onboard' && (
      <motion.div
        className="console-bg/0 relative"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <div className="p-6 lg:p-12 max-w-7xl mx-auto space-y-12">
          {/* All caught up: celebrate before the rails. */}
          {heroKind === 'review' && (
            <ReviewCelebration
              name={displayName}
              completed={completedCount}
              accuracy={accuracy}
              streak={streak}
            />
          )}

          {/* PS5-style bento grid */}
          <BentoGrid
            widgets={widgets}
            onOpenLecture={(id) => openLecture(id)}
            onViewTrophies={() => navigate(StudentRoutes.ACHIEVEMENTS)}
          />

          {/* Recently Viewed: lectures + courses, MRF ordered, deduplicated */}
          <RecentlyViewed
            items={recentItems}
            onOpenLecture={(id, lastSlide) => {
              // lastSlide is informational — the lecture page handles resuming
              openLecture(id);
            }}
            onOpenCourse={(courseId) => navigate(`/student/courses/${courseId}`)}
          />

          {/* Quick check */}
          {continueLectures[0] && (
            <div className="depth-card p-4 lg:p-6">
              <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-primary">
                <Sparkles className="w-4 h-4" /> Quick check
              </div>
              <MicroQuizCard
                lectureId={continueLectures[0].lecture.id}
                targetSlideNumber={Math.max(
                  1,
                  (byId.get(continueLectures[0].lecture.id)?.last_slide_viewed || 1) - 1,
                )}
              />
            </div>
          )}

          {user?.id && <AssignmentsPanel userId={user.id} />}

          {/* Netflix browse rows: Continue + one per course (LIFS ordered) */}
          {rows.map((row) => (
            <BrowseRow key={row.id} row={row} onOpen={(id) => openLecture(id)} />
          ))}

          {/* Learning Insights teaser */}
          <section className="space-y-6">
            <SectionHeader
              icon={TrendingUp}
              eyebrow={t('dashboard:stats.aiIntelligence')}
              title={t('dashboard:stats.learningInsights')}
            />
            <div
              onClick={() => navigate(StudentRoutes.INSIGHTS)}
              className="depth-card p-6 relative overflow-hidden group cursor-pointer"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary group-hover:scale-110 transition-transform duration-500">
                    <TrendingUp className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                    {t('dashboard:stats.insightsDescription')}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-widest">
                  {t('dashboard:stats.explore')}
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </section>

          {user?.id && <KnowledgeMapCard userId={user.id} />}
        </div>
      </motion.div>
      )}
    </DepthScene>
  );
}
