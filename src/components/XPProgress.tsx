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
    <div className="glass-card border-white/5 p-8 rounded-[32px] relative overflow-hidden group">
      {/* Background Glow */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-[50px] -z-10 group-hover:bg-primary/10 transition-colors" />
      
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-8 relative z-10">
        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
              <Star className="w-8 h-8 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-xp flex items-center justify-center border-2 border-background shadow-lg">
              <Zap className="w-3 h-3 text-white fill-current" />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-1">Current Protocol</p>
            <p className="text-3xl font-bold text-foreground tracking-tight">Level {currentLevel}</p>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex flex-col items-center md:items-end">
            <div className="flex items-center gap-2 text-xp">
              <Zap className="w-6 h-6 fill-current" />
              <span className="text-3xl font-bold tracking-tighter">{currentXP.toLocaleString()}</span>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Total Experience</p>
          </div>

          {streak > 0 && (
            <div className="w-px h-12 bg-white/5 hidden md:block" />
          )}

          {streak > 0 && (
            <div className="flex flex-col items-center md:items-end">
              <div className="flex items-center gap-2 text-warning">
                <Flame className="w-6 h-6 animate-streak-fire fill-current" />
                <span className="text-3xl font-bold tracking-tighter">{streak}</span>
              </div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Cognitive Streak</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 relative z-10">
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Next Evolution</p>
            <p className="text-xs font-bold text-foreground">Phase {currentLevel + 1}</p>
          </div>
          <p className="text-sm font-bold text-foreground tracking-tight">
            <span className="text-primary">{xpInCurrentLevel}</span> <span className="text-muted-foreground">/ {xpToNextLevel} XP</span>
          </p>
        </div>
        
        <div className="h-4 bg-white/5 rounded-2xl p-1 overflow-hidden border border-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-primary via-secondary to-xp rounded-xl relative shadow-glow-primary/50"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 1.2, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <div className="absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-white/20 to-transparent" />
          </motion.div>
        </div>
        
        <p className="text-[9px] text-center text-muted-foreground/50 font-bold uppercase tracking-[0.2em]">
          Cognitive synchronization active • Telemetry synchronized
        </p>
      </div>
    </div>
  );
}
