import { motion } from 'framer-motion';
import { BookOpen, CheckCircle2, ChevronRight, Clock, Star } from 'lucide-react';
import { memo, useMemo } from 'react';

interface LectureCardProps {
  id: string;
  title: string;
  description?: string;
  totalSlides: number;
  completedSlides: number;
  quizScore?: number;
  totalQuestions?: number;
  onClick: () => void;
  index?: number;
}

export const LectureCard = memo(function LectureCard({
  title,
  description,
  totalSlides,
  completedSlides,
  onClick,
  index = 0,
}: LectureCardProps) {
  const progress = useMemo(() => 
    totalSlides > 0 ? (completedSlides / totalSlides) * 100 : 0,
    [completedSlides, totalSlides]
  );

  const isCompleted = progress === 100;
  const isNew = completedSlides === 0 && !isCompleted;

  const statusText = useMemo(() => {
    if (isNew) return 'Awaiting Initiation';
    if (isCompleted) return 'Review Synchronized';
    return `${Math.round(progress)}% Integrated`;
  }, [isNew, isCompleted, progress]);

  const actionText = useMemo(() => {
    if (isCompleted) return 'Enter Review';
    if (isNew) return 'Initiate Mission';
    return 'Resume Sync';
  }, [isNew, isCompleted]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -8 }}
      className="group relative h-full cursor-pointer"
      onClick={onClick}
      role="article"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`${title}. ${statusText}. ${actionText}`}
    >
      <div className="glass-card flex flex-col h-full overflow-hidden border-white/5 group-hover:border-primary/50 transition-all duration-500 shadow-xl group-hover:shadow-glow-primary/10">
        {/* Animated Accent */}
        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary via-secondary to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="p-6 flex flex-col gap-4 flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest">Cognitive Module</span>
            </div>
            {isCompleted && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-success/10 text-success border border-success/20">
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Synced</span>
              </div>
            )}
            {isNew && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                <Star className="w-3 h-3 fill-primary" aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-wider">New</span>
              </div>
            )}
          </div>

          <h3 className="font-bold text-xl text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors duration-300 tracking-tight">
            {title}
          </h3>

          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed opacity-70 group-hover:opacity-100 transition-opacity">
              {description}
            </p>
          )}

          <div className="mt-auto pt-6 space-y-4">
            <div className="flex justify-between items-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              <span className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                {statusText}
              </span>
              <span className="text-foreground/50">{completedSlides}/{totalSlides} Units</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
              <motion.div
                className="h-full bg-gradient-to-r from-primary via-secondary to-xp rounded-full relative"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1.5, ease: [0.34, 1.56, 0.64, 1], delay: index * 0.1 }}
              >
                {progress > 0 && (
                  <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-white/30 to-transparent" />
                )}
              </motion.div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-white/2 border-t border-white/5 flex items-center justify-between group-hover:bg-primary/5 transition-all duration-300">
          <span className="text-xs font-bold text-muted-foreground group-hover:text-primary uppercase tracking-widest transition-colors">
            {actionText}
          </span>
          <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all duration-300">
            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
          </div>
        </div>
      </div>
    </motion.div>
  );
});
