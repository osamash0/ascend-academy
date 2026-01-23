import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, BookOpen, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SlideViewerProps {
  title: string;
  content: string;
  summary: string;
  slideNumber: number;
  totalSlides: number;
  onPrevious: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export function SlideViewer({
  title,
  content,
  summary,
  slideNumber,
  totalSlides,
  onPrevious,
  onNext,
  isFirst,
  isLast,
}: SlideViewerProps) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-secondary/50 px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 gradient-primary rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{title}</h2>
              <p className="text-sm text-muted-foreground">
                Slide {slideNumber} of {totalSlides}
              </p>
            </div>
          </div>
          
          {/* Progress dots */}
          <div className="flex gap-1.5">
            {Array.from({ length: Math.min(totalSlides, 10) }).map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i + 1 === slideNumber
                    ? 'bg-primary'
                    : i + 1 < slideNumber
                    ? 'bg-success'
                    : 'bg-muted'
                }`}
              />
            ))}
            {totalSlides > 10 && (
              <span className="text-xs text-muted-foreground ml-1">
                +{totalSlides - 10}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <motion.div
        key={slideNumber}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="p-8 min-h-[400px]"
      >
        <div className="prose prose-slate max-w-none">
          <div className="text-foreground text-lg leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        </div>
      </motion.div>

      {/* Summary */}
      {summary && (
        <div className="px-8 pb-6">
          <div className="bg-secondary/50 rounded-xl p-4 border border-border">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 gradient-xp rounded-lg flex items-center justify-center flex-shrink-0">
                <Lightbulb className="w-4 h-4 text-xp-foreground" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground mb-1">AI Summary</h4>
                <p className="text-sm text-muted-foreground">{summary}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="px-8 pb-6">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={onPrevious}
            disabled={isFirst}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>

          <div className="flex items-center gap-2">
            <div className="h-1 w-32 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full gradient-primary"
                initial={{ width: 0 }}
                animate={{ width: `${(slideNumber / totalSlides) * 100}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {Math.round((slideNumber / totalSlides) * 100)}%
            </span>
          </div>

          <Button
            variant={isLast ? 'success' : 'default'}
            onClick={onNext}
          >
            {isLast ? 'Complete' : 'Next'}
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
