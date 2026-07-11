import { useState, useRef, useCallback } from 'react';
import type { SlideData, QuestionData } from '@/types/lectureUpload';

const makeEmptySlide = (): SlideData => ({
  title: '',
  content: '',
  summary: '',
  questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
});

interface UseSlideManagerOptions {
  /**
   * Called when a slide that already exists server-side (has a DB `id`) is
   * removed, so edit mode can delete it from the database immediately. Ignored
   * for not-yet-persisted slides (create flow).
   */
  onDeletePersisted?: (slide: SlideData) => void;
}

export function useSlideManager(options: UseSlideManagerOptions = {}) {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  // Ref so callbacks stay stable without listing slides as a dep
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  // Ref so removeSlide can reach the latest delete callback without depending on it
  const onDeletePersistedRef = useRef(options.onDeletePersisted);
  onDeletePersistedRef.current = options.onDeletePersisted;

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
    const removed = current[index];
    // Delete the persisted row immediately in edit mode (matches the legacy
    // LectureEdit behaviour). No-op for slides that only exist client-side.
    if (removed?.id) onDeletePersistedRef.current?.(removed);
    if (current.length <= 1) {
      setSlides([]);
      setActiveSlideIndex(0);
      return;
    }
    setSlides(current.filter((_, i) => i !== index));
    setActiveSlideIndex(prev => (prev >= index && prev > 0 ? prev - 1 : prev));
  }, []);

  const moveSlide = useCallback((index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    setSlides(prev => {
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next;
    });
    setActiveSlideIndex(prev => (prev === index ? newIndex : prev === newIndex ? index : prev));
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
    moveSlide,
    updateSlide,
    updateQuestionText,
    updateCorrectAnswer,
    updateOption,
  };
}
