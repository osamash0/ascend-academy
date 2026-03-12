import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Save, Plus, Trash2, CheckCircle2, Loader2, Sparkles, ArrowLeft, FileText, Upload, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const API_BASE = 'http://localhost:8000';

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

export default function LectureEdit() {
    const { lectureId } = useParams<{ lectureId: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [slides, setSlides] = useState<SlideData[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // PDF state
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [existingPdfUrl, setExistingPdfUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    // Per-slide AI loading states
    const [aiSummaryLoading, setAiSummaryLoading] = useState<Record<number, boolean>>({});
    const [aiQuizLoading, setAiQuizLoading] = useState<Record<number, boolean>>({});

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
                    const { data: urlData } = supabase.storage.from('lecture-pdfs').getPublicUrl(filePath);
                    finalPdfUrl = urlData.publicUrl;
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

            // 2. Update lecture (regenerate slug from title if it changed, or keep existing)
            const slug = title
                .toLowerCase()
                .trim()
                .replace(/[^\w\s-]/g, '')
                .replace(/[\s_-]+/g, '-')
                .replace(/^-+|-+$/g, '');

            const { error: lErr } = await supabase
                .from('lectures')
                .update({
                    title,
                    description,
                    total_slides: slides.length,
                    pdf_url: finalPdfUrl
                } as any)
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
                            await supabase.from('quiz_questions').update({
                                question_text: q.question,
                                options: q.options,
                                correct_answer: q.correctAnswer,
                            }).eq('id', q.id);
                        } else {
                            await supabase.from('quiz_questions').insert({
                                slide_id: s.id,
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
                            await supabase.from('quiz_questions').insert({
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
        const content = slides[slideIndex].content;
        if (!content.trim()) {
            toast({ title: 'No content', description: 'Add slide content first.', variant: 'destructive' });
            return;
        }
        setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: true }));
        try {
            const res = await fetch(`${API_BASE}/api/ai/generate-summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slide_text: content, ai_model: localStorage.getItem('ascend-academy-ai-model') || 'llama3' }),
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            updateSlide(slideIndex, 'summary', data.summary);
            toast({ title: 'Summary generated!' });
        } catch {
            toast({ title: 'AI Error', description: 'Is Ollama running?', variant: 'destructive' });
        } finally {
            setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: false }));
        }
    };

    const handleGenerateQuiz = async (slideIndex: number) => {
        const content = slides[slideIndex].content;
        if (!content.trim()) {
            toast({ title: 'No content', description: 'Add slide content first.', variant: 'destructive' });
            return;
        }
        setAiQuizLoading(prev => ({ ...prev, [slideIndex]: true }));
        try {
            const res = await fetch(`${API_BASE}/api/ai/generate-quiz`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slide_text: content, ai_model: localStorage.getItem('ascend-academy-ai-model') || 'llama3' }),
            });
            if (!res.ok) throw new Error();
            const quiz = await res.json();
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
            // Delete from DB
            await supabase.from('quiz_questions').delete().eq('slide_id', slide.id);
            await supabase.from('slides').delete().eq('id', slide.id);
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

    return (
        <div className="p-6 lg:p-8 max-w-4xl mx-auto">
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
                    </div>
                </motion.div>

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
                            {slides.length > 1 && (
                                <Button type="button" variant="ghost" size="sm" onClick={() => removeSlide(slideIndex)} className="text-destructive hover:text-destructive">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div>
                                <Label>Slide Title</Label>
                                <Input value={slide.title} onChange={e => updateSlide(slideIndex, 'title', e.target.value)} placeholder="Slide title" className="mt-1.5" />
                            </div>
                            <div>
                                <Label>Content</Label>
                                <Textarea value={slide.content} onChange={e => updateSlide(slideIndex, 'content', e.target.value)} placeholder="Slide content..." className="mt-1.5" rows={4} />
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
}
