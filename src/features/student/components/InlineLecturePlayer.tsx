/**
 * InlineLecturePlayer — the lecture experience rendered *inside* the library,
 * directly on the console background rather than as a separate full-screen page.
 *
 * Design intent (see the library mockup): it should feel like part of the
 * backdrop — translucent surfaces, no opaque "glass card" chrome — with the AI
 * slide narrative rendered as rich ChatGPT-style markdown and the existing
 * QuizCard ("Neural Evaluation") reused for assessment.
 *
 * The heavy slide-state machine is reused from useSlideProgress; only the quiz
 * / XP glue is kept here (a leaner version of the full LectureView route, which
 * still owns review/recap/achievements and is reachable via "open full page").
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  X,
  Maximize2,
  ExternalLink,
  Zap,
  Trophy,
  Volume2,
  Pause,
  Play,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  SkipForward,
  Sparkles,
  Plus,
  Send,
  ArrowLeft,
  User,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchLecture,
  fetchSlides,
  fetchQuizQuestions,
  resolvePdfUrl,
} from '@/services/lectureService';
import {
  fetchLectureProgress,
  upsertLectureProgress,
  logLearningEvent,
} from '@/services/studentService';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import { useSlideProgress } from '@/features/student/hooks/useSlideProgress';
import { statesFromLegacyCompleted } from '@/lib/slideProgress';
import { QuizCard } from '@/components/QuizCard';
import { useAiModel } from '@/hooks/use-ai-model';
import { useTTS } from '@/hooks/useTTS';
import { useToast } from '@/hooks/use-toast';
import { topicIcon } from '@/lib/topicIcon';
import { cn, splitLectureTitle, safeGetUUID } from '@/lib/utils';
import { gradientFor } from '@/components/console';
import type { Slide, QuizQuestion, Lecture, SlideState } from '@/types/domain';
import 'katex/dist/katex.min.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
import { useCurriculumTranslation } from '@/hooks/useCurriculumTranslation';

interface InlineLecturePlayerProps {
  lectureId: string;
  /** Course title for the breadcrumb (the library already knows it). */
  courseTitle?: string;
  /** Close the inline player (return to browsing the rails). */
  onClose: () => void;
  /** Open the same lecture as the standalone full-screen /lecture route. */
  onExpand?: () => void;
  /** Fires with the active slide index so the host can react (e.g. wallpaper). */
  onSlideChange?: (index: number) => void;
}

/**
 * Markdown class string shared by the slide narrative and the chat answers.
 * Tuned to read like a polished ChatGPT / Gemini reply: clear section spacing,
 * comfortable line-height, real tables, styled lists / quotes / code / rules.
 */
const PROSE_CLASS = [
  'prose prose-invert max-w-none',
  // tighten the very top so the panel doesn't start with a big gap
  '[&>*:first-child]:mt-0',
  // headings — distinct hierarchy with generous space above for section breaks
  'prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-foreground',
  'prose-h1:text-[22px] prose-h1:mt-8 prose-h1:mb-3',
  'prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3',
  'prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2',
  // body copy — roomy line-height like the chat assistants
  'prose-p:text-[15px] prose-p:leading-7 prose-p:my-3 prose-p:text-foreground/85',
  'prose-strong:text-foreground prose-strong:font-semibold',
  'prose-em:text-foreground/80',
  'prose-a:text-primary prose-a:underline-offset-2 hover:prose-a:text-primary/80',
  // lists — clear markers + breathing room, nested-friendly
  'prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 prose-li:text-[15px] prose-li:text-foreground/85',
  'prose-ul:pl-1 prose-li:marker:text-primary/70 prose-ol:marker:text-primary/70 prose-li:marker:font-semibold',
  // inline + block code
  'prose-code:text-accent prose-code:bg-accent/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-medium prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-pre:text-[13px]',
  // blockquotes → callout style
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/50 prose-blockquote:bg-white/[0.03] prose-blockquote:rounded-r-lg prose-blockquote:px-4 prose-blockquote:py-0.5 prose-blockquote:not-italic prose-blockquote:text-foreground/75',
  // dividers between sections
  'prose-hr:border-white/10 prose-hr:my-6',
  // tables — bordered, readable header row
  'prose-table:my-4 prose-table:text-[13px] prose-table:overflow-hidden prose-table:rounded-xl',
  'prose-thead:border-white/10 prose-th:bg-white/[0.06] prose-th:text-foreground prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-white/10 prose-th:text-left',
  'prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-white/10 prose-td:text-foreground/80',
  'prose-img:rounded-xl prose-img:border prose-img:border-white/10',
].join(' ');

export function InlineLecturePlayer({
  lectureId,
  courseTitle,
  onClose,
  onExpand,
  onSlideChange,
}: InlineLecturePlayerProps) {
  const { user, profile, session, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['lecture', 'common']);
  const translateCurriculum = useCurriculumTranslation();
  const { toast } = useToast();
  const { aiModel } = useAiModel();
  const { speak, stop, isSpeaking, isPaused, isLoading: ttsLoading } = useTTS();
  const gamification = useGamification();

  // In-session consecutive-correct counter for the "On Fire" / "Unstoppable" badges.
  const correctStreakRef = useRef(0);

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showQuiz, setShowQuiz] = useState(false);
  // Direction of the last slide move (1 = forward/right, -1 = back/left) so the
  // content + slide image can slide in/out horizontally instead of flashing.
  const [dir, setDir] = useState<1 | -1>(1);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [xpEarned, setXpEarned] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [completed, setCompleted] = useState(false);

  // ── AI chat (input lives under the PDF; conversation renders in the right view) ──
  type ChatMessage = { id: string; role: 'user' | 'model'; content: string };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [chatActive, setChatActive] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  const answeredRef = useRef<Set<string>>(new Set());
  const xpRef = useRef(0);
  const correctRef = useRef(0);
  const sessionIdRef = useRef<string>(safeGetUUID());
  // Restore payload kept in STATE (not a ref): the slides arrive via setSlides
  // before fetchLectureProgress resolves, so a ref would be applied by the
  // [slides] effect while still null and never re-run. State re-triggers it.
  const [pendingInit, setPendingInit] = useState<{ states: Record<string, SlideState>; index: number } | null>(null);

  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [pdfWidth, setPdfWidth] = useState(0);
  const [pdfHeight, setPdfHeight] = useState(0);

  // Horizontal syllabus rail scrolling.
  const railRef = useRef<HTMLDivElement>(null);
  const [railEdges, setRailEdges] = useState({ left: false, right: false });
  // rAF-eased scroll target (for clicks) + press-and-hold + click-streak state.
  const railAnimRef = useRef<{ raf?: number; target?: number }>({});
  const holdRef = useRef<{ timer?: ReturnType<typeof setTimeout>; raf?: number; dir: 1 | -1; held: boolean }>({ dir: 1, held: false });
  const clickStreakRef = useRef<{ t: number; n: number }>({ t: 0, n: 0 });

  // ── Slide-state machine (reused, the tricky part) ──────────────────────────
  const {
    currentIndex,
    goToSlide,
    slideStates,
    completionPct,
    validateSlide,
    initialize: initSlideProgress,
    markLectureComplete,
    flushSave: flushSlideProgress,
  } = useSlideProgress({ lectureId, slides, userId: user?.id });

  // Apply restored progress once BOTH the slides and the restore payload are
  // ready — order-independent, so the resume position is never dropped.
  useEffect(() => {
    if (slides.length > 0 && pendingInit) {
      initSlideProgress(pendingInit.states, pendingInit.index);
      setPendingInit(null);
    }
  }, [slides, pendingInit, initSlideProgress]);

  // ── Data fetch (re-runs when the opened lecture changes) ───────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setShowQuiz(false);
      setQuizAnswers({});
      setXpEarned(0);
      setCorrectAnswers(0);
      setCompleted(false);
      setMessages([]);
      setChatActive(false);
      setStreaming('');
      setPdfError(false);
      answeredRef.current = new Set();
      xpRef.current = 0;
      correctRef.current = 0;
      setPendingInit(null);

      try {
        const lec = await fetchLecture(lectureId);
        if (cancelled) return;
        if (!lec) {
          toast({ title: 'Lecture not found', variant: 'destructive' });
          onClose();
          return;
        }
        setLecture(lec);
        resolvePdfUrl(lec.pdf_url).then((u) => !cancelled && setPdfUrl(u)).catch(() => setPdfUrl(null));

        const [slidesData, questionsData] = await Promise.all([
          fetchSlides(lectureId),
          fetchQuizQuestions(lectureId),
        ]);
        if (cancelled) return;

        setSlides(slidesData);
        setQuestions(
          questionsData.map((q) => ({
            ...q,
            options: Array.isArray(q.options) ? (q.options as string[]) : [],
          })),
        );

        if (user?.id) {
          const progress = await fetchLectureProgress(user.id, lectureId);
          if (cancelled) return;
          if (progress) {
            const maxSlides = slidesData.length || 1;
            const rawLast = progress.last_slide_viewed;
            const lastIndex =
              rawLast !== null && rawLast !== undefined && rawLast >= 0
                ? Math.min(rawLast, maxSlides - 1)
                : 0;
            const totalQ = questionsData.length || slidesData.length;
            if (progress.xp_earned) {
              const xp = Math.min(progress.xp_earned, totalQ * 10);
              setXpEarned(xp);
              xpRef.current = xp;
            }
            if (progress.correct_answers) {
              const c = Math.min(progress.correct_answers, totalQ);
              setCorrectAnswers(c);
              correctRef.current = c;
            }
            if (Array.isArray(progress.completed_slides)) {
              const restored: Record<number, number> = {};
              progress.completed_slides.forEach((slideNum: number) => {
                const slideIndex = slideNum - 1;
                restored[slideIndex] = -1;
                const slideId = slidesData[slideIndex]?.id;
                const qId = questionsData.find((q) => q.slide_id === slideId)?.id;
                if (qId) answeredRef.current.add(qId);
              });
              setQuizAnswers(restored);
            }
            const savedStates =
              progress.slide_states && Object.keys(progress.slide_states).length > 0
                ? (progress.slide_states as Record<string, SlideState>)
                : statesFromLegacyCompleted(progress.completed_slides ?? [], lastIndex, slidesData);
            setPendingInit({ states: savedStates, index: lastIndex });
          }

          logLearningEvent(user.id, 'lecture_start', {
            lectureId,
            sessionId: sessionIdRef.current,
          }).catch(() => {});
        }
      } catch (err) {
        console.error('InlineLecturePlayer load failed', err);
        if (!cancelled) toast({ title: 'Could not load lecture', variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId, user?.id]);

  // ── PDF width observer ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfContainerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setPdfWidth(e.contentRect.width);
        setPdfHeight(e.contentRect.height);
      }
    });
    obs.observe(pdfContainerRef.current);
    return () => obs.disconnect();
  }, [loading]);

  const currentSlide = slides[currentIndex];
  const narrative = currentSlide?.summary || currentSlide?.content_text || '';

  // Cross-slide deck questions first, mirroring the full route.
  const currentQuestion = useMemo(() => {
    return questions
      .filter((q) => q.slide_id === currentSlide?.id)
      .slice()
      .sort((a, b) => {
        const aCross = (a.linked_slides?.length ?? 0) >= 2 ? 0 : 1;
        const bCross = (b.linked_slides?.length ?? 0) >= 2 ? 0 : 1;
        return aCross - bCross;
      })[0];
  }, [questions, currentSlide?.id]);

  const totalForScore = questions.length || slides.length;

  // ── Quiz handling ──────────────────────────────────────────────────────────
  const handleAnswer = useCallback(
    async (isCorrect: boolean, selectedIndex: number) => {
      if (!currentQuestion || answeredRef.current.has(currentQuestion.id)) return;
      answeredRef.current.add(currentQuestion.id);
      setQuizAnswers((prev) => ({ ...prev, [currentIndex]: selectedIndex }));

      if (user) {
        logLearningEvent(user.id, 'quiz_attempt', {
          lectureId,
          slideId: currentSlide?.id,
          slideTitle: currentSlide?.title,
          questionId: currentQuestion.id,
          correct: isCorrect,
          selectedAnswer: selectedIndex,
          sessionId: sessionIdRef.current,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }

      if (isCorrect) {
        const newXp = xpRef.current + 10;
        const newCorrect = Math.min(correctRef.current + 1, totalForScore);
        xpRef.current = newXp;
        correctRef.current = newCorrect;
        setXpEarned(newXp);
        setCorrectAnswers(newCorrect);
        if (user) {
          // Optimistically update progress in the UI cache
          queryClient.setQueryData(['student-progress', user.id], (old: any) => {
            if (!old) return old;
            return old.map((p: any) => {
              if (p.lecture_id === lectureId) {
                return {
                  ...p,
                  xp_earned: Math.min(newXp, totalForScore * 10),
                  correct_answers: Math.min(newCorrect, totalForScore),
                  // answeredRef doesn't update until after this render cycle, but we can assume +1
                  total_questions_answered: answeredRef.current.size + 1,
                };
              }
              return p;
            });
          });
        }

        queryClient.invalidateQueries({ queryKey: ['student-progress', user?.id] });

        // XP, level-ups and count-based badges are handled by the gamification
        // engine. The day-streak stays owned by record_daily_activity().
        await gamification.grantXp(10, 'quiz_correct');

        // In-session correct-answer streak → "On Fire" (5) / "Unstoppable" (10).
        correctStreakRef.current += 1;
        if (correctStreakRef.current === 5) await gamification.awardBadge('On Fire');
        else if (correctStreakRef.current === 10) await gamification.awardBadge('Unstoppable');
      } else {
        correctStreakRef.current = 0;
      }

      if (user && lecture) {
        await upsertLectureProgress(user.id, lecture.id, {
          xp_earned: Math.min(xpRef.current, totalForScore * 10),
          correct_answers: Math.min(correctRef.current, totalForScore),
          total_questions_answered: answeredRef.current.size,
        });
        // Progress persisted → sweep count-based badges (Quiz Master, Sharpshooter).
        if (isCorrect) gamification.evaluate();
      }
      await flushSlideProgress();
    },
    [currentQuestion, currentIndex, currentSlide, user, lecture, lectureId, totalForScore, refreshProfile, flushSlideProgress],
  );

  const finishLecture = useCallback(async () => {
    markLectureComplete();
    setCompleted(true);
    setShowQuiz(false);
    if (user && lecture) {
      await upsertLectureProgress(user.id, lecture.id, {
        xp_earned: Math.min(xpRef.current, totalForScore * 10),
        completed_slides: slides.map((_, i) => i + 1),
        quiz_score: slides.length > 0 ? Math.round((correctRef.current / slides.length) * 100) : 0,
        correct_answers: Math.min(correctRef.current, totalForScore),
        completed_at: new Date().toISOString(),
      });
      logLearningEvent(user.id, 'lecture_complete', {
        lectureId: lecture.id,
        xpEarned: xpRef.current,
        correctAnswers: correctRef.current,
        sessionId: sessionIdRef.current,
        completed_at: new Date().toISOString(),
      }).catch(() => {});

      queryClient.invalidateQueries({ queryKey: ['student-progress', user.id] });

      // Completion bonus (once per lecture) + "First Quiz Completed" event badge;
      // threshold badges (First Steps, Bookworm, Perfect Score, Course Conqueror, …)
      // are swept server-side from the freshly-persisted progress.
      await gamification.grantXp(20, 'lecture_complete', `lecture:${lecture.id}`);
      await gamification.awardBadge('First Quiz Completed');
      gamification.evaluate();
    }
    toast({ title: 'Lecture complete! 🎉', description: `+${xpRef.current} XP` });
  }, [markLectureComplete, user, lecture, slides, totalForScore, toast]);

  const advance = useCallback(() => {
    if (currentIndex < slides.length - 1) {
      const next = currentIndex + 1;
      setDir(1);
      goToSlide(next);
      setShowQuiz(quizAnswers[next] !== undefined);
    } else {
      finishLecture();
    }
  }, [currentIndex, slides.length, goToSlide, quizAnswers, finishLecture]);

  const handleNext = useCallback(() => {
    if (!showQuiz && currentQuestion) {
      setShowQuiz(true);
      return;
    }
    advance();
  }, [showQuiz, currentQuestion, advance]);

  const handlePrev = useCallback(() => {
    if (showQuiz && quizAnswers[currentIndex] === undefined) {
      setShowQuiz(false);
      return;
    }
    if (currentIndex > 0) {
      const prev = currentIndex - 1;
      setDir(-1);
      goToSlide(prev);
      setShowQuiz(quizAnswers[prev] !== undefined);
    }
  }, [showQuiz, quizAnswers, currentIndex, goToSlide]);

  const selectSlide = useCallback(
    (index: number) => {
      setDir(index >= currentIndex ? 1 : -1);
      goToSlide(index);
      setShowQuiz(quizAnswers[index] !== undefined);
      setCompleted(false);
    },
    [goToSlide, quizAnswers, currentIndex],
  );

  // ── TTS ────────────────────────────────────────────────────────────────────
  const ttsText = useMemo(() => {
    if (!currentSlide) return '';
    return [
      currentSlide.title ? `${currentSlide.title}.` : '',
      currentSlide.summary ? `${currentSlide.summary}.` : '',
      currentSlide.content_text ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }, [currentSlide]);

  const handleListen = useCallback(() => {
    if (isSpeaking && !isPaused) stop();
    else speak(ttsText);
  }, [isSpeaking, isPaused, stop, speak, ttsText]);

  useEffect(() => {
    stop();
    onSlideChange?.(currentIndex);
    // Each slide is its own chat context — leaving a slide drops back to the
    // notes view and clears the prior conversation.
    chatAbortRef.current?.abort();
    setChatActive(false);
    setMessages([]);
    setStreaming('');
    setChatLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // Keep the conversation scrolled to the latest message.
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming, chatLoading]);

  useEffect(() => () => chatAbortRef.current?.abort(), []);

  // ── Syllabus rail: edge detection, arrow scrolling, auto-center ────────────
  const updateRailEdges = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setRailEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
    });
  }, []);

  // Width of one card incl. the gap, measured from a real card.
  const railStep = useCallback(() => {
    const el = railRef.current;
    const card = el?.querySelector<HTMLElement>('[data-card]');
    return (card?.offsetWidth ?? 220) + 12; // gap-3
  }, []);

  const clampScroll = useCallback((v: number) => {
    const el = railRef.current;
    if (!el) return v;
    return Math.max(0, Math.min(v, el.scrollWidth - el.clientWidth));
  }, []);

  // Ease scrollLeft toward railAnimRef.target each frame.
  const animateRail = useCallback(() => {
    const el = railRef.current;
    const a = railAnimRef.current;
    if (!el || a.target == null) return;
    const delta = a.target - el.scrollLeft;
    if (Math.abs(delta) < 1) {
      el.scrollLeft = a.target;
      a.target = undefined;
      a.raf = undefined;
      updateRailEdges();
      return;
    }
    el.scrollLeft += delta * 0.22;
    a.raf = requestAnimationFrame(animateRail);
  }, [updateRailEdges]);

  // A discrete click: one card, but rapid clicks accelerate (up to 5 cards).
  const railClick = useCallback(
    (dir: 1 | -1) => {
      const el = railRef.current;
      if (!el) return;
      const now = performance.now();
      const cs = clickStreakRef.current;
      cs.n = now - cs.t < 450 ? cs.n + 1 : 1;
      cs.t = now;
      const multiplier = Math.min(cs.n, 5);
      const a = railAnimRef.current;
      const base = a.target ?? el.scrollLeft;
      a.target = clampScroll(base + dir * railStep() * multiplier);
      if (!a.raf) a.raf = requestAnimationFrame(animateRail);
    },
    [railStep, clampScroll, animateRail],
  );

  // Press-and-hold: slow, continuous scroll until release.
  const railHoldStart = useCallback(
    (dir: 1 | -1) => {
      const el = railRef.current;
      if (!el) return;
      if (railAnimRef.current.raf) {
        cancelAnimationFrame(railAnimRef.current.raf);
        railAnimRef.current = {};
      }
      const tick = () => {
        const node = railRef.current;
        if (!node) return;
        node.scrollLeft = clampScroll(node.scrollLeft + dir * 3); // ~slow glide
        updateRailEdges();
        holdRef.current.raf = requestAnimationFrame(tick);
      };
      holdRef.current.raf = requestAnimationFrame(tick);
    },
    [clampScroll, updateRailEdges],
  );

  // Pointer down → arm hold; if released quickly it's a click, else it held.
  const railPress = useCallback(
    (dir: 1 | -1) => {
      const hs = holdRef.current;
      hs.dir = dir;
      hs.held = false;
      hs.timer = setTimeout(() => {
        hs.held = true;
        railHoldStart(dir);
      }, 220);
    },
    [railHoldStart],
  );

  const railRelease = useCallback(() => {
    const hs = holdRef.current;
    if (hs.timer) clearTimeout(hs.timer);
    if (hs.held) {
      if (hs.raf) cancelAnimationFrame(hs.raf);
      hs.held = false;
      updateRailEdges();
    } else {
      railClick(hs.dir);
    }
  }, [railClick, updateRailEdges]);

  const railCancel = useCallback(() => {
    const hs = holdRef.current;
    if (hs.timer) clearTimeout(hs.timer);
    if (hs.held && hs.raf) cancelAnimationFrame(hs.raf);
    hs.held = false;
  }, []);

  // Stop any in-flight animations / timers on unmount.
  useEffect(
    () => () => {
      if (railAnimRef.current.raf) cancelAnimationFrame(railAnimRef.current.raf);
      if (holdRef.current.raf) cancelAnimationFrame(holdRef.current.raf);
      if (holdRef.current.timer) clearTimeout(holdRef.current.timer);
    },
    [],
  );

  // Recompute reachable edges when the slide set changes.
  useEffect(() => {
    updateRailEdges();
  }, [slides, updateRailEdges]);

  // Keep the active slide card centered in the rail (no vertical page jump).
  useEffect(() => {
    const el = railRef.current;
    const active = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (el && active) {
      el.scrollTo({ left: active.offsetLeft - el.clientWidth / 2 + active.offsetWidth / 2, behavior: 'smooth' });
    }
  }, [currentIndex, slides.length]);

  // ── Ask the grounded tutor; conversation renders in the right view ─────────
  const handleAsk = useCallback(async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput('');
    setChatActive(true);
    setMessages((prev) => [...prev, { id: safeGetUUID(), role: 'user', content: q }]);
    setChatLoading(true);
    setStreaming('');

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const ctrl = new AbortController();
      chatAbortRef.current = ctrl;
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/v1/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          slide_text: currentSlide?.content_text || narrative,
          user_message: q,
          chat_history: history,
          ai_model: aiModel,
          lecture_id: lectureId,
          current_slide_index: currentIndex,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('Request failed');

      const ct = res.headers.get('content-type');
      if (ct?.includes('text/event-stream')) {
        const reader = res.body?.getReader();
        const dec = new TextDecoder();
        let full = '';
        if (!reader) throw new Error('No reader');
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of dec.decode(value, { stream: true }).split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') {
              setMessages((prev) => [...prev, { id: safeGetUUID(), role: 'model', content: full }]);
              setStreaming('');
            } else {
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  full += parsed.content;
                  setStreaming(full);
                }
              } catch {
                full += data;
                setStreaming(full);
              }
            }
          }
        }
      } else {
        const data = await res.json();
        setMessages((prev) => [...prev, { id: safeGetUUID(), role: 'model', content: data.reply ?? '' }]);
      }

      if (user) {
        logLearningEvent(user.id, 'ai_tutor_query', {
          lectureId,
          slideId: currentSlide?.id,
          slideTitle: currentSlide?.title,
          sessionId: sessionIdRef.current,
          query: q,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setMessages((prev) => [
          ...prev,
          { id: safeGetUUID(), role: 'model', content: 'Sorry — I couldn’t reach the tutor. Please try again.' },
        ]);
      }
    } finally {
      setChatLoading(false);
      setStreaming('');
      chatAbortRef.current = null;
    }
  }, [chatInput, chatLoading, messages, session, currentSlide, narrative, aiModel, lectureId, currentIndex, user]);

  const { badge } = splitLectureTitle(translateCurriculum(lecture?.title) ?? '');
  const hasPdf = pdfUrl && !pdfError;

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const ListenIcon = isSpeaking && !isPaused ? Pause : isPaused ? Play : Volume2;

  return (
    // `select-text` overrides the library shell's `select-none`, so students
    // can select & copy the lecture text (slide notes, quiz, etc.).
    <div className="relative w-full text-foreground select-text">
      {/* ── Header strip (blends into backdrop) ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="console-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            aria-label="Close lecture"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-primary/70">
              <span className="truncate max-w-[180px]">{translateCurriculum(courseTitle || lecture?.course?.title) || 'Course'}</span>
              <span className="opacity-40">/</span>
              <span className="truncate">{badge ? `Lecture ${badge}` : 'Lecture'}</span>
            </div>
            <h2 className="truncate text-lg font-black tracking-tight sm:text-xl">{translateCurriculum(lecture?.title)}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleListen}
            disabled={ttsLoading}
            className="console-focusable flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold transition-all hover:bg-white/10 disabled:opacity-50"
          >
            {ttsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListenIcon className="h-3.5 w-3.5" />}
            {isSpeaking && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Listen'}
          </button>
          <div className="flex items-center gap-2 rounded-full border border-xp/20 bg-xp/10 px-3 py-2">
            <Zap className="h-3.5 w-3.5 fill-xp text-xp" />
            <span className="text-xs font-bold text-xp">+{xpEarned} XP</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
            <Trophy className="h-3.5 w-3.5 text-success" />
            <span className="text-xs font-bold">
              {correctAnswers}/{totalForScore}
            </span>
          </div>
          {onExpand && (
            <button
              onClick={onExpand}
              className="console-focusable flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label="Open full page"
              title="Open full page"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Syllabus: thin meta row + horizontal slide rail ── */}
      <div className="pt-4">
        <div className="mb-2 flex items-center justify-between gap-4 px-0.5">
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Syllabus</p>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-success to-success/70"
                  animate={{ width: `${completionPct}%` }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className="text-[10px] font-bold text-muted-foreground">{completionPct}%</span>
            </div>
          </div>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Source PDF
            </a>
          )}
        </div>
        <div className="relative">
          {/* Left arrow + fade */}
          <AnimatePresence>
            {railEdges.left && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-16 items-center justify-start bg-gradient-to-r from-[#05060f] to-transparent"
              >
                <button
                  onPointerDown={() => railPress(-1)}
                  onPointerUp={railRelease}
                  onPointerLeave={railCancel}
                  onPointerCancel={railCancel}
                  className="console-focusable pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 text-foreground backdrop-blur-sm transition-colors hover:bg-black/80"
                  aria-label="Scroll syllabus left"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Right arrow + fade */}
          <AnimatePresence>
            {railEdges.right && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-16 items-center justify-end bg-gradient-to-l from-[#05060f] to-transparent"
              >
                <button
                  onPointerDown={() => railPress(1)}
                  onPointerUp={railRelease}
                  onPointerLeave={railCancel}
                  onPointerCancel={railCancel}
                  className="console-focusable pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 text-foreground backdrop-blur-sm transition-colors hover:bg-black/80"
                  aria-label="Scroll syllabus right"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            ref={railRef}
            onScroll={updateRailEdges}
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && railRef.current) {
                railRef.current.scrollLeft += e.deltaY;
              }
            }}
            className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {slides.map((s, i) => {
              const isCurrent = i === currentIndex;
            const state = slideStates[String(s.slide_number)];
            const isVisited = state === 'visited' && !isCurrent;
            const isSkipped = state === 'skipped' && !isCurrent;
            return (
              <button
                key={s.id}
                data-card
                data-active={isCurrent}
                onClick={() => {
                  selectSlide(i);
                  if (isSkipped) validateSlide(s.slide_number);
                }}
                className={cn(
                  'flex min-w-[230px] max-w-[230px] shrink-0 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left backdrop-blur-sm transition-all',
                  isCurrent
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                    isCurrent
                      ? 'bg-primary text-white shadow-glow-primary'
                      : isVisited
                        ? 'border border-success/30 bg-success/20 text-success'
                        : isSkipped
                          ? 'border border-dashed border-amber-400/50 bg-amber-400/10 text-amber-400'
                          : 'border border-white/10 bg-white/5 text-muted-foreground',
                  )}
                >
                  {isVisited ? <CheckCircle2 className="h-4 w-4" /> : isSkipped ? <SkipForward className="h-3.5 w-3.5" /> : s.slide_number}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate text-sm font-bold', isCurrent ? 'text-foreground' : 'text-muted-foreground')}>
                    {s.title || `Slide ${s.slide_number}`}
                  </span>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                    {isCurrent ? 'Current' : isVisited ? 'Done' : isSkipped ? 'Skipped' : 'Remaining'}
                  </span>
                </span>
              </button>
            );
            })}
          </div>
        </div>
      </div>

      {/* ── Body: slide image + AI (left) · content / quiz (right) ── */}
      <div className="grid grid-cols-1 gap-6 pt-4 lg:grid-cols-2">
        {/* Left column: slide image then the Ask-AI bar / tutor */}
        <div className="space-y-4">
          <div
            ref={pdfContainerRef}
            className="relative overflow-hidden rounded-2xl border border-white/5 bg-black/30"
            style={{ minHeight: pdfHeight || 320 }}
          >
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={currentIndex}
                custom={dir}
                initial={{ opacity: 0, x: dir > 0 ? 40 : -40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir > 0 ? -40 : 40 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                {hasPdf ? (
                  <Document
                    file={pdfUrl}
                    loading={
                      <div className="flex h-[320px] items-center justify-center">
                        <Loader2 className="h-7 w-7 animate-spin text-primary" />
                      </div>
                    }
                    onLoadError={() => setPdfError(true)}
                  >
                    <Page
                      pageNumber={currentSlide?.slide_number ?? 1}
                      width={pdfWidth > 0 ? pdfWidth : undefined}
                      renderTextLayer
                      renderAnnotationLayer={false}
                    />
                  </Document>
                ) : (
                  <div className={cn('relative flex h-[320px] flex-col justify-end bg-gradient-to-br p-5', gradientFor(currentIndex))}>
                    <div className="absolute inset-0 flex items-center justify-center opacity-20">
                      {(() => {
                        const Icon = topicIcon(translateCurriculum(lecture?.title) ?? '', lecture?.id ?? '');
                        return <Icon className="h-24 w-24 text-white" />;
                      })()}
                    </div>
                    <div className="relative">
                      <p className="text-lg font-black leading-tight">{translateCurriculum(courseTitle || lecture?.course?.title)}</p>
                      <p className="text-sm text-white/70">{translateCurriculum(lecture?.title)}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Chat bar — always under the PDF. Submitting turns the right view
              into the conversation (prompt + grounded response). */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk();
            }}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 backdrop-blur-sm focus-within:border-primary/40"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-muted-foreground">
              <Plus className="h-4 w-4" />
            </span>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask AI about this slide…"
              disabled={chatLoading}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary transition-opacity hover:opacity-90 disabled:opacity-30 disabled:shadow-none"
              aria-label="Send"
            >
              {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>

        {/* Right column: content / chat / quiz / completion — height-matched to
            the PDF so the panel stays aligned with the slide on the left. */}
        <div
          className="custom-scrollbar lg:h-[var(--pdf-h)] lg:overflow-y-auto"
          style={pdfHeight ? ({ '--pdf-h': `${pdfHeight}px` } as CSSProperties) : undefined}
        >
          <AnimatePresence mode="wait" custom={dir}>
            {completed ? (
              <motion.div
                key="complete"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="rounded-3xl border border-success/20 bg-success/5 p-8 text-center"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-success/20 text-success">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <h3 className="text-2xl font-black">Lecture complete</h3>
                <p className="mt-1 text-muted-foreground">
                  You earned <span className="font-bold text-xp">+{xpEarned} XP</span> · {correctAnswers}/{totalForScore} correct
                </p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    onClick={() => selectSlide(0)}
                    className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-bold transition-colors hover:bg-white/10"
                  >
                    Review again
                  </button>
                  <button
                    onClick={onClose}
                    className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow-primary transition-opacity hover:opacity-90"
                  >
                    Back to library
                  </button>
                </div>
              </motion.div>
            ) : chatActive ? (
              <motion.div
                key="chat"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="flex h-full min-h-[320px] flex-col rounded-3xl border border-white/5 bg-[#0a0a12]/50 backdrop-blur-sm"
              >
                <div className="flex items-center gap-3 border-b border-white/5 px-5 py-3.5">
                  <button
                    onClick={() => setChatActive(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                    aria-label="Back to slide notes"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-white shadow-glow-primary">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-tight">AI Tutor</p>
                    <p className="truncate text-[11px] text-muted-foreground">{currentSlide?.title || translateCurriculum(lecture?.title)}</p>
                  </div>
                </div>
                <div ref={chatScrollRef} className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
                  {messages.map((m) =>
                    m.role === 'user' ? (
                      <div key={m.id} className="flex justify-end gap-2">
                        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                          {m.content}
                        </div>
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                          <User className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="flex gap-2">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-white/5 text-primary">
                          <Sparkles className="h-3.5 w-3.5" />
                        </div>
                        <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-white/5 bg-white/[0.03] px-4 py-2.5">
                          <div className={PROSE_CLASS + ' prose-p:text-sm prose-li:text-sm'}>
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                              {m.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                  {streaming && (
                    <div className="flex gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-white/5 text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                      </div>
                      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-white/5 bg-white/[0.03] px-4 py-2.5">
                        <div className={PROSE_CLASS + ' prose-p:text-sm prose-li:text-sm'}>
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {streaming}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}
                  {chatLoading && !streaming && (
                    <div className="flex items-center gap-2 px-1 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Thinking…</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : showQuiz && currentQuestion ? (
              <motion.div
                key={`quiz-${currentIndex}`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
              >
                <QuizCard
                  question={currentQuestion.question_text}
                  options={currentQuestion.options}
                  correctAnswer={currentQuestion.correct_answer}
                  onAnswer={handleAnswer}
                  onContinue={advance}
                  continueLabel={currentIndex < slides.length - 1 ? 'Continue' : 'Finish lecture'}
                  questionNumber={currentIndex + 1}
                  totalQuestions={slides.length}
                  initialSelectedAnswer={quizAnswers[currentIndex]}
                  explanation={currentQuestion.explanation}
                  concept={currentQuestion.concept}
                  linkedSlides={
                    currentQuestion.linked_slides && currentQuestion.linked_slides.length > 0
                      ? currentQuestion.linked_slides.map((i) => i + 1)
                      : undefined
                  }
                  onJumpToSlide={(n) => selectSlide(Math.max(0, Math.min(slides.length - 1, n - 1)))}
                />
              </motion.div>
            ) : (
              <motion.div
                key={`content-${currentIndex}`}
                custom={dir}
                initial={{ opacity: 0, x: dir > 0 ? 48 : -48 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir > 0 ? -48 : 48 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-3xl border border-white/5 bg-[#0a0a12]/50 p-6 backdrop-blur-sm sm:p-8"
              >
                {currentSlide?.title && (
                  <h3 className="mb-4 text-2xl font-black tracking-tight">{currentSlide.title}</h3>
                )}
                {narrative ? (
                  <div className={PROSE_CLASS}>
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {narrative}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-muted-foreground">This slide has no notes yet.</p>
                )}

                {/* Slide navigation */}
                <div className="mt-8 flex items-center justify-between gap-4 border-t border-white/5 pt-5">
                  <button
                    onClick={handlePrev}
                    disabled={currentIndex === 0}
                    className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold transition-colors hover:bg-white/5 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </button>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    {currentIndex + 1} / {slides.length}
                  </span>
                  <button
                    onClick={handleNext}
                    className={cn(
                      'flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90',
                      currentIndex === slides.length - 1 && !currentQuestion ? 'bg-success shadow-glow-success' : 'bg-primary shadow-glow-primary',
                    )}
                  >
                    {currentQuestion && !showQuiz
                      ? 'Take quiz'
                      : currentIndex < slides.length - 1
                        ? 'Continue'
                        : 'Finish'}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* Level-up / badge popups are rendered globally by GamificationProvider. */}
    </div>
  );
}
