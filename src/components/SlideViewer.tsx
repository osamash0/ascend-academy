import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, BookOpen, Lightbulb, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure pdf.js worker - use the bundled worker from pdfjs-dist
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

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
  pdfUrl?: string | null;
  pageNumber?: number;
  isLive?: boolean;
  locked?: boolean;
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
  pdfUrl,
  pageNumber,
  isLive,
  locked,
}: SlideViewerProps) {
  console.log('DEBUG: SlideViewer props:', { title, slideNumber, pdfUrl, pageNumber, isLive, locked });
  const [scale, setScale] = useState(1.2);
  const [pdfError, setPdfError] = useState(false);

  const handleZoomIn = useCallback(() => setScale(s => Math.min(s + 0.2, 2.5)), []);
  const handleZoomOut = useCallback(() => setScale(s => Math.max(s - 0.2, 0.5)), []);

  const hasPdf = pdfUrl && !pdfError;

  return (
    <div className={`bg-card rounded-2xl border ${isLive ? 'border-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]' : 'border-border'} shadow-lg overflow-hidden transition-all duration-500`}>
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

          <div className="flex items-center gap-3">
            {/* Zoom controls (only when PDF is shown) */}
            {hasPdf && (
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <button onClick={handleZoomOut} className="p-1.5 rounded hover:bg-background transition-colors" title="Zoom out">
                  <ZoomOut className="w-4 h-4 text-muted-foreground" />
                </button>
                <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(scale * 100)}%</span>
                <button onClick={handleZoomIn} className="p-1.5 rounded hover:bg-background transition-colors" title="Zoom in">
                  <ZoomIn className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            )}

            {/* Progress dots */}
            <div className="flex gap-1.5">
              {Array.from({ length: Math.min(totalSlides, 10) }).map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${i + 1 === slideNumber
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
      </div>

      {/* Content — PDF preview OR text fallback */}
      <motion.div
        key={slideNumber}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="min-h-[400px]"
      >
        {hasPdf ? (
          /* ── PDF Page Preview ── */
          <div className="flex justify-center bg-muted/30 p-4 overflow-auto max-h-[600px]">
            <Document
              file={pdfUrl}
              loading={
                <div className="flex items-center justify-center h-[400px]">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              }
              onLoadError={() => setPdfError(true)}
            >
              <Page
                pageNumber={pageNumber ?? slideNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </div>
        ) : (
          /* ── Text fallback ── */
          <div className="p-8">
            <div className="prose prose-slate max-w-none">
              <div className="text-foreground text-lg leading-relaxed whitespace-pre-wrap">
                {content}
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* AI Summary */}
      {summary && (
        <div className="px-8 pb-6 pt-4">
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
            disabled={isFirst || locked}
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
            disabled={locked}
          >
            {isLast ? 'Complete' : 'Next'}
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
