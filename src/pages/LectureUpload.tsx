import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  GripVertical,
  BrainCircuit,
  Wand2,
  Save,
  AlertCircle,
  LayoutTemplate,
  BookOpen,
  X,
  MoreHorizontal,
  Zap,
  FileUp,
  ListChecks,
  Type,
  ArrowRight,
  Eye,
  EyeOff,
  PartyPopper
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { PDFUploadOverlay } from '@/components/PDFUploadOverlay';
import { supabase } from '@/integrations/supabase/client';
import { insertQuizQuestion } from '@/services/lectureService';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAiModel } from '@/hooks/use-ai-model';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/* ────────────────────────────────────────────────────────────────────────── */
/*  TYPES                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

interface SlideData {
  title: string;
  content: string;
  summary: string;
  questions: QuestionData[];
}

interface QuestionData {
  question: string;
  options: string[];
  correctAnswer: number;
}

interface SlideStatus {
  hasTitle: boolean;
  hasContent: boolean;
  hasSummary: boolean;
  hasQuiz: boolean;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  UTILITY: Slide completion calculator                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function getSlideStatus(slide: SlideData): SlideStatus {
  return {
    hasTitle: slide.title.trim().length > 0,
    hasContent: slide.content.trim().length > 0,
    hasSummary: slide.summary.trim().length > 0,
    hasQuiz: slide.questions.some(q => q.question.trim().length > 0 && q.options.some(o => o.trim().length > 0)),
  };
}

function getCompletionPercent(status: SlideStatus): number {
  const values = Object.values(status);
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

function getOverallCompletion(slides: SlideData[]): number {
  if (slides.length === 0) return 0;
  const total = slides.reduce((acc, s) => acc + getCompletionPercent(getSlideStatus(s)), 0);
  return Math.round(total / slides.length);
}

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
  const items = [
    { key: 'hasTitle', label: 'Title', icon: Type },
    { key: 'hasContent', label: 'Content', icon: FileText },
    { key: 'hasSummary', label: 'Summary', icon: Sparkles },
    { key: 'hasQuiz', label: 'Quiz', icon: ListChecks },
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
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8"
    >
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-950/50 dark:to-indigo-950/50 flex items-center justify-center mb-6 shadow-inner">
        <LayoutTemplate className="w-10 h-10 text-violet-500" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">Start Building Your Lecture</h3>
      <p className="text-muted-foreground max-w-sm mb-8">
        Create slides from scratch or import a PDF to auto-generate structured content with AI-powered summaries and quizzes.
      </p>
      <div className="flex gap-3">
        <Button onClick={onAddSlide} size="lg" className="gap-2">
          <Plus className="w-5 h-5" />
          Create First Slide
        </Button>
        <Button onClick={onUploadPDF} variant="outline" size="lg" className="gap-2">
          <FileUp className="w-5 h-5" />
          Import PDF
        </Button>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  COMPONENT: Quiz Builder                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function QuizBuilder({
  question,
  questionIndex,
  slideIndex,
  onUpdateQuestion,
  onUpdateOption,
  onUpdateCorrectAnswer,
}: {
  question: QuestionData;
  questionIndex: number;
  slideIndex: number;
  onUpdateQuestion: (si: number, qi: number, val: string) => void;
  onUpdateOption: (si: number, qi: number, oi: number, val: string) => void;
  onUpdateCorrectAnswer: (si: number, qi: number, val: number) => void;
}) {
  const optionLabels = ['A', 'B', 'C', 'D'];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Question
        </Label>
        <Input
          value={question.question}
          onChange={(e) => onUpdateQuestion(slideIndex, questionIndex, e.target.value)}
          placeholder="What is the main concept discussed in this slide?"
          className="bg-background border-input focus:border-violet-500 focus:ring-violet-500/20"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {question.options.map((option, oIndex) => {
          const isCorrect = question.correctAnswer === oIndex;
          return (
            <motion.div
              key={oIndex}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onUpdateCorrectAnswer(slideIndex, questionIndex, oIndex)}
              className={cn(
                "relative flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 group",
                isCorrect
                  ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm"
                  : "border-border bg-muted/30 hover:border-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/10"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 transition-all duration-200",
                  isCorrect
                    ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                    : "bg-muted text-muted-foreground group-hover:bg-violet-100 group-hover:text-violet-700 dark:group-hover:bg-violet-900/30"
                )}
              >
                {isCorrect ? <CheckCircle2 className="w-4 h-4" /> : optionLabels[oIndex]}
              </div>
              <Input
                value={option}
                onChange={(e) => onUpdateOption(slideIndex, questionIndex, oIndex, e.target.value)}
                placeholder={`Option ${optionLabels[oIndex]}`}
                className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            </motion.div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <AlertCircle className="w-3 h-3" />
        Click any option card to mark it as the correct answer
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  MAIN COMPONENT                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export default function LectureUpload() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { aiModel } = useAiModel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const slideListRef = useRef<HTMLDivElement>(null);

  /* ── State ─────────────────────────────────────────────────────────────── */
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [showPDFPanel, setShowPDFPanel] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState<Record<number, boolean>>({});
  const [aiQuizLoading, setAiQuizLoading] = useState<Record<number, boolean>>({});
  const [aiTitleLoading, setAiTitleLoading] = useState<Record<number, boolean>>({});
  const [aiContentLoading, setAiContentLoading] = useState<Record<number, boolean>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [processedSlides, setProcessedSlides] = useState<SlideData[]>([]);

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const activeSlide = slides[activeSlideIndex];
  const overallCompletion = getOverallCompletion(slides);
  const totalSlides = slides.length;

  /* ── Scroll active slide into view ─────────────────────────────────────── */
  useEffect(() => {
    if (sidebarRef.current) {
      const activeEl = sidebarRef.current.querySelector(`[data-slide-index="${activeSlideIndex}"]`);
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeSlideIndex]);

  /* ── Keyboard Navigation ───────────────────────────────────────────────── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'ArrowUp' && activeSlideIndex > 0) {
          e.preventDefault();
          setActiveSlideIndex(prev => prev - 1);
        }
        if (e.key === 'ArrowDown' && activeSlideIndex < slides.length - 1) {
          e.preventDefault();
          setActiveSlideIndex(prev => prev + 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSlideIndex, slides.length]);

  /* ── Auto-scroll slide log during upload ──────────────────────────────── */
  useEffect(() => {
    if (slideListRef.current) {
      slideListRef.current.scrollTop = slideListRef.current.scrollHeight;
    }
  }, [processedSlides]);

  /* ── PDF Import ────────────────────────────────────────────────────────── */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast({ title: 'Invalid file type', description: 'Please upload a PDF file.', variant: 'destructive' });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadTotal(0);
    setUploadStatus('Uploading PDF...');
    setProcessedSlides([]);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('ai_model', aiModel);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${API_BASE}/api/upload/parse-pdf-stream`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        body: formData
      });

      if (!response.ok) throw new Error('Failed to start PDF parsing');
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.replace('data: ', ''));
            
            if (data.type === 'progress') {
              const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
              setUploadProgress(pct);
              if (data.total > 0) setUploadTotal(data.total);
              setUploadStatus(data.message);
            } else if (data.type === 'slide') {
              setProcessedSlides(prev => {
                const updated = [...prev];
                updated[data.index] = {
                  title: data.slide.title,
                  content: data.slide.content,
                  summary: data.slide.summary || '',
                  questions: data.slide.questions || [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
                };
                return updated;
              });
              setUploadStatus(`Processed ${data.index + 1} slide(s)...`);
            } else if (data.type === 'complete') {
              setProcessedSlides(prev => {
                const finalSlides = prev.filter(Boolean) as SlideData[];
                setSlides(finalSlides);
                setActiveSlideIndex(0);
                if (!title) setTitle(file.name.replace('.pdf', ''));
                setPdfFile(file);
                toast({
                  title: 'PDF Imported Successfully',
                  description: `${finalSlides.length} slides extracted and structured.`,
                });
                return prev; // Keep slides for the overlay success state
              });
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          }
        }
      }
    } catch (err: any) {
      toast({ title: 'Upload Failed', description: err.message || 'Could not parse the PDF.', variant: 'destructive' });
    } finally {
      // We don't set setIsUploading(false) here because the overlay has its own 'Close' button now
      // unless there was an error
      e.target.value = '';
    }
  };

  /* ── AI: Generate Summary ──────────────────────────────────────────────── */
  const handleGenerateSummary = async (slideIndex: number) => {
    const content = slides[slideIndex].content;
    if (!content.trim()) {
      toast({ title: 'No content', description: 'Add slide content before generating a summary.', variant: 'destructive' });
      return;
    }

    setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: true }));
    try {
      const data = await apiClient.post<{ summary: string }>('/api/ai/generate-summary', {
        slide_text: content,
        ai_model: aiModel
      });
      updateSlide(slideIndex, 'summary', data.summary);
      toast({ title: 'Summary Generated', description: 'AI has distilled the key points for you.' });
    } catch {
      toast({ title: 'AI Error', description: 'Summary generation failed. Is Ollama running?', variant: 'destructive' });
    } finally {
      setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: false }));
    }
  };

  /* ── AI: Generate Quiz ─────────────────────────────────────────────────── */
  const handleGenerateQuiz = async (slideIndex: number) => {
    const content = slides[slideIndex].content;
    if (!content.trim()) {
      toast({ title: 'No content', description: 'Add slide content before generating a quiz.', variant: 'destructive' });
      return;
    }

    setAiQuizLoading(prev => ({ ...prev, [slideIndex]: true }));
    try {
      const quiz = await apiClient.post<{ question: string; options: string[]; correctAnswer: number }>('/api/ai/generate-quiz', {
        slide_text: content,
        ai_model: aiModel
      });
      const newSlides = [...slides];
      newSlides[slideIndex].questions = [{
        question: quiz.question,
        options: quiz.options,
        correctAnswer: quiz.correctAnswer,
      }];
      setSlides(newSlides);
      toast({ title: 'Quiz Generated', description: 'A new question has been crafted from your content.' });
    } catch {
      toast({ title: 'AI Error', description: 'Quiz generation failed. Is Ollama running?', variant: 'destructive' });
    } finally {
      setAiQuizLoading(prev => ({ ...prev, [slideIndex]: false }));
    }
  };
  
  /* ── AI: Generate Title ────────────────────────────────────────────────── */
  const handleGenerateTitle = async (slideIndex: number) => {
    const content = slides[slideIndex].content;
    if (!content.trim()) {
      toast({ title: 'No content', description: 'Add slide content before generating a title.', variant: 'destructive' });
      return;
    }

    setAiTitleLoading(prev => ({ ...prev, [slideIndex]: true }));
    try {
      const data = await apiClient.post<{ title: string }>('/api/ai/suggest-title', {
        slide_text: content,
        ai_model: aiModel
      });
      updateSlide(slideIndex, 'title', data.title);
      toast({ title: 'Title Suggested', description: 'AI has analyzed your content for a perfect title.' });
    } catch {
      toast({ title: 'AI Error', description: 'Title generation failed.', variant: 'destructive' });
    } finally {
      setAiTitleLoading(prev => ({ ...prev, [slideIndex]: false }));
    }
  };

  /* ── AI: Generate Content ──────────────────────────────────────────────── */
  const handleGenerateContent = async (slideIndex: number) => {
    const existingContent = slides[slideIndex].content;
    const existingTitle = slides[slideIndex].title;
    
    setAiContentLoading(prev => ({ ...prev, [slideIndex]: true }));
    try {
      const data = await apiClient.post<{ content: string }>('/api/ai/suggest-content', {
        slide_text: existingContent || existingTitle || "Educational topic",
        ai_model: aiModel
      });
      updateSlide(slideIndex, 'content', data.content);
      toast({ title: 'Content Enhanced', description: 'AI has expanded and structured your slide content.' });
    } catch {
      toast({ title: 'AI Error', description: 'Content generation failed.', variant: 'destructive' });
    } finally {
      setAiContentLoading(prev => ({ ...prev, [slideIndex]: false }));
    }
  };

  /* ── Slide Helpers ─────────────────────────────────────────────────────── */
  const addSlide = (insertAfterIndex?: number) => {
    const newSlide: SlideData = {
      title: '',
      content: '',
      summary: '',
      questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
    };

    if (insertAfterIndex !== undefined) {
      const newSlides = [...slides];
      newSlides.splice(insertAfterIndex + 1, 0, newSlide);
      setSlides(newSlides);
      setActiveSlideIndex(insertAfterIndex + 1);
    } else {
      setSlides([...slides, newSlide]);
      setActiveSlideIndex(slides.length);
    }
  };

  const removeSlide = (index: number) => {
    if (slides.length <= 1) {
      setSlides([]);
      setActiveSlideIndex(0);
      return;
    }
    const newSlides = slides.filter((_, i) => i !== index);
    setSlides(newSlides);
    if (activeSlideIndex >= index && activeSlideIndex > 0) {
      setActiveSlideIndex(activeSlideIndex - 1);
    }
  };

  const updateSlide = (index: number, field: keyof SlideData, value: string | QuestionData[]) => {
    const newSlides = [...slides];
    newSlides[index] = { ...newSlides[index], [field]: value };
    setSlides(newSlides);
  };

  const updateQuestionText = (slideIndex: number, questionIndex: number, value: string) => {
    const newSlides = [...slides];
    const newQuestions = [...newSlides[slideIndex].questions];
    newQuestions[questionIndex] = { ...newQuestions[questionIndex], question: value };
    newSlides[slideIndex].questions = newQuestions;
    setSlides(newSlides);
  };

  const updateCorrectAnswer = (slideIndex: number, questionIndex: number, value: number) => {
    const newSlides = [...slides];
    const newQuestions = [...newSlides[slideIndex].questions];
    newQuestions[questionIndex] = { ...newQuestions[questionIndex], correctAnswer: value };
    newSlides[slideIndex].questions = newQuestions;
    setSlides(newSlides);
  };

  const updateOption = (slideIndex: number, questionIndex: number, optionIndex: number, value: string) => {
    const newSlides = [...slides];
    const newOptions = [...newSlides[slideIndex].questions[questionIndex].options];
    newOptions[optionIndex] = value;
    newSlides[slideIndex].questions[questionIndex].options = newOptions;
    setSlides(newSlides);
  };

  /* ── Submit ────────────────────────────────────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast({ title: 'Error', description: 'Please enter a lecture title.', variant: 'destructive' });
      return;
    }

    if (slides.length === 0) {
      toast({ title: 'Error', description: 'Add at least one slide.', variant: 'destructive' });
      return;
    }

    setLoading(true);

    try {
      let pdfUrl: string | null = null;
      const lectureId = crypto.randomUUID();

      if (pdfFile) {
        const filePath = `lectures/${lectureId}/${pdfFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from('lecture-pdfs')
          .upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: true });

        if (uploadError) {
          toast({
            title: 'PDF Upload Failed',
            description: 'Could not upload PDF to storage. Please check Supabase Storage RLS policies.',
            variant: 'destructive'
          });
          throw uploadError;
        }
        const { data: urlData } = supabase.storage.from('lecture-pdfs').getPublicUrl(filePath);
        pdfUrl = urlData.publicUrl;
      }

      const { data: lecture, error: lectureError } = await supabase
        .from('lectures')
        .insert({
          id: lectureId,
          title,
          description,
          professor_id: user?.id,
          total_slides: slides.length,
          pdf_url: pdfUrl,
        })
        .select()
        .single();

      if (lectureError) throw lectureError;

      for (let i = 0; i < slides.length; i++) {
        const slideData = slides[i];
        const { data: slide, error: slideError } = await supabase
          .from('slides')
          .insert({
            lecture_id: lecture.id,
            slide_number: i + 1,
            title: slideData.title || `Slide ${i + 1}`,
            content_text: slideData.content,
            summary: slideData.summary,
          })
          .select()
          .single();

        if (slideError) throw slideError;

        for (const q of slideData.questions) {
          if (q.question.trim()) {
            await insertQuizQuestion({
              slide_id: slide.id,
              question_text: q.question,
              options: q.options.filter((o: string) => o.trim()),
              correct_answer: q.correctAnswer,
            });
          }
        }
      }

      toast({ title: 'Success!', description: 'Lecture created successfully.' });
      navigate('/professor/dashboard');
    } catch (error) {
      console.error('Error creating lecture:', error);
      toast({ title: 'Error', description: 'Failed to create lecture. Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  /* ── Render: Empty State ───────────────────────────────────────────────── */
  if (slides.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Create Lecture</h1>
                <p className="text-xs text-muted-foreground">Build interactive learning experiences</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/professor/dashboard')}>
              Cancel
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
              <Label htmlFor="title" className="text-sm font-medium">Lecture Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Introduction to Machine Learning"
                className="mt-1.5 text-lg h-12"
              />
            </div>
            <div>
              <Label htmlFor="description" className="text-sm font-medium">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief overview of what students will learn..."
                className="mt-1.5"
                rows={3}
              />
            </div>
          </motion.div>
        </div>

        {/* Empty State */}
        <EmptySlideState
          onAddSlide={() => addSlide()}
          onUploadPDF={() => fileInputRef.current?.click()}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>
    );
  }

  /* ── Render: Full Editor ───────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ═══════ TOP BAR ═══════ */}
      <div className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 lg:px-6 h-16">
          {/* Left: Brand + Title Input */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-500/20 shrink-0">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0 max-w-md">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Lecture Title"
                className="border-0 bg-transparent text-lg font-semibold placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-auto"
              />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a brief description..."
                className="border-0 bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-auto py-0"
              />
            </div>
          </div>

          {/* Center: Progress */}
          <div className="hidden md:flex items-center gap-3 px-6">
            <ProgressRing percent={overallCompletion} size={32} stroke={2.5} />
            <div className="text-xs">
              <span className="font-semibold text-foreground">{overallCompletion}%</span>
              <span className="text-muted-foreground ml-1">complete</span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="hidden sm:flex gap-2"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
              Import PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/professor/dashboard')}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFullPreview(true)}
              className="gap-2 border-violet-200 text-violet-700 hover:bg-violet-50"
            >
              <BookOpen className="w-4 h-4" />
              Preview Full Lecture
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
              Publish
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
                    Slides ({totalSlides})
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => fileInputRef.current?.click()}
                      title="Import PDF"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => addSlide(activeSlideIndex)}
                      title="Add slide after current"
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
                  Add New Slide
                </Button>
              </div>

              {/* Slide List */}
              <div ref={sidebarRef} className="flex-1 overflow-y-auto p-2 space-y-1">
                {slides.map((slide, index) => {
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
                      className={cn(
                        "group relative flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200",
                        isActive
                          ? "bg-card shadow-md border border-violet-200 dark:border-violet-800/50 ring-1 ring-violet-500/20"
                          : "hover:bg-card/80 border border-transparent"
                      )}
                    >
                      {/* Slide Number */}
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5",
                        isActive
                          ? "bg-violet-500 text-white shadow-md shadow-violet-500/30"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {index + 1}
                      </div>

                      {/* Slide Info */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm font-medium truncate",
                          isActive ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {slide.title || `Slide ${index + 1}`}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StatusDots status={status} />
                          <span className="text-[10px] text-muted-foreground">
                            {percent}%
                          </span>
                        </div>
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSlide(index);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-destructive/10 hover:text-destructive transition-all"
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
        >
          {sidebarCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        {/* ─── MAIN CONTENT: Slide Editor ─── */}
        <div className="flex-1 overflow-y-auto">
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
                      <h2 className="text-lg font-semibold text-foreground">Slide Editor</h2>
                      <p className="text-xs text-muted-foreground">
                        {getCompletionPercent(getSlideStatus(activeSlide))}% complete
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPreview(!showPreview)}
                      className={cn(
                        "gap-1.5 transition-all duration-300",
                        showPreview ? "bg-violet-50 text-violet-600 border-violet-200" : ""
                      )}
                    >
                      {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {showPreview ? "Close Preview" : "Preview"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addSlide(activeSlideIndex)}
                      className="gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Insert After
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
                    Slide Title
                  </Label>
                  <Input
                    value={activeSlide.title}
                    onChange={(e) => updateSlide(activeSlideIndex, 'title', e.target.value)}
                    placeholder="Enter a clear, descriptive title..."
                    className="h-11 text-base"
                  />
                </div>

                {/* Content Field */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    Content
                  </Label>
                  <Textarea
                    value={activeSlide.content}
                    onChange={(e) => updateSlide(activeSlideIndex, 'content', e.target.value)}
                    placeholder="Write the main content for this slide..."
                    className="min-h-[160px] resize-y text-base leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">
                    {activeSlide.content.length} characters
                  </p>
                </div>

                {/* AI Actions Bar */}
                <div className="flex flex-wrap gap-3 p-4 rounded-xl bg-gradient-to-r from-violet-50/80 to-indigo-50/80 dark:from-violet-950/20 dark:to-indigo-950/20 border border-violet-100 dark:border-violet-800/30">
                  <div className="flex items-center gap-2 text-sm text-violet-800 dark:text-violet-300 font-medium">
                    <Zap className="w-4 h-4" />
                    AI Assistant
                  </div>
                  <div className="flex-1" />
                  <AIActionButton
                    onClick={() => handleGenerateSummary(activeSlideIndex)}
                    loading={!!aiSummaryLoading[activeSlideIndex]}
                    variant="subtle"
                  >
                    Generate Summary
                  </AIActionButton>
                  <AIActionButton
                    onClick={() => handleGenerateQuiz(activeSlideIndex)}
                    loading={!!aiQuizLoading[activeSlideIndex]}
                    variant="subtle"
                  >
                    Generate Quiz
                  </AIActionButton>
                </div>

                {/* Summary Field */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Summary
                    {activeSlide.summary && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">
                        AI Generated
                      </span>
                    )}
                  </Label>
                  <Textarea
                    value={activeSlide.summary}
                    onChange={(e) => updateSlide(activeSlideIndex, 'summary', e.target.value)}
                    placeholder="Key takeaways from this slide (or use AI to generate)..."
                    className="min-h-[100px] resize-y bg-amber-50/30 dark:bg-amber-950/10 border-amber-200/50 dark:border-amber-800/30 focus:border-amber-400"
                    rows={3}
                  />
                </div>

                {/* Quiz Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <ListChecks className="w-3.5 h-3.5 text-emerald-500" />
                      Quiz Questions
                    </Label>
                    {activeSlide.questions[0]?.question && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">
                        Configured
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
                    onClick={() => setActiveSlideIndex(Math.max(0, activeSlideIndex - 1))}
                    disabled={activeSlideIndex === 0}
                    className="gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous Slide
                  </Button>

                  <span className="text-xs text-muted-foreground">
                    Slide {activeSlideIndex + 1} of {totalSlides}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveSlideIndex(Math.min(totalSlides - 1, activeSlideIndex + 1))}
                    disabled={activeSlideIndex === totalSlides - 1}
                    className="gap-2"
                  >
                    Next Slide
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── RIGHT SIDEBAR: Live Preview ─── */}
        <AnimatePresence>
          {showPreview && activeSlide && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 450, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="border-l border-border bg-card/50 backdrop-blur-xl flex flex-col shrink-0 overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Live Preview
                  </span>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 hover:bg-muted"
                  onClick={() => setShowPreview(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {/* Simulated Tablet Frame */}
                <div className="relative aspect-[4/3] w-full bg-background rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col group">
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
                  
                  {/* Status Bar */}
                  <div className="h-6 px-4 flex items-center justify-between text-[8px] font-medium text-muted-foreground border-b border-border/50">
                    <span>9:41 AM</span>
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full border border-current opacity-50" />
                      <div className="w-2.5 h-2.5 rounded-sm border border-current opacity-50" />
                    </div>
                  </div>

                  {/* Content Preview */}
                  <div className="flex-1 p-8 flex flex-col">
                    <div className="space-y-4">
                      <motion.h1 
                        key={`title-${activeSlideIndex}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-2xl font-black text-foreground tracking-tight leading-none"
                      >
                        {activeSlide.title || "Untitled Slide"}
                      </motion.h1>
                      <div className="h-1 w-12 bg-violet-500 rounded-full" />
                    </div>

                    <motion.div 
                      key={`content-${activeSlideIndex}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="mt-6 flex-1 text-sm text-muted-foreground leading-relaxed overflow-y-auto pr-2 custom-scrollbar"
                    >
                      {activeSlide.content ? (
                        <div className="prose prose-sm dark:prose-invert">
                          {activeSlide.content.split('\n').map((line, i) => (
                            <p key={i}>{line}</p>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full opacity-30 italic">
                          <LayoutTemplate className="w-8 h-8 mb-2" />
                          No content to preview
                        </div>
                      )}
                    </motion.div>

                    {/* Quick Stats Overlay */}
                    <div className="mt-auto pt-4 flex gap-3">
                      <div className="px-2 py-1 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] font-bold uppercase tracking-wider">
                        Slide {activeSlideIndex + 1}
                      </div>
                      {activeSlide.questions[0]?.question && (
                        <div className="px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Quiz Included
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Summary Peek */}
                <div className="mt-8 space-y-3">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    Key Takeaway
                  </h4>
                  <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-800/30">
                    <p className="text-xs text-amber-800 dark:text-amber-200 italic leading-relaxed">
                      {activeSlide.summary || "Summary will appear here..."}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
                  Student View Preview
                </div>
                <h3 className="font-bold text-sm truncate max-w-md">
                  {title || "Untitled Lecture"}
                </h3>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowFullPreview(false)}
                className="gap-2"
              >
                <X className="w-4 h-4" />
                Exit Preview
              </Button>
            </header>

            {/* Preview Content (Simplified LectureView) */}
            <div className="flex-1 flex overflow-hidden">
              {/* Sidebar */}
              <div className="w-64 border-r border-border bg-muted/20 flex flex-col hidden md:flex">
                <div className="p-4 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Lecture Contents
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
                        <span className="truncate">{s.title || `Slide ${i + 1}`}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Slide Viewer */}
              <div className="flex-1 overflow-y-auto bg-muted/10 p-12 flex flex-col items-center">
                <div className="max-w-4xl w-full space-y-12">
                  <div className="bg-card border border-border shadow-2xl rounded-3xl overflow-hidden flex flex-col min-h-[500px]">
                    <div className="p-10 flex-1 space-y-8">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-12 bg-violet-600 rounded-full" />
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-600">
                            Slide {activeSlideIndex + 1}
                          </span>
                        </div>
                        <h2 className="text-4xl font-black text-foreground tracking-tight leading-tight">
                          {activeSlide?.title}
                        </h2>
                      </div>
                      
                      <div className="prose prose-lg dark:prose-invert max-w-none text-muted-foreground leading-relaxed">
                        {activeSlide?.content.split('\n').map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                      </div>
                    </div>

                    {/* Quiz Preview Area if exists */}
                    {activeSlide?.questions[0]?.question && (
                      <div className="p-10 bg-emerald-50/30 dark:bg-emerald-950/10 border-t border-emerald-100 dark:border-emerald-800/20">
                        <div className="flex items-center gap-2 mb-6">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                          <span className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                            Practice Quiz
                          </span>
                        </div>
                        <div className="space-y-6">
                          <p className="text-lg font-bold text-foreground">
                            {activeSlide.questions[0].question}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {activeSlide.questions[0].options.map((opt, i) => (
                              <div key={i} className={cn(
                                "p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/30 text-sm font-medium",
                                i === activeSlide.questions[0].correctAnswer ? "bg-emerald-500 text-white border-transparent" : "bg-card text-muted-foreground opacity-60"
                              )}>
                                {opt}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Navigation */}
                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      onClick={() => setActiveSlideIndex(Math.max(0, activeSlideIndex - 1))}
                      disabled={activeSlideIndex === 0}
                      className="rounded-xl px-8"
                    >
                      <ChevronLeft className="mr-2 h-4 w-4" /> Previous
                    </Button>
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                      Slide {activeSlideIndex + 1} of {slides.length}
                    </span>
                    <Button
                      onClick={() => setActiveSlideIndex(Math.min(slides.length - 1, activeSlideIndex + 1))}
                      disabled={activeSlideIndex === slides.length - 1}
                      className="rounded-xl px-8 bg-violet-600 hover:bg-violet-700 text-white border-none"
                    >
                      Next <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
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
        accept=".pdf"
        onChange={handleFileUpload}
        className="hidden"
      />

      <PDFUploadOverlay
        isOpen={isUploading}
        uploadProgress={uploadProgress}
        uploadTotal={uploadTotal}
        uploadStatus={uploadStatus}
        processedSlides={processedSlides}
        onClose={() => {
          setIsUploading(false);
          setUploadProgress(0);
          setUploadStatus('');
          setProcessedSlides([]);
        }}
      />
    </div>
  );
}