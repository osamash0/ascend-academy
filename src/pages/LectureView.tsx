import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, Zap, Trophy, X, Bot, ExternalLink, HelpCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { SlideViewer } from '@/components/SlideViewer';
import { QuizCard } from '@/components/QuizCard';
import { LevelUpModal } from '@/components/LevelUpModal';
import { BadgeEarnedModal } from '@/components/BadgeEarnedModal';
import { Button } from '@/components/ui/button';
import { LectureSidebar } from '@/components/LectureSidebar';
import { LectureChat } from '@/components/LectureChat';
import { useToast } from '@/hooks/use-toast';
import { useMindMap } from '@/features/mindmap/hooks/useMindMap';

interface Slide {
  id: string;
  slide_number: number;
  title: string | null;
  content_text: string | null;
  summary: string | null;
}

interface QuizQuestion {
  id: string;
  slide_id: string;
  question_text: string;
  options: string[];
  correct_answer: number;
}

interface Lecture {
  id: string;
  title: string;
  description: string | null;
  total_slides: number;
  pdf_url?: string | null;
}

export default function LectureView() {
  const { lectureId } = useParams<{ lectureId: string }>();
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [lecture, setLecture] = useState<Lecture | null>(null);
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

  // UI state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { role } = useAuth();

  // Mind map
  const { map: mindMap, generate: generateMindMap } = useMindMap(lectureId ?? null);

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
    const now = Date.now();

    // Logic to log previous slide duration
    const logSlideView = async (slideId: string, title: string, startTime: number) => {
      const duration = Math.round((Date.now() - startTime) / 1000); // seconds
      if (duration < 1) return; // Ignore very short views

      console.log(`DEBUG: Logging slide_view for ${slideId}, duration: ${duration}s`);
      await supabase.from('learning_events').insert({
        user_id: user.id,
        event_type: 'slide_view',
        event_data: {
          lectureId,
          slideId,
          slideTitle: title,
          duration_seconds: duration,
          timestamp: new Date().toISOString()
        },
      });
    };

    // Update the state for other logic (like quiz answer timing)
    setSlideStartTime(now);
    slideStartRef.current = now;

    // When slide changes, log the previous one
    return () => {
      if (currentSlideId) {
        logSlideView(currentSlideId, slides[currentSlideIndex]?.title || '', now);
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

    let currentLectureId = lectureId;
    if (!currentLectureId) return;

    try {
      // Fetch lecture - We removed slug resolution as the slug column was deleted
      const { data: lectureData, error: lectureError } = await supabase
        .from('lectures')
        .select('*, pdf_url')
        .eq('id', currentLectureId)
        .single();

      if (lectureError) {
        console.error('Error fetching lecture:', lectureError);
        toast({ title: 'Not Found', description: 'Lecture not found or error loading data.', variant: 'destructive' });
        navigate('/dashboard');
        return;
      }

      if (lectureData) {
        console.log('DEBUG: Fetched lecture data:', lectureData);
        setLecture(lectureData);
      }

    // Fetch slides
    const { data: slidesData } = await supabase
      .from('slides')
      .select('id, slide_number, title, content_text, summary')
      .eq('lecture_id', currentLectureId)
      .order('slide_number', { ascending: true })
      .limit(200);

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
    const { data: questionsData } = await supabase
      .from('quiz_questions')
      .select('*')
      .in('slide_id', slidesData?.map(s => s.id) || []);

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
      const { data: progressData } = await supabase
        .from('student_progress')
        .select('*')
        .eq('lecture_id', currentLectureId)
        .eq('user_id', user.id)
        .single();

      if (progressData) {
        if (progressData.last_slide_viewed !== null && progressData.last_slide_viewed >= 0) {
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
            
            // Map slide number to actual question ID if possible
            const slideId = slidesData?.[slideIndex]?.id;
            const qId = questionsData?.find(q => q.slide_id === slideId)?.id;
            if (qId) answeredQuestionsRef.current.add(qId);
          });
          setQuizAnswers(restoredAnswers);
        }
      }
    }

    // Log lecture start event
    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'lecture_start',
      event_data: { lectureId: currentLectureId },
    });

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
    const aiModel = localStorage.getItem('ascend-academy-ai-model') || 'groq';
    setIsRegeneratingContent(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/ai/slides/${currentSlide.id}/regenerate-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ ai_model: aiModel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Regeneration failed');
      }
      const json = await res.json();
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

  // Refined: Only get questions for the REALLY current slide ID
  const currentSlideQuestions = questions.filter(q => q.slide_id === currentSlide?.id);
  const currentQuestion = currentSlideQuestions[0]; // Assuming 1 question per slide for now

  const saveProgress = async (newSlideIndex: number, newXp: number, newCorrectAnswers: number) => {
    if (!user || !lectureId || !lecture) return;

    const totalQuestions = questions.length || slides.length; // Fallback only if no questions
    const cappedCorrect = Math.min(newCorrectAnswers, totalQuestions);

    await supabase.from('student_progress').upsert({
      user_id: user.id,
      lecture_id: lecture.id,
      last_slide_viewed: newSlideIndex,
      xp_earned: Math.min(newXp, totalQuestions * 10),
      correct_answers: cappedCorrect,
      completed_slides: slides.slice(0, Math.max(0, newSlideIndex + 1)).map(s => s.slide_number),
    }, {
      onConflict: 'user_id,lecture_id',
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
      
      // Log revision event
      supabase.from('learning_events').insert({
        user_id: user?.id,
        event_type: 'slide_back_navigation',
        event_data: {
          lectureId,
          fromSlideId: slides[currentSlideIndex]?.id,
          toSlideId: slides[prevIndex]?.id,
          timestamp: new Date().toISOString()
        }
      });

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

    // Log quiz attempt
    const timeToAnswer = Math.round((Date.now() - slideStartTime) / 1000);

    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'quiz_attempt',
      event_data: {
        lectureId,
        slideId: currentSlide?.id,
        slideTitle: currentSlide?.title,
        questionId: currentQuestion?.id,
        correct: isCorrect,
        selectedAnswer: selectedIndex,
        time_to_answer_seconds: timeToAnswer,
        timestamp: new Date().toISOString()
      },
    });

    if (isCorrect) {
      const newXp = xpEarned + 10;
      setXpEarned(newXp);
      setCorrectAnswers(prev => {
        const next = prev + 1;
        const totalQ = questions.length || 1;
        return Math.min(next, totalQ);
      });

      // Add XP to user — RPC should use auth.uid() internally
      await supabase.rpc('add_xp_to_user', {
        p_xp: 10,
      } as never);

      // Update streak — RPC should use auth.uid() internally
      const newStreak = await supabase.rpc('update_user_streak', {
        p_correct: true,
      } as never);

      // Check for level up
      const oldLevel = profile?.current_level || 1;
      const newTotalXp = (profile?.total_xp || 0) + 10;
      const calculatedLevel = Math.floor(newTotalXp / 100) + 1;

      if (calculatedLevel > oldLevel) {
        setNewLevel(calculatedLevel);
        setShowLevelUp(true);
        // Notification: level up
        await supabase.from('notifications').insert({
          user_id: user?.id,
          title: `Level ${calculatedLevel}!`,
          message: `You leveled up to Level ${calculatedLevel}. Keep going!`,
          type: 'level_up',
        });
      }
        // Badge: Level 5 Scholar
        if (calculatedLevel >= 5) {
          const { data: lvl5Badge } = await supabase
            .from('achievements')
            .select('id')
            .eq('user_id', user?.id)
            .eq('badge_name', 'Level 5 Scholar')
            .single();

          if (!lvl5Badge) {
            await supabase.from('achievements').insert({
              user_id: user?.id,
              badge_name: 'Level 5 Scholar',
              badge_description: 'Reached level 5!',
              badge_icon: '⭐',
            });
            setBadgeInfo({
              name: 'Level 5 Scholar',
              description: 'Reached level 5!',
              icon: '⭐',
            });
            setTimeout(() => setShowBadge(true), 500);
          }
        }

        // Badge: Level 10 Expert
        if (calculatedLevel >= 10) {
          const { data: lvl10Badge } = await supabase
            .from('achievements')
            .select('id')
            .eq('user_id', user?.id)
            .eq('badge_name', 'Level 10 Expert')
            .single();

          if (!lvl10Badge) {
            await supabase.from('achievements').insert({
              user_id: user?.id,
              badge_name: 'Level 10 Expert',
              badge_description: 'Reached level 10!',
              badge_icon: '🌟',
            });
            setBadgeInfo({
              name: 'Level 10 Expert',
              description: 'Reached level 10!',
              icon: '🌟',
            });
            setTimeout(() => setShowBadge(true), 500);
          }
        }

      // Check for achievements
      if (newStreak.data === 5 || newStreak.data === 10) {
        const badgeName = newStreak.data === 5 ? '5 Streak Master' : '10 Streak Champion';
        const { data: existingBadge } = await supabase
          .from('achievements')
          .select('id')
          .eq('user_id', user?.id)
          .eq('badge_name', badgeName)
          .single();

        if (!existingBadge) {
          await supabase.from('achievements').insert({
            user_id: user?.id,
            badge_name: badgeName,
            badge_description: `Achieved a streak of ${newStreak.data} correct answers!`,
            badge_icon: '🔥',
          });

          setBadgeInfo({
            name: badgeName,
            description: `Achieved a streak of ${newStreak.data} correct answers!`,
            icon: '🔥',
          });
          setTimeout(() => setShowBadge(true), 1000);
          // Notification: streak badge
          await supabase.from('notifications').insert({
            user_id: user?.id,
            title: badgeName,
            message: `Achieved a streak of ${newStreak.data} correct answers!`,
            type: 'streak',
          });
        }
      }

      await refreshProfile();
    } else {
      // Reset streak — RPC should use auth.uid() internally
      await supabase.rpc('update_user_streak', {
        p_correct: false,
      } as never);
      await refreshProfile();
    }

    // Persist progress immediately so reload cannot re-award XP for this question
    const finalXpNow = isCorrect ? xpEarned + 10 : xpEarned;
    const finalCorrectNow = isCorrect ? correctAnswers + 1 : correctAnswers;
    await saveProgress(currentSlideIndex, finalXpNow, finalCorrectNow);

    // Move to next slide after quiz
    setTimeout(() => {
      const isCorrectNow = isCorrect ? 1 : 0;
      const currentFinalXp = isCorrect ? xpEarned + 10 : xpEarned;
      const currentFinalCorrect = correctAnswers + isCorrectNow;

      if (currentSlideIndex < slides.length - 1) {
        const nextIndex = currentSlideIndex + 1;
        setCurrentSlideIndex(nextIndex);
        setShowQuiz(quizAnswers[nextIndex] !== undefined);
        saveProgress(nextIndex, currentFinalXp, currentFinalCorrect);
      } else {
        setShowQuiz(false);
        handleLectureComplete(currentFinalXp, currentFinalCorrect);
      }
    }, 1500);
  };

  const handleLectureComplete = async (finalXp: number = xpEarned, finalCorrect: number = correctAnswers) => {
    if (!lecture) return;

    const sessionDuration = Math.round((Date.now() - sessionStartRef.current) / 1000);

    // Log completion
    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'lecture_complete',
      event_data: {
        lectureId: lecture.id,
        xpEarned: finalXp,
        correctAnswers: finalCorrect,
        total_duration_seconds: sessionDuration,
        completed_at: new Date().toISOString()
      },
    });

    const cappedXp = slides.length > 0 ? Math.min(finalXp, slides.length * 10) : finalXp;
    const cappedCorrect = slides.length > 0 ? Math.min(finalCorrect, slides.length) : finalCorrect;

    // Update progress
    await supabase.from('student_progress').upsert({
      user_id: user?.id,
      lecture_id: lecture.id,
      xp_earned: cappedXp,
      completed_slides: slides.map((_, i) => i + 1),
      quiz_score: slides.length > 0 ? Math.round((cappedCorrect / slides.length) * 100) : 0,
      total_questions_answered: slides.length,
      correct_answers: cappedCorrect,
      completed_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,lecture_id',
    });

    // Check for first completion achievement
    const { data: firstQuizBadge } = await supabase
      .from('achievements')
      .select('id')
      .eq('user_id', user?.id)
      .eq('badge_name', 'First Quiz Completed')
      .single();

    if (!firstQuizBadge) {
      await supabase.from('achievements').insert({
        user_id: user?.id,
        badge_name: 'First Quiz Completed',
        badge_description: 'Completed your first lecture quiz!',
        badge_icon: '🎯',
      });

      setBadgeInfo({
        name: 'First Quiz Completed',
        description: 'Completed your first lecture quiz!',
        icon: '🎯',
      });
      setShowBadge(true);
      // Notification: first quiz badge
      await (supabase as any).from('notifications').insert({
        user_id: user?.id,
        title: 'First Quiz Completed 🎯',
        message: 'Completed your first lecture quiz!',
        type: 'achievement',
      });
    }

    // Badge: Perfect Score
    if (finalCorrect === slides.length && slides.length > 0) {
      const { data: perfectScoreBadge } = await supabase
        .from('achievements')
        .select('id')
        .eq('user_id', user?.id)
        .eq('badge_name', 'Perfect Score')
        .single();

      if (!perfectScoreBadge) {
        await supabase.from('achievements').insert({
          user_id: user?.id,
          badge_name: 'Perfect Score',
          badge_description: 'Got 100% on a lecture quiz!',
          badge_icon: '💯',
        });

        setBadgeInfo({
          name: 'Perfect Score',
          description: 'Got 100% on a lecture quiz!',
          icon: '💯',
        });
        setTimeout(() => setShowBadge(true), 1500);
      }
    }

    // Badge: Bookworm (5 lectures) & Graduate (10 lectures)
    const { count } = await supabase
      .from('student_progress')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user?.id);

    if (count && (count >= 5 || count >= 10)) {
      const badgesToCheck = [
        { name: 'Bookworm', threshold: 5, description: 'Complete 5 lectures', icon: '📚' },
        { name: 'Graduate', threshold: 10, description: 'Complete 10 lectures', icon: '🎓' }
      ];

      for (const badge of badgesToCheck) {
        if (count >= badge.threshold) {
          const { data: existingBadge } = await supabase
            .from('achievements')
            .select('id')
            .eq('user_id', user?.id)
            .eq('badge_name', badge.name)
            .single();

          if (!existingBadge) {
            await supabase.from('achievements').insert({
              user_id: user?.id,
              badge_name: badge.name,
              badge_description: badge.description,
              badge_icon: badge.icon,
            });

            setBadgeInfo({
              name: badge.name,
              description: badge.description,
              icon: badge.icon,
            });
            setTimeout(() => setShowBadge(true), 3000);
          }
        }
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

            {lecture?.pdf_url && (
              <Button
                onClick={() => window.open(lecture.pdf_url!, '_blank', 'noopener noreferrer')}
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
                      pdfUrl={lecture?.pdf_url}
                      pageNumber={currentSlide.slide_number}
                      onConfidenceRate={async (rating) => {
                        if (!user || !currentSlide) return;
                        await supabase.from('learning_events').insert({
                          user_id: user.id,
                          event_type: 'confidence_rating',
                          event_data: {
                            lectureId,
                              slideId: currentSlide.id,
                              slideTitle: currentSlide.title,
                              rating,
                              timestamp: new Date().toISOString(),
                            },
                          });
                        }}
                      mindMapData={mindMap.data ?? null}
                      currentSlideId={currentSlide.id}
                      onGenerateMindMap={() => {
                        const model = localStorage.getItem('ascend-academy-ai-model') || 'gemini-2.5-flash';
                        generateMindMap.mutate(model, {
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
                  {showQuiz && currentQuestion ? (
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
                        questionNumber={currentSlideIndex + 1}
                        totalQuestions={slides.length}
                        initialSelectedAnswer={quizAnswers[currentSlideIndex]}
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
          />
        </div>
      </div>
    </div>
  );
}
