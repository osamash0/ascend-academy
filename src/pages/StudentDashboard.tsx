import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Trophy, Target, Flame, TrendingUp, Plus, Clock } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { XPProgress } from '@/components/XPProgress';
import { LectureCard } from '@/components/LectureCard';
import { StatsCard } from '@/components/StatsCard';
import { AchievementCard } from '@/components/AchievementCard';
import { Button } from '@/components/ui/button';

interface Lecture {
  id: string;
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

export default function StudentDashboard() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    
    // Fetch lectures
    const { data: lecturesData } = await supabase
      .from('lectures')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (lecturesData) {
      setLectures(lecturesData);
    }

    // Fetch progress
    const { data: progressData } = await supabase
      .from('student_progress')
      .select('*')
      .eq('user_id', user?.id);
    
    if (progressData) {
      setProgress(progressData.map(p => ({
        ...p,
        completed_slides: Array.isArray(p.completed_slides) ? p.completed_slides : []
      })));
    }

    // Fetch achievements
    const { data: achievementsData } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', user?.id)
      .order('earned_at', { ascending: false });
    
    if (achievementsData) {
      setAchievements(achievementsData);
    }

    await refreshProfile();
    setLoading(false);
  };

  const getProgressForLecture = (lectureId: string) => {
    return progress.find(p => p.lecture_id === lectureId);
  };

  const totalQuestionsAnswered = progress.reduce((sum, p) => sum + (p.total_questions_answered || 0), 0);
  const totalCorrect = progress.reduce((sum, p) => sum + (p.correct_answers || 0), 0);
  const accuracy = totalQuestionsAnswered > 0 
    ? Math.round((totalCorrect / totalQuestionsAnswered) * 100) 
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold text-foreground"
          >
            Welcome back! 👋
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Ready to continue your learning journey?
          </p>
        </div>
      </div>

      {/* XP Progress */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <XPProgress
          currentXP={profile?.total_xp || 0}
          currentLevel={profile?.current_level || 1}
          streak={profile?.current_streak || 0}
        />
      </motion.div>

      {/* Stats Grid */}
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

      {/* Lectures Section */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Your Lectures</h2>
        </div>

        {lectures.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-card rounded-2xl border border-border p-12 text-center"
          >
            <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-primary-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No lectures available yet
            </h3>
            <p className="text-muted-foreground mb-4">
              Lectures uploaded by professors will appear here.
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {lectures.map((lecture, index) => {
              const lectureProgress = getProgressForLecture(lecture.id);
              return (
                <motion.div
                  key={lecture.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <LectureCard
                    id={lecture.id}
                    title={lecture.title}
                    description={lecture.description || undefined}
                    totalSlides={lecture.total_slides}
                    completedSlides={lectureProgress?.completed_slides?.length || 0}
                    quizScore={lectureProgress?.correct_answers || 0}
                    totalQuestions={lectureProgress?.total_questions_answered || 0}
                    onClick={() => navigate(`/lecture/${lecture.id}`)}
                  />
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Achievements */}
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
