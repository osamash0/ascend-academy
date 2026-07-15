/**
 * Lecture data service — read/write operations for lectures and slides.
 * All supabase access for the lecture domain goes through here.
 */
import { supabase } from '@/integrations/supabase/client';
import { apiClient } from '@/lib/apiClient';
import type { Lecture, Slide, QuizQuestion } from '@/types/domain';
import type { SlideData } from '@/types/lectureUpload';
import { toSlug } from '@/lib/utils';

export interface EnhancedSlideResult {
  slide_id: string;
  title: string;
  summary: string;
  ai_enhanced: boolean;
  already_enhanced?: boolean;
}

/**
 * Run the unified per-slide synthesis on a slide imported with "Skip AI"
 * (ai_enhanced=false) and flip the flag. Server-authoritative — the row is
 * updated server-side; the returned title/summary let the editor refresh in place.
 */
export async function enhanceSlide(slideId: string): Promise<EnhancedSlideResult> {
  return apiClient.post<EnhancedSlideResult>(`/api/upload/enhance-slide/${slideId}`, {});
}


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

export async function fetchLecture(idOrSlug: string): Promise<Lecture | null> {
  let id = idOrSlug;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  if (!isUuid) {
    const { data: allLectures, error: listError } = await supabase
      .from('lectures')
      .select('id, title');
    if (listError) {
      console.error("Error listing lectures to resolve slug:", listError);
      return null;
    }
    const match = (allLectures ?? []).find(l => toSlug(l.title) === idOrSlug || l.id === idOrSlug);
    if (!match) {
      console.error(`No lecture found matching slug: ${idOrSlug}`);
      return null;
    }
    id = match.id;
  }

  const { data, error } = await supabase
    .from('lectures')
    .select('*, course:courses(id, title, color)')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`Error fetching lecture ${id}:`, error);
    return null;
  }
  return data as unknown as Lecture;
}

export async function fetchSlides(lectureId: string): Promise<Slide[]> {
  let { data, error } = await supabase
    .from('slides')
    .select('id, slide_number, title, content_text, summary, regen_instruction')
    .eq('lecture_id', lectureId)
    .order('slide_number', { ascending: true });
  
  if (error && /column .*regen_instruction.* does not exist/i.test(error.message ?? '')) {
    console.warn(
      `slides.regen_instruction column missing — falling back to legacy schema. ` +
      `Apply migration 20260711040000_slide_trust_signals.sql to enable it.`
    );
    const fallback = await supabase
      .from('slides')
      .select('id, slide_number, title, content_text, summary')
      .eq('lecture_id', lectureId)
      .order('slide_number', { ascending: true });
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error) {
    console.error(`Error fetching slides for lecture ${lectureId}:`, error);
    return [];
  }
  return data ?? [];
}

export async function fetchQuizQuestions(lectureId: string): Promise<QuizQuestion[]> {
  // We need to fetch questions for all slides belonging to this lecture
  // Since there is no direct lecture_id in quiz_questions, we join with slides.
  // ``metadata`` carries the concept-testing fields (explanation/concept/...)
  // produced by the upgraded quiz prompt; it is optional and defaults to '{}'.
  // The column is added in supabase/migrations/20260503000007_quiz_metadata.sql
  // and MUST be applied before this code runs — PostgREST returns a 42703
  // "column does not exist" error if the migration is missing. We retry the
  // query without ``metadata`` in that case so the rest of the lecture view
  // keeps working during a partial rollout (server upgraded, DB migration
  // not yet applied).
  let { data, error } = await supabase
    .from('quiz_questions')
    .select('id, slide_id, question_text, options, correct_answer, metadata, slides!inner(lecture_id)' as string)
    .eq('slides.lecture_id', lectureId);

  if (error && /column .*metadata.* does not exist/i.test(error.message ?? '')) {
    console.warn(
      `quiz_questions.metadata column missing — falling back to legacy ` +
      `schema. Apply migration 20260503000007_quiz_metadata.sql to enable ` +
      `concept-testing fields. (lecture ${lectureId})`,
    );
    const fallback = await supabase
      .from('quiz_questions')
      .select('id, slide_id, question_text, options, correct_answer, slides!inner(lecture_id)')
      .eq('slides.lecture_id', lectureId);
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error) {
    console.error(`Error fetching quiz questions for lecture ${lectureId}:`, error);
    return [];
  }

  return (data as any[] ?? []).map((q: any) => {
    const meta = (q.metadata as Record<string, unknown> | null | undefined) ?? {};
    return {
      id: q.id as string,
      slide_id: q.slide_id as string,
      question_text: q.question_text as string,
      options: Array.isArray(q.options) ? (q.options as string[]) : [],
      correct_answer: q.correct_answer as number,
      explanation: typeof meta.explanation === 'string' ? meta.explanation : undefined,
      concept: typeof meta.concept === 'string' ? meta.concept : undefined,
      cognitive_level:
        meta.cognitive_level === 'recall' ||
        meta.cognitive_level === 'apply' ||
        meta.cognitive_level === 'analyse'
          ? meta.cognitive_level
          : undefined,
      linked_slides: Array.isArray(meta.linked_slides)
        ? (meta.linked_slides as unknown[]).filter((n): n is number => typeof n === 'number')
        : undefined,
    };
  });
}

export async function updateSlideContent(
  slideId: string,
  patch: { content_text?: string; summary?: string; title?: string },
): Promise<void> {
  await supabase.from('slides').update(patch).eq('id', slideId);
}

export async function fetchProfessorLectures(
  professorId: string,
  options?: { includeArchived?: boolean; onlyArchived?: boolean }
): Promise<Lecture[]> {
  let query: any = supabase
    .from('lectures')
    .select('id, title, description, total_slides, created_at, pdf_url, course_id, is_archived');

  if (options?.onlyArchived) {
    query = query.eq('is_archived', true);
  } else if (!options?.includeArchived) {
    query = query.eq('is_archived', false);
  }

  const { data } = await query
    .or(`professor_id.eq.${professorId},student_owner_id.eq.${professorId}`)
    .order('created_at', { ascending: false });
  return (data ?? []) as unknown as Lecture[];
}

export async function archiveLecture(lectureId: string): Promise<void> {
  const { error } = await supabase
    .from('lectures')
    .update({ is_archived: true } as any)
    .eq('id', lectureId);
  if (error) throw error;
}

export async function unarchiveLecture(lectureId: string): Promise<void> {
  const { error } = await supabase
    .from('lectures')
    .update({ is_archived: false } as any)
    .eq('id', lectureId);
  if (error) throw error;
}

export interface QuizQuestionInput {
  slide_id: string;
  question_text: string;
  options: string[];
  correct_answer: number;
  /**
   * Optional concept-testing fields. Persisted into the ``metadata`` jsonb
   * column added in 20260503000007_quiz_metadata.sql. Omitted keys are
   * skipped (we don't write nulls) so the column default ``{}`` stays clean
   * for manually-authored questions.
   */
  metadata?: {
    explanation?: string;
    concept?: string;
    cognitive_level?: 'recall' | 'apply' | 'analyse';
    linked_slides?: number[];
  };
}

export async function insertQuizQuestion(q: QuizQuestionInput): Promise<void> {
  // Trim the metadata down to only its populated keys before INSERT so we
  // don't pollute the column with explicit "undefined"s that PostgREST would
  // serialize as nulls.
  const cleanedMetadata =
    q.metadata
      ? Object.fromEntries(
          Object.entries(q.metadata).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
          ),
        )
      : undefined;
  const payload: Record<string, unknown> = {
    slide_id: q.slide_id,
    question_text: q.question_text,
    options: q.options,
    correct_answer: q.correct_answer,
  };
  if (cleanedMetadata && Object.keys(cleanedMetadata).length > 0) {
    payload.metadata = cleanedMetadata;
  }
  await supabase.from('quiz_questions').insert(payload as any);
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

/**
 * Everything the unified lecture editor needs to hydrate itself for an
 * existing lecture: metadata plus fully-formed {@link SlideData} (with slide
 * and question DB ids preserved so save can upsert rather than duplicate).
 */
export interface LectureForEdit {
  title: string;
  description: string;
  courseId: string | null;
  /** Raw stored pdf_url value (path or legacy URL), or null. */
  pdfUrl: string | null;
  /** Short-lived signed URL for rendering the PDF, or null. */
  signedPdfUrl: string | null;
  pdfHash: string | null;
  slides: SlideData[];
}

/**
 * Loads a persisted lecture + its slides + questions into the editor's
 * {@link SlideData} shape. Ported from the legacy LectureEdit.fetchLecture so
 * the unified editor can edit existing lectures with the same state model the
 * upload flow uses. Throws on failure so the caller can surface a toast.
 */
export async function loadLectureForEdit(lectureId: string): Promise<LectureForEdit> {
  const { data: lecture, error: lErr } = await supabase
    .from('lectures')
    .select('*')
    .eq('id', lectureId)
    .maybeSingle();
  if (lErr) throw lErr;

  const lectureRow = lecture as typeof lecture & {
    course_id?: string | null;
    pdf_hash?: string | null;
  };

  const signedPdfUrl = lecture.pdf_url ? await resolvePdfUrl(lecture.pdf_url) : null;

  const { data: slidesData, error: sErr } = await supabase
    .from('slides')
    .select('*')
    .eq('lecture_id', lectureId)
    .order('slide_number', { ascending: true });
  if (sErr) throw sErr;

  const slideIds = (slidesData ?? []).map(s => s.id);
  const { data: questionsData } = slideIds.length
    ? await supabase.from('quiz_questions').select('*').in('slide_id', slideIds)
    : { data: [] as any[] };

  const slides: SlideData[] = (slidesData ?? []).map(slide => {
    const slideQuestions = (questionsData ?? [])
      .filter((q: any) => q.slide_id === slide.id)
      .map((q: any) => ({
        id: q.id as string,
        question: q.question_text as string,
        options: Array.isArray(q.options) ? (q.options as string[]) : ['', '', '', ''],
        correctAnswer: q.correct_answer ?? 0,
      }));

    const slideRow = slide as {
      ai_enhanced?: boolean;
      vision_routed?: boolean;
      needs_review?: boolean;
      review_reason?: string | null;
      regen_instruction?: string | null;
    };
    return {
      id: slide.id,
      title: slide.title ?? '',
      content: slide.content_text ?? '',
      summary: slide.summary ?? '',
      ai_enhanced: slideRow.ai_enhanced ?? true,
      vision_routed: slideRow.vision_routed ?? false,
      needs_review: slideRow.needs_review ?? false,
      review_reason: slideRow.review_reason ?? undefined,
      regen_instruction: slideRow.regen_instruction ?? undefined,
      questions: slideQuestions.length > 0
        ? slideQuestions
        : [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
    };
  });

  return {
    title: lecture.title,
    description: lecture.description ?? '',
    courseId: lectureRow.course_id ?? null,
    pdfUrl: lecture.pdf_url,
    signedPdfUrl,
    pdfHash: lectureRow.pdf_hash ?? null,
    slides,
  };
}

export interface SaveExistingLectureInput {
  title: string;
  description: string;
  slides: SlideData[];
  /** New PDF to replace the current one (optional). */
  pdfFile?: File | null;
  /** Current stored pdf_url; kept when no replacement is uploaded. */
  existingPdfUrl?: string | null;
}

/**
 * Persists edits to an existing lecture: updates the lecture row, uploads a
 * replacement PDF if provided, then upserts each slide (renumbering by array
 * order) and its questions — updating rows that carry an id, inserting the
 * rest. Ported from the legacy LectureEdit.handleSave so the unified editor
 * shares one save path. Throws on failure.
 */
export async function saveExistingLecture(
  lectureId: string,
  { title, description, slides, pdfFile, existingPdfUrl }: SaveExistingLectureInput,
): Promise<void> {
  let finalPdfUrl = existingPdfUrl ?? null;

  if (pdfFile) {
    const filePath = `lectures/${lectureId}/${pdfFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from('lecture-pdfs')
      .upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;
    // Store only the storage path — the bucket is private; signed URLs are
    // generated on demand.
    finalPdfUrl = filePath;
  }

  const { error: lErr } = await supabase
    .from('lectures')
    .update({ title, description, total_slides: slides.length, pdf_url: finalPdfUrl })
    .eq('id', lectureId);
  if (lErr) throw lErr;

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.id) {
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

      for (const q of s.questions) {
        if (!q.question.trim()) continue;
        if (q.id) {
          await updateQuizQuestion(q.id, {
            question_text: q.question,
            options: q.options,
            correct_answer: q.correctAnswer,
          });
        } else {
          await insertQuizQuestion({
            slide_id: s.id,
            question_text: q.question,
            options: q.options,
            correct_answer: q.correctAnswer,
          });
        }
      }
    } else {
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
          await insertQuizQuestion({
            slide_id: newSlide.id,
            question_text: q.question,
            options: q.options,
            correct_answer: q.correctAnswer,
          });
        }
      }
    }
  }
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
    .maybeSingle();
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
