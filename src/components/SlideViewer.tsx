import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, BookOpen, Lightbulb, Volume2, VolumeX, Square, Play, Pause, Star, HelpCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Document, Page, pdfjs } from 'react-pdf';
import { supabase } from '@/integrations/supabase/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
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
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    // Stop browser TTS
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    
    // Stop backend Audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  const handleSpeak = useCallback(async () => {
    if (isSpeaking && !isPaused) {
      if (audioRef.current) audioRef.current.pause();
      else window.speechSynthesis.pause();
      setIsPaused(true);
      return;
    }

    if (isPaused) {
      if (audioRef.current) audioRef.current.play();
      else window.speechSynthesis.resume();
      setIsPaused(false);
      return;
    }

    const text = [
      title ? `Slide ${slideNumber}: ${title}.` : '',
      summary ? `Summary: ${stripMarkdown(summary)}.` : '',
      content ? `Study Notes: ${stripMarkdown(content)}` : '',
    ].filter(Boolean).join(' ');

    if (!text.trim()) return;

    setIsLoadingTTS(true);
    try {
      // 1. Try backend high-quality AI voice
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const res = await fetch(`${API_BASE}/api/ai/tts`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text, voice: "en-US-AvaNeural" })
      });

      if (!res.ok) throw new Error('Backend TTS failed');
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      audio.onplay = () => { setIsSpeaking(true); setIsPaused(false); };
      audio.onended = () => { setIsSpeaking(false); setIsPaused(false); audioRef.current = null; };
      audio.onerror = () => { throw new Error('Audio play error'); };
      
      audioRef.current = audio;
      audio.play();

    } catch (err) {
      console.warn('Fallback to browser TTS:', err);
      // 2. Fallback to browser SpeechSynthesis
      if (!ttsSupported) return;
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.onstart = () => { setIsSpeaking(true); setIsPaused(false); };
      utterance.onend = () => { setIsSpeaking(false); setIsPaused(false); };
      utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); };

      utteranceRef.current = utterance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } finally {
      setIsLoadingTTS(false);
    }
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
  const ttsLabel = isSpeaking && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Listen';

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
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Slide {slideNumber} / {totalSlides}</span>
              </div>
            </div>
          </div>

          {/* TTS controls */}
          {ttsSupported && (
            <div className="flex items-center gap-2">
              <motion.button
                onClick={handleSpeak}
                disabled={isLoadingTTS}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-300 ${isSpeaking
                    ? 'bg-primary/20 border-primary/30 text-primary shadow-glow-primary/20'
                    : 'bg-surface-2 border-white/5 text-muted-foreground hover:text-foreground hover:border-primary/30'
                  } ${isLoadingTTS ? 'opacity-50 cursor-not-allowed' : ''}`}
                whileTap={{ scale: 0.95 }}
                title={ttsLabel}
              >
                {isLoadingTTS ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : isSpeaking && !isPaused ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
                {isLoadingTTS ? 'Generating...' : ttsLabel}
              </motion.button>

              {isSpeaking && (
                <motion.button
                  onClick={stopSpeech}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-1.5 rounded-xl bg-surface-2 border border-white/5 text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                  title="Stop"
                >
                  <Square className="w-3.5 h-3.5" />
                </motion.button>
              )}
            </div>
          )}
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
              {/* Speaking indicator */}
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

        {/* AI Summary Section */}
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

        {/* Study Notes Content */}
        <div className="p-8 lg:p-10">
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
          {/* Confidence Rating — Orbital Style */}
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
                    onClick={() => handleConfidence(opt.key!)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border-2 text-sm font-bold transition-all duration-300 ${isActive
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
