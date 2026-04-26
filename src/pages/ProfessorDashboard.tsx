import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, BookOpen, TrendingUp, BarChart3, Plus, Eye, Settings, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface Lecture {
  id: string;
  slug?: string | null;
  title: string;
  description: string | null;
  total_slides: number;
  created_at: string;
  pdf_url?: string | null;
}

interface StudentStats {
  totalStudents: number;
  averageScore: number;
  totalQuizAttempts: number;
}

export default function ProfessorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [stats, setStats] = useState<StudentStats>({
    totalStudents: 0,
    averageScore: 0,
    totalQuizAttempts: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user?.id]);

  const fetchData = async () => {
    setLoading(true);

    // Fetch professor's lectures
    const { data: lecturesData } = await supabase
      .from('lectures')
      .select('*')
      .eq('professor_id', user?.id)
      .order('created_at', { ascending: false });

    if (lecturesData) {
      setLectures(lecturesData);
    }

    // Fetch student statistics
    const { data: progressData } = await supabase
      .from('student_progress')
      .select('user_id, quiz_score, total_questions_answered, correct_answers');

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
    if (!window.confirm('Are you sure you want to delete this lecture? This cannot be undone.')) return;

    try {
      // 1. Get slide IDs for this lecture
      const { data: slidesData } = await supabase
        .from('slides')
        .select('id')
        .eq('lecture_id', lectureId);
      const slideIds = slidesData?.map(s => s.id) || [];

      // 2. Delete quiz questions
      if (slideIds.length > 0) {
        await supabase.from('quiz_questions').delete().in('slide_id', slideIds);
      }

      // 3. Delete student progress
      await supabase.from('student_progress').delete().eq('lecture_id', lectureId);

      // 4. Delete slides
      await supabase.from('slides').delete().eq('lecture_id', lectureId);

      // 5. Delete PDF from storage
      const { data: lectureData } = await supabase
        .from('lectures')
        .select('pdf_url')
        .eq('id', lectureId)
        .single();
      if (lectureData?.pdf_url) {
        const pathMatch = lectureData.pdf_url.match(/lecture-pdfs\/(.+)$/);
        if (pathMatch) {
          await supabase.storage.from('lecture-pdfs').remove([pathMatch[1]]);
        }
      }

      // 6. Delete the lecture itself
      await supabase.from('lectures').delete().eq('id', lectureId);

      setLectures(prev => prev.filter(l => l.id !== lectureId));
      toast({ title: 'Deleted', description: 'Lecture deleted successfully.' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to delete lecture.', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        {/* Stats skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-5 animate-pulse">
              <div className="h-4 w-24 bg-muted rounded mb-3" />
              <div className="h-8 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
        {/* Lecture table skeleton */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden animate-pulse">
          <div className="h-12 bg-muted/50 border-b border-border" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-6 py-4 border-b border-border last:border-0">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 bg-muted rounded" />
                <div className="h-3 w-1/2 bg-muted rounded" />
              </div>
              <div className="h-4 w-12 bg-muted rounded" />
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="flex gap-2">
                <div className="h-8 w-8 bg-muted rounded" />
                <div className="h-8 w-8 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const profName = user?.email?.split('@')[0] || 'Professor';

  return (
    <div className="p-6 lg:p-10 space-y-10 pb-32 max-w-[1600px] mx-auto">
      {/* ── Hero Banner ── */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
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
              Command Center Dashboard
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="text-4xl md:text-5xl font-black text-foreground tracking-tight"
            >
              {getGreeting()}, <span className="text-primary">{profName}.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-lg text-muted-foreground mt-4 max-w-2xl font-medium leading-relaxed"
            >
              System analysis confirms <strong className="text-foreground">{stats.totalStudents} students</strong> are actively engaged. Global accuracy is holding at <strong className="text-success">{stats.averageScore}%</strong> across your <strong className="text-foreground">{lectures.length} academic streams</strong>.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className="flex-shrink-0"
          >
            <Button onClick={() => navigate('/professor/upload')} className="h-16 px-10 rounded-2xl gap-3 shadow-glow-primary gradient-primary text-base font-black uppercase tracking-widest hover:opacity-90 transition-all">
              <Plus className="w-6 h-6" /> Create Lecture
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Students"
          value={stats.totalStudents}
          icon={Users}
          variant="primary"
        />
        <StatsCard
          title="Your Lectures"
          value={lectures.length}
          icon={BookOpen}
          variant="default"
        />
        <StatsCard
          title="Average Score"
          value={`${stats.averageScore}%`}
          icon={TrendingUp}
          variant="success"
        />
        <StatsCard
          title="Quiz Attempts"
          value={stats.totalQuizAttempts}
          icon={BarChart3}
          variant="xp"
        />
      </div>

      {/* Lectures Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-foreground tracking-tight">Active Academic Streams</h2>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mt-1 opacity-60">Manage your interactive learning materials</p>
          </div>
          <Button variant="ghost" className="rounded-xl glass-card border-white/5 font-black uppercase text-[10px] tracking-widest h-10 px-6 hover:bg-primary/10 hover:text-primary transition-all" onClick={() => navigate('/professor/analytics')}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Global Analytics
          </Button>
        </div>

        {
          lectures.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-card rounded-2xl border border-border p-12 text-center"
            >
              <div className="w-16 h-16 gradient-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No lectures yet
              </h3>
              <p className="text-muted-foreground mb-4">
                Upload your first lecture to get started with interactive quizzes.
              </p>
              <Button variant="hero" onClick={() => navigate('/professor/upload')}>
                <Plus className="w-5 h-5 mr-2" />
                Upload Your First Lecture
              </Button>
            </motion.div>
          ) : (
            <div className="glass-card rounded-[2rem] border-white/5 overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/5">
                      <th className="px-8 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        Lecture Details
                      </th>
                      <th className="px-8 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        Slide Count
                      </th>
                      <th className="px-8 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        Launch Date
                      </th>
                      <th className="px-8 py-6 text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        Protocol Status
                      </th>
                      <th className="px-8 py-6 text-right text-[10px] font-black text-muted-foreground uppercase tracking-[0.25em]">
                        Executive Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {lectures.map((lecture, index) => (
                      <motion.tr
                        key={lecture.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="hover:bg-white/5 transition-all group"
                      >
                        <td className="px-8 py-6">
                          <div>
                            <p className="font-black text-foreground text-lg tracking-tight group-hover:text-primary transition-colors">{lecture.title}</p>
                            {lecture.description && (
                              <p className="text-sm text-muted-foreground font-medium mt-1 line-clamp-1 opacity-70">
                                {lecture.description}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-foreground/80">{lecture.total_slides}</span>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-bold text-muted-foreground">
                            {new Date(lecture.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-8 py-6">
                          <span className={`text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest border ${lecture.pdf_url ? 'bg-success/10 text-success border-success/20 shadow-glow-success/10' : 'bg-warning/10 text-warning border-warning/20'}`}>
                            {lecture.pdf_url ? 'Active Protocol' : 'No Source PDF'}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-xl w-10 h-10 text-primary hover:bg-primary/10 shadow-sm border border-transparent hover:border-primary/20"
                              onClick={() => navigate(`/professor/analytics/${lecture.id}`)}
                              title="View Lecture Analytics"
                            >
                              <BarChart3 className="w-5 h-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-xl w-10 h-10 text-muted-foreground hover:bg-white/10 shadow-sm border border-transparent hover:border-white/10"
                              onClick={() => navigate(`/lecture/${lecture.id}`)}
                              title="Preview Lecture"
                            >
                              <Eye className="w-5 h-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-xl w-10 h-10 text-muted-foreground hover:bg-white/10 shadow-sm border border-transparent hover:border-white/10"
                              onClick={() => navigate(`/professor/lecture/${lecture.id}`)}
                              title="Edit Parameters"
                            >
                              <Settings className="w-5 h-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-xl w-10 h-10 text-destructive hover:bg-destructive/10 shadow-sm border border-transparent hover:border-destructive/20"
                              onClick={() => deleteLecture(lecture.id)}
                              title="Delete Stream"
                            >
                              <Trash2 className="w-5 h-5" />
                            </Button>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        }
      </div >
    </div >
  );
}
