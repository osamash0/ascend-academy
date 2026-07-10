import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAiModel } from '@/hooks/use-ai-model';
import { motion } from 'framer-motion';
import { Save, Plus, Trash2, CheckCircle2, Loader2, Sparkles, ArrowLeft, FileText, Upload, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { insertQuizQuestion, updateQuizQuestion, deleteSlideWithQuestions, resolvePdfUrl, enhanceSlide } from '@/services/lectureService';
import { Document, pdfjs } from 'react-pdf';
import { PDFPagePreview } from '@/components/PDFPagePreview';
import { PDFLightbox } from '@/components/PDFLightbox';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
import { apiClient } from '@/lib/apiClient';
import { listCourses, assignLectureToCourse, unassignLectureFromCourse, type Course } from '@/services/coursesService';
import { WorksheetsPanel } from '@/components/WorksheetsPanel';
import { ProfessorPracticeSheetsTab } from '@/features/practice_sheets/ProfessorPracticeSheetsTab';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface QuestionData {
    id?: string;     // existing DB id (undefined for new)
    question: string;
    options: string[];
    correctAnswer: number;
}

interface SlideData {
    id?: string;     // existing DB id (undefined for new)
    title: string;
    content: string;
    summary: string;
    questions: QuestionData[];
}

interface DiagnosticsSlide {
    slide_index: number;
    route: string;
    route_reason: string;
    layout_features: Record<string, number | boolean>;
    has_parse_error?: boolean;
}

interface DiagnosticsRunMetrics {
    started_at?: string;
    finished_at?: string;
    totals?: Record<string, number>;
    fallbacks?: Record<string, number>;
}

interface DiagnosticsResponse {
    pdf_hash: string;
    pipeline_version: string;
    run_metrics: DiagnosticsRunMetrics | null;
    per_slide: DiagnosticsSlide[];
    flags: { slide_index: number; reason: string }[];
}

export default function LectureEdit() {
    const { lectureId } = useParams<{ lectureId: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { aiModel } = useAiModel();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [courses, setCourses] = useState<Course[]>([]);
    const [courseId, setCourseId] = useState<string | null>(null);
    const [originalCourseId, setOriginalCourseId] = useState<string | null>(null);
    const [slides, setSlides] = useState<SlideData[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // PDF state
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [existingPdfUrl, setExistingPdfUrl] = useState<string | null>(null);
    const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
    const [lightboxPage, setLightboxPage] = useState<number | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [pdfHash, setPdfHash] = useState<string | null>(null);

    // Diagnostics state — read-only routing telemetry panel
    const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
    const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
    const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

    // Per-slide AI loading states
    const [aiSummaryLoading, setAiSummaryLoading] = useState<Record<number, boolean>>({});
    const [aiQuizLoading, setAiQuizLoading] = useState<Record<number, boolean>>({});
    const [aiTitleLoading, setAiTitleLoading] = useState<Record<number, boolean>>({});
    const [aiContentLoading, setAiContentLoading] = useState<Record<number, boolean>>({});

    // Task #58: deck-level on-demand quiz generation. Persists results
    // server-side; we re-fetch the lecture to refresh question lists.
    const [deckQuizLoading, setDeckQuizLoading] = useState(false);

    // ── Load existing lecture data ─────────────────────────────────────────────
    useEffect(() => {
        if (lectureId) fetchLecture();
    }, [lectureId]);

    const fetchLecture = async () => {
        setLoading(true);
        try {
            // Fetch lecture
            const { data: lecture, error: lErr } = await supabase
                .from('lectures')
                .select('*')
                .eq('id', lectureId)
                .single();
            if (lErr) throw lErr;

            setTitle(lecture.title);
            setDescription(lecture.description ?? '');
            setExistingPdfUrl(lecture.pdf_url);
            if (lecture.pdf_url) {
                const signed = await resolvePdfUrl(lecture.pdf_url);
                setSignedPdfUrl(signed);
            }
            const cid = (lecture as { course_id?: string | null }).course_id ?? null;
            setCourseId(cid);
            setOriginalCourseId(cid);
            try { setCourses(await listCourses()); } catch (e) { console.error(e); }
            const lectureWithHash = lecture as typeof lecture & { pdf_hash?: string | null };
            setPdfHash(lectureWithHash.pdf_hash ?? null);

            // Fetch slides ordered by slide_number
            const { data: slidesData, error: sErr } = await supabase
                .from('slides')
                .select('*')
                .eq('lecture_id', lectureId)
                .order('slide_number', { ascending: true });
            if (sErr) throw sErr;

            // Fetch questions for each slide
            const slideIds = slidesData.map(s => s.id);
            const { data: questionsData } = await supabase
                .from('quiz_questions')
                .select('*')
                .in('slide_id', slideIds);

            const enrichedSlides: SlideData[] = slidesData.map(slide => {
                const slideQuestions = (questionsData ?? [])
                    .filter(q => q.slide_id === slide.id)
                    .map(q => ({
                        id: q.id,
                        question: q.question_text,
                        options: Array.isArray(q.options) ? (q.options as string[]) : ['', '', '', ''],
                        correctAnswer: q.correct_answer ?? 0,
                    }));

                return {
                    id: slide.id,
                    title: slide.title ?? '',
                    content: slide.content_text ?? '',
                    summary: slide.summary ?? '',
                    ai_enhanced: (slide as { ai_enhanced?: boolean }).ai_enhanced ?? true,
                    questions: slideQuestions.length > 0
                        ? slideQuestions
                        : [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
                };
            });

            setSlides(enrichedSlides);
        } catch (err) {
            console.error(err);
            toast({ title: 'Error', description: 'Failed to load lecture.', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    // ── Diagnostics ─────────────────────────────────────────────────────────
    const fetchDiagnostics = async () => {
        if (!pdfHash) return;
        setDiagnosticsLoading(true);
        setDiagnosticsError(null);
        try {
            const data = await apiClient.get<DiagnosticsResponse>(
                `/api/upload/diagnostics/${pdfHash}`,
            );
            setDiagnostics(data);
        } catch (err) {
            console.error(err);
            setDiagnosticsError('Failed to load diagnostics.');
        } finally {
            setDiagnosticsLoading(false);
        }
    };

    // ── PDF Upload Helpers ───────────────────────────────────────────────────
    const handlePdfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setPdfFile(file);
        } else if (file) {
            toast({ title: 'Invalid file', description: 'Please select a PDF file.', variant: 'destructive' });
        }
    };

    // ── Save ────────────────────────────────────────────────────────────────────
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) {
            toast({ title: 'Error', description: 'Title cannot be empty.', variant: 'destructive' });
            return;
        }

        setSaving(true);
        try {
            let finalPdfUrl = existingPdfUrl;

            // 1. Upload new PDF if selected
            if (pdfFile) {
                const filePath = `lectures/${lectureId}/${pdfFile.name}`;
                const { error: uploadError } = await supabase.storage
                    .from('lecture-pdfs')
                    .upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: true });

                if (!uploadError) {
                    // Store only the storage path (not a public URL) — the bucket is private.
                    // Signed URLs are generated on demand when the PDF must be accessed.
                    finalPdfUrl = filePath;
                } else {
                    console.error('PDF Upload Error:', uploadError);
                    toast({
                        title: 'PDF Upload Failed',
                        description: 'Could not upload PDF to storage. Please check Supabase Storage RLS policies.',
                        variant: 'destructive'
                    });
                    throw uploadError;
                }
            }

            const { error: lErr } = await supabase
                .from('lectures')
                .update({
                    title,
                    description,
                    total_slides: slides.length,
                    pdf_url: finalPdfUrl
                })
                .eq('id', lectureId);
            if (lErr) throw lErr;

            for (let i = 0; i < slides.length; i++) {
                const s = slides[i];

                if (s.id) {
                    // Update existing slide
                    const { error: sErr } = await supabase
                        .from('slides')
                        .update({
                            slide_number: i + 1,
                            title: s.title || `Slide ${i + 1}`,
                            content_text: s.content,
                            summary: s.summary,
                        })
                        .eq('id', s.id);
                    if (sErr) throw sErr;

                    // For each question: upsert if has id, insert if new
                    for (const q of s.questions) {
                        if (!q.question.trim()) continue;
                        if (q.id) {
                            await updateQuizQuestion(q.id, {
                                question_text: q.question,
                                options: q.options,
                                correct_answer: q.correctAnswer,
                            });
                        } else {
                            await insertQuizQuestion({
                                slide_id: s.id!,
                                question_text: q.question,
                                options: q.options,
                                correct_answer: q.correctAnswer,
                            });
                        }
                    }
                } else {
                    // Insert new slide
                    const { data: newSlide, error: sErr } = await supabase
                        .from('slides')
                        .insert({
                            lecture_id: lectureId,
                            slide_number: i + 1,
                            title: s.title || `Slide ${i + 1}`,
                            content_text: s.content,
                            summary: s.summary,
                        })
                        .select()
                        .single();
                    if (sErr) throw sErr;

                    for (const q of s.questions) {
                        if (q.question.trim()) {
                            await insertQuizQuestion({
                                slide_id: newSlide.id,
                                question_text: q.question,
                                options: q.options,
                                correct_answer: q.correctAnswer,
                            });
                        }
                    }
                }
            }

            toast({ title: 'Saved!', description: 'Lecture updated successfully.' });
            navigate('/professor/dashboard');
        } catch (err) {
            console.error(err);
            toast({ title: 'Error', description: 'Failed to save lecture.', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    // ── AI Helpers ──────────────────────────────────────────────────────────────
    const handleGenerateSummary = async (slideIndex: number) => {
        const content = slides[slideIndex].content || slides[slideIndex].title || "Educational topic";
        if (!content.trim()) {
            toast({ title: 'No content', description: 'Add slide content first.', variant: 'destructive' });
            return;
        }
        setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: true }));
        try {
            const data = await apiClient.post<{ summary: string }>('/api/ai/generate-summary', { slide_text: content, ai_model: aiModel });
            updateSlide(slideIndex, 'summary', data.summary);
            toast({ title: 'Summary generated!' });
        } catch {
            toast({ title: 'AI Error', description: 'Is Ollama running?', variant: 'destructive' });
        } finally {
            setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: false }));
        }
    };

    const handleGenerateQuiz = async (slideIndex: number) => {
        const content = slides[slideIndex].content || slides[slideIndex].title || slides[slideIndex].summary || "Educational topic";
        if (!content.trim()) {
            toast({ title: 'No content', description: 'Add slide content first.', variant: 'destructive' });
            return;
        }
        setAiQuizLoading(prev => ({ ...prev, [slideIndex]: true }));
        try {
            const quiz = await apiClient.post<{ question: string; options: string[]; correctAnswer: number }>('/api/ai/generate-quiz', { slide_text: content, ai_model: aiModel });
            const newSlides = [...slides];
            // keep existing id if there was one
            const existingId = newSlides[slideIndex].questions[0]?.id;
            newSlides[slideIndex].questions = [{
                id: existingId,
                question: quiz.question,
                options: quiz.options,
                correctAnswer: quiz.correctAnswer,
            }];
            setSlides(newSlides);
            toast({ title: 'Quiz generated!' });
        } catch {
            toast({ title: 'AI Error', description: 'Is Ollama running?', variant: 'destructive' });
        } finally {
            setAiQuizLoading(prev => ({ ...prev, [slideIndex]: false }));
        }
    };

    const handleGenerateTitle = async (slideIndex: number) => {
        const content = slides[slideIndex].content || slides[slideIndex].summary || "Educational topic";
        if (!content.trim()) {
            toast({ title: 'No content', description: 'Add slide content first.', variant: 'destructive' });
            return;
        }
        setAiTitleLoading(prev => ({ ...prev, [slideIndex]: true }));
        try {
            const data = await apiClient.post<{ title: string }>('/api/ai/suggest-title', { slide_text: content, ai_model: aiModel });
            updateSlide(slideIndex, 'title', data.title);
            toast({ title: 'Title generated!' });
        } catch {
            toast({ title: 'AI Error', variant: 'destructive' });
        } finally {
            setAiTitleLoading(prev => ({ ...prev, [slideIndex]: false }));
        }
    };

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
            toast({ title: 'Content enhanced!' });
        } catch {
            toast({ title: 'AI Error', variant: 'destructive' });
        } finally {
            setAiContentLoading(prev => ({ ...prev, [slideIndex]: false }));
        }
    };

    // ── Deck-level on-demand AI (Task #58) ─────────────────────────────────────
    const handleGenerateDeckQuiz = async () => {
        if (!lectureId) return;
        if (slides.length < 2) {
            toast({ title: 'Need at least 2 slides', description: 'Cross-slide quizzes require multiple slides.', variant: 'destructive' });
            return;
        }
        setDeckQuizLoading(true);
        try {
            await apiClient.post(`/api/ai/decks/${lectureId}/generate-quiz`, { ai_model: aiModel });
            toast({ title: 'Cross-slide quiz generated!', description: 'Refreshing slides…' });
            await fetchLecture();
        } catch (err) {
            console.error(err);
            toast({ title: 'AI Error', description: 'Failed to generate cross-slide quiz.', variant: 'destructive' });
        } finally {
            setDeckQuizLoading(false);
        }
    };

    // ── Skip-AI enhancement ──────────────────────────────────────────────────────
    // Slides imported with "Skip AI" (ai_enhanced=false) can be synthesized later.
    const [enhancingIds, setEnhancingIds] = useState<Set<string>>(new Set());

    const enhanceOneSlide = async (index: number): Promise<boolean> => {
        const slide = slides[index];
        if (!slide.id || slide.ai_enhanced) return false;
        setEnhancingIds(prev => new Set(prev).add(slide.id as string));
        try {
            const res = await enhanceSlide(slide.id);
            setSlides(prev => prev.map((s, i) =>
                i === index
                    ? { ...s, title: res.title ?? s.title, summary: res.summary ?? s.summary, ai_enhanced: true }
                    : s,
            ));
            return true;
        } catch (err) {
            console.error('enhance slide failed', err);
            toast({ title: 'Enhancement failed', description: 'Could not enhance this slide. Try again.', variant: 'destructive' });
            return false;
        } finally {
            setEnhancingIds(prev => { const next = new Set(prev); next.delete(slide.id as string); return next; });
        }
    };

    const [enhancingAll, setEnhancingAll] = useState(false);
    const unenhancedCount = slides.filter(s => s.id && s.ai_enhanced === false).length;

    const enhanceAllRemaining = async () => {
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
    };

    // ── Slide helpers ───────────────────────────────────────────────────────────
    const addSlide = () => setSlides([...slides, { title: '', content: '', summary: '', questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }] }]);

    const moveSlide = (index: number, direction: 'up' | 'down') => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= slides.length) return;
        const newSlides = [...slides];
        [newSlides[index], newSlides[newIndex]] = [newSlides[newIndex], newSlides[index]];
        setSlides(newSlides);
    };

    const removeSlide = async (index: number) => {
        if (slides.length <= 1) return;
        const slide = slides[index];
        if (slide.id) {
            await deleteSlideWithQuestions(slide.id);
        }
        setSlides(slides.filter((_, i) => i !== index));
    };

    const updateSlide = (index: number, field: keyof SlideData, value: string | QuestionData[]) => {
        const newSlides = [...slides];
        newSlides[index] = { ...newSlides[index], [field]: value };
        setSlides(newSlides);
    };

    const updateQuestion = (si: number, qi: number, field: keyof QuestionData, value: string | string[] | number) => {
        const newSlides = [...slides];
        const newQs = [...newSlides[si].questions];
        newQs[qi] = { ...newQs[qi], [field]: value };
        newSlides[si].questions = newQs;
        setSlides(newSlides);
    };

    const updateOption = (si: number, qi: number, oi: number, value: string) => {
        const newSlides = [...slides];
        const newOpts = [...newSlides[si].questions[qi].options];
        newOpts[oi] = value;
        newSlides[si].questions[qi].options = newOpts;
        setSlides(newSlides);
    };

    // ── Render ──────────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const activePdf = pdfFile || signedPdfUrl;
    
    const editorContent = (
        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <button
                    onClick={() => navigate('/professor/dashboard')}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                </button>
                <h1 className="text-3xl font-bold text-foreground">Edit Lecture</h1>
                <p className="text-muted-foreground mt-1">Update slides, content, and quiz questions</p>
            </motion.div>

            <form onSubmit={handleSave} className="space-y-8">

                {/* Sticky Save Bar — always visible while scrolling so professors
                    can save from anywhere on the page (no more scroll-to-bottom). */}
                <div
                    className="sticky top-0 z-30 -mx-6 lg:-mx-8 px-6 lg:px-8 py-3 bg-background/85 backdrop-blur-md border-b border-border flex items-center justify-end gap-3 shadow-sm"
                    data-testid="lecture-edit-sticky-save"
                >
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => navigate('/professor/dashboard')}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button type="submit" variant="hero" disabled={saving} data-testid="lecture-edit-save-top">
                        {saving
                            ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>
                            : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
                    </Button>
                </div>

                {/* Lecture Details */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl border border-border p-6">
                    <h2 className="text-lg font-semibold text-foreground mb-4">Lecture Details</h2>
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="title">Title</Label>
                            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Lecture title" className="mt-1.5" />
                        </div>
                        <div>
                            <Label htmlFor="description">Description (optional)</Label>
                            <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief overview..." className="mt-1.5" rows={3} />
                        </div>
                        <div>
                            <Label htmlFor="course">Course</Label>
                            <select
                                id="course"
                                value={courseId ?? ''}
                                onChange={async (e) => {
                                    const next = e.target.value || null;
                                    setCourseId(next);
                                    if (!lectureId) return;
                                    try {
                                        if (originalCourseId && originalCourseId !== next) {
                                            await unassignLectureFromCourse(originalCourseId, lectureId);
                                        }
                                        if (next && next !== originalCourseId) {
                                            await assignLectureToCourse(next, lectureId);
                                        }
                                        setOriginalCourseId(next);
                                        toast({ title: 'Course updated' });
                                    } catch (err) {
                                        toast({ title: 'Failed to change course', description: String(err), variant: 'destructive' });
                                    }
                                }}
                                className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                            >
                                <option value="">Uncategorized</option>
                                {courses.map(c => (
                                    <option key={c.id} value={c.id}>{c.title}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </motion.div>

                {/* Worksheets */}
                {lectureId && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl border border-border p-6">
                        <WorksheetsPanel lectureId={lectureId} editable />
                    </motion.div>
                )}

                {/* Practice Sheets */}
                {lectureId && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl border border-border p-6">
                        <h2 className="text-lg font-semibold text-foreground mb-1">Practice Sheets</h2>
                        <p className="text-xs text-muted-foreground mb-5">
                            Auto-generate a sheet from quiz questions or author your own. Students see published sheets on this lecture's page.
                        </p>
                        <ProfessorPracticeSheetsTab lectureId={lectureId} />
                    </motion.div>
                )}

                {/* PDF Upload / Replace */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl border border-border p-6 font-geist">
                    <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-primary" />
                        {existingPdfUrl ? 'Replace PDF Slides' : 'Attach PDF Slides'}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        {existingPdfUrl
                            ? "This lecture already has a PDF attached. You can replace it with a new one."
                            : "Upload a PDF to show original slides to your students alongside the content."}
                    </p>
                    <div className="flex flex-col gap-4">
                        <div className="grid w-full max-w-sm items-center gap-1.5">
                            <Label htmlFor="pdf-edit-upload">Choose PDF file</Label>
                            <Input
                                id="pdf-edit-upload"
                                type="file"
                                accept=".pdf"
                                onChange={handlePdfFileChange}
                            />
                        </div>
                        {existingPdfUrl && (
                            <div className="flex items-center gap-2 text-xs text-success bg-success/10 p-2 rounded-lg w-fit">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Current PDF: {existingPdfUrl.split('/').pop()}</span>
                            </div>
                        )}
                        {pdfFile && (
                            <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 p-2 rounded-lg w-fit">
                                <Upload className="w-3 h-3" />
                                <span>Selected: {pdfFile.name}</span>
                            </div>
                        )}
                    </div>
                </motion.div>

                {/* Pipeline Diagnostics — read-only routing telemetry */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card rounded-2xl border border-border p-6"
                >
                    <button
                        type="button"
                        onClick={() => {
                            const next = !diagnosticsOpen;
                            setDiagnosticsOpen(next);
                            if (next && !diagnostics && !diagnosticsLoading && pdfHash) {
                                void fetchDiagnostics();
                            }
                        }}
                        className="flex items-center justify-between w-full text-left"
                        disabled={!pdfHash}
                    >
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">Pipeline Diagnostics</h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                {pdfHash
                                    ? 'Routing telemetry for the most recent parse of this PDF.'
                                    : 'No parsed PDF on this lecture yet.'}
                            </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                            {diagnosticsOpen ? 'Hide' : 'Show'}
                        </span>
                    </button>

                    {diagnosticsOpen && pdfHash && (
                        <div className="mt-4 space-y-3 text-sm">
                            {diagnosticsLoading && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Loader2 className="w-4 h-4 animate-spin" /> Loading diagnostics…
                                </div>
                            )}
                            {diagnosticsError && (
                                <p className="text-xs text-destructive">{diagnosticsError}</p>
                            )}
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
                                                    <li key={f.slide_index}>
                                                        Slide {f.slide_index + 1}: {f.reason}
                                                    </li>
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
                </motion.div>

                {/* Deck-level AI actions (Task #58) */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card rounded-2xl border border-border p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                    <div>
                        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-primary" />
                            Cross-slide quiz
                        </h2>
                        <p className="text-xs text-muted-foreground mt-1">
                            Generate a quiz that ties together concepts from multiple slides. Useful when slides were imported with AI parsing turned off.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleGenerateDeckQuiz}
                        disabled={deckQuizLoading || slides.length < 2}
                        data-testid="deck-quiz-generate"
                        className="gap-1.5 shrink-0"
                    >
                        {deckQuizLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
                        {deckQuizLoading ? 'Generating…' : 'Generate cross-slide quiz'}
                    </Button>
                </motion.div>

                {/* Skip-AI banner: offer to enhance all raw-imported slides at once. */}
                {unenhancedCount > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4"
                    >
                        <p className="text-sm text-foreground">
                            <span className="font-semibold">{unenhancedCount}</span> slide{unenhancedCount === 1 ? ' was' : 's were'} imported without AI. Enhance to generate titles and explanations.
                        </p>
                        <Button
                            type="button"
                            onClick={enhanceAllRemaining}
                            disabled={enhancingAll}
                            className="gap-1.5 shrink-0"
                            data-testid="enhance-all-remaining"
                        >
                            {enhancingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            {enhancingAll ? 'Enhancing…' : 'Enhance all remaining'}
                        </Button>
                    </motion.div>
                )}

                {/* Slide Cards */}
                {slides.map((slide, slideIndex) => (
                    <motion.div
                        key={slide.id ?? slideIndex}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: slideIndex * 0.04 }}
                        className="bg-card rounded-2xl border border-border p-6"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <GripVertical className="w-4 h-4 text-muted-foreground" />
                                <h2 className="text-lg font-semibold text-foreground">Slide {slideIndex + 1}</h2>
                                <div className="flex items-center gap-0.5 ml-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => moveSlide(slideIndex, 'up')}
                                        disabled={slideIndex === 0}
                                        className="h-7 w-7 p-0"
                                        title="Move slide up"
                                    >
                                        <ArrowUp className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => moveSlide(slideIndex, 'down')}
                                        disabled={slideIndex === slides.length - 1}
                                        className="h-7 w-7 p-0"
                                        title="Move slide down"
                                    >
                                        <ArrowDown className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {slide.id && slide.ai_enhanced === false && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => enhanceOneSlide(slideIndex)}
                                        disabled={enhancingIds.has(slide.id) || enhancingAll}
                                        className="gap-1.5"
                                        title="Run AI synthesis on this slide"
                                    >
                                        {enhancingIds.has(slide.id)
                                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            : <Sparkles className="w-3.5 h-3.5" />}
                                        Enhance with AI
                                    </Button>
                                )}
                                {slides.length > 1 && (
                                    <Button type="button" variant="ghost" size="sm" onClick={() => removeSlide(slideIndex)} className="text-destructive hover:text-destructive">
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        <div className="md:grid md:grid-cols-[1fr,320px] gap-8">
                            <div className="space-y-4">
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <Label>Slide Title</Label>
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            size="sm" 
                                            onClick={() => handleGenerateTitle(slideIndex)} 
                                            disabled={aiTitleLoading[slideIndex]} 
                                            className="gap-1.5 text-xs h-7"
                                        >
                                            {aiTitleLoading[slideIndex] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-primary" />}
                                            {slide.title ? 'Regenerate' : 'AI Generate'}
                                        </Button>
                                    </div>
                                    <Input value={slide.title} onChange={e => updateSlide(slideIndex, 'title', e.target.value)} placeholder="Slide title" />
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <Label>Content</Label>
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            size="sm" 
                                            onClick={() => handleGenerateContent(slideIndex)} 
                                            disabled={aiContentLoading[slideIndex]} 
                                            className="gap-1.5 text-xs h-7"
                                        >
                                            {aiContentLoading[slideIndex] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-primary" />}
                                            {slide.content ? 'Enhance Content' : 'AI Generate'}
                                        </Button>
                                    </div>
                                    <Textarea value={slide.content} onChange={e => updateSlide(slideIndex, 'content', e.target.value)} placeholder="Slide content..." rows={4} />
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <Label>Summary</Label>
                                        <Button type="button" variant="outline" size="sm" onClick={() => handleGenerateSummary(slideIndex)} disabled={aiSummaryLoading[slideIndex]} className="gap-1.5 text-xs h-7">
                                            {aiSummaryLoading[slideIndex] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-primary" />}
                                            {aiSummaryLoading[slideIndex] ? 'Generating…' : 'AI Generate'}
                                        </Button>
                                    </div>
                                    <Textarea value={slide.summary} onChange={e => updateSlide(slideIndex, 'summary', e.target.value)} placeholder="Key takeaways..." rows={2} />
                                </div>

                                {/* Quiz */}
                                <div className="border-t border-border pt-4 mt-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <Label>Quiz Question</Label>
                                        <Button type="button" variant="outline" size="sm" onClick={() => handleGenerateQuiz(slideIndex)} disabled={aiQuizLoading[slideIndex]} className="gap-1.5 text-xs h-7">
                                            {aiQuizLoading[slideIndex] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-primary" />}
                                            {aiQuizLoading[slideIndex] ? 'Generating…' : 'AI Generate'}
                                        </Button>
                                    </div>
                                    {slide.questions.map((question, qIndex) => (
                                        <div key={qIndex} className="space-y-3 bg-muted/50 rounded-xl p-4">
                                            <Input value={question.question} onChange={e => updateQuestion(slideIndex, qIndex, 'question', e.target.value)} placeholder="Quiz question..." />
                                            <div className="grid grid-cols-2 gap-3">
                                                {question.options.map((option, oIndex) => (
                                                    <div key={oIndex} className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => updateQuestion(slideIndex, qIndex, 'correctAnswer', oIndex)}
                                                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${question.correctAnswer === oIndex
                                                                ? 'bg-success text-success-foreground'
                                                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                                                }`}
                                                        >
                                                            {question.correctAnswer === oIndex ? <CheckCircle2 className="w-4 h-4" /> : String.fromCharCode(65 + oIndex)}
                                                        </button>
                                                        <Input value={option} onChange={e => updateOption(slideIndex, qIndex, oIndex, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + oIndex)}`} className="flex-1" />
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-xs text-muted-foreground">Click a letter to mark the correct answer</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Right side: PDF Preview */}
                            {activePdf && (
                                <div className="hidden md:flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-muted-foreground">Original Slide Preview</Label>
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            onClick={() => setLightboxPage(slideIndex + 1)}
                                            className="h-7 text-xs gap-1.5 px-2"
                                        >
                                            <FileText className="w-3.5 h-3.5" /> View Full
                                        </Button>
                                    </div>
                                    <div 
                                        className="rounded-lg border border-border shadow-sm overflow-hidden cursor-pointer hover:ring-2 ring-primary/20 transition-all"
                                        onClick={() => setLightboxPage(slideIndex + 1)}
                                    >
                                        <PDFPagePreview pageNumber={slideIndex + 1} width={320} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                ))}

                <Button type="button" variant="outline" onClick={addSlide} className="w-full">
                    <Plus className="w-5 h-5 mr-2" /> Add Another Slide
                </Button>

                <div className="flex justify-end gap-4">
                    <Button type="button" variant="outline" onClick={() => navigate('/professor/dashboard')}>Cancel</Button>
                    <Button type="submit" variant="hero" disabled={saving}>
                        {saving
                            ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> Saving...</span>
                            : <><Save className="w-5 h-5 mr-2" /> Save Changes</>}
                    </Button>
                </div>
            </form>
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
