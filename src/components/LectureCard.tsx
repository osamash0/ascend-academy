import { motion } from 'framer-motion';
import { BookOpen, ChevronRight, Clock, CheckCircle2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface LectureCardProps {
  id: string;
  title: string;
  description?: string;
  totalSlides: number;
  completedSlides: number;
  quizScore?: number;
  totalQuestions?: number;
  onClick: () => void;
}

export function LectureCard({
  title,
  description,
  totalSlides,
  completedSlides,
  quizScore = 0,
  totalQuestions = 0,
  onClick,
}: LectureCardProps) {
  const progress = totalSlides > 0 ? (completedSlides / totalSlides) * 100 : 0;
  const isCompleted = progress === 100;
  const isNew = completedSlides === 0 && !isCompleted;

  return (
    <motion.div
      className="group bg-card rounded-2xl border border-border overflow-hidden shadow-md hover:shadow-xl transition-all duration-300"
      whileHover={{ y: -4 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isCompleted ? 'gradient-success' : 'gradient-primary'
              }`}>
              {isCompleted ? (
                <CheckCircle2 className="w-6 h-6 text-success-foreground" />
              ) : (
                <BookOpen className="w-6 h-6 text-primary-foreground" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors">
                {title}
              </h3>
              {description && (
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              <span>{totalSlides} slides</span>
            </div>
            {totalQuestions > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>{quizScore}/{totalQuestions} correct</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium text-foreground">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <Button
            variant={isCompleted ? 'secondary' : 'default'}
            className="w-full group-hover:shadow-md transition-shadow"
            onClick={onClick}
          >
            {isCompleted ? 'Review Lecture' : isNew ? 'Start Learning' : 'Continue Learning'}
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
