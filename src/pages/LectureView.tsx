import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookOpen, Zap, Trophy, X, Bot, ExternalLink, HelpCircle, Loader2, Send, ArrowLeft, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { fetchLecture, fetchSlides, fetchQuizQuestions, resolvePdfUrl } from '@/services/lectureService';
import {
  fetchLectureProgress,
  upsertLectureProgress,
  logLearningEvent,
} from '@/services/studentService';

import { useGamification } from '@/lib/gamification/GamificationProvider';
import { useSlideProgress } from '@/features/student/hooks/useSlideProgress';
import { statesFromLegacyCompleted, allVisitedStates } from '@/lib/slideProgress';
import { apiClient } from '@/lib/apiClient';
import { SlideViewer } from '@/components/SlideViewer';
import { QuizCard } from '@/components/QuizCard';
import { Button } from '@/components/ui/button';
import { WorksheetsPanel } from '@/components/WorksheetsPanel';
import { StudentPracticeSheetsPanel } from '@/features/practice_sheets/StudentPracticeSheetsPanel';
import { LectureRecap, type RecapItem } from '@/components/LectureRecap';
import { RelatedAcrossCoursesPanel } from '@/components/RelatedAcrossCoursesPanel';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useMindMap } from '@/features/mindmap/hooks/useMindMap';
import { useAiModel } from '@/hooks/use-ai-model';
import { PomodoroTimer } from '@/components/PomodoroTimer';
import { AmbientGlow, GLOW_BY_STATUS, DepthScene, LectureBackdrop } from '@/components/console';
import { StudentRoutes, ProfessorRoutes } from '@/lib/routes';
import { safeGetUUID, cn } from '@/lib/utils';
import 'katex/dist/katex.min.css';

import type { Slide, QuizQuestion, Lecture } from '@/types/domain';

type ChatMessage = { id: string; role: 'user' | 'model'; content: string };

const PROSE_CLASS = [
  'prose prose-invert max-w-none',
  '[&>*:first-child]:mt-0',
  'prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-foreground',
  'prose-h1:text-[22px] prose-h1:mt-8 prose-h1:mb-3',
  'prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3',
  'prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2',
  'prose-p:text-[15px] prose-p:leading-7 prose-p:my-3 prose-p:text-foreground/85',
  'prose-strong:text-foreground prose-strong:font-semibold',
  'prose-em:text-foreground/80',
  'prose-a:text-primary prose-a:underline-offset-2 hover:prose-a:text-primary/80',
  'prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 prose-li:text-[15px] prose-li:text-foreground/85',
  'prose-ul:pl-1 prose-li:marker:text-primary/70 prose-ol:marker:text-primary/70 prose-li:marker:font-semibold',
  'prose-code:text-accent prose-code:bg-accent/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-medium prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl prose-pre:text-[13px]',
  'prose-blockquote:border-l-2 prose-blockquote:border-primary/50 prose-blockquote:bg-white/[0.03] prose-blockquote:rounded-r-lg prose-blockquote:px-4 prose-blockquote:py-0.5 prose-blockquote:not-italic prose-blockquote:text-foreground/75',
  'prose-hr:border-white/10 prose-hr:my-6',
  'prose-table:my-4 prose-table:text-[13px] prose-table:overflow-hidden prose-table:rounded-xl',
  'prose-thead:border-white/10 prose-th:bg-white/[0.06] prose-th:text-foreground prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-white/10 prose-th:text-left',
  'prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-white/10 prose-td:text-foreground/80',
  'prose-img:rounded-xl prose-img:border prose-img:border-white/10',
].join(' ');

export default function LectureView() {
  const { t } = useTranslation(['lecture', 'common']);
  const { lectureId } = useParams<{ lectureId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const gamification = useGamification();

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [resolvedPdfUrl, setResolvedPdfUrl] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [xpEarned, setXpEarned] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  // In-session consecutive-correct counter for the "On Fire" / "Unstoppable" badges.
  const correctStreakRef = useRef(0);

  // ── Slide progress hook (replaces broken saveProgress / useState(currentSlideIndex)) ──
  const slideProgress = useSlideProgress({
    lectureId: lecture?.id ?? '',
    slides,
    userId: user?.id,
  });
  const {
    currentIndex: currentSlideIndex,
    goToSlide,
    slideStates,
    completionPct,
    validateSlide,
    initialize: initSlideProgress,
    flushSave: flushSlideProgress,
  } = slideProgress;

  // Pending init: stored by fetchLectureData, applied once slides state is ready.
  // Kept in STATE (not a ref): setSlides() runs before fetchLectureProgress()
  // resolves, so a ref would be read by the [slides] effect while still null and
  // the resume position would be lost. State re-triggers the effect.
  const [pendingInit, setPendingInit] = useState<{ states: Record<string, import('@/types/domain').SlideState>; index: number } | null>(null);

  useEffect(() => {
    if (slides.length > 0 && pendingInit) {
      initSlideProgress(pendingInit.states, pendingInit.index);
      setPendingInit(null);
    }
  }, [slides, pendingInit, initSlideProgress]);
  const [slideStartTime, setSlideStartTime] = useState<number>(Date.now());
  const sessionStartRef = useRef<number>(Date.now());
  // Stable id for this study session, stamped onto every learning event so
  // analytics can segment per-session behavior (re-visits, pacing) without
  // reconstructing sessions from timestamp gaps.
  const sessionIdRef = useRef<string>(safeGetUUID());
  const slideStartRef = useRef<number>(Date.now());
  const quizRef = useRef<HTMLDivElement>(null);
  const scrollableContainerRef = useRef<HTMLDivElement>(null);
  const answeredQuestionsRef = useRef<Set<string>>(new Set());
  // Authoritative post-answer counters. handleQuizAnswer writes the freshly
  // computed values here so handleQuizContinue can read them synchronously
  // without depending on possibly-stale React state.
  const committedXpRef = useRef<number>(0);
  const committedCorrectRef = useRef<number>(0);
  // One-shot guards so a fast double-click on Continue / Finish lecture
  // cannot double-fire advancement or completion side effects.
  const continueLockRef = useRef<boolean>(false);
  const lectureCompleteLockRef = useRef<boolean>(false);

  // Review stage: every wrong answer during the run is pushed here so the
  // student can re-attempt them after the last slide. Stored in a ref so
  // handleQuizAnswer can append synchronously without a re-render race.
  const missedQueueRef = useRef<
    Array<{
      question: QuizQuestion;
      slideIndex: number;
      firstSelectedIndex: number;
      secondSelectedIndex: number | null;
    }>
  >([]);
  // Mirror set of question ids already in `missedQueueRef` for O(1) dedup
  // during first-pass queueing. Kept in sync alongside the queue itself.
  const missedQueuedIdsRef = useRef<Set<string>>(new Set());
  const [reviewStage, setReviewStage] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewSelectedAnswer, setReviewSelectedAnswer] = useState<number | null>(null);
  const reviewAnsweredRef = useRef<Set<string>>(new Set());
  const reviewContinueLockRef = useRef<boolean>(false);
  // End-of-lecture recap: snapshot of every question the student missed on
  // their first attempt, with their first answer + their retry answer + the
  // correct answer. Populated when the lecture completes.
  const [lectureCompleted, setLectureCompleted] = useState(false);
  const [recapItems, setRecapItems] = useState<RecapItem[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<'slide' | 'worksheets' | 'related'>('slide');
  const { role } = useAuth();
  const isMobile = useIsMobile();

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [chatActive, setChatActive] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Horizontal syllabus rail scrolling.
  const railRef = useRef<HTMLDivElement>(null);
  const [railEdges, setRailEdges] = useState({ left: false, right: false });
  const railAnimRef = useRef<{ raf?: number; target?: number }>({});
  const holdRef = useRef<{ timer?: ReturnType<typeof setTimeout>; raf?: number; dir: 1 | -1; held: boolean }>({ dir: 1, held: false });
  const clickStreakRef = useRef<{ t: number; n: number }>({ t: 0, n: 0 });

  const updateRailEdges = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setRailEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
    });
  }, []);

  const railStep = useCallback(() => {
    const el = railRef.current;
    const card = el?.querySelector<HTMLElement>('[data-card]');
    return (card?.offsetWidth ?? 220) + 12;
  }, []);

  const clampScroll = useCallback((v: number) => {
    const el = railRef.current;
    if (!el) return v;
    return Math.max(0, Math.min(v, el.scrollWidth - el.clientWidth));
  }, []);

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
        node.scrollLeft = clampScroll(node.scrollLeft + dir * 3);
        updateRailEdges();
        holdRef.current.raf = requestAnimationFrame(tick);
      };
      holdRef.current.raf = requestAnimationFrame(tick);
    },
    [clampScroll, updateRailEdges],
  );

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

  useEffect(() => {
    return () => {
      if (railAnimRef.current.raf) cancelAnimationFrame(railAnimRef.current.raf);
      if (holdRef.current.raf) cancelAnimationFrame(holdRef.current.raf);
      if (holdRef.current.timer) clearTimeout(holdRef.current.timer);
    };
  }, []);

  useEffect(() => {
    updateRailEdges();
  }, [slides, updateRailEdges]);

  useEffect(() => {
    const el = railRef.current;
    const active = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (el && active) {
      el.scrollTo({ left: active.offsetLeft - el.clientWidth / 2 + active.offsetWidth / 2, behavior: 'smooth' });
    }
  }, [currentSlideIndex, slides.length]);

  // Mind map
  const { map: mindMap, generate: generateMindMap } = useMindMap(lectureId ?? null);
  const { aiModel } = useAiModel();

  // Slide content regeneration (professor only) — Roadmap Phase 5.2
  const [isRegeneratingContent, setIsRegeneratingContent] = useState(false);
  // Ids of slides with an as-yet-unactioned regenerate, so "Undo" shows for
  // EVERY such slide (not just the most recently regenerated one) — a
  // professor regenerating slide 2 must not hide slide 1's still-valid undo.
  const [regeneratedSlideIds, setRegeneratedSlideIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (lectureId && user) {
      fetchLectureData();
    }
  }, [lectureId, user]);

  // Opening a lecture is enough to earn "Welcome Aboard" (first slide ever) — the
  // dashboard records the lecture_visit on navigation; the server sweep awards it.
  useEffect(() => {
    if (slides.length > 0 && user) gamification.evaluate();
  }, [slides.length, user]);



  // Analytics: Track slide view duration
  useEffect(() => {
    if (!slides.length || !user) return;

    const currentSlideId = slides[currentSlideIndex]?.id;
    const currentSlideTitle = slides[currentSlideIndex]?.title || '';
    const now = Date.now();

    const logSlideView = (slideId: string, title: string, durationSeconds: number) => {
      if (durationSeconds < 1) return;
      // Fire-and-forget — telemetry must never block the UI or crash the lecture.
      logLearningEvent(user.id, 'slide_view', {
        lectureId,
        slideId,
        slideTitle: title,
        duration_seconds: durationSeconds,
        sessionId: sessionIdRef.current,
        timestamp: new Date().toISOString(),
      }).catch((err) => console.warn('slide_view telemetry failed', err));
    };

    setSlideStartTime(now);
    slideStartRef.current = now;

    return () => {
      if (currentSlideId) {
        const elapsed = Math.round((Date.now() - slideStartRef.current) / 1000);
        logSlideView(currentSlideId, currentSlideTitle, elapsed);
      }
    };
  }, [currentSlideIndex, slides, user, lectureId]);

  // Scroll container back to top on slide or review question change
  useEffect(() => {
    if (scrollableContainerRef.current) {
      scrollableContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentSlideIndex, reviewIndex, reviewStage]);


  const fetchLectureData = async () => {
    setLoading(true);
    
    // Reset session state for new lecture
    setPendingInit(null); // clear any stale pending-init from previous lecture
    setShowQuiz(false);
    setQuizAnswers({});
    setXpEarned(0);
    setCorrectAnswers(0);

    // Reset replay/review session state so a previously-loaded lecture
    // doesn't leak its missed-question queue or review progress into the
    // newly loaded one.
    missedQueueRef.current = [];
    missedQueuedIdsRef.current = new Set();
    reviewAnsweredRef.current = new Set();
    reviewContinueLockRef.current = false;
    setReviewStage(false);
    setReviewIndex(0);
    setReviewSelectedAnswer(null);
    setLectureCompleted(false);
    setRecapItems([]);

    const currentLectureId = lectureId;
    if (!currentLectureId) return;

    try {
      const lectureData = await fetchLecture(currentLectureId);
      if (!lectureData) {
        toast({ title: t('lecture:toasts.notFoundTitle'), description: t('lecture:toasts.notFoundDescription'), variant: 'destructive' });
        navigate(role === 'professor' ? ProfessorRoutes.DASHBOARD : StudentRoutes.HOME);
        return;
      }
      setLecture(lectureData);

    // Resolve the stored pdf_url (path or legacy public URL) to an authenticated
    // signed URL so the private bucket is accessible in the browser.
    resolvePdfUrl(lectureData.pdf_url).then(setResolvedPdfUrl).catch(() => setResolvedPdfUrl(null));

    // Fetch slides
    const slidesFromService = await fetchSlides(lectureData.id);
    const slidesData = slidesFromService.length > 0 ? slidesFromService : null;

    if (slidesData && slidesData.length > 0) {
      setSlides(slidesData);
    } else {
      setSlides([]);
    }

    // Fetch questions
    const questionsFromService = await fetchQuizQuestions(lectureData.id);
    const questionsData = questionsFromService.length > 0 ? questionsFromService : null;

    if (questionsData && questionsData.length > 0) {
      setQuestions(questionsData.map(q => ({
        ...q,
        options: Array.isArray(q.options) ? q.options as string[] : []
      })));
    } else {
      setQuestions([]);
    }

    // Fetch user progress and schedule restoration
    if (user?.id) {
      const progressData = await fetchLectureProgress(user.id, lectureData.id);

      if (progressData) {
        const maxSlides = slidesData && slidesData.length > 0 ? slidesData.length : 4;
        const rawLast = progressData.last_slide_viewed;
        const lastIndex =
          rawLast !== null && rawLast !== undefined && rawLast >= 0
            ? Math.min(rawLast, maxSlides - 1)
            : 0;

        // Restore XP / quiz state (unchanged from before)
        if (progressData.xp_earned) setXpEarned(Math.min(progressData.xp_earned, questionsData?.length ? questionsData.length * 10 : 0));
        if (progressData.correct_answers) setCorrectAnswers(Math.min(progressData.correct_answers, questionsData?.length || 0));

        if (progressData.completed_slides && Array.isArray(progressData.completed_slides)) {
          const restoredAnswers: Record<number, number> = {};
          progressData.completed_slides.forEach((slideNum: number) => {
            const slideIndex = slideNum - 1;
            restoredAnswers[slideIndex] = -1;
            const slideId = slidesData?.[slideIndex]?.id;
            const qId = questionsData?.find(q => q.slide_id === slideId)?.id;
            if (qId) answeredQuestionsRef.current.add(qId);
          });
          setQuizAnswers(restoredAnswers);
        }

        // Restore granular slide states. Prefer the new slide_states JSONB;
        // fall back to synthesising them from the legacy completed_slides array.
        const savedStates =
          progressData.slide_states && Object.keys(progressData.slide_states).length > 0
            ? (progressData.slide_states as Record<string, import('@/types/domain').SlideState>)
            : statesFromLegacyCompleted(
                progressData.completed_slides ?? [],
                lastIndex,
                slidesData ?? [],
              );

        // Defer init until after setSlides() causes a re-render
        setPendingInit({ states: savedStates, index: lastIndex });
      }
    }

    // Log lecture start event (fire-and-forget; never block lecture load)
    if (user?.id) {
      logLearningEvent(user.id, 'lecture_start', { lectureId: lectureData.id, sessionId: sessionIdRef.current })
        .catch((err) => console.warn('lecture_start telemetry failed', err));
    }

    setLoading(false);
    } catch (err) {
      console.error('Fatal error in fetchLectureData:', err);
      toast({ title: t('lecture:toasts.errorTitle'), description: t('lecture:toasts.systemError'), variant: 'destructive' });
      setLoading(false);
    }
  };

  const currentSlide = slides[currentSlideIndex];

  const handleRegenerateContent = async (instruction?: string) => {
    if (!currentSlide || !user) return;
    setIsRegeneratingContent(true);
    try {
      const json = await apiClient.post<{ slide: Slide }>(`/api/ai/slides/${currentSlide.id}/regenerate-content`, {
        ai_model: aiModel,
        instruction,
      });
      const updated = json.slide;
      // Patch the slide in local state so the UI updates immediately
      setSlides(prev => prev.map(s =>
        s.id === currentSlide.id
          ? { ...s, title: updated.title, content_text: updated.content_text, summary: updated.summary, regen_instruction: updated.regen_instruction }
          : s
      ));
      // Roadmap Phase 5.2: mark THIS slide as undoable, without disturbing
      // any other slide's still-valid undo state (the backend keeps one
      // previous_version snapshot per slide, independently).
      setRegeneratedSlideIds(prev => new Set(prev).add(currentSlide.id));
      toast({ title: t('lecture:regenerate.success'), description: t('lecture:regenerate.successDescription') });
    } catch (err: unknown) {
      toast({ title: t('lecture:regenerate.failure'), description: (err instanceof Error ? err.message : '') || t('lecture:regenerate.failureDescription'), variant: 'destructive' });
    } finally {
      setIsRegeneratingContent(false);
    }
  };

  const handleUndoRegenerateContent = async () => {
    if (!currentSlide || !user) return;
    setIsRegeneratingContent(true);
    try {
      const json = await apiClient.post<{ slide: Slide }>(`/api/ai/slides/${currentSlide.id}/undo-regenerate`, {});
      const restored = json.slide;
      setSlides(prev => prev.map(s =>
        s.id === currentSlide.id
          ? { ...s, title: restored.title, content_text: restored.content_text, summary: restored.summary, regen_instruction: restored.regen_instruction }
          : s
      ));
      setRegeneratedSlideIds(prev => {
        const next = new Set(prev);
        next.delete(currentSlide.id);
        return next;
      });
      toast({ title: t('lecture:regenerate.undoSuccess'), description: t('lecture:regenerate.undoSuccessDescription') });
    } catch (err: unknown) {
      toast({ title: t('lecture:regenerate.undoFailure'), description: (err instanceof Error ? err.message : '') || '', variant: 'destructive' });
    } finally {
      setIsRegeneratingContent(false);
    }
  };

  // Get questions for the current slide. When a slide has both a per-slide
  // quiz AND an anchored cross-slide deck quiz item, we surface the deck
  // (cross-slide) question first — it's the more pedagogically valuable
  // assessment and otherwise gets shadowed by the [0] selection below.
  const currentSlideQuestions = questions
    .filter(q => q.slide_id === currentSlide?.id)
    .slice()
    .sort((a, b) => {
      const aCross = (a.linked_slides?.length ?? 0) >= 2 ? 0 : 1;
      const bCross = (b.linked_slides?.length ?? 0) >= 2 ? 0 : 1;
      return aCross - bCross;
    });
  const currentQuestion = currentSlideQuestions[0];

  // saveProgress is replaced by useSlideProgress.flushSave (called by the hook
  // automatically on every goToSlide and before tab close).

  const handleNextSlide = () => {
    if (!showQuiz && currentQuestion) {
      setShowQuiz(true);
      setTimeout(() => {
        quizRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return;
    }

    if (currentSlideIndex < slides.length - 1) {
      const nextIndex = currentSlideIndex + 1;
      goToSlide(nextIndex);                              // ← transition + debounced save
      setShowQuiz(quizAnswers[nextIndex] !== undefined);
    } else {
      handleLectureComplete(xpEarned, correctAnswers);
    }
  };

  const handlePreviousSlide = () => {
    if (showQuiz && quizAnswers[currentSlideIndex] === undefined) {
      setShowQuiz(false);
      return;
    }

    if (currentSlideIndex > 0) {
      const prevIndex = currentSlideIndex - 1;

      if (user) {
        logLearningEvent(user.id, 'slide_back_navigation', {
          lectureId,
          fromSlideId: slides[currentSlideIndex]?.id,
          toSlideId: slides[prevIndex]?.id,
          sessionId: sessionIdRef.current,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }

      goToSlide(prevIndex);                              // ← transition + debounced save
      setShowQuiz(quizAnswers[prevIndex] !== undefined);
    }
  };

  // Keyboard navigation for slide cycling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextSlide();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePreviousSlide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNextSlide, handlePreviousSlide]);

  const handleQuizAnswer = async (isCorrect: boolean, selectedIndex: number) => {
    if (!currentQuestion) return;

    // Strict guard: If we already answered this specific question instance, block immediately
    if (answeredQuestionsRef.current.has(currentQuestion.id)) return;
    
    // Mark as answered in Ref (sync) to block rapid clicks
    answeredQuestionsRef.current.add(currentQuestion.id);

    // Record this selection for UI state (async update)
    setQuizAnswers(prev => ({ ...prev, [currentSlideIndex]: selectedIndex }));

    const timeToAnswer = Math.round((Date.now() - slideStartTime) / 1000);

    if (user) {
      // Fire-and-forget telemetry; never block the quiz flow on a network blip.
      logLearningEvent(user.id, 'quiz_attempt', {
        lectureId,
        slideId: currentSlide?.id,
        slideTitle: currentSlide?.title,
        questionId: currentQuestion?.id,
        correct: isCorrect,
        selectedAnswer: selectedIndex,
        time_to_answer_seconds: timeToAnswer,
        sessionId: sessionIdRef.current,
        timestamp: new Date().toISOString(),
      }).catch((err) => console.warn('quiz_attempt telemetry failed', err));
    }

    // Track wrong answers for the end-of-lecture replay stage. Each missed
    // question is queued exactly once per run; second-pass attempts during
    // the replay are tracked separately via handleReviewAnswer. Membership
    // is verified via a Set-backed lookup so the queue is deterministic
    // even if multiple wrong answers land in the same tick.
    if (!isCorrect && !missedQueuedIdsRef.current.has(currentQuestion.id)) {
      missedQueuedIdsRef.current.add(currentQuestion.id);
      missedQueueRef.current.push({
        question: currentQuestion,
        slideIndex: currentSlideIndex,
        firstSelectedIndex: selectedIndex,
        secondSelectedIndex: null,
      });
    }

    if (isCorrect) {
      const newXp = xpEarned + 10;
      const totalQ = questions.length || 1;
      const newCorrect = Math.min(correctAnswers + 1, totalQ);
      
      setXpEarned(newXp);
      setCorrectAnswers(newCorrect);

      if (user && lectureId) {
        queryClient.setQueryData(['student-progress', user.id], (old: any) => {
          if (!old) return old;
          return old.map((p: any) => {
            if (p.lecture_id === lectureId) {
              return {
                ...p,
                xp_earned: Math.min(newXp, totalQ * 10),
                correct_answers: newCorrect,
                total_questions_answered: answeredQuestionsRef.current.size + 1,
              };
            }
            return p;
          });
        });
      }

      queryClient.invalidateQueries({ queryKey: ['student-progress', user?.id] });

      // XP, level-ups and count-based badges are handled by the gamification
      // engine. grantXp refreshes the profile so the global level-up modal can
      // fire; the day-streak is still owned by record_daily_activity() on the
      // dashboard, so we deliberately don't touch current_streak here.
      await gamification.grantXp(10, 'quiz_correct');

      // In-session correct-answer streak → "On Fire" (5) / "Unstoppable" (10).
      correctStreakRef.current += 1;
      if (correctStreakRef.current === 5) await gamification.awardBadge('On Fire');
      else if (correctStreakRef.current === 10) await gamification.awardBadge('Unstoppable');
    } else {
      correctStreakRef.current = 0;
    }

    // Persist progress immediately so reload cannot re-award XP for this question.
    // The hook saves slide_states; we separately persist the XP/score fields.
    const finalXpNow = isCorrect ? xpEarned + 10 : xpEarned;
    const finalCorrectNow = isCorrect ? correctAnswers + 1 : correctAnswers;
    committedXpRef.current = finalXpNow;
    committedCorrectRef.current = finalCorrectNow;
    continueLockRef.current = false;

    if (user && lecture) {
      await upsertLectureProgress(user.id, lecture.id, {
        xp_earned: Math.min(finalXpNow, (questions.length || slides.length) * 10),
        correct_answers: Math.min(finalCorrectNow, questions.length || slides.length),
        total_questions_answered: answeredQuestionsRef.current.size,
      });
      // Progress is persisted → sweep count-based badges (Quiz Master, Sharpshooter).
      if (isCorrect) gamification.evaluate();
    }
    await flushSlideProgress(); // flush slide_states + last_slide_viewed

    // Advancement is now driven by the Continue button (see handleQuizContinue),
    // so we no longer auto-advance on a 1.5s timer. The student controls the pace.
  };

  const handleQuizContinue = () => {
    if (continueLockRef.current) return;
    continueLockRef.current = true;

    const xp = committedXpRef.current || xpEarned;
    const correct = committedCorrectRef.current || correctAnswers;

    if (currentSlideIndex < slides.length - 1) {
      const nextIndex = currentSlideIndex + 1;
      goToSlide(nextIndex);                              // ← transition + debounced save
      setShowQuiz(quizAnswers[nextIndex] !== undefined);
    } else {
      setShowQuiz(false);
      if (missedQueueRef.current.length > 0) {
        setReviewStage(true);
        setReviewIndex(0);
        setReviewSelectedAnswer(null);
        reviewContinueLockRef.current = false;
        return;
      }
      handleLectureComplete(xp, correct);
    }
  };

  const currentReviewItem =
    reviewStage && missedQueueRef.current.length > 0
      ? missedQueueRef.current[reviewIndex]
      : null;

  const handleReviewAnswer = (isCorrect: boolean, selectedIndex: number) => {
    const item = currentReviewItem;
    if (!item) return;
    // Idempotency: dedup by question id alone so a stray reviewIndex
    // re-render cannot cause `quiz_retry_attempt` to be emitted twice
    // for the same retry question.
    if (reviewAnsweredRef.current.has(item.question.id)) return;
    reviewAnsweredRef.current.add(item.question.id);

    setReviewSelectedAnswer(selectedIndex);
    reviewContinueLockRef.current = false;
    // Capture the retry answer for the end-of-lecture recap. We overwrite on
    // every retry click so the recap reflects the last attempt the student
    // made on this question.
    item.secondSelectedIndex = selectedIndex;

    if (user) {
      // Separate event type so analytics can distinguish first-attempt
      // accuracy from eventual mastery. Retry attempts deliberately do NOT
      // award XP or bump correctAnswers — saveProgress is not re-called.
      logLearningEvent(user.id, 'quiz_retry_attempt', {
        lectureId,
        slideId: item.question.slide_id,
        slideTitle: slides[item.slideIndex]?.title,
        questionId: item.question.id,
        correct: isCorrect,
        selectedAnswer: selectedIndex,
        firstAttemptAnswer: item.firstSelectedIndex,
        reviewIndex,
        sessionId: sessionIdRef.current,
        timestamp: new Date().toISOString(),
      }).catch((err) => console.warn('quiz_retry_attempt telemetry failed', err));
    }
  };

  const handleReviewContinue = () => {
    if (reviewContinueLockRef.current) return;
    reviewContinueLockRef.current = true;

    const next = reviewIndex + 1;
    if (next < missedQueueRef.current.length) {
      setReviewIndex(next);
      setReviewSelectedAnswer(null);
    } else {
      setReviewStage(false);
      handleLectureComplete(committedXpRef.current || xpEarned, committedCorrectRef.current || correctAnswers);
    }
  };

  const handleLectureComplete = async (finalXp: number = xpEarned, finalCorrect: number = correctAnswers) => {
    if (!lecture) return;
    // One-shot guard — double-clicking Finish must not fire completion (XP cap,
    // achievements, notifications, navigate) twice.
    if (lectureCompleteLockRef.current) return;
    lectureCompleteLockRef.current = true;

    // Snapshot the missed-question queue for the recap UI before any
    // post-completion side effects run. Items already carry first/second
    // attempt indices populated during the run + replay stages.
    setRecapItems(
      missedQueueRef.current.map((m) => ({
        question: m.question,
        slideIndex: m.slideIndex,
        slideTitle: slides[m.slideIndex]?.title,
        firstSelectedIndex: m.firstSelectedIndex,
        secondSelectedIndex: m.secondSelectedIndex,
      })),
    );
    setLectureCompleted(true);

    const sessionDuration = Math.round((Date.now() - sessionStartRef.current) / 1000);

    if (!user) return;

    // Fire-and-forget telemetry — completion flow must finish even if logging fails.
    logLearningEvent(user.id, 'lecture_complete', {
      lectureId: lecture.id,
      xpEarned: finalXp,
      correctAnswers: finalCorrect,
      total_duration_seconds: sessionDuration,
      sessionId: sessionIdRef.current,
      completed_at: new Date().toISOString(),
    }).catch((err) => console.warn('lecture_complete telemetry failed', err));

    const cappedXp = slides.length > 0 ? Math.min(finalXp, slides.length * 10) : finalXp;
    const cappedCorrect = slides.length > 0 ? Math.min(finalCorrect, slides.length) : finalCorrect;

    await upsertLectureProgress(user.id, lecture.id, {
      xp_earned: cappedXp,
      completed_slides: slides.map((_, i) => i + 1),
      // Mark every slide as visited in the granular map
      slide_states: allVisitedStates(slides),
      quiz_score: slides.length > 0 ? Math.round((cappedCorrect / slides.length) * 100) : 0,
      total_questions_answered: slides.length,
      correct_answers: cappedCorrect,
      completed_at: new Date().toISOString(),
    });

    queryClient.invalidateQueries({ queryKey: ['student-lectures'] });
    queryClient.invalidateQueries({ queryKey: ['student-courses'] });
    queryClient.invalidateQueries({ queryKey: ['student-progress'] });
    queryClient.invalidateQueries({ queryKey: ['student-achievements'] });
    queryClient.invalidateQueries({ queryKey: ['course-visits'] });

    // A completion bonus (once per lecture) + the "First Quiz Completed" event
    // badge. All threshold badges (First Steps, Bookworm, Graduate, Scholar,
    // Perfect Score, Course Conqueror, …) are then swept server-side from the
    // freshly-persisted progress. Popups/notifications are owned by the engine.
    await gamification.grantXp(20, 'lecture_complete', `lecture:${lecture.id}`);
    await gamification.awardBadge('First Quiz Completed');
    gamification.evaluate();

    toast({
      title: t('lecture:toasts.lectureCompleteTitle'),
      description: t('lecture:toasts.lectureCompleteDescription', { xp: xpEarned, correct: correctAnswers, total: questions.length || slides.length }),
    });

    // The recap card now owns the "Back to dashboard" CTA — no auto-navigate
    // so students can review which questions they had to retry.
  };

  const handleAsk = useCallback(async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput('');
    setActiveTab('slide');
    setChatActive(true);
    setMessages((prev) => [...prev, { id: safeGetUUID(), role: 'user', content: q }]);
    setChatLoading(true);
    setStreaming('');

    try {
      const history = messages.filter(m => m.content).map((m) => ({ role: m.role, content: m.content }));
      const ctrl = new AbortController();
      chatAbortRef.current = ctrl;
      const res = await apiClient.stream('/api/v1/ai/chat', {
        slide_text: currentSlide?.content_text || currentSlide?.summary || '',
        user_message: q,
        chat_history: history,
        ai_model: aiModel,
        lecture_id: lecture?.id ?? '',
        current_slide_index: currentSlideIndex,
      }, ctrl.signal);

      const ct = res.headers.get('content-type');
      if (ct?.includes('text/event-stream')) {
        const reader = res.body?.getReader();
        const dec = new TextDecoder();
        let full = '';
        if (!reader) throw new Error('No reader');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.reply || parsed.content) {
                  full += (parsed.reply || parsed.content);
                  setStreaming(full);
                }
              } catch (e) {
                // Ignore parse errors on incomplete chunks
              }
            }
          }
        }
        setMessages((prev) => [...prev, { id: safeGetUUID(), role: 'assistant', content: full }]);
      } else {
        const data = await res.json();
        setMessages((prev) => [...prev, { id: safeGetUUID(), role: 'assistant', content: data.reply }]);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Chat error', e);
        toast({ title: 'Error communicating with AI tutor', variant: 'destructive' });
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, messages, currentSlide, aiModel, lecture?.id, currentSlideIndex, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <DepthScene
      status={lectureCompleted ? 'done' : 'progress'}
      gradientIndex={currentSlideIndex}
      motionKey={lectureId!}
      backdrop={<LectureBackdrop lectureId={lectureId!} pdfUrl={resolvedPdfUrl} />}
    >
      <div className="flex flex-col h-[100svh] relative z-10 max-w-7xl mx-auto w-full overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 flex items-center justify-between relative z-50">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(role === 'professor' ? ProfessorRoutes.DASHBOARD : StudentRoutes.HOME)}
              className="rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
              title={t('lecture:chrome.exitLecture')}
            >
              <X className="w-5 h-5" />
            </Button>
            <div className="flex flex-col">
              <nav className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest mb-0.5">
                <span className="opacity-50 truncate max-w-[160px]">
                  {(lecture as { course?: { title?: string } | null } | null)?.course?.title || t('lecture:chrome.uncategorized')}
                </span>
                <span className="opacity-30">/</span>
                <span className="truncate max-w-[200px]">{lecture?.title || t('lecture:chrome.lectureLoading')}</span>
              </nav>
              <h1 className="text-sm font-bold text-foreground truncate max-w-[300px]">
                {currentSlide?.title || t('lecture:chrome.slideView')}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {role === 'student' && <PomodoroTimer />}
            <div className="hidden sm:flex items-center gap-2 mr-4">
              <div className="flex items-center gap-2 px-3 py-1.5 glass-panel border-white/5 rounded-xl">
                <Zap className="w-3.5 h-3.5 text-xp fill-xp" />
                <span className="text-xs font-bold text-xp">+{xpEarned} XP</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 glass-panel border-white/5 rounded-xl">
                <Trophy className="w-3.5 h-3.5 text-success fill-success/20" />
                <span className="text-xs font-bold text-foreground">
                  {correctAnswers}/{questions.length || slides.length}
                </span>
              </div>
            </div>

            {resolvedPdfUrl && (
              <Button
                onClick={() => window.open(resolvedPdfUrl, '_blank', 'noopener noreferrer')}
                variant="ghost"
                className="hidden md:flex gap-2 rounded-xl px-4 text-muted-foreground hover:text-foreground hover:bg-white/5"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="text-xs font-bold">{t('lecture:chrome.sourcePdf')}</span>
              </Button>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
          {/* Horizontal Rail */}
          <div className="relative mb-6">
            {railEdges.left && (
              <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
            )}
            {railEdges.right && (
              <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />
            )}
            <div
              className="absolute bottom-0 left-0 top-0 z-20 flex w-8 cursor-pointer items-center justify-center opacity-0 transition-opacity hover:bg-white/5 hover:opacity-100"
              onClick={() => railClick(-1)}
              onPointerDown={() => railPress(-1)}
              onPointerUp={railRelease}
              onPointerLeave={railCancel}
              onContextMenu={(e) => e.preventDefault()}
            />
            <div
              className="absolute bottom-0 right-0 top-0 z-20 flex w-8 cursor-pointer items-center justify-center opacity-0 transition-opacity hover:bg-white/5 hover:opacity-100"
              onClick={() => railClick(1)}
              onPointerDown={() => railPress(1)}
              onPointerUp={railRelease}
              onPointerLeave={railCancel}
              onContextMenu={(e) => e.preventDefault()}
            />
            <div
              ref={railRef}
              className="no-scrollbar relative flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth py-1"
              onScroll={updateRailEdges}
            >
              {slides.map((s, i) => {
                const isCurrent = i === currentSlideIndex;
                const state = slideStates[s.id] || { status: 'unvisited', history: [] };
                const isVisited = state.status === 'visited';
                const isSkipped = state.status === 'skipped';
                return (
                  <button
                    key={s.id}
                    data-card
                    data-active={isCurrent}
                    onClick={() => {
                      goToSlide(i);
                      setShowQuiz(quizAnswers[i] !== undefined);
                    }}
                    className={cn(
                      'group relative flex w-56 shrink-0 snap-start items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5',
                      isCurrent
                        ? 'border-primary/50 bg-primary/10 shadow-[0_0_20px_-5px_rgba(var(--primary),0.3)] ring-1 ring-primary/20'
                        : isVisited
                          ? 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                          : isSkipped
                            ? 'border-dashed border-white/10 bg-transparent hover:border-white/20'
                            : 'border-white/5 bg-transparent hover:border-white/10 hover:bg-white/[0.02]'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                        isCurrent
                          ? 'bg-primary/20 text-primary'
                          : isVisited
                            ? 'bg-white/10 text-muted-foreground'
                            : 'bg-white/5 text-muted-foreground/40 text-xs font-bold'
                      )}
                    >
                      {isCurrent ? <BookOpen className="h-4 w-4" /> : i + 1}
                    </div>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Slide Viewer + Chat Bar */}
            <div className="space-y-4">
              <AnimatePresence mode="wait">
                {slides.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center py-16 text-center glass-panel border-white/5 rounded-3xl p-8"
                  >
                    <BookOpen className="w-12 h-12 text-muted-foreground/45 mb-4" />
                    <h2 className="text-xl font-bold text-foreground mb-2">{t('lecture:chrome.noSlidesTitle', { defaultValue: 'No slides available' })}</h2>
                    <p className="text-sm text-muted-foreground max-w-sm">{t('lecture:chrome.noSlidesDescription', { defaultValue: 'This lecture does not contain any slide content yet.' })}</p>
                  </motion.div>
                ) : currentSlide ? (
                  <motion.div
                    key={`slide-${currentSlideIndex}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SlideViewer
                      title={currentSlide.title || t('lecture:chrome.slideNumberFallback', { number: currentSlide.slide_number })}
                      content={currentSlide.content_text || ''}
                      summary={currentSlide.summary || ''}
                      slideNumber={currentSlideIndex + 1}
                      totalSlides={slides.length}
                      onPrevious={handlePreviousSlide}
                      onNext={handleNextSlide}
                      isFirst={currentSlideIndex === 0}
                      isLast={currentSlideIndex === slides.length - 1}
                      pdfUrl={resolvedPdfUrl}
                      pageNumber={currentSlide.slide_number}
                      onConfidenceRate={async (rating) => {
                        if (!user || !currentSlide) return;
                        await logLearningEvent(user.id, 'confidence_rating', {
                          lectureId,
                          slideId: currentSlide.id,
                          slideTitle: currentSlide.title,
                          rating,
                          sessionId: sessionIdRef.current,
                          timestamp: new Date().toISOString(),
                        });
                      }}
                      mindMapState={
                        mindMap.isLoading
                          ? { kind: 'loading' }
                          : mindMap.isError
                            ? {
                                kind: 'error',
                                message: (mindMap.error as Error | null)?.message
                                  || 'Network error while loading mind map.',
                                onRetry: () => mindMap.refetch(),
                              }
                            : mindMap.data
                              ? { kind: 'ready', tree: mindMap.data }
                              : {
                                  kind: 'empty',
                                  canGenerate: role === 'professor',
                                  isGenerating: generateMindMap.isPending,
                                  onGenerate: () => generateMindMap.mutate(aiModel, {
                                    onError: (error: Error) => {
                                      toast({
                                        title: t('lecture:toasts.mindMapErrorTitle'),
                                        description: error.message || t('lecture:toasts.mindMapErrorDescription'),
                                        variant: 'destructive',
                                      });
                                    },
                                  }),
                                }
                      }
                      onMindMapSlideClick={(slideId) => {
                        const idx = slides.findIndex((s) => s.id === slideId);
                        if (idx >= 0) {
                          goToSlide(idx);
                          setShowQuiz(quizAnswers[idx] !== undefined);
                        }
                      }}
                      onMindMapRetry={() => mindMap.refetch()}
                      currentSlideId={currentSlide.id}
                      onAskAbout={(text) => {
                        setChatInput(text);
                        setTimeout(() => chatInputRef.current?.focus(), 50);
                      }}
                      onGenerateMindMap={() => {
                        generateMindMap.mutate(aiModel, {
                          onError: (error: Error) => {
                            toast({
                              title: t('lecture:toasts.mindMapErrorTitle'),
                              description: error.message || t('lecture:toasts.mindMapErrorDescription'),
                              variant: "destructive"
                            });
                          },
                          onSuccess: () => {
                            toast({
                              title: t('lecture:toasts.mindMapSuccessTitle'),
                              description: t('lecture:toasts.mindMapSuccessDescription'),
                            });
                          }
                        });
                      }}
                      isMindMapLoading={generateMindMap.isPending}
                      isProfessor={role === 'professor'}
                      onRegenerateContent={role === 'professor' ? handleRegenerateContent : undefined}
                      isRegeneratingContent={isRegeneratingContent}
                      regenInstruction={currentSlide?.regen_instruction ?? ''}
                      canUndoRegenerate={Boolean(currentSlide?.id) && regeneratedSlideIds.has(currentSlide!.id)}
                      onUndoRegenerate={role === 'professor' ? handleUndoRegenerateContent : undefined}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>


            </div>

            {/* Right Column: Tabs (Slide, Worksheets, Related) */}
            <div className="flex flex-col bg-[#0a0a12]/50 border border-white/5 rounded-3xl p-6 relative overflow-hidden backdrop-blur-sm min-h-[500px]">
              
              {/* Tabs UI */}
              <div className="flex items-center gap-6 border-b border-white/10 pb-4 mb-4">
                {(['slide', 'worksheets', 'related'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab);
                      if (tab !== 'slide') setChatActive(false);
                    }}
                    className={cn(
                      "text-sm font-bold uppercase tracking-widest transition-colors py-3 px-2 -ml-2 rounded-lg focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                      activeTab === tab ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    {tab === 'slide' ? 'Notes & Chat' : tab}
                  </button>
                ))}
              </div>

              {/* Assessment Overlays */}
              <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                {lectureCompleted ? (
                  <LectureRecap
                    items={recapItems}
                    xpEarned={xpEarned}
                    correctOnFirstTry={correctAnswers}
                    totalQuestions={questions.length || slides.length}
                    onDone={() => navigate(role === 'professor' ? ProfessorRoutes.DASHBOARD : StudentRoutes.HOME)}
                  />
                ) : reviewStage && currentReviewItem ? (
                  <motion.div
                    key={`review-${reviewIndex}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                    data-testid="review-stage"
                  >

                    <QuizCard
                      key={`review-card-${reviewIndex}`}
                      question={currentReviewItem.question.question_text}
                      options={currentReviewItem.question.options}
                      correctAnswer={currentReviewItem.question.correct_answer}
                      onAnswer={handleReviewAnswer}
                      onContinue={handleReviewContinue}
                      continueLabel={
                        reviewIndex < missedQueueRef.current.length - 1
                          ? t('lecture:navigation.next')
                          : t('lecture:navigation.finishLecture')
                      }
                      questionNumber={reviewIndex + 1}
                      totalQuestions={missedQueueRef.current.length}
                      initialSelectedAnswer={reviewSelectedAnswer}
                      explanation={currentReviewItem.question.explanation}
                      concept={currentReviewItem.question.concept}
                    />
                  </motion.div>
                ) : showQuiz && currentQuestion ? (
                  <motion.div
                    key={`quiz-${currentSlideIndex}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >

                    <QuizCard
                      question={currentQuestion.question_text}
                      options={currentQuestion.options}
                      correctAnswer={currentQuestion.correct_answer}
                      onAnswer={handleQuizAnswer}
                      onContinue={handleQuizContinue}
                      continueLabel={currentSlideIndex < slides.length - 1 ? t('lecture:navigation.continue') : t('lecture:navigation.finishLecture')}
                      questionNumber={currentSlideIndex + 1}
                      totalQuestions={slides.length}
                      initialSelectedAnswer={quizAnswers[currentSlideIndex]}
                      explanation={currentQuestion.explanation}
                      concept={currentQuestion.concept}
                      linkedSlides={
                        currentQuestion.linked_slides && currentQuestion.linked_slides.length > 0
                          ? currentQuestion.linked_slides.map((i) => i + 1)
                          : undefined
                      }
                      onJumpToSlide={(slideNumber) => {
                        const idx = Math.max(0, Math.min(slides.length - 1, slideNumber - 1));
                        goToSlide(idx);
                        setShowQuiz(quizAnswers[idx] !== undefined);
                      }}
                    />
                  </motion.div>
                ) : (
                  /* Tabs Content */
                  <div className="w-full">
                    {activeTab === 'worksheets' && (
                      <div className="space-y-6">
                        {lectureId && (
                          <>
                            <div className="bg-card/20 rounded-2xl border border-white/5 p-5">
                              <WorksheetsPanel lectureId={lectureId} editable={role === 'professor'} />
                            </div>
                            {role !== 'professor' && (
                              <div className="bg-card/20 rounded-2xl border border-white/5 p-5">
                                <StudentPracticeSheetsPanel lectureId={lectureId} />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {activeTab === 'related' && (
                      <div className="space-y-6">
                        {lectureId && (
                          <div className="bg-card/20 rounded-2xl border border-white/5 p-5">
                            <RelatedAcrossCoursesPanel lectureId={lectureId} />
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'slide' && (
                      chatActive ? (
                        <div className="flex flex-col min-h-[320px]">
                          <div className="flex items-center gap-3 py-2">
                            <button
                              onClick={() => setChatActive(false)}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                              aria-label="Back to slide notes"
                            >
                              <ArrowLeft className="h-4 w-4" />
                            </button>
                            <span className="text-sm font-semibold">Tutor</span>
                          </div>
                          <div ref={chatScrollRef} className="flex-1 space-y-8 py-4">
                            {messages.map((m) =>
                              m.role === 'user' ? (
                                <div key={m.id} className="flex flex-col items-end text-right w-full">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">You</span>
                                  <div className="text-sm text-indigo-200/80 max-w-[85%] leading-relaxed whitespace-pre-wrap">
                                    {m.content}
                                  </div>
                                </div>
                              ) : (
                                <div key={m.id} className="flex flex-col items-start text-left w-full">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">Response</span>
                                  <div className="text-sm text-foreground max-w-[85%]">
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
                              <div className="flex flex-col items-start text-left w-full">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">Response</span>
                                <div className="text-sm text-foreground max-w-[85%]">
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
                        </div>
                      ) : (
                        <div className="pt-2">
                          {currentSlide?.title && (
                            <h3 className="mb-4 text-2xl font-black tracking-tight">{currentSlide.title}</h3>
                          )}
                          {currentSlide?.summary || currentSlide?.content_text ? (
                            <div className={PROSE_CLASS}>
                              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                {currentSlide.summary || currentSlide.content_text || ''}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground/60">
                              <BookOpen className="w-12 h-12 opacity-20 mb-4" />
                              <p>This slide has no notes yet.</p>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Chat Input (Right Column) */}
              {!lectureCompleted && !reviewStage && !showQuiz && activeTab === 'slide' && slides.length > 0 && (
                <div className="pt-4 mt-2 border-t border-white/10 shrink-0">
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
                      ref={chatInputRef}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask AI about this slide…"
                      disabled={chatLoading}
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 rounded-md"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || chatLoading}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary transition-opacity hover:opacity-90 disabled:opacity-30 disabled:shadow-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                      aria-label="Send"
                    >
                      {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DepthScene>
  );
}
