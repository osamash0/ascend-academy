import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Upload, Plus, Trash2, CheckCircle2, Loader2, Sparkles, FileText } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const API_BASE = 'http://localhost:8000';

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

export default function LectureUpload() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slides, setSlides] = useState<SlideData[]>([
    {
      title: '',
      content: '',
      summary: '',
      questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  // Per-slide AI loading states
  const [aiSummaryLoading, setAiSummaryLoading] = useState<Record<number, boolean>>({});
  const [aiQuizLoading, setAiQuizLoading] = useState<Record<number, boolean>>({});

  // ── PDF Import ────────────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast({ title: 'Invalid file type', description: 'Please upload a PDF file.', variant: 'destructive' });
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ai_model', localStorage.getItem('ascend-academy-ai-model') || 'groq');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/api/upload/parse-pdf`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: formData
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Unauthorized - Please log in again');
        throw new Error('Failed to parse PDF');
      }

      interface ParsedSlideFromAPI {
        title: string;
        content: string;
        summary?: string;
        questions?: QuestionData[];
      }
      const data: { slides: ParsedSlideFromAPI[] } = await res.json();
      const newSlides: SlideData[] = data.slides.map((s) => ({
        title: s.title,
        content: s.content,
        summary: s.summary || '',
        questions: s.questions || [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
      }));

      setSlides(newSlides);
      if (!title) setTitle(file.name.replace('.pdf', ''));
      setPdfFile(file);

      toast({ title: 'PDF Imported', description: `${newSlides.length} slides extracted successfully.` });
    } catch {
      toast({ title: 'Upload Failed', description: 'Could not parse the PDF. Make sure the backend is running.', variant: 'destructive' });
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // ── AI: Generate Summary ──────────────────────────────────────────────────
  const handleGenerateSummary = async (slideIndex: number) => {
    const content = slides[slideIndex].content;
    if (!content.trim()) {
      toast({ title: 'No content', description: 'Add slide content before generating a summary.', variant: 'destructive' });
      return;
    }

    setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/api/ai/generate-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ slide_text: content, ai_model: localStorage.getItem('ascend-academy-ai-model') || 'groq' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      updateSlide(slideIndex, 'summary', data.summary);
      toast({ title: 'Summary generated!' });
    } catch {
      toast({ title: 'AI Error', description: 'Summary generation failed. Is Ollama running?', variant: 'destructive' });
    } finally {
      setAiSummaryLoading(prev => ({ ...prev, [slideIndex]: false }));
    }
  };

  // ── AI: Generate Quiz ─────────────────────────────────────────────────────
  const handleGenerateQuiz = async (slideIndex: number) => {
    const content = slides[slideIndex].content;
    if (!content.trim()) {
      toast({ title: 'No content', description: 'Add slide content before generating a quiz.', variant: 'destructive' });
      return;
    }

    setAiQuizLoading(prev => ({ ...prev, [slideIndex]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/api/ai/generate-quiz`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ slide_text: content, ai_model: localStorage.getItem('ascend-academy-ai-model') || 'groq' }),
      });
      if (!res.ok) throw new Error();
      const quiz = await res.json();
      const newSlides = [...slides];
      newSlides[slideIndex].questions = [{
        question: quiz.question,
        options: quiz.options,
        correctAnswer: quiz.correctAnswer,
      }];
      setSlides(newSlides);
      toast({ title: 'Quiz generated!' });
    } catch {
      toast({ title: 'AI Error', description: 'Quiz generation failed. Is Ollama running?', variant: 'destructive' });
    } finally {
      setAiQuizLoading(prev => ({ ...prev, [slideIndex]: false }));
    }
  };

  // ── Slide Helpers ─────────────────────────────────────────────────────────
  const addSlide = () => {
    setSlides([...slides, { title: '', content: '', summary: '', questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }] }]);
  };

  const removeSlide = (index: number) => {
    if (slides.length > 1) setSlides(slides.filter((_, i) => i !== index));
  };

  const updateSlide = (index: number, field: keyof SlideData, value: string | QuestionData[]) => {
    const newSlides = [...slides];
    newSlides[index] = { ...newSlides[index], [field]: value };
    setSlides(newSlides);
  };

  const updateQuestion = (slideIndex: number, questionIndex: number, field: keyof QuestionData, value: string | string[] | number) => {
    const newSlides = [...slides];
    const newQuestions = [...newSlides[slideIndex].questions];
    newQuestions[questionIndex] = { ...newQuestions[questionIndex], [field]: value };
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

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast({ title: 'Error', description: 'Please enter a lecture title.', variant: 'destructive' });
      return;
    }

    setLoading(true);

    try {
      // 1. Prepare PDF URL if available
      let pdfUrl: string | null = null;
      const lectureId = crypto.randomUUID();

      if (pdfFile) {
        const filePath = `lectures/${lectureId}/${pdfFile.name}`;
        console.log('DEBUG: Uploading PDF to storage...', filePath);
        const { error: uploadError } = await supabase.storage
          .from('lecture-pdfs')
          .upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: true });

        if (uploadError) {
          console.error('DEBUG: PDF storage upload error:', uploadError);
          toast({
            title: 'PDF Upload Failed',
            description: 'Could not upload PDF to storage. Please check Supabase Storage RLS policies.',
            variant: 'destructive'
          });
          throw uploadError; // Stop the process if PDF is required and fails
        } else {
          const { data: urlData } = supabase.storage.from('lecture-pdfs').getPublicUrl(filePath);
          pdfUrl = urlData.publicUrl;
          console.log('DEBUG: PDF public URL generated:', pdfUrl);
        }
      }

      // 2. Create lecture row with pdf_url included
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

      if (lectureError) {
        console.error('DEBUG: Lecture insert error:', lectureError);
        throw lectureError;
      }

      console.log('DEBUG: Lecture created successfully:', lecture);

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
            await supabase.from('quiz_questions').insert({
              slide_id: slide.id,
              question_text: q.question,
              options: q.options.filter(o => o.trim()),
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Create Lecture</h1>
        <p className="text-muted-foreground mt-1">Add slides and quiz questions for your students</p>
      </motion.div>

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ── PDF Import ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> Import from PDF
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a PDF to auto-populate all slides. You can edit them afterwards.
          </p>
          <div className="flex items-center gap-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="pdf-upload">Choose PDF file</Label>
              <Input
                id="pdf-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
            </div>
            {isUploading && (
              <div className="flex items-center gap-3 text-primary mt-6 bg-primary/5 px-4 py-3 rounded-xl border border-primary/20 animate-pulse">
                <Sparkles className="h-5 w-5" />
                <span className="text-sm font-medium">Local AI is structuring and enhancing your slides...</span>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Lecture Details ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Lecture Details</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Introduction to Computer Science" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A brief overview of the lecture content..." className="mt-1.5" rows={3} />
            </div>
          </div>
        </motion.div>

        {/* ── Slide Cards ── */}
        {slides.map((slide, slideIndex) => (
          <motion.div
            key={slideIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: slideIndex * 0.05 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            {/* Slide header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Slide {slideIndex + 1}</h2>
              {slides.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeSlide(slideIndex)} className="text-destructive hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="space-y-4">
              {/* Slide title */}
              <div>
                <Label>Slide Title</Label>
                <Input value={slide.title} onChange={(e) => updateSlide(slideIndex, 'title', e.target.value)} placeholder="Introduction" className="mt-1.5" />
              </div>

              {/* Content */}
              <div>
                <Label>Content</Label>
                <Textarea value={slide.content} onChange={(e) => updateSlide(slideIndex, 'content', e.target.value)} placeholder="Slide content goes here..." className="mt-1.5" rows={4} />
              </div>

              {/* Summary + AI button */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label>Summary</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateSummary(slideIndex)}
                    disabled={aiSummaryLoading[slideIndex]}
                    className="gap-1.5 text-xs h-7"
                  >
                    {aiSummaryLoading[slideIndex]
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Sparkles className="w-3 h-3 text-primary" />}
                    {aiSummaryLoading[slideIndex] ? 'Generating…' : 'AI Generate'}
                  </Button>
                </div>
                <Textarea value={slide.summary} onChange={(e) => updateSlide(slideIndex, 'summary', e.target.value)} placeholder="Key takeaways from this slide..." rows={2} />
              </div>

              {/* Quiz Questions */}
              <div className="border-t border-border pt-4 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label>Quiz Question</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateQuiz(slideIndex)}
                    disabled={aiQuizLoading[slideIndex]}
                    className="gap-1.5 text-xs h-7"
                  >
                    {aiQuizLoading[slideIndex]
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Sparkles className="w-3 h-3 text-primary" />}
                    {aiQuizLoading[slideIndex] ? 'Generating…' : 'AI Generate'}
                  </Button>
                </div>
                {slide.questions.map((question, qIndex) => (
                  <div key={qIndex} className="space-y-3 bg-muted/50 rounded-xl p-4">
                    <Input
                      value={question.question}
                      onChange={(e) => updateQuestion(slideIndex, qIndex, 'question', e.target.value)}
                      placeholder="What is the main concept discussed?"
                    />
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
                            {question.correctAnswer === oIndex
                              ? <CheckCircle2 className="w-4 h-4" />
                              : String.fromCharCode(65 + oIndex)}
                          </button>
                          <Input
                            value={option}
                            onChange={(e) => updateOption(slideIndex, qIndex, oIndex, e.target.value)}
                            placeholder={`Option ${String.fromCharCode(65 + oIndex)}`}
                            className="flex-1"
                          />
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

        {/* Add Slide */}
        <Button type="button" variant="outline" onClick={addSlide} className="w-full">
          <Plus className="w-5 h-5 mr-2" />
          Add Another Slide
        </Button>

        {/* Submit */}
        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => navigate('/professor/dashboard')}>
            Cancel
          </Button>
          <Button type="submit" variant="hero" disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Creating...
              </span>
            ) : (
              <>
                <Upload className="w-5 h-5 mr-2" />
                Create Lecture
              </>
            )}
          </Button>
        </div>

      </form>
    </div>
  );
}
