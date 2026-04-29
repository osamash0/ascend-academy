/**
 * Lecture data service — read/write operations for lectures and slides.
 * All supabase access for the lecture domain goes through here.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Lecture, Slide, QuizQuestion } from '@/types/domain';

export async function fetchLecture(lectureId: string): Promise<Lecture | null> {
  const { data } = await supabase
    .from('lectures')
    .select('id, title, description, total_slides, created_at, pdf_url')
    .eq('id', lectureId)
    .single();
  return data ?? null;
}

export async function fetchSlides(lectureId: string): Promise<Slide[]> {
  const { data } = await supabase
    .from('slides')
    .select('id, slide_number, title, content_text, summary')
    .eq('lecture_id', lectureId)
    .order('slide_number', { ascending: true });
  return data ?? [];
}

export async function fetchQuizQuestions(lectureId: string): Promise<QuizQuestion[]> {
  const { data } = await supabase
    .from('quiz_questions')
    .select('id, slide_id, question_text, options, correct_answer')
    .eq('lecture_id', lectureId);
  return (data ?? []).map(q => ({
    ...q,
    options: Array.isArray(q.options) ? q.options : [],
  }));
}

export async function updateSlideContent(
  slideId: string,
  patch: { content_text?: string; summary?: string; title?: string },
): Promise<void> {
  await supabase.from('slides').update(patch).eq('id', slideId);
}

export async function fetchProfessorLectures(professorId: string): Promise<Lecture[]> {
  const { data } = await supabase
    .from('lectures')
    .select('id, title, description, total_slides, created_at')
    .eq('professor_id', professorId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export interface QuizQuestionInput {
  slide_id: string;
  question_text: string;
  options: string[];
  correct_answer: number;
}

export async function insertQuizQuestion(q: QuizQuestionInput): Promise<void> {
  await supabase.from('quiz_questions').insert(q);
}

export async function updateQuizQuestion(
  id: string,
  patch: { question_text: string; options: string[]; correct_answer: number },
): Promise<void> {
  await supabase.from('quiz_questions').update(patch).eq('id', id);
}

export async function deleteSlideWithQuestions(slideId: string): Promise<void> {
  await supabase.from('quiz_questions').delete().eq('slide_id', slideId);
  await supabase.from('slides').delete().eq('id', slideId);
}

export async function deleteLecture(lectureId: string): Promise<void> {
  const { data: slidesData } = await supabase
    .from('slides')
    .select('id')
    .eq('lecture_id', lectureId);
  const slideIds = slidesData?.map(s => s.id) ?? [];

  if (slideIds.length > 0) {
    await supabase.from('quiz_questions').delete().in('slide_id', slideIds);
  }
  await supabase.from('student_progress').delete().eq('lecture_id', lectureId);
  await supabase.from('slides').delete().eq('lecture_id', lectureId);

  const { data: lectureData } = await supabase
    .from('lectures')
    .select('pdf_url')
    .eq('id', lectureId)
    .single();
  if (lectureData?.pdf_url) {
    const pathMatch = (lectureData.pdf_url as string).match(/lecture-pdfs\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from('lecture-pdfs').remove([pathMatch[1]]);
    }
  }

  await supabase.from('lectures').delete().eq('id', lectureId);
}
