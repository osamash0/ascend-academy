import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAiModel } from '@/hooks/use-ai-model';
import type { SlideData, DeckQuizItem } from '@/types/lectureUpload';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB
const UPLOAD_TIMEOUT_MS = 10 * 60_000; // 10 minutes — LLM batch analysis can be slow

interface UsePDFUploadOptions {
  setSlides: (slides: SlideData[]) => void;
  setActiveSlideIndex: (idx: number) => void;
  title: string;
  setTitle: (t: string) => void;
}

export function usePDFUpload({ setSlides, setActiveSlideIndex, title, setTitle }: UsePDFUploadOptions) {
  const { toast } = useToast();
  const { aiModel } = useAiModel();

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [processedSlides, setProcessedSlides] = useState<SlideData[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfHash, setPdfHash] = useState<string | null>(null);
  const [parserUsed, setParserUsed] = useState<string | null>(null);
  const [deckQuiz, setDeckQuiz] = useState<DeckQuizItem[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.type !== 'application/pdf') {
        toast({ title: 'Invalid file type', description: 'Please upload a PDF file.', variant: 'destructive' });
        return;
      }

      if (file.size > MAX_PDF_BYTES) {
        toast({ title: 'File too large', description: 'PDF must be under 50 MB.', variant: 'destructive' });
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);
      setUploadTotal(0);
      setUploadStatus('Uploading PDF...');
      setProcessedSlides([]);
      setParserUsed(null);
      setPdfHash(null);
      setDeckQuiz([]);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('ai_model', aiModel);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(`${API_BASE}/api/upload/parse-pdf-stream`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) throw new Error('Failed to start PDF parsing');
        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.replace('data: ', ''));

            if (data.type === 'info') {
              setParserUsed(data.parser);
            } else if (data.type === 'meta') {
              if (data.pdf_hash) setPdfHash(data.pdf_hash);
            } else if (data.type === 'progress') {
              const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
              setUploadProgress(pct);
              if (data.total > 0) setUploadTotal(data.total);
              setUploadStatus(data.message);
            } else if (data.type === 'slide') {
              setProcessedSlides(prev => {
                const updated = [...prev];
                // Pull through the new concept-testing fields
                // (explanation/concept/cognitive_level) so the professor can
                // review them before saving and so they survive the save
                // round-trip into quiz_questions.metadata.
                const rawQs = Array.isArray(data.slide.questions) ? data.slide.questions : [];
                const questions = rawQs.length > 0
                  ? rawQs.map((q: Record<string, unknown>) => ({
                      question: typeof q.question === 'string' ? q.question : '',
                      options: Array.isArray(q.options) ? (q.options as string[]) : ['', '', '', ''],
                      correctAnswer: typeof q.correctAnswer === 'number'
                        ? q.correctAnswer
                        : typeof q.answer === 'string' && q.answer.length === 1
                          ? Math.max(0, q.answer.toUpperCase().charCodeAt(0) - 65)
                          : 0,
                      explanation: typeof q.explanation === 'string' ? q.explanation : undefined,
                      concept: typeof q.concept === 'string' ? q.concept : undefined,
                      cognitive_level:
                        q.cognitive_level === 'recall' ||
                        q.cognitive_level === 'apply' ||
                        q.cognitive_level === 'analyse'
                          ? q.cognitive_level
                          : undefined,
                    }))
                  : [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }];
                updated[data.index] = {
                  title: data.slide.title,
                  content: data.slide.content,
                  summary: data.slide.summary || '',
                  questions,
                };
                return updated;
              });
              setUploadStatus(`Processed ${data.index + 1} slide(s)...`);
            } else if (data.type === 'deck_complete') {
              // Capture cross-slide deck quiz items so the submit hook can
              // persist them alongside per-slide questions.
              const rawDeck = Array.isArray(data.deck_quiz) ? data.deck_quiz : [];
              const items: DeckQuizItem[] = rawDeck
                .map((q: Record<string, unknown>) => {
                  const linked = Array.isArray(q.linked_slides)
                    ? (q.linked_slides as unknown[]).filter(
                        (n): n is number => typeof n === 'number' && Number.isFinite(n),
                      )
                    : [];
                  if (linked.length < 2) return null;
                  const correctAnswer =
                    typeof q.correctAnswer === 'number'
                      ? q.correctAnswer
                      : typeof q.answer === 'string' && q.answer.length === 1
                        ? Math.max(0, q.answer.toUpperCase().charCodeAt(0) - 65)
                        : 0;
                  return {
                    question: typeof q.question === 'string' ? q.question : '',
                    options: Array.isArray(q.options) ? (q.options as string[]) : ['', '', '', ''],
                    correctAnswer,
                    explanation: typeof q.explanation === 'string' ? q.explanation : undefined,
                    concept: typeof q.concept === 'string' ? q.concept : undefined,
                    linked_slides: linked,
                  } satisfies DeckQuizItem;
                })
                .filter((q: DeckQuizItem | null): q is DeckQuizItem => q !== null && q.question.trim().length > 0);
              setDeckQuiz(items);
            } else if (data.type === 'complete') {
              setProcessedSlides(prev => {
                const finalSlides = prev.filter(Boolean) as SlideData[];
                setSlides(finalSlides);
                setActiveSlideIndex(0);
                if (!title) setTitle(file.name.replace('.pdf', ''));
                setPdfFile(file);
                toast({
                  title: 'PDF Imported Successfully',
                  description: `${finalSlides.length} slides extracted and structured.`,
                });
                return prev;
              });
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
           console.info("PDF upload aborted by user");
           return;
        }
        const message = err instanceof Error ? err.message : 'Could not parse the PDF.';
        toast({ title: 'Upload Failed', description: message, variant: 'destructive' });
      } finally {
        clearTimeout(timeoutId);
        abortControllerRef.current = null;
        e.target.value = '';
      }
    },
    [aiModel, setSlides, setActiveSlideIndex, title, setTitle, toast]
  );

  const closeUploadOverlay = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsUploading(false);
    setUploadProgress(0);
    setUploadStatus('');
    setProcessedSlides([]);
    setParserUsed(null);
    setDeckQuiz([]);
  }, []);

  return {
    isUploading,
    setIsUploading,
    uploadProgress,
    uploadTotal,
    uploadStatus,
    processedSlides,
    pdfFile,
    pdfHash,
    parserUsed,
    deckQuiz,
    handleFileUpload,
    closeUploadOverlay,
  };
}
