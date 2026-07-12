import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, FolderOpen, BookOpen, GraduationCap, Sparkles, NotebookText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import { LectureCard } from '@/components/LectureCard';
import { CommandPalette } from '@/components/CommandPalette';
import { FEATURES } from '@/lib/featureFlags';
import { splitLectureTitle } from '@/lib/utils';
import { StudentRoutes } from '@/lib/routes';

export default function StudentCourseView() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [askOpen, setAskOpen] = useState(false);

  const { data, isLoading } = useStudentDashboard();
  const lectures = data?.lectures || [];
  const progress = data?.progress || [];

  const getProgressForLecture = (lectureId: string) => 
    progress.find(p => p.lecture_id === lectureId);

  // Filter lectures for this specific course
  const courseLectures = lectures.filter(l => 
    courseId === '__uncat__' 
      ? (!l.course_id && !l.course?.id)
      : (l.course_id === courseId || l.course?.id === courseId)
  );

  // Determine course title
  const courseTitle = courseId === '__uncat__'
    ? t('dashboard:uncategorized')
    : courseLectures[0]?.course?.title || t('dashboard:courseFallback');

  // Sort lectures by prefix badge, then created_at
  const sortedLectures = [...courseLectures].sort((a, b) => {
    const badgeA = splitLectureTitle(a.title).badge;
    const badgeB = splitLectureTitle(b.title).badge;
    const numA = badgeA ? parseFloat(badgeA) : Infinity;
    const numB = badgeB ? parseFloat(badgeB) : Infinity;
    if (numA !== numB) return numA - numB;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Identify first uncompleted lecture
  const firstUncompletedId = sortedLectures.find(l => {
    const p = getProgressForLecture(l.id);
    const completed = p?.completed_slides?.length || 0;
    return completed < l.total_slides || l.total_slides === 0;
  })?.id;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background">
      {/* Background gradients for modern look */}
      <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:50px_50px]" />
      <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none" />
      
      <div className="relative z-10 p-6 lg:p-10 max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <motion.button
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-colors w-fit group"
            >
              <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Back to Dashboard
            </motion.button>

            <div className="flex items-center gap-2">
              {FEATURES.globalSearch && courseId && courseId !== '__uncat__' && (
                <button
                  onClick={() => setAskOpen(true)}
                  className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-primary hover:bg-primary/20 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('search:entry.askThisCourse')}
                </button>
              )}
              {courseId && courseId !== '__uncat__' && (
                <button
                  onClick={() => navigate(StudentRoutes.EXAM(courseId))}
                  className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-primary hover:bg-primary/20 transition-colors"
                >
                  <GraduationCap className="w-3.5 h-3.5" />
                  {t('exam:generate.title')}
                </button>
              )}
              {courseId && courseId !== '__uncat__' && (
                <button
                  onClick={() => navigate(StudentRoutes.STUDY_GUIDE(courseId))}
                  className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-primary hover:bg-primary/20 transition-colors"
                  id="course-study-guide-btn"
                >
                  <NotebookText className="w-3.5 h-3.5" />
                  Study Guide
                </button>
              )}
              {/* Temporary toggle to preview the experimental PS5-style library */}
              <button
                onClick={() => navigate(`/course-v3/${courseId}`)}
                className="rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-primary hover:bg-primary/20 transition-colors"
              >
                Try new view →
              </button>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shadow-glow-primary flex-shrink-0">
              <FolderOpen className="w-8 h-8 text-primary" />
            </div>
            <div>
              <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Course Pathway</span>
              <h1 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">{courseTitle}</h1>
            </div>
          </motion.div>
        </div>

        {/* Timeline */}
        {sortedLectures.length === 0 ? (
           <div className="glass-card p-12 text-center flex flex-col items-center">
             <BookOpen className="w-12 h-12 text-muted-foreground/50 mb-4" />
             <h3 className="text-xl font-bold">Empty Course</h3>
             <p className="text-muted-foreground">This course doesn't have any active lectures yet.</p>
           </div>
        ) : (
          <div className="relative w-full py-6 pl-4 sm:pl-8">
            {/* Vertical continuous line */}
            <div className="absolute top-0 bottom-0 left-[15px] sm:left-[31px] w-0.5 bg-white/5 rounded-full" />

            {/* "Start" Indicator */}
            <div className="relative z-10 flex items-center gap-4 mb-8 -ml-[5px]">
              <div className="w-3 h-3 rounded-full bg-primary shadow-glow-primary ring-4 ring-background" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Sequence Start</span>
            </div>

            <div className="flex flex-col gap-6 relative z-10">
              <AnimatePresence mode="popLayout">
                {sortedLectures.map((lecture, index) => {
                  const lectureProgress = getProgressForLecture(lecture.id);
                  const isNext = lecture.id === firstUncompletedId;
                  
                  return (
                    <motion.div
                      key={lecture.id}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.05 }}
                      className="relative flex items-center group/timeline w-full"
                    >
                      {/* Connection node on the timeline */}
                      <div className={`absolute -left-[19px] sm:-left-[35px] w-4 h-4 rounded-full border-[3px] border-background transition-all duration-300 z-20 ${
                        isNext 
                          ? 'bg-primary ring-2 ring-primary/50 shadow-glow-primary scale-125' 
                          : 'bg-white/20 group-hover/timeline:bg-primary/50'
                      }`} />

                      <div className="w-full transition-transform duration-300 hover:translate-x-2">
                        <LectureCard
                          id={lecture.id}
                          title={lecture.title}
                          description={lecture.description || undefined}
                          totalSlides={lecture.total_slides}
                          completedSlides={lectureProgress?.completed_slides?.length || 0}
                          quizScore={lectureProgress?.correct_answers || 0}
                          totalQuestions={lectureProgress?.total_questions_answered || 0}
                          isNextUp={isNext}
                          index={index}
                          onClick={() => navigate(`/lecture/${lecture.id}`)}
                        />
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* "Finish" Indicator */}
            <div className="relative z-10 flex items-center gap-4 mt-8 -ml-[5px]">
              <div className="w-3 h-3 rounded-full bg-white/20 ring-4 ring-background" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Sequence Finish</span>
            </div>
          </div>
        )}
      </div>

      {FEATURES.globalSearch && courseId && courseId !== '__uncat__' && (
        <CommandPalette
          open={askOpen}
          onOpenChange={setAskOpen}
          initialCourseId={courseId}
          initialCourseTitle={courseTitle}
        />
      )}
    </div>
  );
}
