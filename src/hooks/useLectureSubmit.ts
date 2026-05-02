import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { insertQuizQuestion } from '@/services/lectureService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';
import type { SlideData } from '@/types/lectureUpload';

interface UseLectureSubmitOptions {
  slides: SlideData[];
  title: string;
  description: string;
  pdfFile: File | null;
  pdfHash?: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function useLectureSubmit({ slides, title, description, pdfFile, pdfHash }: UseLectureSubmitOptions) {
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

          for (const q of slideData.questions) {
            if (q.question.trim()) {
              await insertQuizQuestion({
                slide_id: slide.id,
                question_text: q.question,
                options: q.options.filter((o: string) => o.trim()),
                correct_answer: q.correctAnswer,
              });
            }
          }
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
    [slides, title, description, pdfFile, pdfHash, user, navigate, toast]
  );

  return { loading, handleSubmit };
}
