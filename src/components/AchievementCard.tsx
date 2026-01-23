import { motion } from 'framer-motion';
import { Award, Lock } from 'lucide-react';

interface AchievementCardProps {
  name: string;
  description: string;
  icon: string;
  earnedAt?: string;
  isLocked?: boolean;
}

const iconMap: Record<string, string> = {
  'first_quiz': '🎯',
  'streak_5': '🔥',
  'streak_10': '⚡',
  'level_5': '⭐',
  'level_10': '🌟',
  'perfect_score': '💯',
  'bookworm': '📚',
  'graduate': '🎓',
  'explorer': '🧭',
  'champion': '🏆',
};

export function AchievementCard({
  name,
  description,
  icon,
  earnedAt,
  isLocked = false,
}: AchievementCardProps) {
  const displayIcon = iconMap[icon] || icon || '🏆';
  const formattedDate = earnedAt
    ? new Date(earnedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <motion.div
      className={`relative rounded-2xl border p-6 transition-all duration-300 ${
        isLocked
          ? 'bg-muted/50 border-border opacity-60'
          : 'bg-card border-border hover:border-primary hover:shadow-lg'
      }`}
      whileHover={!isLocked ? { y: -4, scale: 1.02 } : {}}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl ${
            isLocked ? 'bg-muted' : 'gradient-primary shadow-md'
          }`}
        >
          {isLocked ? (
            <Lock className="w-6 h-6 text-muted-foreground" />
          ) : (
            displayIcon
          )}
        </div>
        
        <div className="flex-1">
          <h3 className={`font-semibold text-lg ${
            isLocked ? 'text-muted-foreground' : 'text-foreground'
          }`}>
            {name}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {description}
          </p>
          {formattedDate && (
            <div className="flex items-center gap-1.5 mt-2">
              <Award className="w-4 h-4 text-xp" />
              <span className="text-xs text-muted-foreground">
                Earned on {formattedDate}
              </span>
            </div>
          )}
        </div>
      </div>

      {!isLocked && (
        <div className="absolute top-3 right-3">
          <div className="w-8 h-8 gradient-success rounded-full flex items-center justify-center shadow-sm">
            <span className="text-success-foreground text-xs">✓</span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
