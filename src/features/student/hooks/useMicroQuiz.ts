import { useQuery } from '@tanstack/react-query';
import { fetchSlides, fetchQuizQuestions } from '@/services/lectureService';
import type { QuizQuestion, Slide } from '@/types/domain';

interface MicroQuizResult {
  question: QuizQuestion;
  slide: Slide;
}

export function useMicroQuiz(lectureId: string | undefined, targetSlideNumber: number) {
  return useQuery({
    queryKey: ['micro-quiz', lectureId, targetSlideNumber],
    queryFn: async (): Promise<MicroQuizResult | null> => {
      if (!lectureId) return null;

      // Fetch slides to map slide_number to slide_id
      const slides = await fetchSlides(lectureId);
      if (!slides || slides.length === 0) return null;

      // Fetch all quiz questions for this lecture
      const questions = await fetchQuizQuestions(lectureId);
      if (!questions || questions.length === 0) return null;

      // 1. Find the target slide
      let targetSlide = slides.find(s => s.slide_number === targetSlideNumber);

      // If slide not found (e.g., target <= 0 or invalid), pick a random slide from the first 3
      if (!targetSlide) {
        const fallbackPool = slides.slice(0, 3);
        targetSlide = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
      }

      // 2. Find a question for the target slide
      const questionCandidates = questions.filter(q => q.slide_id === targetSlide?.id);

      // Helper to reduce options to exactly 2 (1 correct, 1 incorrect)
      const reduceToTwoOptions = (q: QuizQuestion): QuizQuestion => {
        if (!q.options || q.options.length <= 2) return q;
        const correctIdx = q.correct_answer;
        const incorrectIndices = q.options
          .map((_, i) => i)
          .filter(i => i !== correctIdx);
        const randomIncorrectIdx = incorrectIndices[Math.floor(Math.random() * incorrectIndices.length)];
        const chosenIndices = [correctIdx, randomIncorrectIdx].sort((a, b) => a - b);
        return {
          ...q,
          options: chosenIndices.map(i => q.options[i]),
          correct_answer: chosenIndices.indexOf(correctIdx)
        };
      };

      // 3. Fallback: If no questions for this specific slide, pick ANY random question from the lecture
      // and match it to its corresponding slide.
      if (questionCandidates.length === 0) {
        const randomQ = questions[Math.floor(Math.random() * questions.length)];
        const associatedSlide = slides.find(s => s.id === randomQ.slide_id);
        
        if (!associatedSlide) return null; // Should never happen if data is consistent
        
        return {
          question: reduceToTwoOptions(randomQ),
          slide: associatedSlide
        };
      }

      // 4. Return a random question from the candidates for the target slide
      const selectedQuestion = questionCandidates[Math.floor(Math.random() * questionCandidates.length)];
      return {
        question: reduceToTwoOptions(selectedQuestion),
        slide: targetSlide
      };
    },
    enabled: !!lectureId,
    staleTime: Infinity, // The quiz question doesn't need to refresh rapidly
  });
}
