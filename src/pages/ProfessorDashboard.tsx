import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, BookOpen, TrendingUp, BarChart3, Plus, Eye, Settings, 
  Trash2, Sparkles, Activity, GraduationCap, ChevronRight, 
  MoreHorizontal, Filter
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface Lecture {
  id: string;
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
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);

    const { data: lecturesData } = await supabase
      .from('lectures')
      .select('id, title, description, total_slides, created_at, pdf_url')
      .eq('professor_id', user?.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (lecturesData) setLectures(lecturesData);

    const { data: progressData } = await supabase
      .from('student_progress')
      .select('user_id, quiz_score, total_questions_answered, correct_answers')
      .limit(2000);

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
      const { data: slidesData } = await supabase
        .from('slides')
        .select('id')
        .eq('lecture_id', lectureId);
      const slideIds = slidesData?.map(s => s.id) || [];

      if (slideIds.length > 0) {
        await supabase.from('quiz_questions').delete().in('slide_id', slideIds);
      }
      await supabase.from('student_progress').delete().eq('lecture_id', lectureId);
      await supabase.from('slides').delete().eq('lecture_id', lectureId);

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
      <div className="relative min-h-screen p-6 lg:p-8 space-y-8">
        <ProfessorOrbitalBackground />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-5 animate-pulse">
              <div className="h-4 w-24 bg-surface-2 rounded mb-3" />
              <div className="h-8 w-16 bg-surface-2 rounded" />
            </div>
          ))}
        </div>
        <div className="glass-card overflow-hidden animate-pulse">
          <div className="h-14 bg-surface-2 border-b border-border" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-6 py-4 border-b border-border last:border-0">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 bg-surface-2 rounded" />
                <div className="h-3 w-1/2 bg-surface-2 rounded" />
              </div>
              <div className="h-4 w-12 bg-surface-2 rounded" />
              <div className="h-4 w-20 bg-surface-2 rounded" />
              <div className="flex gap-2">
                <div className="h-8 w-8 bg-surface-2 rounded" />
                <div className="h-8 w-8 bg-surface-2 rounded" />
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
    <div className="relative min-h-screen">
      <ProfessorOrbitalBackground />
      
      <div className="relative z-10 p-6 lg:p-8 space-y-10">

        {/* ── Hero Banner — Command Center Style ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-3xl overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-success/10" />
          <div className="absolute inset-0 glass-panel opacity-40" />
          
          <div className="relative p-8 lg:p-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-caption text-primary/80 uppercase tracking-widest font-medium"
              >
                {getGreeting()}
              </motion.span>
              <motion.h1
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="text-display-md text-foreground"
              >
                Welcome back,{' '}
                <span className="text-gradient">{profName}</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-body-md text-muted-foreground max-w-xl"
              >
                You have <strong className="text-foreground">{stats.totalStudents} students</strong> engaged across{' '}
                <strong className="text-foreground">{lectures.length} active lectures</strong>. Average quiz score:{' '}
                <strong className="text-success">{stats.averageScore}%</strong>.
              </motion.p>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6, type: 'spring', stiffness: 200, damping: 20 }}
            >
              <Button 
                onClick={() => navigate('/professor/upload')} 
                className="gap-2 bg-gradient-to-r from-primary to-secondary hover:opacity-90 text-white shadow-glow-primary px-6 py-3 h-auto rounded-xl"
              >
                <Plus className="w-5 h-5" /> 
                <span className="font-semibold">New Lecture</span>
              </Button>
            </motion.div>
          </div>
        </motion.div>

        {/* ── Stats Grid — Command Center ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: 'Total Students', value: stats.totalStudents, icon: Users, variant: 'primary', glow: 'shadow-glow-primary' },
            { title: 'Your Lectures', value: lectures.length, icon: BookOpen, variant: 'default' },
            { title: 'Average Score', value: `${stats.averageScore}%`, icon: TrendingUp, variant: 'success', glow: 'shadow-glow-success' },
            { title: 'Quiz Attempts', value: stats.totalQuizAttempts, icon: Activity, variant: 'xp' },
          ].map((stat, index) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * index, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <StatsCard
                title={stat.title}
                value={stat.value}
                icon={stat.icon}
                variant={stat.variant as any}
                className={stat.glow}
              />
            </motion.div>
          ))}
        </div>

        {/* ── Lectures Section — Data Table ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-primary" />
              <h2 className="text-heading-lg text-foreground">Your Lectures</h2>
            </div>
            <Button 
              variant="ghost" 
              onClick={() => navigate('/professor/analytics')}
              className="group text-primary hover:text-primary/80"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              View Analytics
              <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>

          {lectures.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card p-12 text-center"
            >
              <motion.div 
                className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-5 shadow-glow-primary"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <BookOpen className="w-10 h-10 text-white" />
              </motion.div>
              <h3 className="text-heading-sm text-foreground mb-2">No lectures yet</h3>
              <p className="text-body-sm text-muted-foreground mb-6 max-w-md mx-auto">
                Upload your first lecture to get started with interactive quizzes and student analytics.
              </p>
              <Button 
                onClick={() => navigate('/professor/upload')}
                className="bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary"
              >
                <Plus className="w-5 h-5 mr-2" />
                Upload Your First Lecture
              </Button>
            </motion.div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/50 bg-surface-1/50">
                      <th className="px-6 py-4 text-left text-caption font-semibold text-muted-foreground uppercase tracking-wider">
                        Lecture
                      </th>
                      <th className="px-6 py-4 text-left text-caption font-semibold text-muted-foreground uppercase tracking-wider">
                        Slides
                      </th>
                      <th className="px-6 py-4 text-left text-caption font-semibold text-muted-foreground uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-6 py-4 text-left text-caption font-semibold text-muted-foreground uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-right text-caption font-semibold text-muted-foreground uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lectures.map((lecture, index) => (
                      <motion.tr
                        key={lecture.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        onMouseEnter={() => setHoveredRow(lecture.id)}
                        onMouseLeave={() => setHoveredRow(null)}
                        className={`border-b border-border/30 last:border-0 transition-all duration-300 ${hoveredRow === lecture.id ? 'bg-surface-2/50' : ''}`}
                      >
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 ${hoveredRow === lecture.id ? 'bg-primary/20 shadow-glow-primary' : 'bg-surface-2'}`}>
                              <BookOpen className={`w-5 h-5 transition-colors ${hoveredRow === lecture.id ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{lecture.title}</p>
                              {lecture.description && (
                                <p className="text-body-sm text-muted-foreground line-clamp-1 mt-0.5">
                                  {lecture.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span className="text-body-sm text-muted-foreground font-medium">{lecture.total_slides}</span>
                        </td>
                        <td className="px-6 py-5">
                          <span className="text-body-sm text-muted-foreground">
                            {new Date(lecture.created_at).toLocaleDateString('en-US', { 
                              month: 'short', 
                              day: 'numeric', 
                              year: 'numeric' 
                            })}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium ${lecture.pdf_url 
                            ? 'bg-success/10 text-success border border-success/20' 
                            : 'bg-warning/10 text-warning border border-warning/20'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${lecture.pdf_url ? 'bg-success' : 'bg-warning'}`} />
                            {lecture.pdf_url ? 'PDF Ready' : 'No PDF'}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-primary hover:text-primary hover:bg-primary/10 rounded-lg"
                                onClick={() => navigate(`/professor/analytics/${lecture.id}`)}
                                title="Analytics"
                              >
                                <BarChart3 className="w-4 h-4" />
                              </Button>
                            </motion.div>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground rounded-lg"
                                onClick={() => navigate(`/lecture/${lecture.id}`)}
                                title="Preview"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </motion.div>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground rounded-lg"
                                onClick={() => navigate(`/professor/lecture/${lecture.id}`)}
                                title="Settings"
                              >
                                <Settings className="w-4 h-4" />
                              </Button>
                            </motion.div>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteLecture(lecture.id)}
                                className="text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
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
      </div>
    </div>
  );
}
