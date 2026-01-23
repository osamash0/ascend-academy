import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Star, Flame, Target, BookOpen, Award } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { AchievementCard } from '@/components/AchievementCard';
import { XPProgress } from '@/components/XPProgress';

interface Achievement {
  id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  earned_at: string;
}

const possibleAchievements = [
  { name: 'First Quiz Completed', description: 'Complete your first lecture quiz', icon: '🎯' },
  { name: '5 Streak Master', description: 'Get 5 correct answers in a row', icon: '🔥' },
  { name: '10 Streak Champion', description: 'Get 10 correct answers in a row', icon: '⚡' },
  { name: 'Level 5 Scholar', description: 'Reach level 5', icon: '⭐' },
  { name: 'Level 10 Expert', description: 'Reach level 10', icon: '🌟' },
  { name: 'Perfect Score', description: 'Get 100% on a lecture quiz', icon: '💯' },
  { name: 'Bookworm', description: 'Complete 5 lectures', icon: '📚' },
  { name: 'Graduate', description: 'Complete 10 lectures', icon: '🎓' },
];

export default function Achievements() {
  const { user, profile } = useAuth();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchAchievements();
    }
  }, [user]);

  const fetchAchievements = async () => {
    const { data } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', user?.id)
      .order('earned_at', { ascending: false });

    if (data) {
      setAchievements(data);
    }
    setLoading(false);
  };

  const earnedBadgeNames = achievements.map(a => a.badge_name);

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
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-bold text-foreground flex items-center gap-3"
        >
          <Trophy className="w-8 h-8 text-xp" />
          Achievements
        </motion.h1>
        <p className="text-muted-foreground mt-1">
          Track your progress and unlock badges as you learn
        </p>
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

      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-2xl border border-border p-6 text-center"
        >
          <Award className="w-8 h-8 text-primary mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{achievements.length}</p>
          <p className="text-sm text-muted-foreground">Earned</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-card rounded-2xl border border-border p-6 text-center"
        >
          <Star className="w-8 h-8 text-xp mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{profile?.current_level || 1}</p>
          <p className="text-sm text-muted-foreground">Level</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card rounded-2xl border border-border p-6 text-center"
        >
          <Flame className="w-8 h-8 text-warning mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{profile?.best_streak || 0}</p>
          <p className="text-sm text-muted-foreground">Best Streak</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="bg-card rounded-2xl border border-border p-6 text-center"
        >
          <Target className="w-8 h-8 text-success mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{profile?.total_xp || 0}</p>
          <p className="text-sm text-muted-foreground">Total XP</p>
        </motion.div>
      </div>

      {/* Earned Achievements */}
      {achievements.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
            <span className="text-2xl">🏆</span> Earned Badges
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {achievements.map((achievement, index) => (
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

      {/* Locked Achievements */}
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
          <span className="text-2xl">🔒</span> Available to Unlock
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {possibleAchievements
            .filter(a => !earnedBadgeNames.includes(a.name))
            .map((achievement, index) => (
              <motion.div
                key={achievement.name}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + index * 0.1 }}
              >
                <AchievementCard
                  name={achievement.name}
                  description={achievement.description}
                  icon={achievement.icon}
                  isLocked
                />
              </motion.div>
            ))}
        </div>
      </div>
    </div>
  );
}
