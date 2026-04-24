import { motion } from 'framer-motion';
import { ChevronRight, BookOpen, CheckCircle2, GraduationCap, Beaker, Globe, Calculator, Music, Palette, Cpu, Leaf, Scale } from 'lucide-react';

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

// Color palettes for the illustration area
const CARD_THEMES = [
  { bg: 'from-orange-400 to-rose-400', label: 'text-orange-500', border: 'border-orange-200', icon: Globe },
  { bg: 'from-blue-400 to-indigo-500', label: 'text-blue-500', border: 'border-blue-200', icon: Beaker },
  { bg: 'from-violet-400 to-purple-500', label: 'text-violet-500', border: 'border-violet-200', icon: GraduationCap },
  { bg: 'from-emerald-400 to-teal-500', label: 'text-emerald-500', border: 'border-emerald-200', icon: Leaf },
  { bg: 'from-amber-400 to-orange-400', label: 'text-amber-500', border: 'border-amber-200', icon: Calculator },
  { bg: 'from-sky-400 to-blue-500', label: 'text-sky-500', border: 'border-sky-200', icon: Cpu },
  { bg: 'from-pink-400 to-rose-500', label: 'text-pink-500', border: 'border-pink-200', icon: Music },
  { bg: 'from-lime-400 to-green-500', label: 'text-lime-600', border: 'border-lime-200', icon: Palette },
  { bg: 'from-cyan-400 to-sky-500', label: 'text-cyan-600', border: 'border-cyan-200', icon: Scale },
];

// Derive a short "category" label from the description or title
function getCategory(description?: string, title?: string): string {
  if (description && description.trim().length > 0) {
    // Use first 2-3 words of description as category-like label
    const words = description.trim().split(/\s+/);
    return words.slice(0, 2).join(' ');
  }
  // Fall back to first word of title
  if (title) return title.split(' ')[0];
  return 'Lecture';
}

export function LectureCard({
  title,
  description,
  totalSlides,
  completedSlides,
  quizScore = 0,
  totalQuestions = 0,
  onClick,
  index = 0,
}: LectureCardProps) {
  const progress = totalSlides > 0 ? (completedSlides / totalSlides) * 100 : 0;
  const isCompleted = progress === 100;
  const isNew = completedSlides === 0 && !isCompleted;

  const theme = CARD_THEMES[index % CARD_THEMES.length];
  const ThemeIcon = theme.icon;
  const category = getCategory(description, title);

  const buttonLabel = isCompleted ? 'Review' : isNew ? 'Start' : 'Continue';

  return (
    <motion.div
      className={`group bg-white dark:bg-card rounded-3xl border ${theme.border} dark:border-border overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col cursor-pointer`}
      whileHover={{ y: -5, scale: 1.01 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      style={{ minHeight: '280px' }}
    >
      {/* Top: white area with category + title */}
      <div className="p-5 flex flex-col gap-2 flex-1">
        {/* Category row */}
        <div className={`flex items-center gap-1.5 ${theme.label}`}>
          <ThemeIcon className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-wide truncate">{category}</span>
        </div>

        {/* Title */}
        <h3 className="font-bold text-base text-gray-900 dark:text-foreground leading-snug line-clamp-3 group-hover:underline decoration-1 underline-offset-2">
          {title}
        </h3>

        {/* Progress pill */}
        {!isNew && (
          <div className="flex items-center gap-2 mt-auto pt-2">
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-muted rounded-full overflow-hidden">
              <motion.div
                className={`h-full bg-gradient-to-r ${theme.bg} rounded-full`}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground">{Math.round(progress)}%</span>
          </div>
        )}
      </div>

      {/* Bottom: colorful illustration area */}
      <div className={`relative bg-gradient-to-br ${theme.bg} h-36 flex items-center justify-center overflow-hidden`}>
        {/* Decorative background circles */}
        <div className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full bg-white/10" />
        <div className="absolute -top-4 -left-4 w-20 h-20 rounded-full bg-white/10" />

        {/* Main icon illustration */}
        <motion.div
          className="relative z-10 flex flex-col items-center gap-2"
          whileHover={{ scale: 1.1, rotate: [0, -3, 3, 0] }}
          transition={{ duration: 0.4 }}
        >
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
            {isCompleted ? (
              <CheckCircle2 className="w-9 h-9 text-white" />
            ) : (
              <BookOpen className="w-9 h-9 text-white" />
            )}
          </div>
          <span className="text-white/90 text-xs font-semibold">
            {totalSlides} slides
          </span>
        </motion.div>

        {/* Action badge */}
        <div className="absolute bottom-3 right-3">
          <div className="flex items-center gap-1 bg-white/25 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-full">
            {buttonLabel}
            <ChevronRight className="w-3 h-3" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
