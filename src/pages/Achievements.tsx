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
      <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-[5%] right-[10%] w-[30%] h-[30%] rounded-full bg-primary/5 blur-[100px] animate-pulse" />
          <div className="absolute bottom-[5%] left-[10%] w-[30%] h-[30%] rounded-full bg-secondary/5 blur-[100px] animate-pulse delay-1000" />
      </div>

      <div className="p-6 lg:p-10 space-y-10 relative z-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest mb-3">
            <Trophy className="w-3 h-3" /> Hall of Valor
          </div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-4xl font-bold text-foreground tracking-tight"
          >
            Mission Achievements
          </motion.h1>
          <p className="text-body-md text-muted-foreground max-w-xl">
            Telemetry from your cognitive missions. Every badge represents a successful neural synthesis and orbital milestone.
          </p>
        </div>

        {/* XP Progress Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="h-full"
            >
              <XPProgress
                currentXP={profile?.total_xp || 0}
                currentLevel={profile?.current_level || 1}
                streak={profile?.current_streak || 0}
              />
            </motion.div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="glass-panel border-white/5 p-6 flex flex-col items-center justify-center text-center group hover:border-primary/30 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Award className="w-5 h-5 text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">{achievements.length}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Earned</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 }}
              className="glass-panel border-white/5 p-6 flex flex-col items-center justify-center text-center group hover:border-xp/30 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-xp/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Star className="w-5 h-5 text-xp" />
              </div>
              <p className="text-2xl font-bold text-foreground">{profile?.current_level || 1}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Level</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="glass-panel border-white/5 p-6 flex flex-col items-center justify-center text-center group hover:border-warning/30 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Flame className="w-5 h-5 text-warning" />
              </div>
              <p className="text-2xl font-bold text-foreground">{profile?.best_streak || 0}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Best Streak</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.35 }}
              className="glass-panel border-white/5 p-6 flex flex-col items-center justify-center text-center group hover:border-success/30 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Target className="w-5 h-5 text-success" />
              </div>
              <p className="text-xl font-bold text-foreground leading-none">{profile?.total_xp?.toLocaleString() || 0}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Total XP</p>
            </motion.div>
          </div>
        </div>

        {/* Earned Achievements Section */}
        <div className="space-y-8">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Trophy className="w-4 h-4 text-primary" />
              </div>
              Neural Badges Earned
            </h2>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full">
              {achievements.length} Badges
            </span>
          </div>

          {achievements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center glass-card border-white/5 rounded-3xl">
              <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6 animate-float">
                <span className="text-4xl">🌱</span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">No neural signatures detected yet</h3>
              <p className="text-muted-foreground max-w-md mx-auto text-sm leading-relaxed">
                Your orbital journey has just begun. Complete your first cognitive mission to synchronize your first badge with the Hall of Valor.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {achievements.map((achievement, index) => (
                <motion.div
                  key={achievement.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
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
          )}
        </div>

        {/* Locked Achievements Section */}
        <div className="space-y-8">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
                <Zap className="w-4 h-4 text-muted-foreground" />
              </div>
              Potential Milestones
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {possibleAchievements
              .filter(a => !earnedBadgeNames.includes(a.name))
              .map((achievement, index) => (
                <motion.div
                  key={achievement.name}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
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
    </div>
  );
}
