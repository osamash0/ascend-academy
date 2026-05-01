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
        const data = await apiClient.post<{ summary: string }>('/api/ai/generate-summary', {
          slide_text: content,
          ai_model: aiModel,
        });
        updateSlide(slideIndex, 'summary', data.summary);
        toast({ title: 'Summary Generated', description: 'AI has distilled the key points for you.' });
      } catch {
        toast({ title: 'AI Error', description: 'Summary generation failed. Is Ollama running?', variant: 'destructive' });
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
        const quiz = await apiClient.post<{ question: string; options: string[]; correctAnswer: number }>(
          '/api/ai/generate-quiz',
          { slide_text: content, ai_model: aiModel }
        );
        updateSlide(slideIndex, 'questions', [
          { question: quiz.question, options: quiz.options, correctAnswer: quiz.correctAnswer },
        ]);
        toast({ title: 'Quiz Generated', description: 'A new question has been crafted from your content.' });
      } catch {
        toast({ title: 'AI Error', description: 'Quiz generation failed. Is Ollama running?', variant: 'destructive' });
      } finally {
        setOpLoading(slideIndex, 'quiz', false);
      }
    },
    [slides, aiModel, updateSlide, setOpLoading, toast]
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
        const data = await apiClient.post<{ title: string }>('/api/ai/suggest-title', {
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
        const data = await apiClient.post<{ content: string }>('/api/ai/suggest-content', {
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
  };
}
