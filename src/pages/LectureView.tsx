import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, Zap, Trophy, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { SlideViewer } from '@/components/SlideViewer';
import { QuizCard } from '@/components/QuizCard';
import { LevelUpModal } from '@/components/LevelUpModal';
import { BadgeEarnedModal } from '@/components/BadgeEarnedModal';
import { Button } from '@/components/ui/button';
import { LectureSidebar } from '@/components/LectureSidebar';
import { useToast } from '@/hooks/use-toast';

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

  // UI state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { role } = useAuth(); // role is 'professor' or 'student'

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

    let currentLectureId = lectureId;
    if (!currentLectureId) return;

    // Resolve slug to ID if necessary
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentLectureId);

    if (!isUuid) {
      const { data: routeData } = await supabase
        .from('lectures')
        .select('id')
        .eq('slug' as any, currentLectureId)
        .single();

      if (routeData) {
        currentLectureId = routeData.id;
      } else {
        toast({ title: 'Not Found', description: 'Lecture not found.', variant: 'destructive' });
        navigate('/dashboard');
        return;
      }
    }

    // Fetch lecture
    const { data: lectureData } = await supabase
      .from('lectures')
      .select('*, pdf_url')
      .eq('id', currentLectureId)
      .single();

    if (lectureData) {
      console.log('DEBUG: Fetched lecture data:', lectureData);
      setLecture(lectureData);
    }

    // Fetch slides
    const { data: slidesData } = await supabase
      .from('slides')
      .select('*')
      .eq('lecture_id', currentLectureId)
      .order('slide_number', { ascending: true });

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
        if (progressData.xp_earned) setXpEarned(progressData.xp_earned);
        if (progressData.correct_answers) setCorrectAnswers(progressData.correct_answers);
      }
    }

    // Log lecture start event
    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'lecture_start',
      event_data: { lectureId: currentLectureId },
    });

    setLoading(false);
  };

  const currentSlide = slides[currentSlideIndex];

  // Refined: Only get questions for the REALLY current slide ID
  const currentSlideQuestions = questions.filter(q => q.slide_id === currentSlide?.id);
  const currentQuestion = currentSlideQuestions[0]; // Assuming 1 question per slide for now

  const saveProgress = async (newSlideIndex: number, newXp: number, newCorrectAnswers: number) => {
    if (!user || !lectureId || !lecture) return;

    await supabase.from('student_progress').upsert({
      user_id: user.id,
      lecture_id: lecture.id,
      last_slide_viewed: newSlideIndex,
      xp_earned: newXp,
      correct_answers: newCorrectAnswers,
      completed_slides: slides.slice(0, Math.max(0, newSlideIndex)).map(s => s.slide_number),
    }, {
      onConflict: 'user_id,lecture_id',
    });
  };

  const handleNextSlide = () => {
    // If we're not showing the quiz yet, and there IS a quiz for this slide, show it first
    if (!showQuiz && currentQuestion) {
      setShowQuiz(true);
      return;
    }

    // If we already showed the quiz (or there wasn't one), then move forward
    if (currentSlideIndex < slides.length - 1) {
      const nextIndex = currentSlideIndex + 1;
      setCurrentSlideIndex(nextIndex);
      setShowQuiz(false); // Hide quiz for the NEW slide initially
      setCurrentQuestionIndex(0);
      saveProgress(nextIndex, xpEarned, correctAnswers);
    } else {
      // It was the last slide
      handleLectureComplete(xpEarned, correctAnswers);
    }
  };

  const handlePreviousSlide = () => {
    if (showQuiz) {
      setShowQuiz(false);
      return;
    }

    if (currentSlideIndex > 0) {
      const prevIndex = currentSlideIndex - 1;
      setCurrentSlideIndex(prevIndex);
      setShowQuiz(false);
      saveProgress(prevIndex, xpEarned, correctAnswers);
    }
  };

  const handleQuizAnswer = async (isCorrect: boolean) => {
    // Log quiz attempt
    const timeToAnswer = Math.round((Date.now() - slideStartTime) / 1000);

    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'quiz_attempt',
      event_data: {
        slideId: currentSlide?.id,
        slideTitle: currentSlide?.title,
        questionId: currentQuestion?.id,
        correct: isCorrect,
        time_to_answer_seconds: timeToAnswer,
        timestamp: new Date().toISOString()
      },
    });

    if (isCorrect) {
      const newXp = xpEarned + 10;
      setXpEarned(newXp);
      setCorrectAnswers(prev => prev + 1);

      // Add XP to user
      await supabase.rpc('add_xp_to_user', {
        p_user_id: user?.id,
        p_xp: 10,
      });

      // Update streak
      const newStreak = await supabase.rpc('update_user_streak', {
        p_user_id: user?.id,
        p_correct: true,
      });

      // Check for level up
      const oldLevel = profile?.current_level || 1;
      const newTotalXp = (profile?.total_xp || 0) + 10;
      const calculatedLevel = Math.floor(newTotalXp / 100) + 1;

      if (calculatedLevel > oldLevel) {
        setNewLevel(calculatedLevel);
        setShowLevelUp(true);
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
        }
      }

      await refreshProfile();
    } else {
      // Reset streak
      await supabase.rpc('update_user_streak', {
        p_user_id: user?.id,
        p_correct: false,
      });
      await refreshProfile();
    }

    // Move to next slide after quiz
    setTimeout(() => {
      setShowQuiz(false);

      const isCorrectNow = isCorrect ? 1 : 0;
      const currentFinalXp = isCorrect ? xpEarned + 10 : xpEarned;
      const currentFinalCorrect = correctAnswers + isCorrectNow;

      if (currentSlideIndex < slides.length - 1) {
        const nextIndex = currentSlideIndex + 1;
        setCurrentSlideIndex(nextIndex);
        saveProgress(nextIndex, currentFinalXp, currentFinalCorrect);
      } else {
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

    // Update progress
    await supabase.from('student_progress').upsert({
      user_id: user?.id,
      lecture_id: lecture.id,
      xp_earned: finalXp,
      completed_slides: slides.map((_, i) => i + 1),
      quiz_score: slides.length > 0 ? Math.round((finalCorrect / slides.length) * 100) : 0,
      total_questions_answered: slides.length,
      correct_answers: finalCorrect,
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
    }

    toast({
      title: 'Lecture Complete! 🎉',
      description: `You earned ${xpEarned} XP and got ${correctAnswers}/${slides.length} correct!`,
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header */}
        <div className="border-b border-border bg-card">
          <div className="w-full px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigate('/dashboard')}
                  className="rounded-full border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                  title="Exit Lecture"
                >
                  <X className="w-4 h-4" />
                </Button>
                <div>
                  <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                    <button
                      onClick={() => navigate('/dashboard')}
                      className="hover:text-foreground transition-colors"
                    >
                      Dashboard
                    </button>
                    <span>/</span>
                    <span className="text-foreground truncate max-w-[180px]">{lecture?.title || 'Lecture'}</span>
                  </nav>
                  <p className="text-sm text-muted-foreground">
                    Slide {currentSlideIndex + 1} of {slides.length}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-lg">
                  <Zap className="w-4 h-4 text-xp" />
                  <span className="font-semibold text-foreground">+{xpEarned} XP</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-lg">
                  <Trophy className="w-4 h-4 text-success" />
                  <span className="font-semibold text-foreground">{correctAnswers}/{slides.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="w-full px-6 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Main content - Slide viewer */}
              <div className="lg:col-span-2">
                <AnimatePresence mode="wait">
                  {currentSlide && (
                    <motion.div
                      key={`slide-${currentSlideIndex}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
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
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Sidebar - Quiz */}
              <div>
                <AnimatePresence mode="wait">
                  {showQuiz && currentQuestion ? (
                    <motion.div
                      key={`quiz-${currentSlideIndex}`}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                    >
                      <QuizCard
                        question={currentQuestion.question_text}
                        options={currentQuestion.options}
                        correctAnswer={currentQuestion.correct_answer}
                        onAnswer={handleQuizAnswer}
                        questionNumber={currentSlideIndex + 1}
                        totalQuestions={slides.length}
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
                            <BookOpen className="w-6 h-6 text-primary-foreground" />
                          </div>
                          <div>
                            <h1 className="text-2xl font-bold text-foreground">{lecture?.title}</h1>
                            <p className="text-muted-foreground">{slides.length} Slides</p>
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
        </div>
      </div>
    </div>
  );
}
