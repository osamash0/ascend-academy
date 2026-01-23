import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Upload, FileText, X, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

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

  const addSlide = () => {
    setSlides([
      ...slides,
      {
        title: '',
        content: '',
        summary: '',
        questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
      },
    ]);
  };

  const removeSlide = (index: number) => {
    if (slides.length > 1) {
      setSlides(slides.filter((_, i) => i !== index));
    }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a lecture title.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      // Create lecture
      const { data: lecture, error: lectureError } = await supabase
        .from('lectures')
        .insert({
          title,
          description,
          professor_id: user?.id,
          total_slides: slides.length,
        })
        .select()
        .single();

      if (lectureError) throw lectureError;

      // Create slides and questions
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

        // Create questions for this slide
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

      toast({
        title: 'Success!',
        description: 'Lecture created successfully.',
      });

      navigate('/professor/dashboard');
    } catch (error) {
      console.error('Error creating lecture:', error);
      toast({
        title: 'Error',
        description: 'Failed to create lecture. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold text-foreground">Create Lecture</h1>
        <p className="text-muted-foreground mt-1">
          Add slides and quiz questions for your students
        </p>
      </motion.div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <h2 className="text-lg font-semibold text-foreground mb-4">Lecture Details</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Introduction to Computer Science"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief overview of the lecture content..."
                className="mt-1.5"
                rows={3}
              />
            </div>
          </div>
        </motion.div>

        {/* Slides */}
        {slides.map((slide, slideIndex) => (
          <motion.div
            key={slideIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: slideIndex * 0.1 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                Slide {slideIndex + 1}
              </h2>
              {slides.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSlide(slideIndex)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <Label>Slide Title</Label>
                <Input
                  value={slide.title}
                  onChange={(e) => updateSlide(slideIndex, 'title', e.target.value)}
                  placeholder="Introduction"
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label>Content</Label>
                <Textarea
                  value={slide.content}
                  onChange={(e) => updateSlide(slideIndex, 'content', e.target.value)}
                  placeholder="Slide content goes here..."
                  className="mt-1.5"
                  rows={4}
                />
              </div>

              <div>
                <Label>AI Summary (optional)</Label>
                <Textarea
                  value={slide.summary}
                  onChange={(e) => updateSlide(slideIndex, 'summary', e.target.value)}
                  placeholder="Key takeaways from this slide..."
                  className="mt-1.5"
                  rows={2}
                />
              </div>

              {/* Questions */}
              <div className="border-t border-border pt-4 mt-4">
                <Label className="mb-3 block">Quiz Question</Label>
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
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                              question.correctAnswer === oIndex
                                ? 'bg-success text-success-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}
                          >
                            {question.correctAnswer === oIndex ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              String.fromCharCode(65 + oIndex)
                            )}
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
                    <p className="text-xs text-muted-foreground">
                      Click a letter to mark the correct answer
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ))}

        {/* Add Slide Button */}
        <Button
          type="button"
          variant="outline"
          onClick={addSlide}
          className="w-full"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Another Slide
        </Button>

        {/* Submit */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/professor/dashboard')}
          >
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
