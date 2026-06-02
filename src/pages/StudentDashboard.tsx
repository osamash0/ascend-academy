import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { 
  BookOpen, Trophy, Target, Flame, Zap, Star, X, PlayCircle, 
  Sparkles, TrendingUp, Clock, ChevronRight, Award
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import { STREAK_BANNER_DURATION_MS } from '@/lib/constants';
import { LectureCard } from '@/components/LectureCard';
import { StatsCard } from '@/components/StatsCard';
import { AchievementCard } from '@/components/AchievementCard';
import { Button } from '@/components/ui/button';
import { AssignmentsPanel } from '@/features/assignments/AssignmentsPanel';
import { KnowledgeMapCard } from '@/components/KnowledgeMapCard';
import { NudgeBanner } from '@/components/NudgeBanner';

import type { Lecture, StudentProgress as Progress, Achievement } from '@/types/domain';

type FilterTab = 'all' | 'inprogress' | 'completed';

const FILTER_TAB_KEYS: { key: FilterTab; i18nKey: string }[] = [
  { key: 'all', i18nKey: 'dashboard:filters.all' },
  { key: 'inprogress', i18nKey: 'dashboard:filters.inProgress' },
  { key: 'completed', i18nKey: 'dashboard:filters.completed' },
];

/* ── Orbital Background Component ── */
function OrbitalBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Primary aurora orb */}
      <motion.div
        className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(234 89% 68% / 0.08) 0%, transparent 70%)',
          filter: 'blur(100px)',
        }}
        animate={{
          x: [0, 30, 0],
          y: [0, 20, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      
      {/* Secondary aurora orb */}
      <motion.div
        className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(270 60% 55% / 0.06) 0%, transparent 70%)',
          filter: 'blur(120px)',
        }}
        animate={{
          x: [0, -20, 0],
          y: [0, -30, 0],
          scale: [1, 1.15, 1],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
      />
      
      {/* Accent orb */}
      <motion.div
        className="absolute top-[40%] right-[20%] w-[30%] h-[30%] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(190 90% 60% / 0.04) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.5, 0.8, 0.5],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 10 }}
      />
    </div>
  );
}

/* ── Floating Particles Component ── */
function FloatingParticles() {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 10,
    duration: 15 + Math.random() * 20,
    size: 2 + Math.random() * 4,
  }));

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-primary/20"
          style={{
            left: `${p.x}%`,
            bottom: '-10px',
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -window.innerHeight * 1.2],
            x: [0, (Math.random() - 0.5) * 100],
            opacity: [0, 0.6, 0],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
}

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation(['dashboard']);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showStreakBanner, setShowStreakBanner] = useState(false);
  const lecturesRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  // Use the new cached hook
  const { data: dashboardData, isLoading: loading } = useStudentDashboard();
  
  const lectures = (dashboardData?.lectures || []).filter(
    l => l.course?.title === 'Database Systems'
  );
  const progress = (dashboardData?.progress || []).filter(
    p => lectures.some(l => l.id === p.lecture_id)
  );
  const achievements = dashboardData?.achievements || [];
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);
  const heroY = useTransform(scrollYProgress, [0, 0.5], [0, -50]);

  useEffect(() => {
    const streak = profile?.current_streak || 0;
    if (streak > 2) {
      setShowStreakBanner(true);
      const timer = setTimeout(() => setShowStreakBanner(false), STREAK_BANNER_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [profile?.current_streak]);

  const getProgressForLecture = (lectureId: string) =>
    progress.find(p => p.lecture_id === lectureId);

  const totalQuestionsAnswered = progress.reduce((s, p) => s + (p.total_questions_answered || 0), 0);
  const totalCorrect = progress.reduce((s, p) => s + (p.correct_answers || 0), 0);
  const accuracy = totalQuestionsAnswered > 0
    ? Math.round((totalCorrect / totalQuestionsAnswered) * 100)
    : 0;

  const filteredLectures = lectures.filter(lecture => {
    const lp = getProgressForLecture(lecture.id);
    const completed = lp?.completed_slides?.length || 0;
    const total = lecture.total_slides;
    const pct = total > 0 ? (completed / total) * 100 : 0;

    if (activeTab === 'completed') return pct === 100;
    if (activeTab === 'inprogress') return pct > 0 && pct < 100;
    return true;
  });

  const continueLectures = lectures.filter(lecture => {
    const lp = getProgressForLecture(lecture.id);
    if (!lp || lp.completed_at) return false;
    const completed = lp.completed_slides?.length || 0;
    const total = lecture.total_slides;
    return total > 0 && completed > 0 && completed < total;
  });

  if (loading) {
    return (
      <div className="relative min-h-screen p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        <OrbitalBackground />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-5 animate-pulse">
              <div className="h-4 w-20 bg-surface-2 rounded mb-3" />
              <div className="h-8 w-14 bg-surface-2 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass-card p-5 animate-pulse space-y-3">
              <div className="h-5 w-3/4 bg-surface-2 rounded" />
              <div className="h-4 w-full bg-surface-2 rounded" />
              <div className="h-4 w-2/3 bg-surface-2 rounded" />
              <div className="h-2 w-full bg-surface-2 rounded-full mt-4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const streak = profile?.current_streak || 0;
  const level = profile?.current_level || 1;
  const displayName = profile?.full_name
    ? profile.full_name.split(' ')[0]
    : user?.email?.split('@')[0] || t('dashboard:fallbackName');

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dashboard:greeting.morning');
    if (hour < 17) return t('dashboard:greeting.afternoon');
    return t('dashboard:greeting.evening');
  };

  return (
    <div className="relative min-h-screen">
      <OrbitalBackground />
      <FloatingParticles />
      
      <div className="relative z-10 p-6 lg:p-8 max-w-7xl mx-auto space-y-10">

        {/* ── Nudge engine banner (highest-priority active nudge) ── */}
        <NudgeBanner />

        {/* ── Streak Celebration Banner ── */}
        <AnimatePresence>
          {showStreakBanner && (
            <motion.div
              initial={{ opacity: 0, y: -20, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -20, height: 0 }}
              className="rounded-2xl overflow-hidden"
            >
              <div className="glass-panel-strong border border-warning/30 px-5 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <motion.span
                    className="text-2xl"
                    animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1.5 }}
                  >
                    🔥
                  </motion.span>
                  <span className="font-semibold text-warning">
                    {t('dashboard:streakBanner', { count: streak })}
                  </span>
                </div>
                <button
                  onClick={() => setShowStreakBanner(false)}
                  className="text-warning/60 hover:text-warning transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Hero Banner — Orbital Design ── */}
        <motion.div
          ref={heroRef}
          style={{ opacity: heroOpacity, scale: heroScale, y: heroY }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-3xl overflow-hidden"
        >
          {/* Living gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/10" />
          
          {/* Animated mesh gradient */}
          <div className="absolute inset-0 opacity-30">
            <div 
              className="absolute inset-0"
              style={{
                backgroundImage: `
                  radial-gradient(at 40% 20%, hsl(234 89% 68% / 0.3) 0px, transparent 50%),
                  radial-gradient(at 80% 0%, hsl(270 60% 55% / 0.2) 0px, transparent 50%),
                  radial-gradient(at 0% 50%, hsl(190 90% 60% / 0.15) 0px, transparent 50%),
                  radial-gradient(at 80% 50%, hsl(234 89% 68% / 0.2) 0px, transparent 50%),
                  radial-gradient(at 0% 100%, hsl(270 60% 55% / 0.15) 0px, transparent 50%)
                `,
                animation: 'aurora-drift 20s ease-in-out infinite',
              }}
            />
          </div>

          {/* Glass overlay */}
          <div className="absolute inset-0 glass-panel opacity-50" />

          <div className="relative p-8 lg:p-10 flex flex-col gap-6">
            {/* Top row: greeting + orbital badges */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-2">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="text-caption text-primary/80 uppercase tracking-widest font-medium">
                    {getGreeting()}
                  </span>
                  <h1 className="text-display-md text-foreground mt-1">
                    {(() => {
                      const parts = t('dashboard:welcomeBack', { name: '__NAME__' }).split('__NAME__');
                      return (
                        <>
                          {parts[0]}
                          <span className="text-gradient-aurora">{displayName}</span>
                          {parts[1] ?? ''}
                        </>
                      );
                    })()}
                  </h1>
                </motion.div>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="text-body-md text-muted-foreground max-w-lg"
                >
                  {(() => {
                    const raw = t('dashboard:subtitle', { count: continueLectures.length });
                    const segments = raw.split(/<bold>|<\/bold>/);
                    return segments.map((seg, idx) =>
                      idx % 2 === 1
                        ? <strong key={idx} className="text-foreground">{seg}</strong>
                        : <span key={idx}>{seg}</span>
                    );
                  })()}
                </motion.p>
              </div>

              {/* Orbital Badge Cluster */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
                className="flex items-center gap-3 flex-wrap"
              >
                <div className="glass-panel px-4 py-2 rounded-full flex items-center gap-2 group hover:border-primary/30 transition-colors">
                  <Star className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                  <span className="text-sm font-semibold text-foreground">{t('dashboard:level', { level })}</span>
                </div>
                <div className="glass-panel px-4 py-2 rounded-full flex items-center gap-2 group hover:border-xp/30 transition-colors">
                  <Zap className="w-4 h-4 text-xp group-hover:scale-110 transition-transform" />
                  <span className="text-sm font-semibold text-xp">{profile?.total_xp || 0} XP</span>
                </div>
                {streak > 0 && (
                  <motion.div 
                    className="glass-panel px-4 py-2 rounded-full flex items-center gap-2 group hover:border-warning/30 transition-colors"
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Flame className="w-4 h-4 text-warning group-hover:scale-110 transition-transform" />
                    <span className="text-sm font-semibold text-warning">{t('dashboard:dayStreak', { count: streak })}</span>
                  </motion.div>
                )}
              </motion.div>
            </div>

            {/* XP Progress — Orbital Style */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="space-y-2"
            >
              <div className="flex justify-between text-caption text-muted-foreground">
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  {t('dashboard:progressToLevel', { level: level + 1 })}
                </span>
                <span>{t('dashboard:xpProgress', { current: (profile?.total_xp || 0) % 100 })}</span>
              </div>
              <div className="h-3 bg-surface-2 rounded-full overflow-hidden relative">
                <motion.div
                  className="h-full rounded-full relative"
                  style={{
                    background: 'linear-gradient(90deg, hsl(45 93% 55%), hsl(38 92% 58%))',
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${((profile?.total_xp || 0) % 100)}%` }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.8 }}
                >
                  {/* Glow tip */}
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-xp rounded-full shadow-glow-xp" />
                  {/* Shimmer overlay */}
                  <div className="absolute inset-0 animate-shimmer" />
                </motion.div>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* ── Stats Grid — Glass Cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { key: 'coursesStarted', title: t('dashboard:stats.coursesStarted'), value: progress.length, icon: BookOpen, variant: 'primary', glow: 'shadow-glow-primary' },
            { key: 'quizAccuracy', title: t('dashboard:stats.quizAccuracy'), value: `${accuracy}%`, subtitle: t('dashboard:stats.accuracySubtitle', { correct: totalCorrect, total: totalQuestionsAnswered }), icon: Target, variant: 'success', glow: 'shadow-glow-success' },
            { key: 'bestStreak', title: t('dashboard:stats.bestStreak'), value: profile?.best_streak || 0, icon: Flame, variant: 'warning' },
            { key: 'achievements', title: t('dashboard:stats.achievements'), value: achievements.length, icon: Trophy, variant: 'xp', glow: 'shadow-glow-xp' },
          ].map((stat, index) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * index, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <StatsCard
                title={stat.title}
                value={stat.value}
                subtitle={stat.subtitle}
                icon={stat.icon}
                variant={stat.variant as 'default' | 'success' | 'xp' | 'primary' | 'warning'}
                className={stat.glow}
                onClick={() => {
                  if (stat.key === 'coursesStarted') {
                    lecturesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  } else if (stat.key === 'achievements') {
                    navigate('/achievements');
                  }
                }}
              />
            </motion.div>
          ))}
        </div>

        {/* ── Assignments Panel ── */}
        {user?.id && <AssignmentsPanel userId={user.id} />}

        {/* ── Continue Learning — Orbital Carousel ── */}
        {continueLectures.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-heading-lg text-foreground">{t('dashboard:continueLearning')}</h2>
            </div>
            
            <div className="flex overflow-x-auto pb-4 gap-5 snap-x snap-mandatory scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
              <AnimatePresence>
                {continueLectures.map((lecture, index) => {
                  const p = getProgressForLecture(lecture.id);
                  const completed = p?.completed_slides?.length || 0;
                  const total = lecture.total_slides;
                  const pct = Math.min(100, Math.round((completed / total) * 100));

                  return (
                    <motion.div
                      key={`continue-${lecture.id}`}
                      initial={{ opacity: 0, x: -30 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      className="min-w-[340px] sm:min-w-[380px] flex-shrink-0 snap-start"
                    >
                      <div
                        onClick={() => navigate(`/lecture/${lecture.id}`)}
                        className="group cursor-pointer glass-card overflow-hidden relative"
                      >
                        {/* Hover glow effect */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        
                        <div className="relative p-6">
                          <div className="flex items-start justify-between gap-4 mb-5">
                            <div className="space-y-1">
                              <h3 className="font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors duration-300">
                                {lecture.title}
                              </h3>
                              <p className="text-body-sm text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {t('dashboard:resumeFromSlide', { slide: (p?.last_slide_viewed ?? completed) + 1 })}
                              </p>
                            </div>
                            <motion.div 
                              className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary flex-shrink-0"
                              whileHover={{ scale: 1.1, rotate: 5 }}
                              whileTap={{ scale: 0.95 }}
                            >
                              <PlayCircle className="w-6 h-6 text-white" />
                            </motion.div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-caption text-muted-foreground font-medium">
                              <span>{t('dashboard:percentComplete', { percent: pct })}</span>
                              <span>{t('dashboard:slidesProgress', { completed, total })}</span>
                            </div>
                            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full rounded-full relative"
                                style={{
                                  background: 'linear-gradient(90deg, hsl(234 89% 68%), hsl(270 60% 55%))',
                                }}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                              >
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-glow-primary" />
                              </motion.div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* ── Lectures Section ── */}
        <div ref={lecturesRef} className="scroll-mt-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <h2 className="text-heading-lg text-foreground">{t('dashboard:yourCourses')}</h2>
            </div>

            {lectures.length > 0 && (
              <div className="flex items-center bg-surface-1 rounded-xl p-1 gap-1 relative border border-border">
                {FILTER_TAB_KEYS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors z-10 ${activeTab === tab.key
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    {activeTab === tab.key && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 bg-surface-2 rounded-lg shadow-sm border border-border z-[-1]"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    {t(tab.i18nKey)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {filteredLectures.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card p-12 text-center"
            >
              <motion.div 
                className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-5 shadow-glow-primary"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <BookOpen className="w-10 h-10 text-white" />
              </motion.div>
              <h3 className="text-heading-sm text-foreground mb-2">
                {t('dashboard:noCourses')}
              </h3>
              <p className="text-body-sm text-muted-foreground">
                {t('dashboard:noCoursesDescription')}
              </p>
            </motion.div>
          ) : (
            (() => {
              // Group lectures by course; lectures without a course go into
              // a single "Uncategorized" group rendered last.
              const groups = new Map<string, { title: string; lectures: typeof filteredLectures }>();
              for (const l of filteredLectures) {
                const key = l.course?.id ?? l.course_id ?? '__uncat__';
                const title = l.course?.title ?? (key === '__uncat__' ? t('dashboard:uncategorized') : t('dashboard:courseFallback'));
                if (!groups.has(key)) groups.set(key, { title, lectures: [] });
                groups.get(key)!.lectures.push(l);
              }
              const ordered = [...groups.entries()].sort(([a], [b]) => {
                if (a === '__uncat__') return 1;
                if (b === '__uncat__') return -1;
                return 0;
              });
              return (
                <div className="space-y-10">
                  {ordered.map(([key, group]) => (
                    <section key={key} className="space-y-4">
                      <div className="flex items-center gap-3">
                        <h3 className="text-heading-sm text-foreground">{group.title}</h3>
                        <span className="text-xs text-muted-foreground">
                          {t('dashboard:lectureCount', { count: group.lectures.length })}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                        <AnimatePresence mode="popLayout">
                          {group.lectures.map((lecture, index) => {
                            const lectureProgress = getProgressForLecture(lecture.id);
                            return (
                              <motion.div
                                key={lecture.id}
                                layout
                                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                                transition={{ delay: index * 0.04, type: 'spring', stiffness: 300, damping: 24 }}
                                whileHover={{ y: -8, scale: 1.02, transition: { type: 'spring', stiffness: 400, damping: 17 } }}
                                whileTap={{ scale: 0.98 }}
                              >
                                <LectureCard
                                  id={lecture.id}
                                  title={lecture.title}
                                  description={lecture.description || undefined}
                                  totalSlides={lecture.total_slides}
                                  completedSlides={lectureProgress?.completed_slides?.length || 0}
                                  quizScore={lectureProgress?.correct_answers || 0}
                                  totalQuestions={lectureProgress?.total_questions_answered || 0}
                                  index={index}
                                  onClick={() => navigate(`/lecture/${lecture.id}`)}
                                />
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </div>
                    </section>
                  ))}
                </div>
              );
            })()
          )}
        </div>

        {/* ── Learning Insights Section ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="text-heading-lg text-foreground">{t('dashboard:stats.learningInsights')}</h2>
          </div>
          <div 
            onClick={() => navigate('/insights')}
            className="glass-card p-6 border-white/5 relative overflow-hidden group cursor-pointer hover:border-primary/30 hover:shadow-glow-primary/20 transition-all duration-500"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary group-hover:scale-110 transition-transform duration-500">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{t('dashboard:stats.learningInsights')}</h3>
                  <p className="text-xs font-bold text-primary uppercase tracking-widest mt-0.5">{t('dashboard:stats.aiIntelligence')}</p>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-xl">
                    {t('dashboard:stats.insightsDescription')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-surface-1 bg-surface-2 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                    </div>
                  ))}
                </div>
                <motion.div
                  whileHover={{ x: 3 }}
                  className="flex items-center gap-1.5 text-xs font-bold text-primary uppercase tracking-widest"
                >
                  {t('dashboard:stats.explore')}
                  <ChevronRight className="w-4 h-4" />
                </motion.div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Cross-course knowledge map ── */}
        {user?.id && <KnowledgeMapCard userId={user.id} />}

        {/* ── Recent Achievements ── */}
        {achievements.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-xp" />
                <h2 className="text-heading-lg text-foreground">{t('dashboard:recentAchievements')}</h2>
              </div>
              <Button 
                variant="ghost" 
                onClick={() => navigate('/achievements')}
                className="group text-primary hover:text-primary/80"
              >
                {t('dashboard:viewAll')}
                <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {achievements.slice(0, 3).map((achievement, index) => (
                <motion.div
                  key={achievement.id}
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: index * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <AchievementCard
                    name={achievement.badge_name}
                    description={achievement.badge_description || ''}
                    icon={achievement.badge_icon || '🏆'}
                    earnedAt={achievement.earned_at}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
