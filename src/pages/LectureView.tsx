import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, Zap, Trophy, X, Bot, ExternalLink, HelpCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { fetchLecture, fetchSlides, fetchQuizQuestions, resolvePdfUrl } from '@/services/lectureService';
import {
  fetchLectureProgress,
  upsertLectureProgress,
  logLearningEvent,
  checkAchievementExists,
  awardAchievement,
  insertNotification,
  countCompletedLectures,
} from '@/services/studentService';
import { apiClient } from '@/lib/apiClient';
import { checkLevelUp } from '@/domain/gamification';
import { SlideViewer } from '@/components/SlideViewer';
import { QuizCard } from '@/components/QuizCard';
import { LevelUpModal } from '@/components/LevelUpModal';
import { BadgeEarnedModal } from '@/components/BadgeEarnedModal';
import { Button } from '@/components/ui/button';
import { LectureSidebar } from '@/components/LectureSidebar';
import { LectureChat } from '@/components/LectureChat';
import { useToast } from '@/hooks/use-toast';
import { useMindMap } from '@/features/mindmap/hooks/useMindMap';
import { useAiModel } from '@/hooks/use-ai-model';

import type { Slide, QuizQuestion, Lecture } from '@/types/domain';

export default function LectureView() {
  const { lectureId } = useParams<{ lectureId: string }>();
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [resolvedPdfUrl, setResolvedPdfUrl] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [xpEarned, setXpEarned] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [newLevel, setNewLevel] = useState(1);
  const [showBadge, setShowBadge] = useState(false);
  const [badgeInfo, setBadgeInfo] = useState({ name: '', description: '', icon: '' });
  const [slideStartTime, setSlideStartTime] = useState<number>(Date.now());
  const sessionStartRef = useRef<number>(Date.now());
  const slideStartRef = useRef<number>(Date.now());
  const quizRef = useRef<HTMLDivElement>(null);
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
    Array<{ question: QuizQuestion; slideIndex: number; firstSelectedIndex: number }>
  >([]);
  const [reviewStage, setReviewStage] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewSelectedAnswer, setReviewSelectedAnswer] = useState<number | null>(null);
  const reviewAnsweredRef = useRef<Set<string>>(new Set());
  const reviewContinueLockRef = useRef<boolean>(false);

  // UI state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { role } = useAuth();

  // Mind map
  const { map: mindMap, generate: generateMindMap } = useMindMap(lectureId ?? null);
  const { aiModel } = useAiModel();

  // Slide content regeneration (professor only)
  const [isRegeneratingContent, setIsRegeneratingContent] = useState(false);

  useEffect(() => {
    if (lectureId && user) {
      fetchLectureData();
    }
  }, [lectureId, user]);



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

  const fetchLectureData = async () => {
    setLoading(true);
    
    // Reset session state for new lecture
    setCurrentSlideIndex(0);
    setCurrentQuestionIndex(0);
    setShowQuiz(false);
    setQuizAnswers({});
    setXpEarned(0);
    setCorrectAnswers(0);

    // Reset replay/review session state so a previously-loaded lecture
    // doesn't leak its missed-question queue or review progress into the
    // newly loaded one.
    missedQueueRef.current = [];
    reviewAnsweredRef.current = new Set();
    reviewContinueLockRef.current = false;
    setReviewStage(false);
    setReviewIndex(0);
    setReviewSelectedAnswer(null);

    let currentLectureId = lectureId;
    if (!currentLectureId) return;

    try {
      const lectureData = await fetchLecture(currentLectureId);
      if (!lectureData) {
        toast({ title: 'Not Found', description: 'Lecture not found or error loading data.', variant: 'destructive' });
        navigate('/dashboard');
        return;
      }
      setLecture(lectureData);

    // Resolve the stored pdf_url (path or legacy public URL) to an authenticated
    // signed URL so the private bucket is accessible in the browser.
    resolvePdfUrl(lectureData.pdf_url).then(setResolvedPdfUrl).catch(() => setResolvedPdfUrl(null));

    // Fetch slides
    const slidesFromService = await fetchSlides(currentLectureId);
    const slidesData = slidesFromService.length > 0 ? slidesFromService : null;

    if (slidesData && slidesData.length > 0) {
      setSlides(slidesData);
    } else {
      // Create mock slides if none exist
      const mockSlides: Slide[] = [
        {
          id: '1',
          slide_number: 1,
          title: 'Introduction',
          content_text: 'Welcome to this lecture! This is where we\'ll cover the fundamental concepts that form the foundation of our topic.\n\nLearning Objectives:\n• Understand core principles\n• Apply theoretical knowledge\n• Develop critical thinking skills',
          summary: 'This slide introduces the course objectives and sets expectations for the learning journey ahead.',
        },
        {
          id: '2',
          slide_number: 2,
          title: 'Core Concepts',
          content_text: 'Let\'s explore the key concepts that underpin our subject matter.\n\n1. Principle One: The fundamental building block\n2. Principle Two: How components interact\n3. Principle Three: Real-world applications\n\nThese concepts will be essential for understanding more advanced topics.',
          summary: 'The core concepts establish the theoretical framework for understanding the subject matter.',
        },
        {
          id: '3',
          slide_number: 3,
          title: 'Practical Applications',
          content_text: 'Now let\'s see how these concepts apply in practice.\n\nCase Study 1: Industry Implementation\nCase Study 2: Research Applications\nCase Study 3: Everyday Examples\n\nUnderstanding practical applications helps bridge the gap between theory and practice.',
          summary: 'Practical applications demonstrate how theoretical concepts translate into real-world solutions.',
        },
        {
          id: '4',
          slide_number: 4,
          title: 'Summary & Next Steps',
          content_text: 'Key Takeaways:\n\n✓ We covered the fundamental principles\n✓ We explored practical applications\n✓ We connected theory to practice\n\nNext Steps:\n• Review the material\n• Complete the practice exercises\n• Prepare questions for the next session',
          summary: 'This final slide summarizes the key points and outlines the next steps in the learning journey.',
        },
      ];
      setSlides(mockSlides);
    }

    // Fetch questions
    const questionsFromService = await fetchQuizQuestions(currentLectureId);
    const questionsData = questionsFromService.length > 0 ? questionsFromService : null;

    if (questionsData && questionsData.length > 0) {
      setQuestions(questionsData.map(q => ({
        ...q,
        options: Array.isArray(q.options) ? q.options as string[] : []
      })));
    } else {
      // Create mock questions
      const mockQuestions: QuizQuestion[] = [
        {
          id: 'q1',
          slide_id: '1',
          question_text: 'What is the primary learning objective of this lecture?',
          options: ['Memorize facts', 'Develop critical thinking skills', 'Pass the exam', 'Complete assignments'],
          correct_answer: 1,
        },
        {
          id: 'q2',
          slide_id: '2',
          question_text: 'How many core principles were discussed in the lecture?',
          options: ['Two', 'Three', 'Four', 'Five'],
          correct_answer: 1,
        },
        {
          id: 'q3',
          slide_id: '3',
          question_text: 'What helps bridge the gap between theory and practice?',
          options: ['Memorization', 'Practical applications', 'Textbook reading', 'Lectures only'],
          correct_answer: 1,
        },
        {
          id: 'q4',
          slide_id: '4',
          question_text: 'What is recommended as the next step after completing this lecture?',
          options: ['Move to advanced topics immediately', 'Skip the practice exercises', 'Review the material', 'Ignore the summary'],
          correct_answer: 2,
        },
      ];
      setQuestions(mockQuestions);
    }

    // Fetch user progress
    if (user?.id) {
      const progressData = await fetchLectureProgress(user.id, currentLectureId);

      if (progressData) {
        if (progressData.last_slide_viewed !== null && progressData.last_slide_viewed !== undefined && progressData.last_slide_viewed >= 0) {
          const maxSlides = slidesData && slidesData.length > 0 ? slidesData.length : 4;
          const lastIndex = Math.min(progressData.last_slide_viewed, maxSlides - 1);
          setCurrentSlideIndex(lastIndex);
        }
        if (progressData.xp_earned) setXpEarned(Math.min(progressData.xp_earned, questionsData?.length ? questionsData.length * 10 : 0));
        if (progressData.correct_answers) setCorrectAnswers(Math.min(progressData.correct_answers, questionsData?.length || 0));

        // Restore locked state for previously answered questions
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
      }
    }

    // Log lecture start event (fire-and-forget; never block lecture load)
    if (user?.id) {
      logLearningEvent(user.id, 'lecture_start', { lectureId: currentLectureId })
        .catch((err) => console.warn('lecture_start telemetry failed', err));
    }

    setLoading(false);
    } catch (err) {
      console.error('Fatal error in fetchLectureData:', err);
      toast({ title: 'Error', description: 'A system error occurred.', variant: 'destructive' });
      setLoading(false);
    }
  };

  const currentSlide = slides[currentSlideIndex];

  const handleRegenerateContent = async () => {
    if (!currentSlide || !user) return;
    setIsRegeneratingContent(true);
    try {
      const json = await apiClient.post<{ slide: Slide }>(`/api/ai/slides/${currentSlide.id}/regenerate-content`, { ai_model: aiModel });
      const updated = json.slide;
      // Patch the slide in local state so the UI updates immediately
      setSlides(prev => prev.map(s =>
        s.id === currentSlide.id
          ? { ...s, title: updated.title, content_text: updated.content_text, summary: updated.summary }
          : s
      ));
      toast({ title: 'Slide re-analyzed', description: 'AI content has been updated using vision analysis.' });
    } catch (err: any) {
      toast({ title: 'Re-analysis failed', description: err.message || 'Could not regenerate content.', variant: 'destructive' });
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

  const saveProgress = async (newSlideIndex: number, newXp: number, newCorrectAnswers: number) => {
    if (!user || !lectureId || !lecture) return;

    const totalQuestions = questions.length || slides.length;
    const cappedCorrect = Math.min(newCorrectAnswers, totalQuestions);

    await upsertLectureProgress(user.id, lecture.id, {
      last_slide_viewed: newSlideIndex,
      xp_earned: Math.min(newXp, totalQuestions * 10),
      correct_answers: cappedCorrect,
      completed_slides: slides.slice(0, Math.max(0, newSlideIndex + 1)).map(s => s.slide_number),
    });
  };

  const handleNextSlide = () => {
    // If we're not showing the quiz yet, and there IS a quiz for this slide, show it first
    if (!showQuiz && currentQuestion) {
      setShowQuiz(true);
      // Auto-scroll to quiz on mobile/small screens if it's below the content
      setTimeout(() => {
        quizRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return;
    }

    // If we already showed the quiz (or there wasn't one), then move forward
    if (currentSlideIndex < slides.length - 1) {
      const nextIndex = currentSlideIndex + 1;
      setCurrentSlideIndex(nextIndex);
      setShowQuiz(quizAnswers[nextIndex] !== undefined);
      setCurrentQuestionIndex(0);
      saveProgress(nextIndex, xpEarned, correctAnswers);
    } else {
      // It was the last slide
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
      
      // Fire-and-forget revision event
      if (user) {
        logLearningEvent(user.id, 'slide_back_navigation', {
          lectureId,
          fromSlideId: slides[currentSlideIndex]?.id,
          toSlideId: slides[prevIndex]?.id,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }

      setCurrentSlideIndex(prevIndex);
      setShowQuiz(quizAnswers[prevIndex] !== undefined);
      saveProgress(prevIndex, xpEarned, correctAnswers);
    }
  };

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
        timestamp: new Date().toISOString(),
      }).catch((err) => console.warn('quiz_attempt telemetry failed', err));
    }

    // Track wrong answers for the end-of-lecture replay stage. Each missed
    // question is queued exactly once per run; second-pass attempts during
    // the replay are tracked separately via handleReviewAnswer.
    if (!isCorrect && currentQuestion) {
      const alreadyQueued = missedQueueRef.current.some(
        (m) => m.question.id === currentQuestion.id,
      );
      if (!alreadyQueued) {
        missedQueueRef.current.push({
          question: currentQuestion,
          slideIndex: currentSlideIndex,
          firstSelectedIndex: selectedIndex,
        });
      }
    }

    if (isCorrect) {
      const newXp = xpEarned + 10;
      setXpEarned(newXp);
      setCorrectAnswers(prev => {
        const next = prev + 1;
        const totalQ = questions.length || 1;
        return Math.min(next, totalQ);
      });

      // Add XP to user — function uses auth.uid() internally; no user ID argument needed.
      await supabase.rpc('add_xp_to_user', { p_xp: 10 } as never);

      // Update streak — function uses auth.uid() internally; no user ID argument needed.
      const newStreak = await supabase.rpc('update_user_streak', {
        p_correct: true,
      } as never);

      // Check for level up using pure domain function
      const { newLevel: calculatedLevel, leveledUp } = checkLevelUp(profile?.total_xp || 0, 10);
      if (leveledUp && user) {
        setNewLevel(calculatedLevel);
        setShowLevelUp(true);
        await insertNotification(user.id, `Level ${calculatedLevel}!`, `You leveled up to Level ${calculatedLevel}. Keep going!`, 'level_up');
      }

      if (user) {
        // Badge: Level 5 Scholar
        if (calculatedLevel >= 5 && !(await checkAchievementExists(user.id, 'Level 5 Scholar'))) {
          await awardAchievement(user.id, { name: 'Level 5 Scholar', description: 'Reached level 5!', icon: '⭐' });
          setBadgeInfo({ name: 'Level 5 Scholar', description: 'Reached level 5!', icon: '⭐' });
          setTimeout(() => setShowBadge(true), 500);
        }

        // Badge: Level 10 Expert
        if (calculatedLevel >= 10 && !(await checkAchievementExists(user.id, 'Level 10 Expert'))) {
          await awardAchievement(user.id, { name: 'Level 10 Expert', description: 'Reached level 10!', icon: '🌟' });
          setBadgeInfo({ name: 'Level 10 Expert', description: 'Reached level 10!', icon: '🌟' });
          setTimeout(() => setShowBadge(true), 500);
        }

        // Streak badges
        if (newStreak.data === 5 || newStreak.data === 10) {
          const badgeName = newStreak.data === 5 ? '5 Streak Master' : '10 Streak Champion';
          if (!(await checkAchievementExists(user.id, badgeName))) {
            await awardAchievement(user.id, {
              name: badgeName,
              description: `Achieved a streak of ${newStreak.data} correct answers!`,
              icon: '🔥',
            });
            setBadgeInfo({ name: badgeName, description: `Achieved a streak of ${newStreak.data} correct answers!`, icon: '🔥' });
            setTimeout(() => setShowBadge(true), 1000);
            await insertNotification(user.id, badgeName, `Achieved a streak of ${newStreak.data} correct answers!`, 'streak');
          }
        }
      }

      await refreshProfile();
    } else {
      // Reset streak — function uses auth.uid() internally; no user ID argument needed.
      await supabase.rpc('update_user_streak', { p_correct: false } as never);
      await refreshProfile();
    }

    // Persist progress immediately so reload cannot re-award XP for this question
    const finalXpNow = isCorrect ? xpEarned + 10 : xpEarned;
    const finalCorrectNow = isCorrect ? correctAnswers + 1 : correctAnswers;
    // Stash authoritative values for handleQuizContinue — React state may not
    // yet reflect the setXpEarned / setCorrectAnswers calls above.
    committedXpRef.current = finalXpNow;
    committedCorrectRef.current = finalCorrectNow;
    // A new question was just answered → re-arm the continue lock.
    continueLockRef.current = false;
    await saveProgress(currentSlideIndex, finalXpNow, finalCorrectNow);

    // Advancement is now driven by the Continue button (see handleQuizContinue),
    // so we no longer auto-advance on a 1.5s timer. The student controls the pace.
  };

  const handleQuizContinue = () => {
    // Idempotency guard — a fast double-click must not advance/complete twice.
    if (continueLockRef.current) return;
    continueLockRef.current = true;

    // Read committed values from refs (set in handleQuizAnswer) so we never
    // race against pending setState calls.
    const xp = committedXpRef.current || xpEarned;
    const correct = committedCorrectRef.current || correctAnswers;

    if (currentSlideIndex < slides.length - 1) {
      const nextIndex = currentSlideIndex + 1;
      setCurrentSlideIndex(nextIndex);
      setShowQuiz(quizAnswers[nextIndex] !== undefined);
      saveProgress(nextIndex, xp, correct);
    } else {
      setShowQuiz(false);
      // If the student got anything wrong during the run, route them through
      // the replay stage before firing completion. Otherwise complete now.
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
    const key = `${item.question.id}#${reviewIndex}`;
    if (reviewAnsweredRef.current.has(key)) return;
    reviewAnsweredRef.current.add(key);

    setReviewSelectedAnswer(selectedIndex);
    reviewContinueLockRef.current = false;

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

    const sessionDuration = Math.round((Date.now() - sessionStartRef.current) / 1000);

    if (!user) return;

    // Fire-and-forget telemetry — completion flow must finish even if logging fails.
    logLearningEvent(user.id, 'lecture_complete', {
      lectureId: lecture.id,
      xpEarned: finalXp,
      correctAnswers: finalCorrect,
      total_duration_seconds: sessionDuration,
      completed_at: new Date().toISOString(),
    }).catch((err) => console.warn('lecture_complete telemetry failed', err));

    const cappedXp = slides.length > 0 ? Math.min(finalXp, slides.length * 10) : finalXp;
    const cappedCorrect = slides.length > 0 ? Math.min(finalCorrect, slides.length) : finalCorrect;

    await upsertLectureProgress(user.id, lecture.id, {
      xp_earned: cappedXp,
      completed_slides: slides.map((_, i) => i + 1),
      quiz_score: slides.length > 0 ? Math.round((cappedCorrect / slides.length) * 100) : 0,
      total_questions_answered: slides.length,
      correct_answers: cappedCorrect,
      completed_at: new Date().toISOString(),
    });

    // Badge: First Quiz Completed
    if (!(await checkAchievementExists(user.id, 'First Quiz Completed'))) {
      await awardAchievement(user.id, { name: 'First Quiz Completed', description: 'Completed your first lecture quiz!', icon: '🎯' });
      setBadgeInfo({ name: 'First Quiz Completed', description: 'Completed your first lecture quiz!', icon: '🎯' });
      setShowBadge(true);
      await insertNotification(user.id, 'First Quiz Completed 🎯', 'Completed your first lecture quiz!', 'achievement');
    }

    // Badge: Perfect Score
    if (finalCorrect === slides.length && slides.length > 0) {
      if (!(await checkAchievementExists(user.id, 'Perfect Score'))) {
        await awardAchievement(user.id, { name: 'Perfect Score', description: 'Got 100% on a lecture quiz!', icon: '💯' });
        setBadgeInfo({ name: 'Perfect Score', description: 'Got 100% on a lecture quiz!', icon: '💯' });
        setTimeout(() => setShowBadge(true), 1500);
      }
    }

    // Badges: Bookworm (5 lectures) & Graduate (10 lectures)
    const count = await countCompletedLectures(user.id);
    const milestoneBadges = [
      { name: 'Bookworm', threshold: 5, description: 'Complete 5 lectures', icon: '📚' },
      { name: 'Graduate', threshold: 10, description: 'Complete 10 lectures', icon: '🎓' },
    ];
    for (const badge of milestoneBadges) {
      if (count >= badge.threshold && !(await checkAchievementExists(user.id, badge.name))) {
        await awardAchievement(user.id, badge);
        setBadgeInfo({ name: badge.name, description: badge.description, icon: badge.icon });
        setTimeout(() => setShowBadge(true), 3000);
      }
    }

    toast({
      title: 'Lecture Complete! 🎉',
      description: `You earned ${xpEarned} XP and got ${correctAnswers}/${questions.length || slides.length} correct!`,
    });

    setTimeout(() => navigate('/dashboard'), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden relative">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div
          className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] rounded-full"
          style={{
            background: 'radial-gradient(circle, hsl(234 89% 68% / 0.05) 0%, transparent 70%)',
            filter: 'blur(100px)',
          }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Sidebar */}
      <LectureSidebar
        slides={slides}
        currentSlideIndex={currentSlideIndex}
        completedSlides={slides.slice(0, currentSlideIndex).map(s => s.slide_number)}
        onSelectSlide={(index) => {
          setCurrentSlideIndex(index);
          setShowQuiz(false);
        }}
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        {/* Header */}
        <header className="glass-panel border-b-0 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/dashboard')}
              className="rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
              title="Exit Lecture"
            >
              <X className="w-5 h-5" />
            </Button>
            <div className="flex flex-col">
              <nav className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest mb-0.5">
                <span className="opacity-50">Course</span>
                <span className="opacity-30">/</span>
                <span className="truncate max-w-[200px]">{lecture?.title || 'Loading...'}</span>
              </nav>
              <h1 className="text-sm font-bold text-foreground truncate max-w-[300px]">
                {currentSlide?.title || 'Slide View'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
                <span className="text-xs font-bold">Source PDF</span>
              </Button>
            )}
            
            <Button
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="gap-2 rounded-xl px-5 bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary border-none hover:opacity-90"
            >
              <Bot className="w-4 h-4" />
              <span className="text-xs font-bold">AI Tutor</span>
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
              {/* Main content - Slide viewer */}
              <AnimatePresence mode="wait">
                {currentSlide && (
                  <motion.div
                    key={`slide-${currentSlideIndex}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SlideViewer
                      title={currentSlide.title || `Slide ${currentSlide.slide_number}`}
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
                          timestamp: new Date().toISOString(),
                        });
                      }}
                      mindMapData={mindMap.data ?? null}
                      currentSlideId={currentSlide.id}
                      onGenerateMindMap={() => {
                        generateMindMap.mutate(aiModel, {
                          onError: (error: any) => {
                            toast({
                              title: "Generation Failed",
                              description: error.message || "Could not generate mind map. Check your AI configuration.",
                              variant: "destructive"
                            });
                          },
                          onSuccess: () => {
                            toast({
                              title: "Mind Map Generated",
                              description: "The knowledge tree has been successfully constructed.",
                            });
                          }
                        });
                      }}
                      isMindMapLoading={generateMindMap.isPending}
                      isProfessor={role === 'professor'}
                      onRegenerateContent={role === 'professor' ? handleRegenerateContent : undefined}
                      isRegeneratingContent={isRegeneratingContent}
                    />
                    </motion.div>
                  )}
                </AnimatePresence>

              {/* Sidebar - Quiz */}
              <div ref={quizRef}>
                <AnimatePresence mode="wait">
                  {reviewStage && currentReviewItem ? (
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
                            Review missed questions
                          </h2>
                          <p className="text-xs text-muted-foreground">
                            {reviewIndex + 1} of {missedQueueRef.current.length} · second attempt
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
                            ? 'Next question'
                            : 'Finish lecture'
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
                            {currentSlide?.title || 'Quiz'}
                          </h2>
                          <p className="text-xs text-muted-foreground">Knowledge Check</p>
                        </div>
                      </div>
                      <QuizCard
                        question={currentQuestion.question_text}
                        options={currentQuestion.options}
                        correctAnswer={currentQuestion.correct_answer}
                        onAnswer={handleQuizAnswer}
                        onContinue={handleQuizContinue}
                        continueLabel={currentSlideIndex < slides.length - 1 ? 'Continue' : 'Finish lecture'}
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
                          setCurrentSlideIndex(idx);
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
                              {currentSlide?.title || 'Lecture Slide'}
                            </h1>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-4">
                        Read through the slide and click "Next" to answer a quiz question about the content.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Modals */}
          <LevelUpModal
            isOpen={showLevelUp}
            onClose={() => setShowLevelUp(false)}
            newLevel={newLevel}
          />

          <BadgeEarnedModal
            isOpen={showBadge}
            onClose={() => setShowBadge(false)}
            badgeName={badgeInfo.name}
            badgeDescription={badgeInfo.description}
            badgeIcon={badgeInfo.icon}
          />

          <LectureChat
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            slideText={currentSlide?.content_text || ''}
            slideTitle={currentSlide?.title || 'Lecture Slide'}
            lectureId={lectureId}
            currentSlideIndex={currentSlideIndex}
            onSlideJump={(idx) => {
              if (idx >= 0 && idx < slides.length) {
                setCurrentSlideIndex(idx);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
