import { useState, useRef, useCallback } from 'react';
import type { SlideData, QuestionData } from '@/types/lectureUpload';

const makeEmptySlide = (): SlideData => ({
  title: '',
  content: '',
  summary: '',
  questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
});

export function useSlideManager() {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  // Ref so callbacks stay stable without listing slides as a dep
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  const addSlide = useCallback((insertAfterIndex?: number) => {
    const current = slidesRef.current;
    const newSlide = makeEmptySlide();
    if (insertAfterIndex !== undefined) {
      const next = [...current];
      next.splice(insertAfterIndex + 1, 0, newSlide);
      setSlides(next);
      setActiveSlideIndex(insertAfterIndex + 1);
    } else {
      setSlides([...current, newSlide]);
      setActiveSlideIndex(current.length);
    }
  }, []);

  const removeSlide = useCallback((index: number) => {
    const current = slidesRef.current;
    if (current.length <= 1) {
      setSlides([]);
      setActiveSlideIndex(0);
      return;
    }
    setSlides(current.filter((_, i) => i !== index));
    setActiveSlideIndex(prev => (prev >= index && prev > 0 ? prev - 1 : prev));
  }, []);

  const updateSlide = useCallback((index: number, field: keyof SlideData, value: string | QuestionData[]) => {
    setSlides(prev => prev.map((s, i) => (i !== index ? s : { ...s, [field]: value })));
  }, []);

  const updateQuestionText = useCallback((slideIndex: number, questionIndex: number, value: string) => {
    setSlides(prev =>
      prev.map((s, i) =>
        i !== slideIndex
          ? s
          : {
              ...s,
              questions: s.questions.map((q, qi) =>
                qi !== questionIndex ? q : { ...q, question: value }
              ),
            }
      )
    );
  }, []);

  const updateCorrectAnswer = useCallback((slideIndex: number, questionIndex: number, value: number) => {
    setSlides(prev =>
      prev.map((s, i) =>
        i !== slideIndex
          ? s
          : {
              ...s,
              questions: s.questions.map((q, qi) =>
                qi !== questionIndex ? q : { ...q, correctAnswer: value }
              ),
            }
      )
    );
  }, []);

  const updateOption = useCallback((slideIndex: number, questionIndex: number, optionIndex: number, value: string) => {
    setSlides(prev =>
      prev.map((s, i) =>
        i !== slideIndex
          ? s
          : {
              ...s,
              questions: s.questions.map((q, qi) =>
                qi !== questionIndex
                  ? q
                  : {
                      ...q,
                      options: q.options.map((o, oi) => (oi !== optionIndex ? o : value)),
                    }
              ),
            }
      )
    );
  }, []);

  return {
    slides,
    setSlides,
    activeSlideIndex,
    setActiveSlideIndex,
    addSlide,
    removeSlide,
    updateSlide,
    updateQuestionText,
    updateCorrectAnswer,
    updateOption,
  };
}
