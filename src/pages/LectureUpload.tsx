import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
  Sparkles,
  FileText,
  ChevronRight,
  ChevronLeft,
  Wand2,
  Save,
  AlertCircle,
  BookOpen,
  X,
  Zap,
  FileUp,
  ListChecks,
  Type,
  ArrowRight,
  Eye,
  Lightbulb,
  Info,
  Flag
} from 'lucide-react';
import { PDFUploadOverlay } from '@/components/PDFUploadOverlay';
import { DuplicatePDFDialog, type DuplicateMatch } from '@/components/DuplicatePDFDialog';
import { ParseCacheDialog } from '@/components/ParseCacheDialog';
import { PDFPagePreview } from '@/components/PDFPagePreview';
import { PDFLightbox } from '@/components/PDFLightbox';
import { NebulaCloud } from '../../learnstation-luna';
import { Document, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import { useSlideManager } from '@/hooks/useSlideManager';
import { usePDFUpload } from '@/hooks/usePDFUpload';
import { usePDFPipelineMode } from '@/hooks/usePDFPipelineMode';
import { useAIGeneration, isAdministrativeQuiz } from '@/hooks/useAIGeneration';
import { useLectureSubmit } from '@/hooks/useLectureSubmit';
import { useParsingMode } from '@/hooks/useParsingMode';
import { useAiModel } from '@/hooks/use-ai-model';
import { useBatchUpload } from '@/hooks/useBatchUpload';
import { MultiFileDropzone } from '@/components/upload/MultiFileDropzone';
import { UploadQueuePanel } from '@/components/upload/UploadQueuePanel';
import { ProfessorRoutes } from '@/lib/routes';
import { apiClient } from '@/lib/apiClient';
import { FEATURES } from '@/lib/featureFlags';
import {
  getSlideStatus,
  getCompletionPercent,
  getOverallCompletion,
} from '@/types/lectureUpload';
import type { SlideStatus } from '@/types/lectureUpload';
import { listCourses, assignLectureToCourse, unassignLectureFromCourse, type Course } from '@/services/coursesService';
import { loadLectureForEdit, deleteSlideWithQuestions, enhanceSlide } from '@/services/lectureService';
import { WorksheetsPanel } from '@/components/WorksheetsPanel';
import { ProfessorPracticeSheetsTab } from '@/features/practice_sheets/ProfessorPracticeSheetsTab';
import { ProfessorReviewCardsPanel } from '@/features/review/ProfessorReviewCardsPanel';
import { SlideViewer } from '@/components/SlideViewer';
import { QuizCard } from '@/components/QuizCard';

/* ────────────────────────────────────────────────────────────────────────── */
/*  COMPONENT: Progress Ring                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function ProgressRing({ percent, size = 36, stroke = 3 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(
            "transition-all duration-700 ease-out",
            percent === 100 ? "text-emerald-500" : percent >= 75 ? "text-primary" : percent >= 50 ? "text-amber-500" : "text-muted-foreground"
          )}
        />
      </svg>
      <span className={cn(
        "absolute inset-0 flex items-center justify-center text-[10px] font-bold",
        percent === 100 ? "text-emerald-600" : "text-muted-foreground"
      )}>
        {percent}%
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  COMPONENT: Status Dots                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function StatusDots({ status }: { status: SlideStatus }) {
  const { t } = useTranslation(['upload']);
  const items = [
    { key: 'hasTitle', label: t('upload:statusDots.title'), icon: Type },
    { key: 'hasContent', label: t('upload:statusDots.content'), icon: FileText },
    { key: 'hasSummary', label: t('upload:statusDots.summary'), icon: Sparkles },
    { key: 'hasQuiz', label: t('upload:statusDots.quiz'), icon: ListChecks },
  ] as const;

  return (
    <div className="flex gap-1">
      {items.map((item) => {
        const active = status[item.key as keyof SlideStatus];
        return (
          <div
            key={item.key}
            className={cn(
              "w-1.5 h-1.5 rounded-full transition-colors duration-300",
              active ? "bg-emerald-500" : "bg-muted-foreground/20"
            )}
            title={item.label}
          />
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  COMPONENT: AI Action Button                                              */
/* ────────────────────────────────────────────────────────────────────────── */

function AIActionButton({
  onClick,
  loading,
  children,
  variant = 'default',
}: {
  onClick: () => void;
  loading: boolean;
  children: React.ReactNode;
  variant?: 'default' | 'subtle';
}) {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={loading}
      className={cn(
        "relative overflow-hidden group flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 disabled:opacity-50",
        variant === 'default'
          ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40"
          : "bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800"
      )}
    >
      <span className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Wand2 className="w-4 h-4" />
      )}
      {children}
    </motion.button>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  COMPONENT: Empty State                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function EmptySlideState({ onAddSlide, onUploadPDF }: { onAddSlide: () => void; onUploadPDF: () => void }) {
  const { t } = useTranslation(['upload']);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8"
    >
      <div className="mb-4 flex justify-center">
        <NebulaCloud size="sm" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">{t('upload:empty.title')}</h3>
      <p className="text-muted-foreground max-w-sm mb-8">
        {t('upload:empty.description')}
      </p>
      <div className="flex gap-3">
        <Button onClick={onAddSlide} size="lg" className="gap-2">
          <Plus className="w-5 h-5" />
          {t('upload:empty.createFirstSlide')}
        </Button>
        <Button onClick={onUploadPDF} variant="outline" size="lg" className="gap-2">
          <FileUp className="w-5 h-5" />
          {t('upload:empty.importPdf')}
        </Button>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  COMPONENT: Quiz Builder                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

const optionLabels = ['A', 'B', 'C', 'D'] as const;

function QuizBuilder({
  question,
  questionIndex,
  slideIndex,
  onUpdateQuestion,
  onUpdateOption,
  onUpdateCorrectAnswer,
}: {
  question: { question: string; options: string[]; correctAnswer: number };
  questionIndex: number;
  slideIndex: number;
  onUpdateQuestion: (slideIndex: number, questionIndex: number, value: string) => void;
  onUpdateOption: (slideIndex: number, questionIndex: number, optionIndex: number, value: string) => void;
  onUpdateCorrectAnswer: (slideIndex: number, questionIndex: number, value: number) => void;
}) {
  const { t } = useTranslation(['upload']);
  return (
    <div className="space-y-4 p-5 rounded-2xl bg-card border border-border shadow-sm">
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('upload:slide.questionLabel')}</Label>
        <Textarea
          value={question.question}
          onChange={(e) => onUpdateQuestion(slideIndex, questionIndex, e.target.value)}
          placeholder={t('upload:slide.questionPlaceholder')}
          className="min-h-[80px] resize-none bg-muted/30 border-0 focus-visible:ring-1"
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          {t('upload:slide.answerOptions')}
          <span className="text-[10px] font-normal normal-case">— {t('upload:slide.answerHelp')}</span>
        </Label>
        {question.options.map((option, oIndex) => {
          const isCorrect = oIndex === question.correctAnswer;
          return (
            <motion.div
              key={oIndex}
              whileHover={{ scale: 1.005 }}
              onClick={() => onUpdateCorrectAnswer(slideIndex, questionIndex, oIndex)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200",
                isCorrect
                  ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-600"
                  : "border-border hover:border-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/10"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-300",
                isCorrect
                  ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                  : "bg-muted text-muted-foreground group-hover:bg-violet-100 group-hover:text-violet-700 dark:group-hover:bg-violet-900/30"
              )}>
                {isCorrect ? <CheckCircle2 className="w-4 h-4" /> : optionLabels[oIndex]}
              </div>
              <Input
                value={option}
                onChange={(e) => onUpdateOption(slideIndex, questionIndex, oIndex, e.target.value)}
                placeholder={t('upload:slide.optionPlaceholder', { label: optionLabels[oIndex] })}
                className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            </motion.div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <AlertCircle className="w-3 h-3" />
        {t('upload:slide.answerHint')}
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  MAIN COMPONENT                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export default function LectureUpload() {
  const { t } = useTranslation(['upload', 'common']);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const slideListRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();

  /* ── Edit mode ─────────────────────────────────────────────────────────── */
  // When the route carries a :lectureId the page edits an EXISTING lecture:
  // slides are loaded from the DB (with row ids) and Save runs a full upsert.
  // Without it, the page is the create/upload flow.
  const { lectureId: editLectureId } = useParams<{ lectureId: string }>();
  const isEditMode = Boolean(editLectureId);
  const [editLoading, setEditLoading] = useState(isEditMode);
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  const [existingPdfUrl, setExistingPdfUrl] = useState<string | null>(null);
  const [editPdfHash, setEditPdfHash] = useState<string | null>(null);
  // PDF chosen to replace the current one (edit mode only).
  const [replacementPdf, setReplacementPdf] = useState<File | null>(null);

  /* ── Lecture metadata ──────────────────────────────────────────────────── */
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [searchParams] = useSearchParams();
  const prefilledCourseId = searchParams.get('courseId');
  const [courseId, setCourseId] = useState<string | null>(prefilledCourseId);
  const [originalCourseId, setOriginalCourseId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  type ParserChoice = 'auto' | 'pymupdf' | 'opendataloader' | 'mineru' | 'llamaparse' | 'markitdown';
  const [parserChoice, setParserChoice] = useState<ParserChoice>('auto');
  useEffect(() => {
    listCourses().then(setCourses).catch((e) => console.error('Failed to load courses', e));
  }, []);

  // Edit mode: hydrate the editor from an existing lecture (slides carry DB ids).
  useEffect(() => {
    if (!editLectureId) return;
    let cancelled = false;
    setEditLoading(true);
    loadLectureForEdit(editLectureId)
      .then((data) => {
        if (cancelled) return;
        setTitle(data.title);
        setDescription(data.description);
        setCourseId(data.courseId);
        setOriginalCourseId(data.courseId);
        setExistingPdfUrl(data.pdfUrl);
        setSignedPdfUrl(data.signedPdfUrl);
        setEditPdfHash(data.pdfHash);
        setSlides(data.slides);
        setActiveSlideIndex(0);
      })
      .catch((e) => {
        console.error('Failed to load lecture for edit', e);
        toast({ title: 'Error', description: 'Failed to load lecture.', variant: 'destructive' });
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLectureId]);

  /* ── UI state ──────────────────────────────────────────────────────────── */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [currentTab, setCurrentTab] = useState<'editor' | 'quizzes' | 'lecture'>('editor');

  /* ── Hooks ─────────────────────────────────────────────────────────────── */
  const {
    slides, setSlides,
    activeSlideIndex, setActiveSlideIndex,
    addSlide, removeSlide, moveSlide,
    updateSlide, updateQuestionText, updateCorrectAnswer, updateOption,
  } = useSlideManager({
    // In edit mode, deleting a slide that exists server-side must remove the
    // row (and its questions) immediately, matching the legacy editor.
    onDeletePersisted: (slide) => {
      if (slide.id) void deleteSlideWithQuestions(slide.id);
    },
  });

  const {
    isUploading,
    uploadProgress, uploadTotal, uploadStatus,
    processedSlides, pdfFile, pdfHash, serverLectureId, parserUsed, parsePhase, parseCompleted,
    deckQuiz,
    handleFileUpload,
    startUpload,
    closeUploadOverlay,
  } = usePDFUpload({ setSlides, setActiveSlideIndex, title, setTitle, parserChoice });

  const { mode, toggle: togglePipelineMode } = usePDFPipelineMode();

  // Task #58: deterministic-vs-AI ingestion toggle. Persisted in
  // localStorage via useParsingMode so the choice survives reloads.
  // The same hook is also called inside usePDFUpload — they share
  // localStorage but each has its own React state. We pass our value
  // down so a toggle here is reflected on the very next upload.
  const { parsingMode, setParsingMode } = useParsingMode();

  /* ── Multi-file batch upload (Phase 1: course-at-once ingestion) ──────── */
  const { aiModel } = useAiModel();
  const batchUpload = useBatchUpload({ courseId, parsingMode, aiModel });
  useEffect(() => {
    if (batchUpload.batchId && batchUpload.allSettled) {
      navigate(ProfessorRoutes.UPLOAD_BATCH_REVIEW(batchUpload.batchId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchUpload.batchId, batchUpload.allSettled]);

  /* ── Edit-mode: lecture-level actions (ported from legacy LectureEdit) ──── */
  // Course reassignment — persisted immediately via assign/unassign RPCs.
  const handleChangeCourse = useCallback(async (next: string | null) => {
    setCourseId(next);
    if (!editLectureId) return;
    try {
      if (originalCourseId && originalCourseId !== next) {
        await unassignLectureFromCourse(originalCourseId, editLectureId);
      }
      if (next && next !== originalCourseId) {
        await assignLectureToCourse(next, editLectureId);
      }
      setOriginalCourseId(next);
      toast({ title: 'Course updated' });
    } catch (err) {
      toast({ title: 'Failed to change course', description: String(err), variant: 'destructive' });
    }
  }, [editLectureId, originalCourseId, toast]);

  // Pipeline diagnostics (read-only routing telemetry for the parsed PDF).
  interface DiagnosticsResponse {
    pdf_hash: string;
    pipeline_version: string;
    run_metrics: { totals?: Record<string, number>; fallbacks?: Record<string, number> } | null;
    per_slide: { slide_index: number; route: string; route_reason: string; layout_features: Record<string, number | boolean> }[];
    flags: { slide_index: number; reason: string }[];
  }
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const fetchDiagnostics = useCallback(async () => {
    if (!editPdfHash) return;
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      setDiagnostics(await apiClient.get<DiagnosticsResponse>(`/api/upload/diagnostics/${editPdfHash}`));
    } catch (err) {
      console.error(err);
      setDiagnosticsError('Failed to load diagnostics.');
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [editPdfHash]);

  // Cross-slide (deck-level) quiz generation.
  const [deckQuizLoading, setDeckQuizLoading] = useState(false);
  const handleGenerateDeckQuiz = useCallback(async () => {
    if (!editLectureId) return;
    if (slides.length < 2) {
      toast({ title: 'Need at least 2 slides', description: 'Cross-slide quizzes require multiple slides.', variant: 'destructive' });
      return;
    }
    setDeckQuizLoading(true);
    try {
      await apiClient.post(`/api/ai/decks/${editLectureId}/generate-quiz`, { ai_model: aiModel });
      toast({ title: 'Cross-slide quiz generated!', description: 'Refreshing slides…' });
      const data = await loadLectureForEdit(editLectureId);
      setSlides(data.slides);
    } catch (err) {
      console.error(err);
      toast({ title: 'AI Error', description: 'Failed to generate cross-slide quiz.', variant: 'destructive' });
    } finally {
      setDeckQuizLoading(false);
    }
  }, [editLectureId, slides.length, aiModel, setSlides, toast]);

  // Skip-AI enhancement — synthesize slides imported with ai_enhanced=false.
  const [enhancingIds, setEnhancingIds] = useState<Set<string>>(new Set());
  const [enhancingAll, setEnhancingAll] = useState(false);
  const unenhancedCount = slides.filter(s => s.id && s.ai_enhanced === false).length;

  // Roadmap Phase 5.1 — "needs review" filter (synthesis failed / vision
  // rescue / empty output). A filter toggle rather than a physical reorder:
  // renumbering the deck away from the professor's real slide positions
  // would be more confusing than useful here.
  const needsReviewCount = slides.filter(s => s.needs_review).length;
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false);
  // The toggle button (the only way to turn the filter off) only renders
  // when needsReviewCount > 0 — if the last flagged slide is resolved/removed
  // while the filter is active, auto-clear it so the professor isn't stuck
  // looking at an empty list with no visible control to escape it.
  useEffect(() => {
    if (needsReviewCount === 0 && showOnlyFlagged) {
      setShowOnlyFlagged(false);
    }
  }, [needsReviewCount, showOnlyFlagged]);

  const enhanceOneSlide = useCallback(async (index: number): Promise<boolean> => {
    const slide = slides[index];
    if (!slide?.id || slide.ai_enhanced) return false;
    setEnhancingIds(prev => new Set(prev).add(slide.id as string));
    try {
      const res = await enhanceSlide(slide.id);
      setSlides(prev => prev.map((s, i) =>
        i === index ? { ...s, title: res.title ?? s.title, summary: res.summary ?? s.summary, ai_enhanced: true } : s,
      ));
      return true;
    } catch (err) {
      console.error('enhance slide failed', err);
      toast({ title: 'Enhancement failed', description: 'Could not enhance this slide. Try again.', variant: 'destructive' });
      return false;
    } finally {
      setEnhancingIds(prev => { const next = new Set(prev); next.delete(slide.id as string); return next; });
    }
  }, [slides, setSlides, toast]);

  const enhanceAllRemaining = useCallback(async () => {
    setEnhancingAll(true);
    let ok = 0;
    try {
      // Sequential to respect the endpoint rate limit and keep LLM load bounded.
      for (let i = 0; i < slides.length; i++) {
        if (slides[i].id && slides[i].ai_enhanced === false) {
          if (await enhanceOneSlide(i)) ok += 1;
        }
      }
      toast({ title: 'Enhancement complete', description: `Enhanced ${ok} slide${ok === 1 ? '' : 's'} with AI.` });
    } finally {
      setEnhancingAll(false);
    }
  }, [slides, enhanceOneSlide, toast]);

  /* ── Duplicate-PDF dialog state ────────────────────────────────────────── */
  const [duplicateState, setDuplicateState] = useState<{
    file: File;
    hash: string;
    matches: DuplicateMatch[];
  } | null>(null);

  // Parse-cache dialog: fires only when no lecture matches but the global
  // pdf_parse_cache would otherwise serve a stale parse silently.
  const [parseCacheState, setParseCacheState] = useState<{
    file: File;
    hash: string;
    parsedAt: string | null;
  } | null>(null);
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);

  const onDuplicateDetected = useCallback(
    (file: File, matches: DuplicateMatch[], hash: string) => {
      setDuplicateState({ file, matches, hash });
    },
    [],
  );

  const onParseCacheHit = useCallback(
    (file: File, hash: string, parsedAt: string | null) => {
      setParseCacheState({ file, hash, parsedAt });
    },
    [],
  );

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      handleFileUpload(e, {
        onDuplicate: onDuplicateDetected,
        onParseCacheHit,
      }),
    [handleFileUpload, onDuplicateDetected, onParseCacheHit],
  );

  const handleDuplicateUseExisting = useCallback(
    (lectureId: string) => {
      setDuplicateState(null);
      navigate(`/professor/lecture/${lectureId}`);
    },
    [navigate],
  );

  const handleDuplicateUploadAsNew = useCallback(async () => {
    const state = duplicateState;
    setDuplicateState(null);
    if (!state) return;
    await startUpload(state.file, { forceReparse: true, precomputedHash: state.hash });
  }, [duplicateState, startUpload]);

  const handleDuplicateCancel = useCallback(() => {
    setDuplicateState(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleParseCacheUseSaved = useCallback(async () => {
    const state = parseCacheState;
    setParseCacheState(null);
    if (!state) return;
    // forceReparse omitted → backend serves the cached parse via SSE.
    await startUpload(state.file, { precomputedHash: state.hash });
  }, [parseCacheState, startUpload]);

  const handleParseCacheReparse = useCallback(async () => {
    const state = parseCacheState;
    setParseCacheState(null);
    if (!state) return;
    await startUpload(state.file, { forceReparse: true, precomputedHash: state.hash });
  }, [parseCacheState, startUpload]);

  const handleParseCacheCancel = useCallback(() => {
    setParseCacheState(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const {
    isAiLoading,
    handleGenerateSummary,
    handleGenerateQuiz,
    handleGenerateTitle,
    handleGenerateContent,
    handleGenerateAllQuizzes,
    isBulkGenerating,
    suggestedQuizzes,
    setSuggestedQuizzes,
    updateSuggestedQuiz,
    updateSuggestedOption,
  } = useAIGeneration({ slides, updateSlide });

  // Sync existing active slide quizzes into suggestedQuizzes state
  useEffect(() => {
    slides.forEach((slide, idx) => {
      const qText = slide.questions[0]?.question?.trim();
      if (qText && !suggestedQuizzes[idx]) {
        setSuggestedQuizzes(prev => ({
          ...prev,
          [idx]: {
            question: slide.questions[0].question,
            options: slide.questions[0].options,
            correctAnswer: slide.questions[0].correctAnswer,
            added: true
          }
        }));
      }
    });
  }, [slides, suggestedQuizzes, setSuggestedQuizzes]);

  // Auto-generate description once PDF parsing finishes (only if still empty)
  useEffect(() => {
    if (!parseCompleted || slides.length === 0 || description.trim()) return;
    const summaries = slides
      .map(s => s.summary?.trim())
      .filter((s): s is string => Boolean(s));
    if (summaries.length === 0) return;
    const courseName = courseId ? courses.find(c => c.id === courseId)?.title : undefined;
    setIsGeneratingDescription(true);
    apiClient
      .post<{ description: string }>('/api/ai/lecture-description', {
        lecture_title: title || 'Lecture',
        course_name: courseName,
        slide_summaries: summaries,
      })
      .then(data => {
        setDescription(prev => prev.trim() ? prev : data.description);
      })
      .catch(() => { /* silently ignore — professor can fill in manually */ })
      .finally(() => setIsGeneratingDescription(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseCompleted]);

  const hasAutoGeneratedRef = useRef<string | null>(null);

  // Auto-generate suggested quizzes only upon successful PDF upload completion
  useEffect(() => {
    if (pdfFile && pdfHash && slides.length > 0 && hasAutoGeneratedRef.current !== pdfHash) {
      const hasAnySuggestions = Object.keys(suggestedQuizzes).length > 0;
      const hasContent = slides.some(s => s.content.trim());
      
      if (hasContent && !hasAnySuggestions && !isBulkGenerating) {
        hasAutoGeneratedRef.current = pdfHash;
        // Trigger bulk generation of suggested quizzes in the background
        handleGenerateAllQuizzes();
      }
    }
  }, [pdfFile, pdfHash, slides, isBulkGenerating, suggestedQuizzes, handleGenerateAllQuizzes]);

  // Copy suggested quiz to the main active slide's questions list
  const handleAddQuiz = useCallback((sIndex: number) => {
    const sug = suggestedQuizzes[sIndex];
    if (!sug) return;
    updateSlide(sIndex, 'questions', [
      { question: sug.question, options: sug.options, correctAnswer: sug.correctAnswer }
    ]);
    setSuggestedQuizzes(prev => ({
      ...prev,
      [sIndex]: { ...prev[sIndex], added: true }
    }));
    toast({
      title: 'Quiz Added',
      description: `Suggested quiz successfully applied to Slide ${sIndex + 1}.`,
    });
  }, [suggestedQuizzes, updateSlide, setSuggestedQuizzes, toast]);

  const [singleGenLoading, setSingleGenLoading] = useState<Record<number, boolean>>({});

  const handleGenerateSingleSuggestion = useCallback(async (sIndex: number) => {
    const slide = slides[sIndex];
    if (!slide || !slide.content.trim()) return;

    setSingleGenLoading(prev => ({ ...prev, [sIndex]: true }));

    const attemptGenerate = async () => {
      const quiz = await apiClient.post<{ question: string; options: string[]; correctAnswer: number; explanation?: string; concept?: string }>(
        '/api/ai/generate-quiz',
        { slide_text: slide.content, ai_model: 'cerebras' }
      );
      setSuggestedQuizzes(prev => ({
        ...prev,
        [sIndex]: {
          question: quiz.question,
          options: quiz.options,
          correctAnswer: quiz.correctAnswer,
          explanation: quiz.explanation,
          concept: quiz.concept,
          added: false
        }
      }));
      if (isAdministrativeQuiz(quiz)) {
        toast({
          title: 'Syllabus / Administrative Slide',
          description: `Logistical info detected on Slide ${sIndex + 1}. A quiz is not recommended.`,
        });
      } else {
        toast({
          title: 'Suggestion Ready',
          description: `Suggested quiz recommendation generated for Slide ${sIndex + 1}.`,
        });
      }
    };

    try {
      await attemptGenerate();
    } catch (firstErr) {
      console.warn('Quiz generation failed, retrying once…', firstErr);
      try {
        await new Promise(r => setTimeout(r, 1500));
        await attemptGenerate();
      } catch (e) {
        console.error(e);
        toast({
          title: 'Generation Failed',
          description: 'Could not generate a quiz after two attempts. Please retry.',
          variant: 'destructive',
        });
      }
    } finally {
      setSingleGenLoading(prev => ({ ...prev, [sIndex]: false }));
    }
  }, [slides, setSuggestedQuizzes, toast]);

  // Accept all pending (non-added, non-administrative) quiz suggestions at once
  const handleAcceptAllQuizzes = useCallback(() => {
    let count = 0;
    Object.entries(suggestedQuizzes).forEach(([idxStr, sug]) => {
      if (!sug || sug.added || isAdministrativeQuiz(sug)) return;
      const idx = Number(idxStr);
      updateSlide(idx, 'questions', [
        { question: sug.question, options: sug.options, correctAnswer: sug.correctAnswer }
      ]);
      setSuggestedQuizzes(prev => ({ ...prev, [idx]: { ...prev[idx], added: true } }));
      count++;
    });
    if (count > 0) {
      toast({ title: `${count} Quiz${count > 1 ? 'zes' : ''} Added`, description: 'All suggestions have been applied to their slides.' });
    }
  }, [suggestedQuizzes, updateSlide, setSuggestedQuizzes, toast]);

  const { loading, handleSubmit } = useLectureSubmit({
    slides,
    title,
    description,
    pdfFile: isEditMode ? replacementPdf : pdfFile,
    pdfHash,
    courseId,
    deckQuiz,
    parsingMode,
    serverLectureId,
    editLectureId: isEditMode ? editLectureId : null,
    existingPdfUrl,
  });

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const activeSlide = slides[activeSlideIndex];
  // The PDF to preview: the just-uploaded File (create) or the loaded lecture's
  // signed URL (edit). A replacement chosen in edit mode takes precedence.
  const activePdf = replacementPdf ?? pdfFile ?? signedPdfUrl;
  const totalSlides = slides.length;
  const overallCompletion = useMemo(() => getOverallCompletion(slides), [slides]);

  const pendingSuggestionsCount = useMemo(() => {
    return Object.values(suggestedQuizzes).filter(
      (sug: any) => sug && !isAdministrativeQuiz(sug) && !sug.added
    ).length;
  }, [suggestedQuizzes]);

  /* ── Stable nav callbacks ──────────────────────────────────────────────── */
  const handlePrevSlide = useCallback(
    () => setActiveSlideIndex(p => Math.max(0, p - 1)),
    [setActiveSlideIndex]
  );
  const handleNextSlide = useCallback(
    () => setActiveSlideIndex(p => Math.min(totalSlides - 1, p + 1)),
    [setActiveSlideIndex, totalSlides]
  );

  const handleExit = useCallback(() => {
    if (slides.length > 0) {
      const confirm = window.confirm(t('upload:toasts.exitConfirm'));
      if (!confirm) return;
    }
    navigate('/professor/dashboard');
  }, [slides.length, navigate, t]);

  /* ── Scroll active slide into view ─────────────────────────────────────── */
  useEffect(() => {
    if (sidebarRef.current) {
      const activeEl = sidebarRef.current.querySelector(`[data-slide-index="${activeSlideIndex}"]`);
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeSlideIndex]);

  // Switching slides swaps the editor content but the scroll container keeps
  // its old scrollTop, so picking a slide from further down the sidebar can
  // land you mid-scroll on the new slide's fields instead of at its title.
  useEffect(() => {
    editorScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeSlideIndex]);

  /* ── Keyboard navigation (stable — uses functional updaters) ───────────── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSlideIndex(p => Math.max(0, p - 1));
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSlideIndex(p => p + 1); // clamped below via Math.min when rendering
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-scroll slide log during upload ──────────────────────────────── */
  useEffect(() => {
    if (slideListRef.current) {
      slideListRef.current.scrollTop = slideListRef.current.scrollHeight;
    }
  }, [processedSlides]);

  /* ── Unsaved-changes guard ─────────────────────────────────────────────── */
  useEffect(() => {
    const dirty = slides.some(
      s => s.title || s.content || s.summary || s.questions.some(q => q.question)
    );
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [slides]);

  /* ── Render: Edit-mode loading ─────────────────────────────────────────── */
  if (isEditMode && editLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* ── Render: Empty State (create/upload flow only) ─────────────────────── */
  // In edit mode we always show the editor chrome — even for a lecture with no
  // slides yet — rather than the upload-focused empty state.
  if (!isEditMode && slides.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleExit}
                className="rounded-full h-8 w-8"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">{t('upload:header.title')}</h1>
                <p className="text-xs text-muted-foreground">{t('upload:header.subtitle')}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleExit} className="text-xs font-medium">
              {t('upload:header.exit')}
            </Button>
          </div>
        </div>

        {/* Lecture Details Form */}
        <div className="max-w-2xl mx-auto px-6 pt-8 pb-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="title" className="text-sm font-medium">{t('upload:form.titleLabel')}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('upload:form.titlePlaceholder')}
                className="mt-1.5 text-lg h-12"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="description" className="text-sm font-medium">{t('upload:form.descriptionLabel')}</Label>
                {isGeneratingDescription && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('upload:form.generating', { defaultValue: 'Generating…' })}
                  </span>
                )}
              </div>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={isGeneratingDescription ? t('upload:form.aiWritingDescription', { defaultValue: 'AI is writing a description…' }) : t('upload:form.descriptionPlaceholder')}
                className="mt-1.5"
                rows={3}
                disabled={isGeneratingDescription}
              />
            </div>
            <div>
              <Label htmlFor="course" className="text-sm font-medium">{t('upload:empty.courseLabel')}</Label>
              <select
                id="course"
                value={courseId ?? ''}
                onChange={(e) => setCourseId(e.target.value || null)}
                className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('upload:empty.uncategorized')}</option>
                {courses?.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="parser" className="text-sm font-medium">{t('upload:form.extractionEngine', { defaultValue: 'Extraction Engine' })}</Label>
              <select
                id="parser"
                value={parserChoice}
                onChange={(e) => setParserChoice(e.target.value as ParserChoice)}
                className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="auto">{t('upload:form.parserAuto', { defaultValue: 'Auto (Recommended)' })}</option>
                <option value="llamaparse">LlamaParse</option>
                <option value="mineru">MinerU</option>
                <option value="opendataloader">OpenDataLoader</option>
                <option value="markitdown">MarkItDown (PowerPoint)</option>
                <option value="pymupdf">PyMuPDF (Fallback)</option>
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">{t('upload:form.parserHelpText', { defaultValue: 'Select the engine used to extract text and layout. PowerPoint (.pptx) files always use MarkItDown.' })}</p>
            </div>
            {/* Parsing-mode selector (Task #58) */}
            <div
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-card/60 p-4 mt-2"
              data-testid="parsing-mode-selector"
            >
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{t('upload:form.parsingModeLabel', { defaultValue: 'PDF parsing mode' })}</Label>
                <p className="text-xs text-muted-foreground">
                  {parsingMode === 'on_demand'
                    ? t('upload:form.parsingModeOnDemandDesc', { defaultValue: 'Skip AI during import — extract text only. Use the editor to generate titles, content, and quizzes per slide.' })
                    : t('upload:form.parsingModeAIDesc', { defaultValue: 'Default: full AI parsing (titles, summaries, and quizzes are generated automatically).' })}
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label="PDF parsing mode"
                className="inline-flex rounded-lg border border-border bg-background p-0.5 shrink-0"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={parsingMode === 'ai'}
                  onClick={() => setParsingMode('ai')}
                  data-testid="parsing-mode-ai"
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                    parsingMode === 'ai'
                      ? 'bg-violet-500 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('upload:form.parsingModeAI', { defaultValue: 'AI parsing' })}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={parsingMode === 'on_demand'}
                  onClick={() => setParsingMode('on_demand')}
                  data-testid="parsing-mode-on-demand"
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                    parsingMode === 'on_demand'
                      ? 'bg-violet-500 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('upload:form.parsingModeOnDemand', { defaultValue: 'Skip AI' })}
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Empty State */}
        <div className="max-w-2xl mx-auto px-6">
          <Tabs defaultValue="single">
            <TabsList className="mb-2">
              <TabsTrigger value="single" data-testid="upload-tab-single">Single file</TabsTrigger>
              <TabsTrigger value="batch" data-testid="upload-tab-batch">Multiple files</TabsTrigger>
            </TabsList>
            <TabsContent value="single">
              <EmptySlideState
                onAddSlide={() => addSlide()}
                onUploadPDF={() => fileInputRef.current?.click()}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.pptx"
                onChange={onPickFile}
                className="hidden"
              />
            </TabsContent>
            <TabsContent value="batch" className="space-y-4 pb-8">
              <MultiFileDropzone
                onFilesSelected={batchUpload.addFiles}
                maxFiles={batchUpload.maxBatchFiles}
                currentCount={batchUpload.files.length}
              />
              <UploadQueuePanel
                files={batchUpload.files}
                onRemove={batchUpload.removeFile}
                onReorder={batchUpload.reorderFiles}
                onRetry={batchUpload.retryFile}
                submitted={!!batchUpload.batchId}
              />
              {batchUpload.files.length > 0 && !batchUpload.batchId && (
                <Button
                  onClick={() => void batchUpload.submitBatch()}
                  disabled={batchUpload.isSubmitting}
                  data-testid="submit-batch"
                >
                  {batchUpload.isSubmitting
                    ? 'Uploading…'
                    : `Upload ${batchUpload.files.length} file${batchUpload.files.length === 1 ? '' : 's'}`}
                </Button>
              )}
              {batchUpload.batchId && !batchUpload.allSettled && (
                <p className="text-xs text-muted-foreground">
                  Parsing in the background — feel free to navigate away; the Uploads indicator in the top bar will notify you when it's done.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DuplicatePDFDialog
          open={duplicateState !== null}
          matches={duplicateState?.matches ?? []}
          onUseExisting={handleDuplicateUseExisting}
          onUploadAsNew={handleDuplicateUploadAsNew}
          onCancel={handleDuplicateCancel}
        />

        <ParseCacheDialog
          open={parseCacheState !== null}
          parsedAt={parseCacheState?.parsedAt ?? null}
          onUseCached={handleParseCacheUseSaved}
          onReparse={handleParseCacheReparse}
          onCancel={handleParseCacheCancel}
        />

        <PDFUploadOverlay
          isOpen={isUploading}
          uploadProgress={uploadProgress}
          uploadTotal={uploadTotal}
          uploadStatus={uploadStatus}
          processedSlides={processedSlides}
          parserUsed={parserUsed}
          parsePhase={parsePhase}
          parseCompleted={parseCompleted}
          parsingMode={parsingMode}
          onClose={closeUploadOverlay}
        />
      </div>
    );
  }

  /* ── Render: Full Editor ───────────────────────────────────────────────── */
  // h-screen (not min-h-screen) so the sidebar and slide-editor panes below
  // are genuinely height-bounded and scroll internally via their own
  // overflow-y-auto — otherwise this whole column just grows with content
  // (e.g. 20+ slides) and the ENTIRE page scrolls instead, which is what let
  // a newly-selected slide's fields land off-screen above the fold.
  const editorContent = (
    <div className="h-screen bg-background flex flex-col">
      {/* ═══════ TOP BAR ═══════ */}
      <div className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 lg:px-6 h-16">
          {/* Left: Brand + Title Input */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExit}
              className="rounded-full h-8 w-8 hover:bg-muted/80"
              title={t('upload:chrome.backToDashboard')}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-500/20 shrink-0">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0 max-w-md">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('upload:form.titleLabel')}
                className="border-0 bg-transparent text-lg font-semibold placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-auto"
              />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('upload:form.descriptionPlaceholder')}
                className="border-0 bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-auto py-0"
              />
            </div>
          </div>

          {/* Center: Progress */}
          <div className="hidden md:flex items-center gap-3 px-6">
            <ProgressRing percent={overallCompletion} size={32} stroke={2.5} />
            <div className="text-xs">
              <span className="font-semibold text-foreground">{overallCompletion}%</span>
              <span className="text-muted-foreground ml-1">{t('upload:chrome.complete')}</span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {!isEditMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="hidden sm:flex gap-2"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                {t('upload:empty.importPdf')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExit}
              className="text-xs font-medium"
            >
              {t('upload:header.exit')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFullPreview(true)}
              className="gap-2 border-violet-200 text-violet-700 hover:bg-violet-50"
            >
              <BookOpen className="w-4 h-4" />
              {t('upload:actions.preview')}
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={loading}
              className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {loading ? t('upload:actions.saving') : t('upload:actions.save')}
            </Button>
          </div>
        </div>

      </div>

      {/* ═══════ MAIN LAYOUT ═══════ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── SIDEBAR: Slide Navigator ─── */}
        <AnimatePresence mode="popLayout">
          {!sidebarCollapsed && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="border-r border-border bg-muted/30 flex flex-col shrink-0 overflow-hidden"
            >
              {/* Sidebar Header */}
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('upload:chrome.slides', { count: totalSlides })}
                  </span>
                  <div className="flex gap-1">
                    {needsReviewCount > 0 && (
                      <Button
                        variant={showOnlyFlagged ? 'default' : 'ghost'}
                        size="icon"
                        className={cn('h-7 w-7 relative', showOnlyFlagged && 'bg-amber-500 hover:bg-amber-600 text-white')}
                        onClick={() => setShowOnlyFlagged(v => !v)}
                        data-testid="needs-review-filter-toggle"
                        title={t('upload:chrome.needsReviewFilter', {
                          count: needsReviewCount,
                          defaultValue: `${needsReviewCount} slide${needsReviewCount === 1 ? '' : 's'} may need review`,
                        })}
                      >
                        <Flag className="w-3.5 h-3.5" />
                        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                          {needsReviewCount}
                        </span>
                      </Button>
                    )}
                    {!isEditMode && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => fileInputRef.current?.click()}
                        title={t('upload:empty.importPdf')}
                      >
                        <FileUp className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => addSlide(activeSlideIndex)}
                      title={t('upload:chrome.addSlideAfter')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Quick Add Button */}
                <Button
                  variant="outline"
                  className="w-full gap-2 text-xs h-8 border-dashed"
                  onClick={() => addSlide()}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('upload:chrome.addNewSlide')}
                </Button>
              </div>

              {/* Slide List */}
              <div ref={sidebarRef} className="flex-1 overflow-y-auto p-2 space-y-1">
                {showOnlyFlagged && needsReviewCount === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {t('upload:chrome.needsReviewNoneLeft', { defaultValue: 'No slides need review anymore.' })}
                  </p>
                )}
                {slides
                  .map((slide, index) => ({ slide, index }))
                  .filter(({ slide }) => !showOnlyFlagged || slide.needs_review)
                  .map(({ slide, index }) => {
                  const status = getSlideStatus(slide);
                  const percent = getCompletionPercent(status);
                  const isActive = index === activeSlideIndex;

                  return (
                    <motion.div
                      key={index}
                      data-slide-index={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      onClick={() => setActiveSlideIndex(index)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActiveSlideIndex(index);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={t('upload:slideItemAria', { number: index + 1, title: slide.title || 'Untitled', defaultValue: `Slide ${index + 1}: ${slide.title || 'Untitled'}` })}
                      className={cn(
                        "group relative flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                        isActive
                          ? "bg-card shadow-md border border-violet-200 dark:border-violet-800/50 ring-1 ring-violet-500/20"
                          : "hover:bg-card/80 border border-transparent"
                      )}
                    >
                      {/* Slide Number */}
                      <div className={cn(
                        "relative w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5",
                        isActive
                          ? "bg-violet-500 text-white shadow-md shadow-violet-500/30"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {index + 1}
                        {slide.needs_review && (
                          <Flag
                            className="w-3 h-3 text-amber-500 absolute -top-1.5 -right-1.5 bg-background rounded-full p-0.5"
                            data-testid={`needs-review-badge-${index}`}
                            aria-label={t('upload:chrome.needsReviewBadge', { defaultValue: 'This slide may need review' })}
                          />
                        )}
                      </div>

                      {/* Slide Info */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm font-medium truncate",
                          isActive ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {slide.title || t('upload:slideFallback', { number: index + 1 })}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StatusDots status={status} />
                          <span className="text-[10px] text-muted-foreground">
                            {percent}%
                          </span>
                        </div>
                        {activePdf && (
                          <div className="mt-2" onClick={(e) => { e.stopPropagation(); setLightboxPage(index + 1); }}>
                            <PDFPagePreview pageNumber={index + 1} width={220} />
                          </div>
                        )}
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSlide(index);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-destructive/10 hover:text-destructive transition-all"
                        aria-label={t('upload:deleteSlideAria', { number: index + 1, defaultValue: `Delete slide ${index + 1}` })}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sidebar Toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-6 h-12 bg-card border border-border rounded-r-lg flex items-center justify-center shadow-md hover:bg-accent transition-colors"
          style={{ marginLeft: sidebarCollapsed ? 0 : 280 }}
          aria-label={sidebarCollapsed ? t('upload:chrome.expandSidebar', { defaultValue: 'Expand sidebar' }) : t('upload:chrome.collapseSidebar', { defaultValue: 'Collapse sidebar' })}
        >
          {sidebarCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        {/* ─── MAIN CONTENT: Slide Editor & Quiz Suggestions ─── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={currentTab} onValueChange={(v) => setCurrentTab(v as 'editor' | 'quizzes' | 'lecture')} className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs Navigation Bar */}
            <div className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-10 px-6 py-3 flex items-center justify-between shrink-0">
              <TabsList className="bg-muted p-0.5 rounded-lg border border-border/50">
                <TabsTrigger value="editor" className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-1.5 text-xs font-semibold rounded-md transition-all">
                  {t('upload:chrome.slideEditor')}
                </TabsTrigger>
                <TabsTrigger value="quizzes" className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-1.5 text-xs font-semibold rounded-md flex items-center gap-2 transition-all">
                  Quiz Suggestions
                  {pendingSuggestionsCount > 0 && (
                    <span className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 px-1.5 py-0.5 rounded-full font-bold animate-pulse">
                      {pendingSuggestionsCount}
                    </span>
                  )}
                </TabsTrigger>
                {isEditMode && (
                  <TabsTrigger value="lecture" className="data-[state=active]:bg-background data-[state=active]:shadow-sm px-4 py-1.5 text-xs font-semibold rounded-md flex items-center gap-2 transition-all">
                    {t('upload:chrome.lectureTab', { defaultValue: 'Lecture' })}
                    {unenhancedCount > 0 && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-bold">
                        {unenhancedCount}
                      </span>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
              <div className="text-xs text-muted-foreground font-medium hidden sm:block">
                Total Slides: {slides.length}
              </div>
            </div>

            {/* Slide Editor Tab */}
            <TabsContent ref={editorScrollRef} value="editor" className="flex-1 overflow-y-auto m-0 focus-visible:ring-0">
              <AnimatePresence mode="wait">
                {activeSlide && (
              <motion.div
                key={activeSlideIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="max-w-3xl mx-auto p-6 lg:p-8 space-y-6"
              >
                {/* Slide Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center">
                      <span className="text-sm font-bold text-violet-600 dark:text-violet-400">
                        {activeSlideIndex + 1}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">{t('upload:chrome.slideEditor')}</h2>
                      <p className="text-xs text-muted-foreground">
                        {getCompletionPercent(getSlideStatus(activeSlide))}% {t('upload:chrome.complete')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isEditMode && (
                      <div className="flex items-center gap-0.5 mr-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => moveSlide(activeSlideIndex, 'up')}
                          disabled={activeSlideIndex === 0}
                          className="h-7 w-7 p-0"
                          title="Move slide up"
                        >
                          <ChevronLeft className="w-3.5 h-3.5 rotate-90" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => moveSlide(activeSlideIndex, 'down')}
                          disabled={activeSlideIndex === slides.length - 1}
                          className="h-7 w-7 p-0"
                          title="Move slide down"
                        >
                          <ChevronLeft className="w-3.5 h-3.5 -rotate-90" />
                        </Button>
                      </div>
                    )}
                    {isEditMode && activeSlide.id && activeSlide.ai_enhanced === false && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => enhanceOneSlide(activeSlideIndex)}
                        disabled={enhancingIds.has(activeSlide.id) || enhancingAll}
                        className="gap-1.5"
                        title="Run AI synthesis on this slide"
                      >
                        {enhancingIds.has(activeSlide.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Enhance with AI
                      </Button>
                    )}
                    {activePdf && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLightboxPage(activeSlideIndex + 1)}
                        className="gap-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {t('upload:chrome.viewOriginal', 'View Original')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowFullPreview(true)}
                      className="gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {t('upload:chrome.previewOpen')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addSlide(activeSlideIndex)}
                      className="gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('upload:chrome.insertAfter')}
                    </Button>
                    {slides.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSlide(activeSlideIndex)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Title Field */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Type className="w-3.5 h-3.5 text-muted-foreground" />
                    {t('upload:slide.titleLabel')}
                  </Label>
                  <Input
                    value={activeSlide.title}
                    onChange={(e) => updateSlide(activeSlideIndex, 'title', e.target.value)}
                    placeholder={t('upload:slide.titlePlaceholder')}
                    className="h-11 text-base"
                  />
                </div>

                {/* Content Field */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    {t('upload:slide.contentLabel')}
                  </Label>
                  <Textarea
                    value={activeSlide.content}
                    onChange={(e) => updateSlide(activeSlideIndex, 'content', e.target.value)}
                    placeholder={t('upload:slide.contentPlaceholder')}
                    className="min-h-[160px] resize-y text-base leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('upload:chrome.characters', { count: activeSlide.content.length })}
                  </p>
                </div>

                {/* AI Actions Bar */}
                <div className="flex flex-wrap gap-3 p-4 rounded-xl bg-gradient-to-r from-violet-50/80 to-indigo-50/80 dark:from-violet-950/20 dark:to-indigo-950/20 border border-violet-100 dark:border-violet-800/30">
                  <div className="flex items-center gap-2 text-sm text-violet-800 dark:text-violet-300 font-medium">
                    <Zap className="w-4 h-4" />
                    {t('upload:chrome.aiAssistant')}
                  </div>
                  <div className="flex-1" />
                  <AIActionButton
                    onClick={() => handleGenerateSummary(activeSlideIndex)}
                    loading={isAiLoading(activeSlideIndex, 'summary')}
                    variant="subtle"
                  >
                    {t('upload:actions.generateSummary')}
                  </AIActionButton>
                  <AIActionButton
                    onClick={() => handleGenerateQuiz(activeSlideIndex)}
                    loading={isAiLoading(activeSlideIndex, 'quiz')}
                    variant="subtle"
                  >
                    {t('upload:actions.generateQuiz')}
                  </AIActionButton>
                </div>

                {/* Summary Field */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    {t('upload:slide.summaryLabel')}
                    {activeSlide.summary && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">
                        {t('upload:chrome.aiGenerated')}
                      </span>
                    )}
                  </Label>
                  <Textarea
                    value={activeSlide.summary}
                    onChange={(e) => updateSlide(activeSlideIndex, 'summary', e.target.value)}
                    placeholder={t('upload:slide.summaryPlaceholder')}
                    className="min-h-[100px] resize-y bg-amber-50/30 dark:bg-amber-950/10 border-amber-200/50 dark:border-amber-800/30 focus:border-amber-400"
                    rows={3}
                  />
                </div>

                {/* Quiz Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <ListChecks className="w-3.5 h-3.5 text-emerald-500" />
                      {t('upload:slide.quizLabel')}
                    </Label>
                    {activeSlide.questions[0]?.question && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">
                        {t('upload:chrome.configured')}
                      </span>
                    )}
                  </div>

                  {activeSlide.questions.map((question, qIndex) => (
                    <QuizBuilder
                      key={qIndex}
                      question={question}
                      questionIndex={qIndex}
                      slideIndex={activeSlideIndex}
                      onUpdateQuestion={updateQuestionText}
                      onUpdateOption={updateOption}
                      onUpdateCorrectAnswer={updateCorrectAnswer}
                    />
                  ))}
                </div>

                {/* Navigation Footer */}
                <div className="flex items-center justify-between pt-6 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrevSlide}
                    disabled={activeSlideIndex === 0}
                    className="gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t('common:actions.back')}
                  </Button>

                  <span className="text-xs text-muted-foreground">
                    {t('upload:slide.slideNumber', { number: activeSlideIndex + 1 })} / {totalSlides}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextSlide}
                    disabled={activeSlideIndex === totalSlides - 1}
                    className="gap-2"
                  >
                    {t('common:actions.next')}
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
            </TabsContent>

            {/* Quiz Suggestions Tab */}
            <TabsContent value="quizzes" className="flex-1 overflow-y-auto m-0 focus-visible:ring-0">
              <div className="max-w-3xl mx-auto p-6 lg:p-8 space-y-6">
                {/* Header Banner */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-violet-50/50 to-indigo-50/50 dark:from-violet-950/10 dark:to-indigo-950/10 border border-violet-100/50 dark:border-violet-900/20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center shrink-0">
                      <ListChecks className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-foreground">Quiz Recommendations</h2>
                      <p className="text-xs text-muted-foreground">
                        Review, edit, and navigate AI-suggested quiz questions generated for all slides.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {pendingSuggestionsCount > 0 && (
                      <Button
                        onClick={handleAcceptAllQuizzes}
                        className="shrink-0 gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/20 h-9 rounded-xl text-xs font-semibold"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Accept All ({pendingSuggestionsCount})
                      </Button>
                    )}
                    {slides.filter(s => !s.questions[0]?.question?.trim() && s.content.trim()).length > 0 && (
                      <Button
                        onClick={() => handleGenerateAllQuizzes()}
                        disabled={isBulkGenerating}
                        className="shrink-0 gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20 hover:from-violet-700 hover:to-indigo-700 h-9 rounded-xl text-xs font-semibold"
                      >
                        {isBulkGenerating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                        )}
                        {isBulkGenerating ? 'Generating All...' : 'Auto-Generate All Quizzes'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Quizzes List */}
                <div className="space-y-6">
                  {slides.map((slide, sIndex) => {
                    const sug = suggestedQuizzes[sIndex];
                    const isLoading = isAiLoading(sIndex, 'quiz');
                    const isWorthQuiz = slide.content.trim().length > 0;
                    
                    // Hide slides that have no text or are detected as administrative
                    if (!isWorthQuiz) return null;
                    if (isAdministrativeQuiz(sug) && !sug.added) return null;
                    
                    return (
                      <div key={sIndex} className="p-5 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md transition-all duration-300">
                        {/* Slide card header */}
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/50">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-md bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 text-xs font-bold flex items-center justify-center">
                              {sIndex + 1}
                            </span>
                            <span className="font-semibold text-sm truncate max-w-[200px] sm:max-w-md">
                              {slide.title || `Slide ${sIndex + 1}`}
                            </span>
                          </div>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setActiveSlideIndex(sIndex);
                              setCurrentTab('editor');
                            }}
                            className="h-7 px-2.5 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 gap-1 font-semibold"
                          >
                            Edit Slide <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        {/* Quiz Editor inside Card */}
                        {(isLoading || singleGenLoading[sIndex]) ? (
                          <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/5 rounded-xl border border-dashed border-border">
                            <Loader2 className="w-6 h-6 animate-spin text-violet-500 mb-2" />
                            <p className="text-xs text-muted-foreground">AI is crafting a recommended quiz question...</p>
                          </div>
                        ) : !sug ? (
                          <div className="flex flex-col items-center justify-center py-6 text-center bg-muted/20 border border-dashed border-border rounded-xl">
                            <AlertCircle className="w-6 h-6 text-muted-foreground/60 mb-2" />
                            <p className="text-xs text-muted-foreground mb-3">No suggested quiz generated yet.</p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleGenerateSingleSuggestion(sIndex)}
                              className="h-8 text-xs gap-1.5 font-medium"
                            >
                              <Wand2 className="w-3.5 h-3.5" /> Suggest Quiz
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {sug.added ? (
                              <div className="flex items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                  This suggestion has been added to the slide.
                                </p>
                              </div>
                            ) : (
                              <>
                                <div className="space-y-1.5">
                                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Suggested Question</Label>
                                  <Textarea
                                    value={sug.question}
                                    onChange={(e) => updateSuggestedQuiz(sIndex, 'question', e.target.value)}
                                    className="min-h-[60px] text-sm resize-y"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Options</Label>
                                  {sug.options?.map((opt: string, oIdx: number) => (
                                    <div key={oIdx} className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => updateSuggestedQuiz(sIndex, 'correctAnswer', oIdx)}
                                        className={cn(
                                          "w-6 h-6 rounded-full shrink-0 flex items-center justify-center border transition-all shadow-sm",
                                          sug.correctAnswer === oIdx
                                            ? "bg-emerald-500 border-emerald-600 text-white shadow-emerald-500/20"
                                            : "bg-background border-border text-transparent hover:border-emerald-500/50"
                                        )}
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                      </button>
                                      <Input
                                        value={opt}
                                        onChange={(e) => updateSuggestedOption(sIndex, oIdx, e.target.value)}
                                        className={cn(
                                          "h-9 text-sm",
                                          sug.correctAnswer === oIdx && "border-emerald-500/30 bg-emerald-50/10"
                                        )}
                                      />
                                    </div>
                                  ))}
                                </div>

                                {/* AI Context (Concept & Explanation) */}
                                {(sug.concept || sug.explanation) && (
                                  <div className="mt-4 p-3 bg-violet-50/50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/30 rounded-lg">
                                    {sug.concept && (
                                      <div className="mb-1.5 flex items-start gap-1.5">
                                        <Lightbulb className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                                        <p className="text-xs font-semibold text-violet-800 dark:text-violet-300">
                                          Concept: <span className="font-medium text-violet-700 dark:text-violet-400">{sug.concept}</span>
                                        </p>
                                      </div>
                                    )}
                                    {sug.explanation && (
                                      <div className="flex items-start gap-1.5">
                                        <Info className="w-3.5 h-3.5 text-violet-500/70 mt-0.5 shrink-0" />
                                        <p className="text-[11px] text-violet-700/80 dark:text-violet-300/80 leading-relaxed">
                                          {sug.explanation}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="flex justify-end pt-2">
                                  <Button
                                    onClick={() => handleAddQuiz(sIndex)}
                                    className="h-8 gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 rounded-lg px-4"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    Accept & Add to Slide
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            {/* Lecture Tab — lecture-level settings & tools (edit mode only) */}
            {isEditMode && (
            <TabsContent value="lecture" className="flex-1 overflow-y-auto m-0 focus-visible:ring-0">
              <div className="max-w-3xl mx-auto p-6 lg:p-8 space-y-6">
                {/* Course assignment */}
                <div className="bg-card rounded-2xl border border-border p-6">
                  <h2 className="text-lg font-semibold text-foreground mb-4">{t('upload:lectureTab.detailsTitle', { defaultValue: 'Lecture Details' })}</h2>
                  <div>
                    <Label htmlFor="edit-course" className="text-sm font-medium">{t('upload:empty.courseLabel')}</Label>
                    <select
                      id="edit-course"
                      value={courseId ?? ''}
                      onChange={(e) => void handleChangeCourse(e.target.value || null)}
                      className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">{t('upload:empty.uncategorized')}</option>
                      {courses.map(c => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Skip-AI enhance-all banner */}
                {unenhancedCount > 0 && (
                  <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{unenhancedCount}</span> slide{unenhancedCount === 1 ? ' was' : 's were'} imported without AI. Enhance to generate titles and explanations.
                    </p>
                    <Button type="button" onClick={enhanceAllRemaining} disabled={enhancingAll} className="gap-1.5 shrink-0">
                      {enhancingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {enhancingAll ? 'Enhancing…' : 'Enhance all remaining'}
                    </Button>
                  </div>
                )}

                {/* Worksheets */}
                {editLectureId && (
                  <div className="bg-card rounded-2xl border border-border p-6">
                    <WorksheetsPanel lectureId={editLectureId} editable />
                  </div>
                )}

                {/* Practice sheets */}
                {editLectureId && (
                  <div className="bg-card rounded-2xl border border-border p-6">
                    <h2 className="text-lg font-semibold text-foreground mb-1">Practice Sheets</h2>
                    <p className="text-xs text-muted-foreground mb-5">
                      Auto-generate a sheet from quiz questions or author your own. Students see published sheets on this lecture's page.
                    </p>
                    <ProfessorPracticeSheetsTab lectureId={editLectureId} />
                  </div>
                )}

                {/* Review cards (spaced-repetition "Daily Ascent") */}
                {editLectureId && FEATURES.reviewEngine && (
                  <div className="bg-card rounded-2xl border border-border p-6">
                    <h2 className="text-lg font-semibold text-foreground mb-1">Review Cards</h2>
                    <p className="text-xs text-muted-foreground mb-5">
                      Auto-generated spaced-repetition cards from this lecture's quiz questions. Hide any that shouldn't reach students — hiding preserves their existing progress, it never deletes it.
                    </p>
                    <ProfessorReviewCardsPanel lectureId={editLectureId} />
                  </div>
                )}

                {/* PDF replace */}
                <div className="bg-card rounded-2xl border border-border p-6">
                  <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    {existingPdfUrl ? 'Replace PDF Slides' : 'Attach PDF Slides'}
                  </h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    {existingPdfUrl
                      ? 'This lecture already has a PDF attached. Choose a new one to replace it on save.'
                      : 'Upload a PDF to show original slides to your students alongside the content.'}
                  </p>
                  <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="pdf-edit-upload">Choose PDF file</Label>
                    <Input
                      id="pdf-edit-upload"
                      type="file"
                      accept=".pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && file.type === 'application/pdf') setReplacementPdf(file);
                        else if (file) toast({ title: 'Invalid file', description: 'Please select a PDF file.', variant: 'destructive' });
                      }}
                    />
                  </div>
                  {existingPdfUrl && !replacementPdf && (
                    <div className="mt-4 flex items-center gap-2 text-xs text-success bg-success/10 p-2 rounded-lg w-fit">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Current PDF: {existingPdfUrl.split('/').pop()}</span>
                    </div>
                  )}
                  {replacementPdf && (
                    <div className="mt-4 flex items-center gap-2 text-xs text-primary bg-primary/10 p-2 rounded-lg w-fit">
                      <Upload className="w-3 h-3" />
                      <span>Selected: {replacementPdf.name} (applied on save)</span>
                    </div>
                  )}
                </div>

                {/* Cross-slide quiz */}
                <div className="bg-card rounded-2xl border border-border p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      Cross-slide quiz
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      Generate a quiz that ties together concepts from multiple slides.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateDeckQuiz}
                    disabled={deckQuizLoading || slides.length < 2}
                    className="gap-1.5 shrink-0"
                  >
                    {deckQuizLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
                    {deckQuizLoading ? 'Generating…' : 'Generate cross-slide quiz'}
                  </Button>
                </div>

                {/* Pipeline diagnostics */}
                <div className="bg-card rounded-2xl border border-border p-6">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !diagnosticsOpen;
                      setDiagnosticsOpen(next);
                      if (next && !diagnostics && !diagnosticsLoading && editPdfHash) void fetchDiagnostics();
                    }}
                    className="flex items-center justify-between w-full text-left"
                    disabled={!editPdfHash}
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Pipeline Diagnostics</h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        {editPdfHash ? 'Routing telemetry for the most recent parse of this PDF.' : 'No parsed PDF on this lecture yet.'}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{diagnosticsOpen ? 'Hide' : 'Show'}</span>
                  </button>
                  {diagnosticsOpen && editPdfHash && (
                    <div className="mt-4 space-y-3 text-sm">
                      {diagnosticsLoading && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading diagnostics…
                        </div>
                      )}
                      {diagnosticsError && <p className="text-xs text-destructive">{diagnosticsError}</p>}
                      {diagnostics && (
                        <>
                          {diagnostics.run_metrics && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {Object.entries(diagnostics.run_metrics.totals ?? {}).map(([k, v]) => (
                                <div key={`t-${k}`} className="bg-muted/50 rounded-lg p-2 text-xs">
                                  <div className="text-muted-foreground">{k}</div>
                                  <div className="font-semibold">{v}</div>
                                </div>
                              ))}
                              {Object.entries(diagnostics.run_metrics.fallbacks ?? {}).map(([k, v]) => (
                                <div key={`f-${k}`} className="bg-amber-500/10 rounded-lg p-2 text-xs">
                                  <div className="text-muted-foreground">fallback: {k}</div>
                                  <div className="font-semibold">{v}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          {diagnostics.flags.length > 0 && (
                            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                              <p className="text-xs font-semibold text-amber-700 mb-1">
                                {diagnostics.flags.length} suspected misclassification(s)
                              </p>
                              <ul className="text-xs text-amber-700 space-y-0.5">
                                {diagnostics.flags.map(f => (
                                  <li key={f.slide_index}>Slide {f.slide_index + 1}: {f.reason}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr className="text-left">
                                  <th className="py-1 pr-2">#</th>
                                  <th className="py-1 pr-2">Route</th>
                                  <th className="py-1 pr-2">Reason</th>
                                  <th className="py-1 pr-2">Words</th>
                                  <th className="py-1 pr-2">Img cov</th>
                                  <th className="py-1 pr-2">Alpha</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diagnostics.per_slide.map(s => {
                                  const f = s.layout_features || {};
                                  return (
                                    <tr key={s.slide_index} className="border-t border-border">
                                      <td className="py-1 pr-2">{s.slide_index + 1}</td>
                                      <td className="py-1 pr-2 font-mono">{s.route || '—'}</td>
                                      <td className="py-1 pr-2 font-mono text-muted-foreground">{s.route_reason || '—'}</td>
                                      <td className="py-1 pr-2">{Number(f.word_count ?? 0)}</td>
                                      <td className="py-1 pr-2">{Number(f.image_coverage ?? 0).toFixed(2)}</td>
                                      <td className="py-1 pr-2">{Number(f.alpha_ratio ?? 0).toFixed(2)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
            )}
          </Tabs>
        </div>
      </div>

      {/* ═══════ FULL LECTURE PREVIEW MODAL ═══════ */}
      <AnimatePresence>
        {showFullPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-background flex flex-col overflow-hidden"
          >
            {/* Preview Header */}
            <header className="px-6 py-4 border-b border-border flex items-center justify-between bg-card">
              <div className="flex items-center gap-4">
                <div className="px-3 py-1 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] font-black uppercase tracking-widest rounded-full">
                  {t('upload:chrome.studentViewPreview')}
                </div>
                <h3 className="font-bold text-sm truncate max-w-md">
                  {title || t('upload:chrome.untitledLecture')}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFullPreview(false)}
                className="gap-2"
              >
                <X className="w-4 h-4" />
                {t('upload:actions.exitPreview')}
              </Button>
            </header>

            {/* Preview Content (Simplified LectureView) */}
            <div className="flex-1 flex overflow-hidden">
              {/* Sidebar */}
              <div className="w-64 border-r border-border bg-muted/20 flex flex-col hidden md:flex">
                <div className="p-4 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t('upload:chrome.lectureContents')}
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {slides.map((s, i) => (
                    <div
                      key={i}
                      onClick={() => setActiveSlideIndex(i)}
                      className={cn(
                        "p-3 rounded-lg cursor-pointer text-xs transition-colors",
                        i === activeSlideIndex ? "bg-violet-500 text-white font-bold" : "hover:bg-muted"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="opacity-50">{i + 1}</span>
                        <span className="truncate">{s.title || t('upload:slideFallback', { number: i + 1 })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Slide Viewer — the real student-facing SlideViewer + QuizCard,
                  fed straight from the editor's live (possibly unsaved) slide
                  state. No progress/XP/analytics callbacks are wired up, so
                  nothing here writes to student_progress or gamification. */}
              <div className="flex-1 overflow-y-auto bg-muted/10 p-12 flex flex-col items-center">
                <div className="max-w-3xl w-full space-y-8">
                  {activeSlide && (
                    <SlideViewer
                      title={activeSlide.title}
                      content={activeSlide.content}
                      summary={activeSlide.summary}
                      slideNumber={activeSlideIndex + 1}
                      totalSlides={slides.length}
                      onPrevious={handlePrevSlide}
                      onNext={handleNextSlide}
                      isFirst={activeSlideIndex === 0}
                      isLast={activeSlideIndex === slides.length - 1}
                      pdfUrl={typeof activePdf === 'string' ? activePdf : undefined}
                      pageNumber={activeSlideIndex + 1}
                    />
                  )}
                  {activeSlide?.questions[0]?.question && (
                    <QuizCard
                      question={activeSlide.questions[0].question}
                      options={activeSlide.questions[0].options}
                      correctAnswer={activeSlide.questions[0].correctAnswer}
                      questionNumber={1}
                      totalQuestions={1}
                      onAnswer={() => { /* preview only — no persistence */ }}
                      onContinue={handleNextSlide}
                      continueLabel={activeSlideIndex === slides.length - 1 ? 'Finish preview' : 'Continue'}
                      explanation={activeSlide.questions[0].explanation}
                      concept={activeSlide.questions[0].concept}
                    />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.pptx"
        onChange={onPickFile}
        className="hidden"
      />

      <DuplicatePDFDialog
        open={duplicateState !== null}
        matches={duplicateState?.matches ?? []}
        onUseExisting={handleDuplicateUseExisting}
        onUploadAsNew={handleDuplicateUploadAsNew}
        onCancel={handleDuplicateCancel}
      />

      <ParseCacheDialog
        open={parseCacheState !== null}
        parsedAt={parseCacheState?.parsedAt ?? null}
        onUseCached={handleParseCacheUseSaved}
        onReparse={handleParseCacheReparse}
        onCancel={handleParseCacheCancel}
      />

      <PDFUploadOverlay
        isOpen={isUploading}
        uploadProgress={uploadProgress}
        uploadTotal={uploadTotal}
        uploadStatus={uploadStatus}
        processedSlides={processedSlides}
        parserUsed={parserUsed}
        parsePhase={parsePhase}
        parseCompleted={parseCompleted}
        parsingMode={parsingMode}
        onClose={closeUploadOverlay}
      />
    </div>
  );

  return (
    <>
      {activePdf ? (
        <Document file={activePdf}>
          {editorContent}
        </Document>
      ) : (
        editorContent
      )}

      {activePdf && lightboxPage && (
        <Document file={activePdf}>
          <PDFLightbox
            isOpen={true}
            pageNumber={lightboxPage}
            totalPages={slides.length}
            onClose={() => setLightboxPage(null)}
            onPrev={() => setLightboxPage(p => Math.max(1, (p || 1) - 1))}
            onNext={() => setLightboxPage(p => Math.min(slides.length, (p || 1) + 1))}
          />
        </Document>
      )}
    </>
  );
}
