import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, BookOpen, TrendingUp, BarChart3, Plus, Eye, Settings, 
  Trash2, Sparkles, Activity, GraduationCap, ChevronRight, 
  MoreHorizontal, Filter, ArrowRight, Archive
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { deleteLecture as deleteLectureService, fetchProfessorLectures, archiveLecture as archiveLectureService } from '@/services/lectureService';
import { listCourses, assignLectureToCourse, unassignLectureFromCourse, type Course } from '@/services/coursesService';
import type { Lecture } from '@/types/domain';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ProfessorAssignmentsTab } from '@/features/assignments/ProfessorAssignmentsTab';
import { ProfessorOverviewSection } from '@/features/analytics/components/ProfessorOverviewSection';
import { splitLectureTitle } from '@/lib/utils';
import { DepthScene, MediaRail, ConsoleTile } from '@/components/console';
import { ProfessorHeroStage } from '@/features/analytics/components/ProfessorHeroStage';
import { topicIcon } from '@/lib/topicIcon';


interface StudentStats {
  totalStudents: number;
  averageScore: number;
  totalQuizAttempts: number;
}

export default function ProfessorDashboard() {
  const { t, i18n } = useTranslation(['professor', 'common']);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  useEffect(() => {
    listCourses().then(setCourses).catch((e) => console.error('Failed to load courses', e));
  }, []);

  const handleAssignCourse = async (lecture: Lecture, nextCourseId: string | null) => {
    const prev = lecture.course_id ?? null;
    if (prev === nextCourseId) return;
    try {
      if (prev) await unassignLectureFromCourse(prev, lecture.id);
      if (nextCourseId) await assignLectureToCourse(nextCourseId, lecture.id);
      setLectures((prevList) =>
        prevList.map((l) => (l.id === lecture.id ? { ...l, course_id: nextCourseId } : l)),
      );
      toast({ title: t('professor:lectures.courseUpdated') });
    } catch (err) {
      toast({ title: t('professor:lectures.courseUpdateFailed'), description: String(err), variant: 'destructive' });
    }
  };
  const [stats, setStats] = useState<StudentStats>({
    totalStudents: 0,
    averageScore: 0,
    totalQuizAttempts: 0,
  });
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState(0);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);

    // Fetch the professor's own lectures first so we can scope progress queries.
    const { data: lecturesData } = await supabase
      .from('lectures')
      .select('id, title, description, total_slides, created_at, pdf_url, course_id')
      .eq('professor_id', user?.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(200);

    const ownLectureIds = (lecturesData ?? []).map(l => l.id);

    // Only fetch student progress for lectures this professor owns.
    // RLS now enforces this server-side as well, but we also filter explicitly
    // so the query intent is clear and does not rely solely on policy enforcement.
    const { data: progressData } = ownLectureIds.length > 0
      ? await supabase
          .from('student_progress')
          .select('user_id, quiz_score, total_questions_answered, correct_answers')
          .in('lecture_id', ownLectureIds)
          .limit(2000)
      : { data: [] };

    if (lecturesData) setLectures(lecturesData);

    if (progressData) {
      const uniqueStudents = new Set(progressData.map(p => p.user_id));
      const totalAttempts = progressData.reduce((sum: number, p: any) => sum + (p.total_questions_answered || 0), 0);
      const totalCorrect = progressData.reduce((sum: number, p: any) => sum + (p.correct_answers || 0), 0);
      const avgScore = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

      setStats({
        totalStudents: uniqueStudents.size,
        averageScore: avgScore,
        totalQuizAttempts: totalAttempts,
      });
    }

    setLoading(false);
  };

  const deleteLecture = async (lectureId: string) => {
    if (!window.confirm(t('professor:lectures.deleteConfirm'))) return;

    try {
      await deleteLectureService(lectureId);
      setLectures(prev => prev.filter(l => l.id !== lectureId));
      toast({ title: t('common:status.deleted'), description: t('professor:lectures.deleted') });
    } catch (err) {
      console.error(err);
      toast({ title: t('common:status.error'), description: t('professor:lectures.deleteFailed'), variant: 'destructive' });
    }
  };

  const handleArchiveLecture = async (lectureId: string, title: string) => {
    if (!window.confirm(`Archive lecture "${title}"? It will be hidden from students and your active dashboard. You can restore it anytime from the Archive.`)) return;

    try {
      await archiveLectureService(lectureId);
      setLectures(prev => prev.filter(l => l.id !== lectureId));
      toast({ title: 'Lecture archived', description: `Successfully archived "${title}".` });
    } catch (err) {
      console.error(err);
      toast({ title: t('common:status.error'), description: 'Failed to archive lecture.', variant: 'destructive' });
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('common:greetings.morning');
    if (hour < 17) return t('common:greetings.afternoon');
    return t('common:greetings.evening');
  };

  const profName = user?.email?.split('@')[0] || t('professor:defaultName');

  if (loading) {
    return (
      <DepthScene status="progress" gradientIndex={0}>
        <div className="console-bg/0 relative min-h-screen p-6 lg:p-12 space-y-10 max-w-[1600px] mx-auto">
          <div className="h-64 rounded-[2.5rem] bg-white/[0.04] animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 rounded-2xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
          <div className="h-96 rounded-[2rem] bg-white/[0.04] animate-pulse" />
        </div>
      </DepthScene>
    );
  }

  const focusedLec = lectures[focused] || null;

  return (
    <DepthScene status="progress" gradientIndex={focused} motionKey={focusedLec?.id}>
      {/* ── Diegetic first screen ── */}
      <section className="relative flex min-h-[calc(100svh-4rem)] flex-col">
        <div className="px-6 lg:px-12 pt-8 flex justify-end">
          <Button onClick={() => navigate('/professor/upload')} className="rounded-2xl shadow-glow-primary gradient-primary text-sm font-black uppercase tracking-widest hover:opacity-90 transition-all border-none text-white h-12 px-6">
            <Plus className="w-5 h-5 mr-2" /> {t('professor:createLecture')}
          </Button>
        </div>

        <div className="flex-1" />

        <div className="px-6 lg:px-12 pb-8 space-y-7">
          {focusedLec ? (
            <>
              <ProfessorHeroStage 
                lecture={focusedLec}
                eyebrow={`${getGreeting()} · ${profName}`}
                courses={courses}
                onAssignCourse={(courseId) => handleAssignCourse(focusedLec, courseId)}
                onAnalytics={() => navigate(`/professor/analytics/${focusedLec.id}`)}
                onEdit={() => navigate(`/professor/lecture/${focusedLec.id}`)}
                onPreview={() => navigate(`/lecture/${focusedLec.id}`)}
                onDelete={() => deleteLecture(focusedLec.id)}
              />
              
              <div className="mt-auto mb-12 relative min-h-[280px]">
                <MediaRail
                  items={lectures}
                  focused={focused}
                  onFocus={setFocused}
                  onActivate={(l) => navigate(`/professor/analytics/${l.id}`)}
                  getKey={(l) => l.id}
                  getAriaLabel={(l) => splitLectureTitle(l.title).cleanTitle}
                  enableKeyboard
                  cardWidth={176}
                  cardHeight={232}
                  step={196}
                  renderTile={(l, { isActive, index }) => {
                    const { cleanTitle, badge } = splitLectureTitle(l.title);
                    const LectureIcon = topicIcon(cleanTitle, l.id);
                    return (
                      <ConsoleTile
                        isActive={isActive}
                        selection="scale"
                        gradientIndex={index}
                        title={cleanTitle}
                        progress={0}
                        watermark={badge ?? <LectureIcon className="w-14 h-14 text-white/15" />}
                        badge={l.is_archived ? { kind: 'done', label: 'Archived' } : undefined}
                      />
                    );
                  }}
                />
              </div>
            </>
          ) : (
            <div className="max-w-2xl space-y-4">
              <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/60">
                {getGreeting()} · {profName}
              </span>
              <h1 className="text-5xl font-black tracking-tight">{t('professor:lectures.empty.title')}</h1>
              <p className="text-white/60">{t('professor:lectures.empty.description')}</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Below the fold: Stats, Course Overview, Assignments ── */}
      <motion.div
        className="console-bg/0 relative"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <div className="p-6 lg:p-12 max-w-[1600px] mx-auto space-y-12">
          {/* ── Global Analytics Header ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-foreground tracking-tight">Dashboard Overview</h2>
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mt-1 opacity-60">Aggregate Statistics</p>
              </div>
            </div>
            <Button variant="ghost" className="rounded-xl glass-card border-white/5 font-black uppercase text-[10px] tracking-widest h-10 px-6 hover:bg-primary/10 hover:text-primary transition-all" onClick={() => navigate('/professor/analytics')}>
              {t('professor:lectures.globalAnalytics')}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

          {/* ── Stats Grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatsCard title={t('professor:stats.totalStudents')} value={stats.totalStudents} icon={Users} variant="primary" />
            <StatsCard title={t('professor:stats.yourLectures')} value={lectures.length} icon={BookOpen} variant="default" />
            <StatsCard title={t('professor:stats.averageScore')} value={`${stats.averageScore}%`} icon={TrendingUp} variant="success" />
            <StatsCard title={t('professor:stats.quizAttempts')} value={stats.totalQuizAttempts} icon={Activity} variant="xp" />
          </div>

          {/* ── Course Overview (whole-course aggregate) ── */}
          <ProfessorOverviewSection courses={courses} />

          {/* ── Assignments Section ── */}
          <ProfessorAssignmentsTab lectures={lectures.map(l => ({ id: l.id, title: l.title }))} />
        </div>
      </motion.div>
    </DepthScene>
  );
}
