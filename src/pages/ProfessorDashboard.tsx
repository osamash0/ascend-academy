import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, BookOpen, TrendingUp, BarChart3, Plus, Eye, Settings, 
  Trash2, Sparkles, Activity, GraduationCap, ChevronRight, 
  MoreHorizontal, Filter, ArrowRight
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { deleteLecture as deleteLectureService, fetchProfessorLectures } from '@/services/lectureService';
import { listCourses, assignLectureToCourse, unassignLectureFromCourse, type Course } from '@/services/coursesService';
import type { Lecture } from '@/types/domain';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ProfessorAssignmentsTab } from '@/features/assignments/ProfessorAssignmentsTab';
import { ProfessorOverviewSection } from '@/features/analytics/components/ProfessorOverviewSection';


interface StudentStats {
  totalStudents: number;
  averageScore: number;
  totalQuizAttempts: number;
}

/* ── Orbital Background for Professor View ── */
function ProfessorOrbitalBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      <motion.div
        className="absolute top-[-15%] right-[-5%] w-[50%] h-[50%] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(158 64% 52% / 0.06) 0%, transparent 70%)',
          filter: 'blur(120px)',
        }}
        animate={{ scale: [1, 1.1, 1], x: [0, -20, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-15%] left-[-5%] w-[45%] h-[45%] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(234 89% 68% / 0.05) 0%, transparent 70%)',
          filter: 'blur(100px)',
        }}
        animate={{ scale: [1, 1.15, 1], y: [0, -15, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
      />
    </div>
  );
}

export default function ProfessorDashboard() {
  const { t } = useTranslation(['professor', 'common']);
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
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

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
      const totalAttempts = progressData.reduce((sum, p) => sum + (p.total_questions_answered || 0), 0);
      const totalCorrect = progressData.reduce((sum, p) => sum + (p.correct_answers || 0), 0);
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

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('common:greetings.morning');
    if (hour < 17) return t('common:greetings.afternoon');
    return t('common:greetings.evening');
  };

  const profName = user?.email?.split('@')[0] || t('professor:defaultName');

  if (loading) {
    return (
      <div className="relative min-h-screen p-6 lg:p-10 space-y-10 max-w-[1600px] mx-auto">
        <ProfessorOrbitalBackground />
        <div className="h-64 glass-panel rounded-[2.5rem] animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-6 animate-pulse h-32" />
          ))}
        </div>
        <div className="glass-card rounded-[2rem] h-96 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen pb-32 bg-background max-w-[1600px] mx-auto">
      <ProfessorOrbitalBackground />
      
      <div className="relative z-10 p-6 lg:p-10 space-y-10">
        
        {/* ── Hero Banner ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-[2.5rem] overflow-hidden glass-panel border-white/5 shadow-2xl"
        >
          {/* Animated orbs */}
          <motion.div
            className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none"
            animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
            transition={{ duration: 8, repeat: Infinity }}
          />
          <motion.div
            className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-accent/10 blur-[100px] pointer-events-none"
            animate={{ scale: [1, 1.1, 1], opacity: [0.1, 0.3, 0.1] }}
            transition={{ duration: 10, repeat: Infinity, delay: 1 }}
          />

          <div className="relative p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.4em] mb-3 opacity-60"
              >
                {t('professor:commandCenter')}
              </motion.p>
              <motion.h1
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="text-4xl md:text-5xl font-black text-foreground tracking-tight"
              >
                {(() => {
                  const parts = t('professor:greeting', {
                    greeting: getGreeting(),
                    name: '__NAME__',
                  }).split('__NAME__');
                  return (
                    <>
                      {parts[0]}
                      <span className="text-gradient">{profName}</span>
                      {parts[1] ?? ''}
                    </>
                  );
                })()}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-lg text-muted-foreground mt-4 max-w-2xl font-medium leading-relaxed"
              >
                {(() => {
                  const raw = t('professor:summary', {
                    students: stats.totalStudents,
                    accuracy: stats.averageScore,
                    lectures: lectures.length,
                  });
                  const segments = raw.split(/<bold>|<\/bold>/);
                  return segments.map((seg, idx) =>
                    idx % 2 === 1
                      ? <strong key={idx} className="text-foreground">{seg}</strong>
                      : <span key={idx}>{seg}</span>
                  );
                })()}
              </motion.p>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 }}
              className="flex-shrink-0"
            >
              <Button onClick={() => navigate('/professor/upload')} className="h-16 px-10 rounded-2xl gap-3 shadow-glow-primary gradient-primary text-base font-black uppercase tracking-widest hover:opacity-90 transition-all border-none text-white">
                <Plus className="w-6 h-6" /> {t('professor:createLecture')}
              </Button>
            </motion.div>
          </div>
        </motion.div>

        {/* ── Course Overview (whole-course aggregate) ── */}
        <ProfessorOverviewSection courses={courses} />

        {/* ── Stats Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsCard
            title={t('professor:stats.totalStudents')}
            value={stats.totalStudents}
            icon={Users}
            variant="primary"
          />
          <StatsCard
            title={t('professor:stats.yourLectures')}
            value={lectures.length}
            icon={BookOpen}
            variant="default"
          />
          <StatsCard
            title={t('professor:stats.averageScore')}
            value={`${stats.averageScore}%`}
            icon={TrendingUp}
            variant="success"
          />
          <StatsCard
            title={t('professor:stats.quizAttempts')}
            value={stats.totalQuizAttempts}
            icon={Activity}
            variant="xp"
          />
        </div>

        {/* ── Lectures Section ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <GraduationCap className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-foreground tracking-tight">{t('professor:lectures.sectionTitle')}</h2>
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mt-1 opacity-60">{t('professor:lectures.sectionSubtitle')}</p>
              </div>
            </div>
            <Button variant="ghost" className="rounded-xl glass-card border-white/5 font-black uppercase text-[10px] tracking-widest h-10 px-6 hover:bg-primary/10 hover:text-primary transition-all" onClick={() => navigate('/professor/analytics')}>
              <BarChart3 className="w-4 h-4 mr-2" />
              {t('professor:lectures.globalAnalytics')}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

          {lectures.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card p-20 text-center border-dashed border-2 border-white/5"
            >
              <div className="w-20 h-20 rounded-[2.5rem] bg-surface-2 border border-white/5 flex items-center justify-center mx-auto mb-6">
                <BookOpen className="w-10 h-10 text-muted-foreground/30" />
              </div>
              <h3 className="text-2xl font-black text-foreground mb-3 tracking-tight">{t('professor:lectures.empty.title')}</h3>
              <p className="text-muted-foreground max-w-md mx-auto font-medium mb-10">
                {t('professor:lectures.empty.description')}
              </p>
              <Button 
                onClick={() => navigate('/professor/upload')}
                className="h-14 px-8 rounded-xl shadow-glow-primary gradient-primary font-black uppercase tracking-widest border-none text-white"
              >
                <Plus className="w-5 h-5 mr-3" />
                {t('professor:lectures.empty.cta')}
              </Button>
            </motion.div>
          ) : (
            <div className="glass-card rounded-[2.5rem] border-white/5 overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/5">
                      <th className="px-10 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        {t('professor:lectures.table.details')}
                      </th>
                      <th className="px-10 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        {t('professor:lectures.table.slideCount')}
                      </th>
                      <th className="px-10 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        {t('professor:lectures.table.launchDate')}
                      </th>
                      <th className="px-10 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        {t('professor:lectures.table.status')}
                      </th>
                      <th className="px-10 py-6 text-right text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        {t('professor:lectures.table.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {lectures.map((lecture, index) => (
                      <motion.tr
                        key={lecture.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        onMouseEnter={() => setHoveredRow(lecture.id)}
                        onMouseLeave={() => setHoveredRow(null)}
                        onClick={() => navigate(`/professor/analytics/${lecture.id}`)}
                        className={`hover:bg-white/5 transition-all group cursor-pointer ${hoveredRow === lecture.id ? 'bg-white/5' : ''}`}
                      >
                        <td className="px-10 py-6">
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-300 ${hoveredRow === lecture.id ? 'bg-primary/20 shadow-glow-primary border-primary/30' : 'bg-surface-2 border border-white/5'}`}>
                              <BookOpen className={`w-6 h-6 transition-colors ${hoveredRow === lecture.id ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <div>
                              <p className="font-black text-foreground text-lg tracking-tight group-hover:text-primary transition-colors">{lecture.title}</p>
                              {lecture.description && (
                                <p className="text-sm text-muted-foreground font-medium mt-1 line-clamp-1 opacity-70">
                                  {lecture.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-10 py-6">
                          <span className="font-black text-foreground/80">{lecture.total_slides}</span>
                        </td>
                        <td className="px-10 py-6">
                          <span className="font-bold text-muted-foreground">
                            {new Date(lecture.created_at).toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric', 
                              year: 'numeric' 
                            })}
                          </span>
                        </td>
                        <td className="px-10 py-6">
                          <div className="flex flex-col items-start gap-2">
                            <span className={`inline-flex items-center gap-2 text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest border transition-all ${lecture.pdf_url 
                              ? 'bg-success/10 text-success border-success/20 shadow-glow-success/5' 
                              : 'bg-warning/10 text-warning border-warning/20'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${lecture.pdf_url ? 'bg-success animate-pulse' : 'bg-warning'}`} />
                              {lecture.pdf_url ? 'Active Protocol' : 'No Source PDF'}
                            </span>
                            <select
                              value={lecture.course_id ?? ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleAssignCourse(lecture, e.target.value || null);
                              }}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                              title={t('professor:lectures.courseAssignment')}
                            >
                              <option value="">{t('professor:lectures.uncategorized')}</option>
                              {courses.map((c) => (
                                <option key={c.id} value={c.id}>{c.title}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-10 py-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-xl w-10 h-10 text-primary hover:bg-primary/10 shadow-sm border border-transparent hover:border-primary/20"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/professor/analytics/${lecture.id}`);
                                }}
                                title={t('professor:lectures.actions.analytics')}
                              >
                                <BarChart3 className="w-5 h-5" />
                              </Button>
                            </motion.div>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-xl w-10 h-10 text-muted-foreground hover:bg-white/10 shadow-sm border border-transparent hover:border-white/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/lecture/${lecture.id}`);
                                }}
                                title={t('professor:lectures.actions.preview')}
                              >
                                <Eye className="w-5 h-5" />
                              </Button>
                            </motion.div>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-xl w-10 h-10 text-muted-foreground hover:bg-white/10 shadow-sm border border-transparent hover:border-white/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/professor/lecture/${lecture.id}`);
                                }}
                                title={t('professor:lectures.actions.edit')}
                              >
                                <Settings className="w-5 h-5" />
                              </Button>
                            </motion.div>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-xl w-10 h-10 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shadow-sm border border-transparent hover:border-destructive/20"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteLecture(lecture.id);
                                }}
                                title={t('professor:lectures.actions.delete')}
                              >
                                <Trash2 className="w-5 h-5" />
                              </Button>
                            </motion.div>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Assignments Section ── */}
        <ProfessorAssignmentsTab
          lectures={lectures.map(l => ({ id: l.id, title: l.title }))}
        />
      </div>
    </div>
  );
}
