import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, BookOpen, TrendingUp, BarChart3, Plus, Eye, Settings } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';

interface Lecture {
  id: string;
  title: string;
  description: string | null;
  total_slides: number;
  created_at: string;
}

interface StudentStats {
  totalStudents: number;
  averageScore: number;
  totalQuizAttempts: number;
}

export default function ProfessorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
  }, [user]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold text-foreground"
          >
            Professor Dashboard
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Manage your lectures and track student progress
          </p>
        </div>

        <Button variant="hero" onClick={() => navigate('/professor/upload')}>
          <Plus className="w-5 h-5 mr-2" />
          Upload Lecture
        </Button>
      </div>

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
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Your Lectures</h2>
          <Button variant="outline" onClick={() => navigate('/professor/analytics')}>
            <BarChart3 className="w-4 h-4 mr-2" />
            View Analytics
          </Button>
        </div>

        {lectures.length === 0 ? (
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
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Lecture Title
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Slides
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Created
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-foreground">
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
                      transition={{ delay: index * 0.05 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-foreground">{lecture.title}</p>
                          {lecture.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1">
                              {lecture.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-muted-foreground">{lecture.total_slides}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-muted-foreground">
                          {new Date(lecture.created_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/lecture/${lecture.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/professor/lecture/${lecture.id}`)}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
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
  );
}
