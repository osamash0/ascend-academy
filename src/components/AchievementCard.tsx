import { motion } from 'framer-motion';
import { Award, Lock, Star } from 'lucide-react';

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
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={!isLocked ? { y: -8, scale: 1.02 } : {}}
      className={`glass-card p-6 relative overflow-hidden transition-all duration-500 group ${
        isLocked
          ? 'opacity-40 grayscale border-white/5 bg-white/2 cursor-not-allowed'
          : 'border-white/10 hover:border-primary/50 shadow-xl hover:shadow-glow-primary/10'
      }`}
    >
      {/* Dynamic Background Glow for earned achievements */}
      {!isLocked && (
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 blur-[60px] rounded-full group-hover:bg-primary/20 transition-all duration-500" />
      )}

      <div className="flex flex-col gap-6 relative z-10">
        <div className="flex items-start justify-between">
          <div
            className={`w-16 h-16 rounded-[24px] flex items-center justify-center text-3xl flex-shrink-0 transition-transform duration-500 group-hover:scale-110 ${
              isLocked 
                ? 'bg-surface-2 text-muted-foreground border border-white/5' 
                : 'bg-gradient-to-br from-primary to-secondary text-white shadow-glow-primary border border-white/10'
            }`}
          >
            {isLocked ? (
              <Lock className="w-8 h-8 opacity-50" />
            ) : (
              <span className="drop-shadow-glow-white/50">{displayIcon}</span>
            )}
          </div>

          {!isLocked && (
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1.5 bg-xp/10 px-2 py-1 rounded-lg border border-xp/20">
                <Star className="w-3 h-3 text-xp fill-xp" />
                <span className="text-[10px] font-bold text-xp uppercase tracking-tighter">Verified</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="space-y-2">
          <h3 className={`font-bold text-lg tracking-tight ${
            isLocked ? 'text-muted-foreground' : 'text-foreground group-hover:text-primary transition-colors'
          }`}>
            {isLocked ? 'Classified Milestone' : name}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed opacity-70 group-hover:opacity-100 transition-opacity">
            {isLocked ? 'Required synapse synchronization level not yet achieved. Continue missions to unlock.' : description}
          </p>
        </div>

        {formattedDate && (
          <div className="pt-4 border-t border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary/60">
              <Award className="w-3.5 h-3.5" />
              <span>SYNCED {formattedDate}</span>
            </div>
            <div className="w-6 h-6 rounded-lg bg-primary/5 flex items-center justify-center">
              <Star className="w-3 h-3 text-primary animate-pulse" />
            </div>
          </div>
        )}
        
        {isLocked && (
          <div className="pt-4 border-t border-white/5">
             <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/30">
              <Lock className="w-3 h-3" />
              <span>LOCKED PROTOCOL</span>
            </div>
          </div>
        )}
      </div>

      {/* Subtle bottom-right icon */}
      {!isLocked && (
        <div className="absolute -bottom-4 -right-4 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-700 -rotate-12">
          <Award className="w-24 h-24 text-primary" />
        </div>
      )}
    </motion.div>
  );
}
