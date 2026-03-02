import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, BookOpen, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
}: SlideViewerProps) {
  console.log('DEBUG: SlideViewer props:', { title, slideNumber, pdfUrl, pageNumber });
  const [pdfError, setPdfError] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    if (!pdfContainerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(pdfContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const hasPdf = pdfUrl && !pdfError;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-lg overflow-hidden transition-all duration-500">
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
      {/* Content — Combined View */}
      <motion.div
        key={slideNumber}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="min-h-[400px] flex flex-col"
      >
        {/* PDF Slide Area (if available) */}
        {hasPdf && (
          <div className="flex flex-col border-b border-border bg-muted/10">
            <div className="px-6 py-3 border-b border-border/50 flex items-center gap-2 text-muted-foreground">
              <BookOpen className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Slide Preview</span>
            </div>
            <div ref={pdfContainerRef} className="w-full overflow-y-auto custom-scrollbar bg-muted/5" style={{ maxHeight: '75vh' }}>
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
                  width={containerWidth > 0 ? containerWidth - 2 : undefined}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              </Document>
            </div>
          </div>
        )}

        {/* AI Summary — shown before Study Notes */}
        {summary && (
          <div className="px-6 py-4 border-b border-border">
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

        {/* AI Structured Content / Study Notes Area */}
        <div className="flex flex-col flex-1">
          {hasPdf && (
            <div className="px-6 py-3 border-b border-border/50 flex items-center gap-2 text-primary">
              <Lightbulb className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Study Notes & Key Concepts</span>
            </div>
          )}
          <div className="p-8 h-full">
            <div className="prose prose-lg dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-primary prose-bullet:bg-primary prose-li:text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || "_No content available for this slide._"}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </motion.div>

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
