/**
 * Lecture data service — read/write operations for lectures and slides.
 * All supabase access for the lecture domain goes through here.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Lecture, Slide, QuizQuestion } from '@/types/domain';

/**
 * Extracts the storage object path from a raw pdf_url value.
 * Handles both:
 *  - Legacy public URL: "https://.../object/public/lecture-pdfs/lectures/uuid/file.pdf"
 *  - New path-only value: "lectures/uuid/file.pdf"
 */
function extractStoragePath(rawPdfUrl: string): string {
  const urlMatch = rawPdfUrl.match(/lecture-pdfs\/(.+)$/);
  return urlMatch ? urlMatch[1] : rawPdfUrl;
}

/**
 * Resolves a stored pdf_url value to a short-lived signed URL suitable for
 * browser rendering or download.  The bucket is private, so public URLs no
 * longer work; this function creates an authenticated signed URL with a
 * 1-hour expiry for the current session.
 *
 * Returns null if the input is null/empty or if signing fails.
 */
export async function resolvePdfUrl(rawPdfUrl: string | null | undefined): Promise<string | null> {
  if (!rawPdfUrl) return null;
  const storagePath = extractStoragePath(rawPdfUrl);
  const { data, error } = await supabase.storage
    .from('lecture-pdfs')
    .createSignedUrl(storagePath, 3600); // 1-hour expiry
  if (error || !data?.signedUrl) {
    console.warn('Failed to create signed URL for PDF:', error?.message);
    return null;
  }
  return data.signedUrl;
}

export async function fetchLecture(id: string): Promise<Lecture | null> {
  const { data, error } = await supabase
    .from('lectures')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) {
    console.error(`Error fetching lecture ${id}:`, error);
    return null;
  }
  return data;
}

export async function fetchSlides(lectureId: string): Promise<Slide[]> {
  const { data, error } = await supabase
    .from('slides')
    .select('id, slide_number, title, content_text, summary')
    .eq('lecture_id', lectureId)
    .order('slide_number', { ascending: true });
  
  if (error) {
    console.error(`Error fetching slides for lecture ${lectureId}:`, error);
    return [];
  }
  return data ?? [];
}

export async function fetchQuizQuestions(lectureId: string): Promise<QuizQuestion[]> {
  // We need to fetch questions for all slides belonging to this lecture
  // Since there is no direct lecture_id in quiz_questions, we join with slides
  const { data, error } = await supabase
    .from('quiz_questions')
    .select('id, slide_id, question_text, options, correct_answer, slides!inner(lecture_id)')
    .eq('slides.lecture_id', lectureId);
  
  if (error) {
    console.error(`Error fetching quiz questions for lecture ${lectureId}:`, error);
    return [];
  }

  return (data ?? []).map(q => ({
    id: q.id,
    slide_id: q.slide_id,
    question_text: q.question_text,
    options: Array.isArray(q.options) ? q.options as string[] : [],
    correct_answer: q.correct_answer
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
    const rawValue = lectureData.pdf_url as string;
    // Support both legacy full public URLs and newer path-only values.
    // Legacy: "https://.../storage/v1/object/public/lecture-pdfs/lectures/uuid/file.pdf"
    //         → extract everything after "lecture-pdfs/"
    // New:    "lectures/uuid/file.pdf" (stored directly as a path)
    const urlMatch = rawValue.match(/lecture-pdfs\/(.+)$/);
    const storagePath = urlMatch ? urlMatch[1] : rawValue;
    await supabase.storage.from('lecture-pdfs').remove([storagePath]);
  }

  await supabase.from('lectures').delete().eq('id', lectureId);
}
