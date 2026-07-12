import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Zap, Trophy, X, Bot, ExternalLink, HelpCircle } from 'lucide-react';
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
import { LectureSidebar } from '@/components/LectureSidebar';
import { LectureChat } from '@/components/LectureChat';
import { WorksheetsPanel } from '@/components/WorksheetsPanel';
import { StudentPracticeSheetsPanel } from '@/features/practice_sheets/StudentPracticeSheetsPanel';
import { LectureRecap, type RecapItem } from '@/components/LectureRecap';
import { RelatedAcrossCoursesPanel } from '@/components/RelatedAcrossCoursesPanel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useToast } from '@/hooks/use-toast';
import { useMindMap } from '@/features/mindmap/hooks/useMindMap';
import { useAiModel } from '@/hooks/use-ai-model';
import { PomodoroTimer } from '@/components/PomodoroTimer';
import { AmbientGlow, GLOW_BY_STATUS } from '@/components/console';
import { StudentRoutes, ProfessorRoutes } from '@/lib/routes';
import { safeGetUUID } from '@/lib/utils';

import type { Slide, QuizQuestion, Lecture } from '@/types/domain';

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const { role } = useAuth();

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen console-bg overflow-hidden relative">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <AmbientGlow color={GLOW_BY_STATUS.progress} />
      </div>

      {/* Sidebar */}
      <LectureSidebar
        slides={slides}
        currentSlideIndex={currentSlideIndex}
        slideStates={slideStates}
        completionPct={completionPct}
        onSelectSlide={(index) => {
          goToSlide(index);
          setShowQuiz(quizAnswers[index] !== undefined);
        }}
        onValidateSlide={validateSlide}
        onMarkComplete={() => slideProgress.markLectureComplete()}
        onResetProgress={() => {
          if (window.confirm('Reset all slide progress for this lecture?')) {
            slideProgress.resetProgress();
            setQuizAnswers({});
            answeredQuestionsRef.current = new Set();
          }
        }}
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        {/* Header */}
        <header className="glass-panel border-b-0 px-6 py-4 flex items-center justify-between relative z-50">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(role === 'professor' ? ProfessorRoutes.DASHBOARD : StudentRoutes.HOME)}
              className="rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
              title={t('lecture:chrome.exitLecture')}
              aria-label={t('lecture:chrome.exitLecture')}
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
            
            <Button
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="gap-2 rounded-xl px-5 bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary border-none hover:opacity-90"
            >
              <Bot className="w-4 h-4" />
              <span className="text-xs font-bold">{t('lecture:tutor.title')}</span>
            </Button>
          </div>
        </header>

        {/* Content */}
        <ResizablePanelGroup direction="horizontal" className="flex-1 w-full h-full">
          <ResizablePanel defaultSize={isChatOpen ? 70 : 100} minSize={40} className="relative">
            <div ref={scrollableContainerRef} className="h-full overflow-y-auto custom-scrollbar relative">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
              {/* Main content - Slide viewer */}
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

              {/* Worksheets attached to this lecture (read-only for students) */}
              {lectureId && (
                <div className="bg-card/40 rounded-2xl border border-border p-5">
                  <WorksheetsPanel lectureId={lectureId} editable={role === 'professor'} />
                </div>
              )}

              {/* Practice Sheets — students see published sheets; professors see their own via LectureEdit */}
              {lectureId && role !== 'professor' && (
                <div className="bg-card/40 rounded-2xl border border-border p-5">
                  <StudentPracticeSheetsPanel lectureId={lectureId} />
                </div>
              )}

              {/* Cross-course concept overlap: surfaces other lectures that
                  cover concepts present on this lecture. */}
              {lectureId && (
                <RelatedAcrossCoursesPanel lectureId={lectureId} />
              )}

              {/* Sidebar - Quiz */}
              <div ref={quizRef}>
                <AnimatePresence mode="wait">
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
                      <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
                        <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
                          <HelpCircle className="w-5 h-5 text-primary-foreground" />
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-foreground">
                            {t('lecture:chrome.reviewMissed')}
                          </h2>
                          <p className="text-xs text-muted-foreground">
                            {t('lecture:chrome.reviewProgress', { current: reviewIndex + 1, total: missedQueueRef.current.length })}
                          </p>
                        </div>
                      </div>
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
                      <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
                        <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
                          <HelpCircle className="w-5 h-5 text-primary-foreground" />
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-foreground truncate max-w-[200px]">
                            {currentSlide?.title || t('lecture:chrome.quizFallback')}
                          </h2>
                          <p className="text-xs text-muted-foreground">{t('lecture:chrome.knowledgeCheck')}</p>
                        </div>
                      </div>
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
                        // ``linked_slides`` are 0-based indices from the
                        // planner; chip labels use 1-based slide numbers.
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
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="bg-card rounded-2xl border border-border p-6"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center">
                            <HelpCircle className="w-6 h-6 text-primary-foreground" />
                          </div>
                          <div>
                            <h1 className="text-xl font-bold text-foreground">
                              {currentSlide?.title || t('lecture:chrome.slideFallback')}
                            </h1>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-4">
                        {t('lecture:chrome.readSlideHint')}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Level-up / badge popups are rendered globally by GamificationProvider. */}

          </div> {/* End of scrollable center column */}
          </ResizablePanel>

          {/* Right Column - Chatbot */}
          {isChatOpen && (
            <>
              <ResizableHandle withHandle className="hidden md:flex bg-white/10" />
              <ResizablePanel defaultSize={30} minSize={20} maxSize={50} className="hidden md:block bg-surface-1/30">
                <LectureChat
                  isOpen={isChatOpen}
                  onClose={() => setIsChatOpen(false)}
                  slideText={currentSlide?.content_text || ''}
                  slideTitle={currentSlide?.title || t('lecture:chrome.slideFallback')}
                  slideId={currentSlide?.id}
                  sessionId={sessionIdRef.current}
                  lectureId={lectureId}
                  currentSlideIndex={currentSlideIndex}
                  onSlideJump={(idx) => {
                    if (idx >= 0 && idx < slides.length) {
                      goToSlide(idx);
                    }
                  }}
                  isInline={true}
                />
              </ResizablePanel>
            </>
          )}
          
          {/* Mobile Chat Drawer (Fallback) */}
          <div className="md:hidden">
            <LectureChat
              isOpen={isChatOpen}
              onClose={() => setIsChatOpen(false)}
              slideText={currentSlide?.content_text || ''}
              slideTitle={currentSlide?.title || t('lecture:chrome.slideFallback')}
              slideId={currentSlide?.id}
              sessionId={sessionIdRef.current}
              lectureId={lectureId}
              currentSlideIndex={currentSlideIndex}
              onSlideJump={(idx) => {
                if (idx >= 0 && idx < slides.length) {
                  goToSlide(idx);
                }
              }}
              isInline={false}
            />
          </div>
        </ResizablePanelGroup> {/* End of Resizable container */}
      </div>
    </div>
  );
}
