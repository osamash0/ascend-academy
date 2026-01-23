import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Users, TrendingUp, TrendingDown, AlertTriangle, Clock, Target, Award } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

interface StudentProgress {
  user_id: string;
  lecture_id: string;
  quiz_score: number;
  total_questions_answered: number;
  correct_answers: number;
}

interface LearningEvent {
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

interface SlidePerformance {
  slideId: string;
  correctRate: number;
  attempts: number;
}

export default function ProfessorAnalytics() {
  const { user } = useAuth();
  const [progressData, setProgressData] = useState<StudentProgress[]>([]);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchAnalytics();
    }
  }, [user]);

  const fetchAnalytics = async () => {
    setLoading(true);

    // Fetch all student progress
    const { data: progress } = await supabase
      .from('student_progress')
      .select('*');

    if (progress) {
      setProgressData(progress);
    }

    // Fetch recent learning events
    const { data: eventData } = await supabase
      .from('learning_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (eventData) {
      setEvents(eventData.map(e => ({
        ...e,
        event_data: typeof e.event_data === 'object' ? e.event_data as Record<string, unknown> : {}
      })));
    }

    setLoading(false);
  };

  // Calculate statistics
  const uniqueStudents = new Set(progressData.map(p => p.user_id)).size;
  const totalAttempts = progressData.reduce((sum, p) => sum + (p.total_questions_answered || 0), 0);
  const totalCorrect = progressData.reduce((sum, p) => sum + (p.correct_answers || 0), 0);
  const averageScore = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

  // Score distribution
  const scoreDistribution = [
    { range: '0-20%', count: progressData.filter(p => p.quiz_score <= 20).length },
    { range: '21-40%', count: progressData.filter(p => p.quiz_score > 20 && p.quiz_score <= 40).length },
    { range: '41-60%', count: progressData.filter(p => p.quiz_score > 40 && p.quiz_score <= 60).length },
    { range: '61-80%', count: progressData.filter(p => p.quiz_score > 60 && p.quiz_score <= 80).length },
    { range: '81-100%', count: progressData.filter(p => p.quiz_score > 80).length },
  ];

  // Activity by day (last 7 days)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    return date.toISOString().split('T')[0];
  });

  const activityByDay = last7Days.map(date => ({
    date: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
    attempts: events.filter(e => 
      e.event_type === 'quiz_attempt' && 
      e.created_at.startsWith(date)
    ).length,
  }));

  // Event type distribution
  const eventTypes = events.reduce((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const eventTypeData = Object.entries(eventTypes).map(([name, value]) => ({
    name: name.replace('_', ' '),
    value,
  }));

  const COLORS = ['hsl(234, 89%, 54%)', 'hsl(270, 70%, 60%)', 'hsl(158, 64%, 42%)', 'hsl(45, 93%, 47%)'];

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
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-bold text-foreground flex items-center gap-3"
        >
          <BarChart3 className="w-8 h-8 text-primary" />
          Analytics Dashboard
        </motion.h1>
        <p className="text-muted-foreground mt-1">
          Insights into student performance and engagement
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Students"
          value={uniqueStudents}
          icon={Users}
          variant="primary"
        />
        <StatsCard
          title="Average Score"
          value={`${averageScore}%`}
          icon={Target}
          variant="success"
        />
        <StatsCard
          title="Quiz Attempts"
          value={totalAttempts}
          icon={Award}
          variant="xp"
        />
        <StatsCard
          title="Correct Answers"
          value={totalCorrect}
          icon={TrendingUp}
          variant="default"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <h3 className="text-lg font-semibold text-foreground mb-6">Score Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="range" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="count" fill="hsl(234, 89%, 54%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Activity Trend */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <h3 className="text-lg font-semibold text-foreground mb-6">Weekly Activity</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activityByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="attempts"
                  stroke="hsl(270, 70%, 60%)"
                  strokeWidth={3}
                  dot={{ fill: 'hsl(270, 70%, 60%)', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Event Types */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <h3 className="text-lg font-semibold text-foreground mb-6">Event Types</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={eventTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name }) => name}
                >
                  {eventTypeData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-card rounded-2xl border border-border p-6 lg:col-span-2"
        >
          <h3 className="text-lg font-semibold text-foreground mb-6">Recent Activity</h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {events.slice(0, 10).map((event, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  event.event_type === 'quiz_attempt'
                    ? 'bg-primary/10 text-primary'
                    : event.event_type === 'lecture_complete'
                    ? 'bg-success/10 text-success'
                    : 'bg-accent/10 text-accent'
                }`}>
                  {event.event_type === 'quiz_attempt' ? (
                    <Target className="w-5 h-5" />
                  ) : event.event_type === 'lecture_complete' ? (
                    <Award className="w-5 h-5" />
                  ) : (
                    <Clock className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground capitalize">
                    {event.event_type.replace('_', ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                </div>
                {event.event_type === 'quiz_attempt' && event.event_data?.correct !== undefined && (
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    event.event_data.correct
                      ? 'bg-success/10 text-success'
                      : 'bg-destructive/10 text-destructive'
                  }`}>
                    {event.event_data.correct ? 'Correct' : 'Incorrect'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
