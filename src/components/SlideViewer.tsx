import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, BookOpen, Lightbulb, Volume2, VolumeX, Square, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type Confidence = 'got_it' | 'unsure' | 'confused' | null;

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
  onConfidenceRate?: (rating: Confidence) => void;
  initialConfidence?: Confidence;
}

const CONFIDENCE_OPTIONS: { key: Confidence; emoji: string; label: string; activeClass: string }[] = [
  { key: 'got_it', emoji: '✅', label: 'Got it', activeClass: 'bg-success/20 border-success text-success' },
  { key: 'unsure', emoji: '🤔', label: 'Unsure', activeClass: 'bg-warning/20 border-warning text-warning' },
  { key: 'confused', emoji: '❌', label: 'Confused', activeClass: 'bg-destructive/20 border-destructive text-destructive' },
];

/** Strip markdown syntax so TTS reads clean text */
function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')              // headings
    .replace(/\*\*(.*?)\*\*/g, '$1')        // bold
    .replace(/\*(.*?)\*/g, '$1')            // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')     // code
    .replace(/!\[.*?\]\(.*?\)/g, '')        // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '')             // list bullets
    .replace(/^\d+\.\s+/gm, '')             // numbered lists
    .replace(/\n{2,}/g, '. ')              // paragraph breaks → pause
    .replace(/\n/g, ' ')
    .trim();
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
  onConfidenceRate,
  initialConfidence = null,
}: SlideViewerProps) {
  // PDF state
  const [pdfError, setPdfError] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Confidence rating
  const [confidence, setConfidence] = useState<Confidence>(initialConfidence);
  const [justRated, setJustRated] = useState(false);

  // TTS state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Reset per slide
  useEffect(() => {
    stopSpeech();
    setConfidence(initialConfidence ?? null);
    setJustRated(false);
  }, [slideNumber]);

  // PDF resize observer
  useEffect(() => {
    if (!pdfContainerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(pdfContainerRef.current);
    return () => observer.disconnect();
  }, []);

  // ── TTS helpers ──────────────────────────────────────────────────────────
  const stopSpeech = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    utteranceRef.current = null;
  }, []);

  const handleSpeak = useCallback(() => {
    if (!ttsSupported) return;

    if (isSpeaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      return;
    }

    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      return;
    }

    const text = [
      title ? `Slide ${slideNumber}: ${title}.` : '',
      summary ? `Summary: ${stripMarkdown(summary)}.` : '',
      content ? `Study Notes: ${stripMarkdown(content)}` : '',
    ].filter(Boolean).join(' ');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.onstart = () => { setIsSpeaking(true); setIsPaused(false); };
    utterance.onend = () => { setIsSpeaking(false); setIsPaused(false); };
    utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); };

    utteranceRef.current = utterance;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [isSpeaking, isPaused, title, summary, content, slideNumber, ttsSupported]);

  // ── Confidence rating ─────────────────────────────────────────────────────
  const handleConfidence = (rating: NonNullable<Confidence>) => {
    setConfidence(rating);
    setJustRated(true);
    onConfidenceRate?.(rating);
    setTimeout(() => setJustRated(false), 1200);
  };

  const hasPdf = pdfUrl && !pdfError;

  // TTS icon to show
  const TTSIcon = isSpeaking && !isPaused ? Pause : Play;
  const ttsLabel = isSpeaking && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Listen';

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
              <p className="text-sm text-muted-foreground">Slide {slideNumber} of {totalSlides}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Progress dots */}
            <div className="flex gap-1.5">
              {Array.from({ length: Math.min(totalSlides, 10) }).map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${i + 1 === slideNumber ? 'bg-primary' : i + 1 < slideNumber ? 'bg-success' : 'bg-muted'
                    }`}
                />
              ))}
              {totalSlides > 10 && (
                <span className="text-xs text-muted-foreground ml-1">+{totalSlides - 10}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <motion.div
        key={slideNumber}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="min-h-[400px] flex flex-col"
      >
        {/* PDF Slide Area */}
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

        {/* AI Summary */}
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

        {/* Study Notes + TTS */}
        <div className="flex flex-col flex-1">
          <div className="px-6 py-3 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary">
              <Lightbulb className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Study Notes & Key Concepts</span>
            </div>

            {/* TTS controls */}
            {ttsSupported && (
              <div className="flex items-center gap-1.5">
                <motion.button
                  onClick={handleSpeak}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isSpeaking
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-muted border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
                    }`}
                  whileTap={{ scale: 0.95 }}
                  title={ttsLabel}
                >
                  {isSpeaking && !isPaused ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  {ttsLabel}
                </motion.button>

                {isSpeaking && (
                  <motion.button
                    onClick={stopSpeech}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-1.5 rounded-lg bg-muted border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                    title="Stop"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </motion.button>
                )}

                {/* Speaking indicator */}
                {isSpeaking && !isPaused && (
                  <div className="flex items-end gap-0.5 h-4">
                    {[0, 0.15, 0.3].map((delay, i) => (
                      <motion.div
                        key={i}
                        className="w-0.5 bg-primary rounded-full"
                        animate={{ height: ['4px', '14px', '4px'] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-8 h-full">
            <div className="prose prose-lg dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-primary prose-li:text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || '_No content available for this slide._'}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Confidence Rating ── */}
      <div className="px-6 py-5 border-t border-border bg-secondary/20">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            How well did you understand this slide?
          </p>
          <div className="flex items-center gap-2">
            {CONFIDENCE_OPTIONS.map(opt => {
              const isActive = confidence === opt.key;
              return (
                <motion.button
                  key={opt.key}
                  onClick={() => handleConfidence(opt.key!)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all duration-200 ${isActive
                      ? opt.activeClass
                      : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                    }`}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  animate={isActive && justRated ? { scale: [1, 1.12, 1] } : {}}
                  transition={{ duration: 0.3 }}
                >
                  <span>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </motion.button>
              );
            })}
          </div>

          {/* Saved confirmation */}
          <AnimatePresence>
            {justRated && (
              <motion.span
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-success font-medium"
              >
                ✓ Saved
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation */}
      <div className="px-8 pb-6 pt-4">
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={onPrevious} disabled={isFirst}>
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

          <Button variant={isLast ? 'success' : 'default'} onClick={onNext}>
            {isLast ? 'Complete' : 'Next'}
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
