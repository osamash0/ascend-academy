import React, { useRef, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BrainCircuit,
  CheckCircle2,
  Loader2,
  Sparkles,
  FileText,
  PartyPopper,
  Cpu
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProcessedSlide {
  title?: string;
}

interface PDFUploadOverlayProps {
  isOpen: boolean;
  uploadProgress: number;
  uploadTotal: number;
  uploadStatus: string;
  processedSlides: ProcessedSlide[];
  parserUsed?: string | null;
  onClose?: () => void;
}

export const PDFUploadOverlay = memo(function PDFUploadOverlay({
  isOpen,
  uploadProgress,
  uploadTotal,
  uploadStatus,
  processedSlides,
  parserUsed,
  onClose
}: PDFUploadOverlayProps) {
  const slideListRef = useRef<HTMLDivElement>(null);

  const completedCount = processedSlides.filter(Boolean).length;
  const isComplete = uploadTotal > 0 && completedCount >= uploadTotal && uploadProgress === 100;

  const isAiPhase = completedCount > 0 && !isComplete;
  const isExtractPhase = uploadProgress > 0 && completedCount === 0 && !isComplete;
  const isUploadPhase = uploadProgress === 0 && !isComplete;

  // Auto-scroll the slide list
  useEffect(() => {
    if (slideListRef.current) {
      slideListRef.current.scrollTop = slideListRef.current.scrollHeight;
    }
  }, [processedSlides]);

  const phases = [
    { label: 'Upload', done: !isUploadPhase, active: isUploadPhase },
    { label: 'Extract', done: isAiPhase || isComplete, active: isExtractPhase },
    { label: 'AI Enhance', done: isComplete, active: isAiPhase },
  ] as const;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-title"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="bg-card border border-violet-200 dark:border-violet-800 shadow-2xl rounded-3xl p-8 max-w-lg w-full relative overflow-hidden"
          >
            {/* Background ambient glows */}
            <div className="absolute -top-20 -left-20 w-56 h-56 bg-violet-500/15 rounded-full blur-[70px] pointer-events-none" />
            <div className="absolute -bottom-20 -right-20 w-56 h-56 bg-indigo-500/15 rounded-full blur-[70px] pointer-events-none" />

            <div className="relative space-y-6">
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <div className="absolute inset-0 bg-violet-500/25 rounded-2xl blur-lg animate-pulse" />
                  <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                    {isComplete ? (
                      <PartyPopper className="w-7 h-7 text-white animate-bounce" aria-hidden="true" />
                    ) : (
                      <BrainCircuit className="w-7 h-7 text-white animate-pulse" aria-hidden="true" />
                    )}
                  </div>
                </div>
                <div>
                  <h3 id="upload-title" className="text-xl font-bold tracking-tight text-foreground">
                    {isComplete ? 'Processing Complete!' : 'Processing Your Lecture'}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5 truncate max-w-[280px]">
                    {isComplete ? 'All slides have been extracted and enhanced.' : (uploadStatus || 'Preparing…')}
                  </p>
                </div>
              </div>

              {/* Phase steps */}
              <div className="flex items-center gap-2" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                {phases.map((step, idx, arr) => (
                  <div key={step.label} className="flex items-center gap-2 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500",
                        step.done
                          ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/40"
                          : step.active
                            ? "bg-violet-600 text-white shadow-sm shadow-violet-500/40 ring-2 ring-violet-400/30"
                            : "bg-muted text-muted-foreground"
                      )}>
                        {step.done ? (
                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        ) : step.active ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <span aria-hidden="true">{idx + 1}</span>
                        )}
                      </div>
                      <span className={cn(
                        "text-xs font-semibold transition-colors duration-300 whitespace-nowrap",
                        step.done 
                          ? "text-emerald-600 dark:text-emerald-400" 
                          : step.active 
                            ? "text-violet-600 dark:text-violet-400" 
                            : "text-muted-foreground"
                      )}>
                        {step.label}
                      </span>
                    </div>
                    {idx < arr.length - 1 && (
                      <div className={cn(
                        "flex-1 h-px transition-colors duration-500", 
                        step.done ? "bg-emerald-400/50" : "bg-border"
                      )} />
                    )}
                  </div>
                ))}
              </div>

              {/* Parser indicator */}
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-center justify-between px-4 py-3 rounded-2xl bg-muted/40 border border-border"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
                  Extraction engine
                </div>
                {parserUsed ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border",
                      parserUsed === 'opendataloader-pdf'
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-700 dark:text-indigo-300"
                        : "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-300"
                    )}
                  >
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      parserUsed === 'opendataloader-pdf'
                        ? "bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.8)]"
                        : "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)]"
                    )} />
                    {parserUsed === 'opendataloader-pdf' ? 'OpenDataLoader PDF' : 'PyMuPDF (fallback)'}
                  </motion.div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                    Detecting…
                  </div>
                )}
              </motion.div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-muted-foreground">
                    {uploadTotal > 0 ? `${completedCount} / ${uploadTotal} slides` : 'Starting…'}
                  </span>
                  <span className={cn(
                    "tabular-nums transition-colors duration-300",
                    isComplete ? "text-emerald-600 dark:text-emerald-400" : "text-violet-600 dark:text-violet-400"
                  )}>
                    {uploadProgress > 0 ? `${uploadProgress}%` : '…'}
                  </span>
                </div>
                <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                  {uploadProgress === 0 ? (
                    <div className="h-full w-[30%] rounded-full bg-gradient-to-r from-violet-600/40 via-indigo-500/60 to-violet-600/40 animate-pulse" />
                  ) : (
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadProgress}%` }}
                      transition={{ type: 'spring', stiffness: 50, damping: 20 }}
                      className={cn(
                        "h-full rounded-full transition-colors duration-500",
                        isComplete 
                          ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                          : "bg-gradient-to-r from-violet-600 via-indigo-500 to-violet-600 shadow-[0_0_10px_rgba(124,58,237,0.4)]"
                      )}
                    />
                  )}
                </div>
              </div>

              {/* Live slide log */}
              <div className="rounded-2xl border border-border bg-muted/30 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/50">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <Sparkles className="w-3 h-3 text-violet-500" aria-hidden="true" />
                    Slides Ready
                  </div>
                  {completedCount > 0 && (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {completedCount}
                    </span>
                  )}
                </div>
                <div
                  ref={slideListRef}
                  className="max-h-[180px] overflow-y-auto p-2 space-y-1 scroll-smooth"
                  role="log"
                  aria-live="polite"
                  aria-label="Processed slides"
                >
                  {completedCount === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" aria-hidden="true" />
                      Waiting for first slide…
                    </div>
                  ) : (
                    processedSlides.filter(Boolean).map((slide, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25 }}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-background/60 hover:bg-background/90 transition-colors group"
                      >
                        <div className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                        </div>
                        <span className="text-xs text-foreground/80 font-medium truncate flex-1 group-hover:text-foreground transition-colors">
                          {slide.title || `Slide ${i + 1}`}
                        </span>
                      </motion.div>
                    ))
                  )}
                  {/* Current processing indicator */}
                  {isAiPhase && completedCount < uploadTotal && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-violet-200/50 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/20"
                    >
                      <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin shrink-0" aria-hidden="true" />
                      <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">
                        Processing slide {completedCount + 1}…
                      </span>
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Footer hint & Cancel */}
              <div className="space-y-4 pt-2">
                {!isComplete ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-center text-[11px] text-muted-foreground/60 font-medium">
                      Please keep this tab open while your lecture is being processed
                    </p>
                    <button
                      onClick={onClose}
                      className="w-full py-2.5 rounded-xl border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-bold transition-all"
                    >
                      Cancel Processing
                    </button>
                  </div>
                ) : (
                  <div className="pt-2">
                    <button
                      onClick={onClose}
                      className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                      Get Started
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
