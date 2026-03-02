import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Trophy, Target, Flame, Zap, Star, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { LectureCard } from '@/components/LectureCard';
import { StatsCard } from '@/components/StatsCard';
import { AchievementCard } from '@/components/AchievementCard';
import { Button } from '@/components/ui/button';

interface Lecture {
  id: string;
  slug?: string | null;
  title: string;
  description: string | null;
  total_slides: number;
  created_at: string;
}

interface Progress {
  lecture_id: string;
  completed_slides: number[];
  quiz_score: number;
  total_questions_answered: number;
  correct_answers: number;
}

interface Achievement {
  id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  earned_at: string;
}

type FilterTab = 'all' | 'inprogress' | 'completed';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inprogress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
];

export default function StudentDashboard() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showStreakBanner, setShowStreakBanner] = useState(false);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  useEffect(() => {
    const streak = profile?.current_streak || 0;
    if (streak > 2) {
      setShowStreakBanner(true);
      const t = setTimeout(() => setShowStreakBanner(false), 4000);
      return () => clearTimeout(t);
    }
  }, [profile?.current_streak]);

  const fetchData = async () => {
    setLoading(true);

    const { data: lecturesData } = await supabase
      .from('lectures')
      .select('*')
      .order('created_at', { ascending: false });
    if (lecturesData) setLectures(lecturesData);

    const { data: progressData } = await supabase
      .from('student_progress')
      .select('*')
      .eq('user_id', user?.id);
    if (progressData) {
      setProgress(progressData.map(p => ({
        ...p,
        completed_slides: Array.isArray(p.completed_slides) ? p.completed_slides : [],
      })));
    }

    const { data: achievementsData } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', user?.id)
      .order('earned_at', { ascending: false });
    if (achievementsData) setAchievements(achievementsData);

    await refreshProfile();
    setLoading(false);
  };

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const streak = profile?.current_streak || 0;
  const level = profile?.current_level || 1;
  const displayName = profile?.full_name
    ? profile.full_name.split(' ')[0]
    : user?.email?.split('@')[0] || 'Student';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">

      {/* ── Streak Celebration Banner ── */}
      <AnimatePresence>
        {showStreakBanner && (
          <motion.div
            initial={{ opacity: 0, y: -20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -20, height: 0 }}
            className="rounded-2xl overflow-hidden"
          >
            <div className="bg-gradient-to-r from-warning/20 via-orange-400/10 to-warning/20 border border-warning/30 px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <motion.span
                  className="text-2xl"
                  animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1.5 }}
                >
                  🔥
                </motion.span>
                <span className="font-semibold text-warning">
                  You're on a {streak}-day streak! Keep it up!
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

      {/* ── Hero Banner ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative rounded-2xl overflow-hidden"
      >
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-xp/20 pointer-events-none" />

        {/* Animated orbs */}
        <motion.div
          className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-primary/10 blur-3xl pointer-events-none"
          animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 5, repeat: Infinity }}
        />
        <motion.div
          className="absolute -bottom-8 left-16 w-32 h-32 rounded-full bg-xp/10 blur-2xl pointer-events-none"
          animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, delay: 1 }}
        />

        <div className="relative p-7 flex flex-col gap-5">
          {/* Top row: greeting + badges */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <motion.h1
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 }}
                className="text-3xl font-bold text-foreground"
              >
                {getGreeting()}, {displayName}! 👋
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
                className="text-muted-foreground mt-1"
              >
                Ready to level up your knowledge today?
              </motion.p>
            </div>

            {/* Badges */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center gap-3 flex-wrap"
            >
              <div className="flex items-center gap-2 bg-primary/20 border border-primary/30 rounded-full px-4 py-2">
                <Star className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-primary">Level {level}</span>
              </div>
              <div className="flex items-center gap-2 bg-xp/20 border border-xp/30 rounded-full px-4 py-2">
                <Zap className="w-4 h-4 text-xp" />
                <span className="text-sm font-semibold text-xp">{profile?.total_xp || 0} XP</span>
              </div>
              {streak > 0 && (
                <div className="flex items-center gap-2 bg-warning/20 border border-warning/30 rounded-full px-4 py-2">
                  <Flame className="w-4 h-4 text-warning" />
                  <span className="text-sm font-semibold text-warning">{streak} day streak</span>
                </div>
              )}
            </motion.div>
          </div>

          {/* XP Progress bar — embedded here, no separate component */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Progress to Level {level + 1}</span>
              <span>{(profile?.total_xp || 0) % 100} / 100 XP</span>
            </div>
            <div className="h-2.5 bg-black/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full gradient-xp rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${((profile?.total_xp || 0) % 100)}%` }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.5 }}
              />
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Lectures Started"
          value={progress.length}
          icon={BookOpen}
          variant="primary"
        />
        <StatsCard
          title="Quiz Accuracy"
          value={`${accuracy}%`}
          subtitle={`${totalCorrect}/${totalQuestionsAnswered} correct`}
          icon={Target}
          variant="success"
        />
        <StatsCard
          title="Best Streak"
          value={profile?.best_streak || 0}
          icon={Flame}
          variant="warning"
        />
        <StatsCard
          title="Achievements"
          value={achievements.length}
          icon={Trophy}
          variant="xp"
        />
      </div>

      {/* ── Lectures Section ── */}
      <div>
        {/* Header + Filter Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-xl font-semibold text-foreground">Your Lectures</h2>

          {lectures.length > 0 && (
            <div className="flex items-center bg-muted rounded-xl p-1 gap-1 relative">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative px-4 py-1.5 rounded-lg text-sm font-medium transition-colors z-10 ${activeTab === tab.key
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {activeTab === tab.key && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-card rounded-lg shadow-sm z-[-1]"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredLectures.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-card rounded-2xl border border-border p-12 text-center"
          >
            <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-primary-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {activeTab === 'all' ? 'No lectures available yet' : `No ${activeTab === 'inprogress' ? 'in-progress' : 'completed'} lectures`}
            </h3>
            <p className="text-muted-foreground">
              {activeTab === 'all'
                ? 'Lectures uploaded by professors will appear here.'
                : 'Switch tabs to see other lectures.'}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            <AnimatePresence mode="popLayout">
              {filteredLectures.map((lecture, index) => {
                const lectureProgress = getProgressForLecture(lecture.id);
                return (
                  <motion.div
                    key={lecture.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: index * 0.05, layout: { type: 'spring', stiffness: 300, damping: 30 } }}
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
                      onClick={() => navigate(`/lecture/${lecture.slug || lecture.id}`)}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Recent Achievements ── */}
      {achievements.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-foreground">Recent Achievements</h2>
            <Button variant="ghost" onClick={() => navigate('/achievements')}>
              View all
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {achievements.slice(0, 3).map((achievement, index) => (
              <motion.div
                key={achievement.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
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
        </div>
      )}
    </div>
  );
}
