import { useState, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/hooks/use-toast';
import { useAiModel } from '@/hooks/use-ai-model';
import type { SlideData, QuestionData } from '@/types/lectureUpload';

type AIOperation = 'summary' | 'quiz' | 'title' | 'content';

interface UseAIGenerationOptions {
  slides: SlideData[];
  updateSlide: (index: number, field: keyof SlideData, value: string | QuestionData[]) => void;
}

export const isAdministrativeQuiz = (quiz?: { question: string; options?: string[] }) => {
  if (!quiz) return false;
  return (
    quiz.question === "This slide contains administrative information." ||
    (quiz.options && quiz.options.every(o => o === "N/A"))
  );
};

export function useAIGeneration({ slides, updateSlide }: UseAIGenerationOptions) {
  const { toast } = useToast();
  const { aiModel } = useAiModel();

  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});

  const setOpLoading = useCallback((idx: number, op: AIOperation, val: boolean) => {
    setAiLoading(prev => ({ ...prev, [`${idx}-${op}`]: val }));
  }, []);

  const isAiLoading = useCallback(
    (idx: number, op: AIOperation) => !!aiLoading[`${idx}-${op}`],
    [aiLoading]
  );

  const handleGenerateSummary = useCallback(
    async (slideIndex: number) => {
      const content = slides[slideIndex]?.content;
      if (!content?.trim()) {
        toast({ title: 'No content', description: 'Add slide content before generating a summary.', variant: 'destructive' });
        return;
      }

      setOpLoading(slideIndex, 'summary', true);
      try {
        const data = await apiClient.post<{ summary: string }>('/api/v1/ai/generate-summary', {
          slide_text: content,
          ai_model: aiModel,
        });
        updateSlide(slideIndex, 'summary', data.summary);
        toast({ title: 'Summary Generated', description: 'AI has distilled the key points for you.' });
      } catch {
        toast({ title: 'AI Error', description: 'Summary generation failed. Please try again.', variant: 'destructive' });
      } finally {
        setOpLoading(slideIndex, 'summary', false);
      }
    },
    [slides, aiModel, updateSlide, setOpLoading, toast]
  );

  const handleGenerateQuiz = useCallback(
    async (slideIndex: number) => {
      const content = slides[slideIndex]?.content;
      if (!content?.trim()) {
        toast({ title: 'No content', description: 'Add slide content before generating a quiz.', variant: 'destructive' });
        return;
      }

      setOpLoading(slideIndex, 'quiz', true);
      try {
        const quiz = await apiClient.post<{ 
          question: string; 
          options: string[]; 
          correctAnswer: number;
          explanation?: string;
          concept?: string;
        }>(
          '/api/v1/ai/generate-quiz',
          { slide_text: content, ai_model: aiModel }
        );
        if (isAdministrativeQuiz(quiz)) {
          updateSlide(slideIndex, 'questions', []);
          setSuggestedQuizzes(prev => ({
            ...prev,
            [slideIndex]: {
              question: quiz.question,
              options: quiz.options,
              correctAnswer: quiz.correctAnswer,
              explanation: quiz.explanation,
              concept: quiz.concept,
              added: false
            }
          }));
          toast({
            title: 'Syllabus / Logistical Slide',
            description: 'This slide contains administrative info. A quiz was not added.',
          });
        } else {
          updateSlide(slideIndex, 'questions', [
            { 
              question: quiz.question, 
              options: quiz.options, 
              correctAnswer: quiz.correctAnswer,
              explanation: quiz.explanation,
              concept: quiz.concept,
            },
          ]);
          setSuggestedQuizzes(prev => ({
            ...prev,
            [slideIndex]: {
              question: quiz.question,
              options: quiz.options,
              correctAnswer: quiz.correctAnswer,
              explanation: quiz.explanation,
              concept: quiz.concept,
              added: true
            }
          }));
          toast({ title: 'Quiz Generated', description: 'A new question has been crafted from your content.' });
        }
      } catch {
        toast({ title: 'AI Error', description: 'Quiz generation failed. Please try again.', variant: 'destructive' });
      } finally {
        setOpLoading(slideIndex, 'quiz', false);
      }
    },
    [slides, aiModel, updateSlide, setOpLoading, toast]
  );

  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [suggestedQuizzes, setSuggestedQuizzes] = useState<Record<number, { 
    question: string; 
    options: string[]; 
    correctAnswer: number; 
    added: boolean;
    explanation?: string;
    concept?: string;
  }>>({});

  const updateSuggestedQuiz = useCallback((idx: number, field: 'question' | 'options' | 'correctAnswer' | 'explanation' | 'concept', value: any) => {
    setSuggestedQuizzes(prev => {
      const current = prev[idx];
      if (!current) return prev;
      return {
        ...prev,
        [idx]: {
          ...current,
          [field]: value,
        }
      };
    });
  }, []);

  const updateSuggestedOption = useCallback((idx: number, optIdx: number, value: string) => {
    setSuggestedQuizzes(prev => {
      const current = prev[idx];
      if (!current) return prev;
      const opts = [...current.options];
      opts[optIdx] = value;
      return {
        ...prev,
        [idx]: {
          ...current,
          options: opts
        }
      };
    });
  }, []);

  const handleGenerateAllQuizzes = useCallback(
    async () => {
      const pending = slides
        .map((s, idx) => ({ slide: s, idx }))
        .filter(({ slide, idx }) => slide.content.trim() && !suggestedQuizzes[idx] && !slide.questions[0]?.question?.trim());

      if (pending.length === 0) {
        return;
      }

      setIsBulkGenerating(true);

      let successCount = 0;
      const chunkSize = 3;

      for (let i = 0; i < pending.length; i += chunkSize) {
        const chunk = pending.slice(i, i + chunkSize);
        chunk.forEach(({ idx }) => setOpLoading(idx, 'quiz', true));

        await Promise.all(
          chunk.map(async ({ slide, idx }) => {
            try {
              const quiz = await apiClient.post<{ 
                question: string; 
                options: string[]; 
                correctAnswer: number;
                explanation?: string;
                concept?: string;
              }>(
                '/api/v1/ai/generate-quiz',
                { slide_text: slide.content, ai_model: aiModel }
              );
              setSuggestedQuizzes(prev => ({
                ...prev,
                [idx]: {
                  question: quiz.question,
                  options: quiz.options,
                  correctAnswer: quiz.correctAnswer,
                  explanation: quiz.explanation,
                  concept: quiz.concept,
                  added: false
                }
              }));
              if (!isAdministrativeQuiz(quiz)) {
                successCount++;
              }
            } catch (err) {
              console.error(`Bulk generation failed for slide ${idx + 1}:`, err);
            } finally {
              setOpLoading(idx, 'quiz', false);
            }
          })
        );
      }

      setIsBulkGenerating(false);
      toast({
        title: 'Quiz Suggestions Ready',
        description: `Generated ${successCount} suggested quiz recommendations in the tab.`,
      });
    },
    [slides, aiModel, suggestedQuizzes, setOpLoading, toast]
  );

  const handleGenerateTitle = useCallback(
    async (slideIndex: number) => {
      const content = slides[slideIndex]?.content;
      if (!content?.trim()) {
        toast({ title: 'No content', description: 'Add slide content before generating a title.', variant: 'destructive' });
        return;
      }

      setOpLoading(slideIndex, 'title', true);
      try {
        const data = await apiClient.post<{ title: string }>('/api/v1/ai/suggest-title', {
          slide_text: content,
          ai_model: aiModel,
        });
        updateSlide(slideIndex, 'title', data.title);
        toast({ title: 'Title Suggested', description: 'AI has analyzed your content for a perfect title.' });
      } catch {
        toast({ title: 'AI Error', description: 'Title generation failed.', variant: 'destructive' });
      } finally {
        setOpLoading(slideIndex, 'title', false);
      }
    },
    [slides, aiModel, updateSlide, setOpLoading, toast]
  );

  const handleGenerateContent = useCallback(
    async (slideIndex: number) => {
      const slide = slides[slideIndex];
      const existingContent = slide?.content;
      const existingTitle = slide?.title;

      setOpLoading(slideIndex, 'content', true);
      try {
        const data = await apiClient.post<{ content: string }>('/api/v1/ai/suggest-content', {
          slide_text: existingContent || existingTitle || 'Educational topic',
          ai_model: aiModel,
        });
        updateSlide(slideIndex, 'content', data.content);
        toast({ title: 'Content Enhanced', description: 'AI has expanded and structured your slide content.' });
      } catch {
        toast({ title: 'AI Error', description: 'Content generation failed.', variant: 'destructive' });
      } finally {
        setOpLoading(slideIndex, 'content', false);
      }
    },
    [slides, aiModel, updateSlide, setOpLoading, toast]
  );

  return {
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
  };
}
