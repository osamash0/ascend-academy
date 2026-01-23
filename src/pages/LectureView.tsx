import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, Zap, Trophy } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { SlideViewer } from '@/components/SlideViewer';
import { QuizCard } from '@/components/QuizCard';
import { LevelUpModal } from '@/components/LevelUpModal';
import { BadgeEarnedModal } from '@/components/BadgeEarnedModal';
import { Button } from '@/components/ui/button';
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

  useEffect(() => {
    if (lectureId && user) {
      fetchLectureData();
    }
  }, [lectureId, user]);

  const fetchLectureData = async () => {
    setLoading(true);

    // Fetch lecture
    const { data: lectureData } = await supabase
      .from('lectures')
      .select('*')
      .eq('id', lectureId)
      .single();

    if (lectureData) {
      setLecture(lectureData);
    }

    // Fetch slides
    const { data: slidesData } = await supabase
      .from('slides')
      .select('*')
      .eq('lecture_id', lectureId)
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

    // Log lecture start event
    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'lecture_start',
      event_data: { lectureId },
    });

    setLoading(false);
  };

  const currentSlide = slides[currentSlideIndex];
  const currentSlideQuestions = questions.filter(
    q => q.slide_id === currentSlide?.id || 
    (questions.length > 0 && currentSlideIndex < questions.length)
  );
  const currentQuestion = currentSlideQuestions[currentQuestionIndex] || questions[currentSlideIndex];

  const handleNextSlide = () => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(prev => prev + 1);
      setShowQuiz(true);
      setCurrentQuestionIndex(0);
    } else {
      // Lecture complete
      handleLectureComplete();
    }
  };

  const handlePreviousSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(prev => prev - 1);
      setShowQuiz(false);
    }
  };

  const handleQuizAnswer = async (isCorrect: boolean) => {
    // Log quiz attempt
    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'quiz_attempt',
      event_data: {
        slideId: currentSlide?.id,
        questionId: currentQuestion?.id,
        correct: isCorrect,
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
      if (currentSlideIndex < slides.length - 1) {
        setCurrentSlideIndex(prev => prev + 1);
      } else {
        handleLectureComplete();
      }
    }, 1500);
  };

  const handleLectureComplete = async () => {
    // Log completion
    await supabase.from('learning_events').insert({
      user_id: user?.id,
      event_type: 'lecture_complete',
      event_data: { lectureId, xpEarned, correctAnswers },
    });

    // Update progress
    await supabase.from('student_progress').upsert({
      user_id: user?.id,
      lecture_id: lectureId,
      xp_earned: xpEarned,
      completed_slides: slides.map((_, i) => i + 1),
      quiz_score: Math.round((correctAnswers / slides.length) * 100),
      total_questions_answered: slides.length,
      correct_answers: correctAnswers,
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="font-semibold text-foreground">{lecture?.title || 'Lecture'}</h1>
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
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content - Slide viewer */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="wait">
              {!showQuiz && currentSlide && (
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
                  <div className="text-center">
                    <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <BookOpen className="w-8 h-8 text-primary-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Quiz Time!</h3>
                    <p className="text-sm text-muted-foreground">
                      Read through the slide and click "Next" to answer a quiz question about the content.
                    </p>
                  </div>
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
  );
}
