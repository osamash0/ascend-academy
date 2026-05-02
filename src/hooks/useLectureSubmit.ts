import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { insertQuizQuestion } from '@/services/lectureService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';
import type { SlideData, DeckQuizItem } from '@/types/lectureUpload';

interface UseLectureSubmitOptions {
  slides: SlideData[];
  title: string;
  description: string;
  pdfFile: File | null;
  pdfHash?: string | null;
  /**
   * Cross-slide quiz items captured from the upload SSE ``deck_complete``
   * event. Each item is anchored to its first ``linked_slides`` index when
   * persisted; the full list is stored in ``quiz_questions.metadata.linked_slides``
   * so the player can render slide-jump chips.
   */
  deckQuiz?: DeckQuizItem[];
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function useLectureSubmit({ slides, title, description, pdfFile, pdfHash, deckQuiz }: UseLectureSubmitOptions) {
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

      setLoading(true);

      try {
        let pdfUrl: string | null = null;
        const lectureId = crypto.randomUUID();

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

        const { data: lecture, error: lectureError } = await supabase
          .from('lectures')
          .insert({
            id: lectureId,
            title,
            description,
            professor_id: user?.id,
            total_slides: slides.length,
            pdf_url: pdfUrl,
          })
          .select()
          .single();

        if (lectureError) throw lectureError;

        // Backfill lecture_id on the embeddings written during PDF parsing
        // so the AI tutor can scope retrieval by lecture.  Best-effort:
        // a failure here must not block lecture creation.
        if (pdfHash) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            await fetch(`${API_BASE}/api/upload/attach-lecture`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session?.access_token}`,
              },
              body: JSON.stringify({ pdf_hash: pdfHash, lecture_id: lecture.id }),
            });
          } catch (e) {
            console.warn('Failed to attach lecture to embeddings (non-fatal):', e);
          }
        }

        // Map slide index → inserted slide UUID so we can anchor cross-slide
        // deck quiz items to a real slide_id once all slides exist.
        const slideIdByIndex: string[] = new Array(slides.length);

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
          const { data: { session } } = await supabase.auth.getSession();
          fetch(`${API_BASE}/api/concepts/ingest/${lecture.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session?.access_token}` },
          }).catch(() => { /* swallow */ });
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
    [slides, title, description, pdfFile, pdfHash, deckQuiz, user, navigate, toast]
  );

  return { loading, handleSubmit };
}
