import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Page } from 'react-pdf';
import { Button } from './ui/button';

interface PDFLightboxProps {
  isOpen: boolean;
  pageNumber: number;
  totalPages: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function PDFLightbox({ isOpen, pageNumber, totalPages, onClose, onPrev, onNext }: PDFLightboxProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onPrev, onNext]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex flex-col items-center justify-center bg-background/80 backdrop-blur-md"
          onClick={onClose}
        >
          <div 
            className="relative flex flex-col items-center justify-center w-full max-w-5xl h-full p-4 md:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header / Actions */}
            <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full shadow-lg h-10 w-10 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                onClick={onClose}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Document Render */}
            <div className="flex-1 overflow-auto rounded-xl shadow-2xl border border-border bg-card custom-scrollbar flex items-center justify-center w-full">
              <Page
                pageNumber={pageNumber}
                width={Math.min(window.innerWidth * 0.9, 1000)}
                renderTextLayer={true}
                renderAnnotationLayer={false}
              />
            </div>

            {/* Navigation Footer */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 bg-background/90 backdrop-blur-md px-6 py-3 rounded-full border border-border shadow-xl">
              <Button
                variant="ghost"
                size="icon"
                onClick={onPrev}
                disabled={pageNumber <= 1}
                className="h-8 w-8"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              
              <span className="text-sm font-medium tabular-nums px-2">
                {pageNumber} / {totalPages}
              </span>

              <Button
                variant="ghost"
                size="icon"
                onClick={onNext}
                disabled={pageNumber >= totalPages}
                className="h-8 w-8"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
