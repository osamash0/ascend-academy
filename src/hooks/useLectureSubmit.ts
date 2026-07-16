import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { insertQuizQuestion, saveExistingLecture } from '@/services/lectureService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';
import { safeGetUUID } from '@/lib/utils';
import { apiClient } from '@/lib/apiClient';
import type { SlideData, DeckQuizItem } from '@/types/lectureUpload';

interface UseLectureSubmitOptions {
  slides: SlideData[];
  title: string;
  description: string;
  pdfFile: File | null;
  pdfHash?: string | null;
  /** Optional course to assign the new lecture to (null/undefined = Uncategorized). */
  courseId?: string | null;
  /**
   * Cross-slide quiz items captured from the upload SSE ``deck_complete``
   * event. Each item is anchored to its first ``linked_slides`` index when
   * persisted; the full list is stored in ``quiz_questions.metadata.linked_slides``
   * so the player can render slide-jump chips.
   */
  deckQuiz?: DeckQuizItem[];
  /**
   * Which extractor produced these slides. When 'on_demand', persisted
   * slides are stamped with ``ai_enhanced=false`` and ``parser_engine``
   * so the editor knows which slides still need an LLM pass (Task #58).
   * Defaults to 'ai' for backward compatibility.
   */
  parsingMode?: 'ai' | 'on_demand';
  /**
   * When set, the unified server pipeline (PARSER_VERSION=5) already created
   * the lecture + slides + quizzes + embeddings during parsing. Save then only
   * applies the professor's metadata edits (title/description/course) to that
   * existing lecture instead of inserting everything client-side.
   */
  serverLectureId?: string | null;
  /**
   * When set, we are editing an EXISTING lecture whose slides were loaded from
   * the database (so each {@link SlideData} carries its row `id`). Save then
   * runs a full upsert via {@link saveExistingLecture} — updating rows with an
   * id, inserting the rest — instead of creating a new lecture. Distinct from
   * ``serverLectureId`` (post-upload metadata-only save on freshly-parsed,
   * id-less client slides, where an upsert would duplicate the server's rows).
   */
  editLectureId?: string | null;
  /** Current stored pdf_url for the edited lecture (kept unless replaced). */
  existingPdfUrl?: string | null;
}



export function useLectureSubmit({ slides, title, description, pdfFile, pdfHash, courseId, deckQuiz, parsingMode = 'ai', serverLectureId, editLectureId, existingPdfUrl }: UseLectureSubmitOptions) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async () => {
      if (!title.trim()) {
        toast({ title: 'Error', description: 'Please enter a lecture title.', variant: 'destructive' });
        return;
      }

      if (slides.length === 0) {
        toast({ title: 'Error', description: 'Add at least one slide.', variant: 'destructive' });
        return;
      }

      // Editing an existing lecture loaded from the DB: full slide/question
      // upsert (rows with an id are updated, the rest inserted). Course
      // assignment is written directly by the editor's Lecture tab, so it is
      // not re-applied here.
      if (editLectureId) {
        setLoading(true);
        try {
          await saveExistingLecture(editLectureId, { title, description, slides, pdfFile, existingPdfUrl });
          try {
            apiClient.post(`/api/v1/concepts/ingest/${editLectureId}`, {}).catch(() => { /* swallow */ });
          } catch (e) {
            console.warn('Failed to schedule concept ingestion (non-fatal):', e);
          }
          toast({ title: 'Saved!', description: 'Lecture updated successfully.' });
          navigate('/professor/dashboard');
        } catch (error) {
          console.error('Error saving lecture:', error);
          toast({ title: 'Error', description: 'Failed to save lecture. Please try again.', variant: 'destructive' });
        } finally {
          setLoading(false);
        }
        return;
      }

      // Unified pipeline (PARSER_VERSION=5): the server already persisted the
      // lecture, slides, quizzes and embeddings during parsing. Save only
      // applies the professor's metadata edits to that existing lecture
      // (slide-level edits are made afterwards in the lecture editor).
      if (serverLectureId) {
        setLoading(true);
        try {
          const isStudent = user?.app_metadata?.role === 'student';
          const updatePayload: any = { title, description, course_id: courseId ?? null };
          
          if (courseId) {
            updatePayload.visibility = 'course';
            updatePayload.professor_id = user?.id;
            updatePayload.student_owner_id = null;
          } else if (isStudent) {
            updatePayload.visibility = 'private_student';
            updatePayload.professor_id = null;
            updatePayload.student_owner_id = user?.id;
          } else {
            updatePayload.visibility = 'course';
            updatePayload.professor_id = user?.id;
            updatePayload.student_owner_id = null;
          }

          const { error } = await supabase
            .from('lectures')
            .update(updatePayload)
            .eq('id', serverLectureId);
          if (error) throw error;
          try {
            apiClient.post(`/api/v1/concepts/ingest/${serverLectureId}`, {}).catch(() => { /* swallow */ });
          } catch (e) {
            console.warn('Failed to schedule concept ingestion (non-fatal):', e);
          }
          toast({ title: 'Success!', description: 'Lecture created successfully.' });
          navigate('/professor/dashboard');
        } catch (error) {
          console.error('Error saving lecture:', error);
          toast({ title: 'Error', description: 'Failed to save lecture. Please try again.', variant: 'destructive' });
        } finally {
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        let pdfUrl: string | null = null;
        const lectureId = safeGetUUID();

        if (pdfFile) {
          const filePath = `lectures/${lectureId}/${pdfFile.name}`;
          const { error: uploadError } = await supabase.storage
            .from('lecture-pdfs')
            .upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: true });

          if (uploadError) {
            toast({
              title: 'PDF Upload Failed',
              description: 'Could not upload PDF to storage. Please check Supabase Storage RLS policies.',
              variant: 'destructive',
            });
            throw uploadError;
          }
          // Store only the storage path (not a public URL) — the bucket is private.
          // Authenticated signed URLs are generated on demand when the PDF must be accessed.
          pdfUrl = filePath;
        }

        const isStudent = user?.app_metadata?.role === 'student';
        const insertPayload: any = {
          id: lectureId,
          title,
          description,
          total_slides: slides.length,
          pdf_url: pdfUrl,
          course_id: courseId ?? null,
        };

        if (courseId) {
          insertPayload.visibility = 'course';
          insertPayload.professor_id = user?.id;
          insertPayload.student_owner_id = null;
        } else if (isStudent) {
          insertPayload.visibility = 'private_student';
          insertPayload.professor_id = null;
          insertPayload.student_owner_id = user?.id;
        } else {
          insertPayload.visibility = 'course';
          insertPayload.professor_id = user?.id;
          insertPayload.student_owner_id = null;
        }

        const { data: lecture, error: lectureError } = await supabase
          .from('lectures')
          .insert(insertPayload)
          .select()
          .single();

        if (lectureError) throw lectureError;

        // Backfill lecture_id on the embeddings written during PDF parsing
        // so the AI tutor can scope retrieval by lecture.  Best-effort:
        // a failure here must not block lecture creation.
        if (pdfHash) {
          try {
            await apiClient.post('/api/v1/upload/attach-lecture', { pdf_hash: pdfHash, lecture_id: lecture.id });
          } catch (e) {
            console.warn('Failed to attach lecture to embeddings (non-fatal):', e);
          }
        }

        // Map slide index → inserted slide UUID so we can anchor cross-slide
        // deck quiz items to a real slide_id once all slides exist.
        const slideIdByIndex: string[] = new Array(slides.length);

        for (let i = 0; i < slides.length; i++) {
          const slideData = slides[i];
          const slideInsert: Record<string, unknown> = {
            lecture_id: lecture.id,
            slide_number: i + 1,
            title: slideData.title || `Slide ${i + 1}`,
            content_text: slideData.content,
            summary: slideData.summary,
          };
          if (parsingMode === 'on_demand') {
            // Stamp these so the editor can surface "AI not yet run"
            // affordances (Task #58). Insert raw — the new columns
            // exist via migration 20260503000019_slides_ai_enhanced.sql
            // even if generated supabase types are regenerated lazily.
            slideInsert.ai_enhanced = false;
            slideInsert.parser_engine = 'heuristic-v1';
          }
          const { data: slide, error: slideError } = await supabase
            .from('slides')
            // Cast here because the generated types are regenerated out of
            // band; the new columns exist in the migration above.
            .insert(slideInsert as never)
            .select()
            .single();

          if (slideError) throw slideError;
          slideIdByIndex[i] = slide.id;

          for (const q of slideData.questions) {
            if (q.question.trim()) {
              await insertQuizQuestion({
                slide_id: slide.id,
                question_text: q.question,
                options: q.options.filter((o: string) => o.trim()),
                correct_answer: q.correctAnswer,
                metadata: {
                  explanation: q.explanation,
                  concept: q.concept,
                  cognitive_level: q.cognitive_level,
                },
              });
            }
          }
        }

        // Persist cross-slide deck quiz items. Anchor each row to the first
        // valid linked slide; the full ``linked_slides`` list lives in
        // metadata so the player renders chips for all of them.
        if (deckQuiz && deckQuiz.length > 0) {
          for (const dq of deckQuiz) {
            const validLinks = dq.linked_slides.filter(
              (idx) => Number.isInteger(idx) && idx >= 0 && idx < slideIdByIndex.length,
            );
            if (validLinks.length < 2) continue;
            const anchorSlideId = slideIdByIndex[validLinks[0]];
            if (!anchorSlideId) continue;
            await insertQuizQuestion({
              slide_id: anchorSlideId,
              question_text: dq.question,
              options: dq.options.filter((o: string) => o.trim()),
              correct_answer: dq.correctAnswer,
              metadata: {
                explanation: dq.explanation,
                concept: dq.concept,
                linked_slides: validLinks,
              },
            });
          }
        }

        // Fire-and-forget: hand the new lecture to the concept-graph
        // ingestion service so it shows up in cross-course mastery
        // queries.  Failure here must not block lecture creation.
        try {
          apiClient.post(`/api/v1/concepts/ingest/${lecture.id}`, {}).catch(() => { /* swallow */ });
        } catch (e) {
          console.warn('Failed to schedule concept ingestion (non-fatal):', e);
        }

        toast({ title: 'Success!', description: 'Lecture created successfully.' });
        navigate('/professor/dashboard');
      } catch (error) {
        console.error('Error creating lecture:', error);
        toast({ title: 'Error', description: 'Failed to create lecture. Please try again.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    },
    [slides, title, description, pdfFile, pdfHash, courseId, deckQuiz, parsingMode, serverLectureId, editLectureId, existingPdfUrl, user, navigate, toast]
  );

  return { loading, handleSubmit };
}
