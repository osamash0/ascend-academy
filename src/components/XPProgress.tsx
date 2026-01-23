import { motion } from 'framer-motion';
import { Zap, Flame, Star } from 'lucide-react';

interface XPProgressProps {
  currentXP: number;
  currentLevel: number;
  streak: number;
}

export function XPProgress({ currentXP, currentLevel, streak }: XPProgressProps) {
  const xpInCurrentLevel = currentXP % 100;
  const xpToNextLevel = 100;
  const progressPercent = (xpInCurrentLevel / xpToNextLevel) * 100;

  return (
    <div className="bg-card rounded-2xl p-6 shadow-lg border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 gradient-level rounded-xl flex items-center justify-center shadow-md">
            <Star className="w-6 h-6 text-level-foreground" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Current Level</p>
            <p className="text-2xl font-bold text-foreground">Level {currentLevel}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="flex items-center gap-1 text-xp">
              <Zap className="w-5 h-5" />
              <span className="text-xl font-bold">{currentXP}</span>
            </div>
            <p className="text-xs text-muted-foreground">Total XP</p>
          </div>

          {streak > 0 && (
            <div className="text-center">
              <div className="flex items-center gap-1 text-warning">
                <Flame className="w-5 h-5 animate-streak-fire" />
                <span className="text-xl font-bold">{streak}</span>
              </div>
              <p className="text-xs text-muted-foreground">Streak</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Progress to Level {currentLevel + 1}</span>
          <span className="font-medium text-foreground">
            {xpInCurrentLevel} / {xpToNextLevel} XP
          </span>
        </div>
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full gradient-xp rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  );
}
