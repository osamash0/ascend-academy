import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronLeft, ChevronRight, BookOpen, Lightbulb, Volume2, VolumeX, 
  Square, Play, Pause, Star, HelpCircle, Loader2, Sparkles 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { MindMap } from '@/components/MindMap';
import { useTTS } from '@/hooks/useTTS';
import type { TreeNode } from '@/features/mindmap/hooks/useMindMap';
import 'katex/dist/katex.min.css';
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
  mindMapData?: TreeNode | null;
  currentSlideId?: string;
  onGenerateMindMap?: () => void;
  isMindMapLoading?: boolean;
  isProfessor?: boolean;
  onRegenerateContent?: () => void;
  isRegeneratingContent?: boolean;
}

/** Returns true when extracted text looks like garbage */
function isGarbageContent(content: string): boolean {
  if (!content || content.trim().length === 0) return true;
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 40) return true;
  const nonSpace = cleaned.replace(/\s/g, '');
  if (nonSpace.length === 0) return true;
  const digits = nonSpace.replace(/\D/g, '');
  return digits.length / nonSpace.length > 0.6;
}

const CONFIDENCE_OPTIONS = [
  { key: 'got_it' as const, emoji: '✅', label: 'Got it', activeClass: 'bg-success/20 border-success text-success' },
  { key: 'unsure' as const, emoji: '🤔', label: 'Unsure', activeClass: 'bg-warning/20 border-warning text-warning' },
  { key: 'confused' as const, emoji: '❌', label: 'Confused', activeClass: 'bg-destructive/20 border-destructive text-destructive' },
];

/** Prepare TTS text from slide data */
function prepareTTSText(title: string, summary: string, content: string, slideNumber: number): string {
  return [
    title ? `Slide ${slideNumber}: ${title}.` : '',
    summary ? `Summary: ${summary}.` : '',
    content ? `Study Notes: ${content}` : '',
  ].filter(Boolean).join(' ');
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
  mindMapData,
  currentSlideId,
  onGenerateMindMap,
  isMindMapLoading = false,
  isProfessor = false,
  onRegenerateContent,
  isRegeneratingContent = false,
}: SlideViewerProps) {
  // PDF state
  const [pdfError, setPdfError] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Confidence rating
  const [confidence, setConfidence] = useState<Confidence>(initialConfidence);
  const [justRated, setJustRated] = useState(false);

  // Mind map panel
  const [mindMapOpen, setMindMapOpen] = useState(false);

  // TTS hook
  const { speak, stop, isSpeaking, isPaused, isLoading: isTTSLoading } = useTTS();

  // Memoized TTS text to prevent unnecessary re-renders
  const ttsText = useMemo(() => 
    prepareTTSText(title, summary, content, slideNumber),
    [title, summary, content, slideNumber]
  );

  // Auto-expand mind map on last slide
  useEffect(() => {
    if (isLast && mindMapData) setMindMapOpen(true);
  }, [isLast, mindMapData]);

  // Reset per slide
  useEffect(() => {
    stop();
    setConfidence(initialConfidence ?? null);
    setJustRated(false);
  }, [slideNumber, initialConfidence, stop]);

  // PDF resize observer with cleanup
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

  // Confidence rating handler
  const handleConfidence = useCallback((rating: NonNullable<Confidence>) => {
    setConfidence(rating);
    setJustRated(true);
    onConfidenceRate?.(rating);
    const timer = setTimeout(() => setJustRated(false), 1200);
    return () => clearTimeout(timer);
  }, [onConfidenceRate]);

  // TTS control handler
  const handleTTS = useCallback(() => {
    if (isSpeaking && !isPaused) {
      stop();
    } else {
      speak(ttsText);
    }
  }, [isSpeaking, isPaused, speak, stop, ttsText]);

  const hasPdf = pdfUrl && !pdfError;
  const ttsLabel = isSpeaking && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Listen';
  const TtsIcon = isSpeaking && !isPaused ? Pause : isPaused ? Play : Volume2;

  return (
    <div className="glass-card overflow-hidden transition-all duration-500 flex flex-col h-full">
      {/* Header */}
      <div className="bg-surface-1/50 px-6 py-5 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-foreground tracking-tight leading-tight">{title}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Orbital Lecture</span>
                <span className="text-[10px] text-muted-foreground">•</span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Slide {slideNumber} / {totalSlides}
                </span>
              </div>
            </div>
          </div>

          {/* TTS controls */}
          <div className="flex items-center gap-2">
            <motion.button
              onClick={handleTTS}
              disabled={isTTSLoading}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-300 ${
                isSpeaking
                  ? 'bg-primary/20 border-primary/30 text-primary shadow-glow-primary/20'
                  : 'bg-surface-2 border-white/5 text-muted-foreground hover:text-foreground hover:border-primary/30'
              } ${isTTSLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              whileTap={{ scale: 0.95 }}
              title={ttsLabel}
            >
              {isTTSLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <TtsIcon className="w-3.5 h-3.5" />
              )}
              {isTTSLoading ? 'Generating...' : ttsLabel}
            </motion.button>

            {isSpeaking && (
              <motion.button
                onClick={stop}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-1.5 rounded-xl bg-surface-2 border border-white/5 text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                title="Stop"
              >
                <Square className="w-3.5 h-3.5" />
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <motion.div
        key={slideNumber}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 10 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex-1 flex flex-col overflow-y-auto custom-scrollbar"
      >
        {/* PDF Slide Area */}
        {hasPdf && (
          <div className="flex flex-col border-b border-white/5 bg-surface-1/30">
            <div className="px-6 py-2 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground/60">
                <BookOpen className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Original Source Material</span>
              </div>
              {isSpeaking && !isPaused && (
                <div className="flex items-end gap-0.5 h-3">
                  {[0, 0.15, 0.3].map((delay, i) => (
                    <motion.div
                      key={i}
                      className="w-0.5 bg-primary rounded-full"
                      animate={{ height: ['4px', '12px', '4px'] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay }}
                    />
                  ))}
                </div>
              )}
            </div>
            <div ref={pdfContainerRef} className="w-full bg-black/20">
              <Document
                file={pdfUrl}
                loading={
                  <div className="flex items-center justify-center h-[300px]">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
                  </div>
                }
                onLoadError={() => setPdfError(true)}
              >
                <Page
                  pageNumber={pageNumber ?? slideNumber}
                  width={containerWidth > 0 ? containerWidth - 2 : undefined}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  className="mx-auto"
                />
              </Document>
            </div>
          </div>
        )}

        {/* AI Summary */}
        {summary && (
          <div className="px-6 py-6 border-b border-white/5">
            <div className="glass-panel border-white/5 rounded-2xl p-5 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-start gap-4 relative z-10">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-xp to-warning flex items-center justify-center flex-shrink-0 shadow-glow-xp">
                  <Lightbulb className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-foreground mb-1 uppercase tracking-tight">AI Insights</h4>
                  <p className="text-body-md text-muted-foreground leading-relaxed italic">"{summary}"</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mind Map Panel */}
        <div className="px-6 py-4 border-b border-white/5">
          <button
            onClick={() => setMindMapOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-3 glass-panel border-white/5 rounded-2xl px-5 py-3.5 hover:bg-white/5 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/30 to-secondary/20 flex items-center justify-center shadow-glow-primary/20 group-hover:scale-110 transition-transform">
                <span className="text-base">🧠</span>
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-foreground">Lecture Mind Map</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  {mindMapData
                    ? 'Interactive knowledge tree — click to explore'
                    : 'AI knowledge tree not yet generated'}
                </p>
              </div>
            </div>
            <motion.span
              animate={{ rotate: mindMapOpen ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="text-muted-foreground text-xs"
            >
              ▼
            </motion.span>
          </button>

          <AnimatePresence>
            {mindMapOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 280, damping: 30 }}
                style={{ overflow: 'hidden' }}
              >
                <div className="mt-3 glass-panel border-white/5 rounded-2xl overflow-hidden relative">
                  {mindMapData ? (
                    <MindMap
                      treeData={mindMapData}
                      currentSlideId={currentSlideId}
                      height={480}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 gap-5">
                      <div className="text-4xl">🧠</div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-foreground mb-1">No mind map yet</p>
                        <p className="text-xs text-muted-foreground">Generate a visual knowledge tree from all lecture slides</p>
                      </div>
                      {onGenerateMindMap && (
                        <button
                          onClick={onGenerateMindMap}
                          disabled={isMindMapLoading}
                          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white text-sm font-bold shadow-glow-primary border-none hover:opacity-90 transition-all disabled:opacity-50"
                        >
                          {isMindMapLoading ? (
                            <>
                              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              Generate Mind Map
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Study Notes Content */}
        <div className="p-8 lg:p-10 space-y-6">
          {/* Garbage-content warning */}
          {isGarbageContent(content) && isProfessor && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3">
              <span className="text-amber-400 mt-0.5 shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-300">AI content not extracted correctly</p>
                <p className="text-xs text-amber-300/70 mt-0.5">
                  This slide likely contains a diagram or chart. The old text parser could not read it. Re-analyze with the vision AI to fix it.
                </p>
              </div>
              {onRegenerateContent && (
                <button
                  onClick={onRegenerateContent}
                  disabled={isRegeneratingContent}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {isRegeneratingContent
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Analyzing…</>
                    : <><Sparkles className="w-3 h-3" /> Re-analyze</>
                  }
                </button>
              )}
            </div>
          )}

          <div className="prose prose-lg dark:prose-invert max-w-none
            prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight
            prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:text-body-lg
            prose-strong:text-primary prose-strong:font-bold
            prose-ul:text-muted-foreground prose-li:my-2
            prose-code:text-accent prose-code:bg-accent/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {content || '_No content available for this slide._'}
            </ReactMarkdown>
          </div>
        </div>
      </motion.div>

      {/* Footer Actions */}
      <div className="px-6 py-6 border-t border-white/5 bg-surface-1/50 mt-auto">
        <div className="flex flex-col gap-6">
          {/* Confidence Rating */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-caption font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                <HelpCircle className="w-3.5 h-3.5" />
                Comprehension Check
              </p>
              <p className="text-body-sm text-muted-foreground/70 italic">How well did you grasp these concepts?</p>
            </div>

            <div className="flex items-center gap-3">
              {CONFIDENCE_OPTIONS.map(opt => {
                const isActive = confidence === opt.key;
                return (
                  <motion.button
                    key={opt.key}
                    onClick={() => handleConfidence(opt.key)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 text-sm font-bold transition-all duration-300 ${
                      isActive
                        ? opt.activeClass + ' shadow-lg'
                        : 'border-white/5 bg-surface-2 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                    }`}
                    whileHover={{ y: -2, scale: 1.02 }}
                    whileTap={{ scale: 0.95 }}
                    animate={isActive && justRated ? { y: [-2, -6, -2], scale: [1.02, 1.08, 1.02] } : {}}
                  >
                    <span className="text-lg">{opt.emoji}</span>
                    <span className="hidden sm:inline">{opt.label}</span>
                  </motion.button>
                );
              })}

              <AnimatePresence>
                {justRated && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 text-success font-bold text-xs uppercase tracking-widest ml-2"
                  >
                    <Star className="w-3.5 h-3.5 fill-success" />
                    Saved
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center justify-between gap-4 pt-4 border-t border-white/5">
            <Button 
              variant="outline" 
              onClick={onPrevious} 
              disabled={isFirst}
              className="rounded-xl px-6 h-12 font-bold border-white/5 hover:bg-white/5 hover:text-primary transition-all group"
            >
              <ChevronLeft className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
              Previous
            </Button>

            <div className="flex-1 max-w-[200px] space-y-2">
              <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                <span>Course Progress</span>
                <span>{Math.round((slideNumber / totalSlides) * 100)}%</span>
              </div>
              <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-primary via-secondary to-accent rounded-full relative"
                  initial={{ width: 0 }}
                  animate={{ width: `${(slideNumber / totalSlides) * 100}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-glow-primary" />
                </motion.div>
              </div>
            </div>

            <Button 
              variant={isLast ? 'success' : 'default'} 
              onClick={onNext}
              className={`rounded-xl px-8 h-12 font-bold transition-all group ${
                isLast 
                  ? 'bg-success text-white shadow-glow-success border-none' 
                  : 'bg-primary text-white shadow-glow-primary border-none hover:opacity-90'
              }`}
            >
              {isLast ? 'Finish Course' : 'Continue'}
              <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
