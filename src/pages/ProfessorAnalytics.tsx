import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Users, TrendingUp, Clock, Target, Award,
  Sparkles, Lightbulb, RefreshCw, CheckCircle2, BookOpen,
  ChevronRight, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
  AreaChart, Area
} from 'recharts';
import { CustomTooltip } from '@/components/charts/CustomTooltip';

const API_BASE = 'http://localhost:8000';

interface Lecture {
  id: string;
  title: string;
  description: string | null;
  total_slides: number | null;
  created_at: string | null;
}

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

interface AIInsights {
  summary: string;
  suggestions: string[];
}

const COLORS = [
  'hsl(234, 89%, 54%)', 'hsl(270, 70%, 60%)', 'hsl(158, 64%, 42%)',
  'hsl(45, 93%, 47%)', 'hsl(346, 77%, 49%)',
];
const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
};

// ─── Lecture Picker ──────────────────────────────────────────────────────────
function LecturePicker({
  lectures,
  onSelect,
}: {
  lectures: Lecture[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="p-6 lg:p-10 space-y-10 relative z-10">
      <div className="max-w-4xl">
        <div className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest mb-4">
          <Link to="/professor/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <span className="opacity-30">/</span>
          <span className="text-foreground">Command Analytics</span>
        </div>
        <motion.h1
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-4xl font-bold text-foreground tracking-tight flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
            <BarChart3 className="w-7 h-7 text-white" />
          </div>
          Intelligence Center
        </motion.h1>
        <p className="text-body-lg text-muted-foreground mt-3 max-w-2xl">
          Deep telemetry and performance heuristics for your orbital lectures. Select a module to begin analysis.
        </p>
      </div>

      {lectures.length === 0 ? (
        <div className="glass-card rounded-3xl border-white/5 p-16 text-center">
          <BookOpen className="w-16 h-16 text-muted-foreground/20 mx-auto mb-6" />
          <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">No active missions found</p>
          <p className="text-muted-foreground/60 text-sm mt-2">Upload a lecture to start tracking neural engagement.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lectures.map((lec, i) => (
            <motion.button
              key={lec.id}
              onClick={() => onSelect(lec.id)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -8, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="group text-left glass-card border-white/5 rounded-3xl p-8 transition-all duration-300 flex flex-col gap-5 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="flex items-start justify-between relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-white/5 flex items-center justify-center group-hover:border-primary/50 transition-colors">
                  <BookOpen className="w-6 h-6 text-primary" />
                </div>
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                </div>
              </div>
              
              <div className="relative z-10">
                <h3 className="font-bold text-xl text-foreground leading-tight group-hover:text-primary transition-colors">{lec.title}</h3>
                {lec.description && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{lec.description}</p>
                )}
              </div>
              
              <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mt-auto pt-4 border-t border-white/5 relative z-10">
                <span className="flex items-center gap-1.5"><Users className="w-3 h-3" /> Heuristics Active</span>
                <span className="text-primary">•</span>
                <span>{lec.total_slides ?? 0} Slides</span>
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Analytics View ─────────────────────────────────────────────────────
export default function ProfessorAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Lecture list
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [lecturesLoading, setLecturesLoading] = useState(true);

  // Selected lecture from URL
  const { lectureId: selectedLectureId } = useParams();
  const [selectedTitle, setSelectedTitle] = useState('');

  // Analytics data
  const [progressData, setProgressData] = useState<StudentProgress[]>([]);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [slides, setSlides] = useState<any[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // AI
  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Fetch lecture list on mount
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('lectures')
        .select('id, title, description, total_slides, created_at')
        .eq('professor_id', user.id)
        .order('created_at', { ascending: false });
      setLectures(data || []);
      setLecturesLoading(false);
    })();
  }, [user]);

  // Fetch analytics when lecture selected
  useEffect(() => {
    if (!selectedLectureId) return;
    setAnalyticsLoading(true);
    setAiInsights(null);
    (async () => {
      let lectureId = selectedLectureId;

      const [
        { data: progress },
        { data: eventData },
        { data: slidesData }
      ] = await Promise.all([
        supabase.from('student_progress')
          .select('user_id, lecture_id, quiz_score, total_questions_answered, correct_answers')
          .eq('lecture_id', lectureId)
          .limit(2000),
        supabase.from('learning_events')
          .select('event_type, event_data, created_at')
          .contains('event_data', { lectureId: lectureId })
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase.from('slides').select('id, title, slide_number').eq('lecture_id', lectureId)
      ]);
      setProgressData(progress || []);
      setEvents((eventData || []).map(e => ({
        ...e,
        event_data: typeof e.event_data === 'object' ? e.event_data as Record<string, unknown> : {},
      })));
      setSlides(slidesData || []);
      setAnalyticsLoading(false);
    })();
  }, [selectedLectureId]);

  // Sync title when lectureId changes
  useEffect(() => {
    if (selectedLectureId && lectures.length > 0) {
      const lec = lectures.find(l => l.id === selectedLectureId);
      if (lec) setSelectedTitle(lec.title);
    }
  }, [selectedLectureId, lectures]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const uniqueStudents = new Set(progressData.map(p => p.user_id)).size;
  const totalAttempts = progressData.reduce((s, p) => s + (p.total_questions_answered || 0), 0);
  const totalCorrect = progressData.reduce((s, p) => s + (p.correct_answers || 0), 0);
  const averageScore = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

  const scoreDistribution = [
    { range: '0–20%', count: progressData.filter(p => p.quiz_score <= 20).length },
    { range: '21–40%', count: progressData.filter(p => p.quiz_score > 20 && p.quiz_score <= 40).length },
    { range: '41–60%', count: progressData.filter(p => p.quiz_score > 40 && p.quiz_score <= 60).length },
    { range: '61–80%', count: progressData.filter(p => p.quiz_score > 60 && p.quiz_score <= 80).length },
    { range: '81–100%', count: progressData.filter(p => p.quiz_score > 80).length },
  ];

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
  const activityByDay = last7Days.map(date => ({
    date: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
    attempts: events.filter(e => e.event_type === 'quiz_attempt' && e.created_at.startsWith(date)).length,
  }));

  const slideStats = events.reduce((acc, e) => {
    const sid = (e.event_data as any)?.slideId;
    if (!sid) return acc;
    if (!acc[sid]) acc[sid] = { duration: 0, views: 0, quizCorrect: 0, quizAttempts: 0, timeToAnswer: 0, slideTitle: '' };
    if (e.event_type === 'slide_view') {
      acc[sid].duration += (e.event_data as any).duration_seconds || 0;
      acc[sid].views += 1;
      if ((e.event_data as any).slideTitle) acc[sid].slideTitle = (e.event_data as any).slideTitle;
    } else if (e.event_type === 'quiz_attempt') {
      acc[sid].quizAttempts += 1;
      if ((e.event_data as any).correct) acc[sid].quizCorrect += 1;
      acc[sid].timeToAnswer += (e.event_data as any).time_to_answer_seconds || 0;
    }
    return acc;
  }, {} as Record<string, any>);

  const slidePerformanceData = Object.entries(slideStats).map(([id, s]: [string, any]) => {
    const realSlide = slides.find(sl => sl.id === id);
    const title = realSlide?.title || s.slideTitle || `Slide ${id.slice(0, 4)}`;
    return {
      name: title,
      avgDuration: s.views > 0 ? Math.round(s.duration / s.views) : 0,
      correctRate: s.quizAttempts > 0 ? Math.round((s.quizCorrect / s.quizAttempts) * 100) : 0,
      avgTimeToAnswer: s.quizAttempts > 0 ? Math.round(s.timeToAnswer / s.quizAttempts) : 0,
    };
  }).sort((a, b) => b.avgDuration - a.avgDuration).slice(0, 10);

  const eventTypeCounts = events.reduce((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const eventTypeData = Object.entries(eventTypeCounts).map(([name, value]) => ({
    name: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    value,
  }));

  const confidenceEvents = events.filter(e => e.event_type === 'confidence_rating');
  const confCounts = { got_it: 0, unsure: 0, confused: 0 };
  confidenceEvents.forEach(e => {
    const r = (e.event_data as any)?.rating as string;
    if (r in confCounts) confCounts[r as keyof typeof confCounts]++;
  });

  // ── AI Insights ────────────────────────────────────────────────────────────
  const fetchAiInsights = useCallback(async () => {
    setAiLoading(true);
    setAiInsights(null);
    const hardSlides = slidePerformanceData.filter(s => s.correctRate < 60 && s.avgDuration > 0)
      .slice(0, 3).map(s => `${s.name} (${s.correctRate}% correct)`).join(', ') || 'None identified';
    const engagingSlides = slidePerformanceData.slice(0, 3)
      .map(s => `${s.name} (${s.avgDuration}s avg)`).join(', ') || 'None identified';
    const weeklyTrend = activityByDay.map(d => `${d.date}: ${d.attempts}`).join(', ');
    const confSummary = `Got it: ${confCounts.got_it}, Unsure: ${confCounts.unsure}, Confused: ${confCounts.confused}`;
    try {
      const res = await fetch(`${API_BASE}/api/ai/analytics-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_students: uniqueStudents, average_score: averageScore,
          total_attempts: totalAttempts, total_correct: totalCorrect,
          hard_slides: hardSlides, engaging_slides: engagingSlides,
          weekly_trend: weeklyTrend, confidence_summary: confSummary,
          ai_model: localStorage.getItem('ascend-academy-ai-model') || 'llama3'
        }),
      });
      if (res.ok) setAiInsights(await res.json());
    } catch {
      setAiInsights({
        summary: 'AI insights unavailable — orbital connection interrupted.',
        suggestions: [
          'Neural engagement on Slide 3 is below target heuristics.',
          'Recommendation: Deploy adaptive quiz variants to increase precision.',
          'Strategic shift: Peer-based leaderboard could boost activity in this module.',
        ],
      });
    }
    setAiLoading(false);
  }, [uniqueStudents, averageScore, totalAttempts, totalCorrect, slidePerformanceData, activityByDay, confCounts]);

  // ── RENDER ─────────────────────────────────────────────────────────────────
  if (lecturesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
      </div>
    );
  }

  // Step 1 — No lecture selected yet → show picker
  if (!selectedLectureId) {
    return (
      <div className="min-h-screen relative overflow-hidden bg-background">
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] animate-aurora-drift" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[120px] animate-aurora-drift animation-delay-4000" />
        </div>
        <LecturePicker lectures={lectures} onSelect={(id) => {
          navigate(`/professor/analytics/${id}`);
        }} />
      </div>
    );
  }

  // Step 2 — Lecture selected → show analytics
  return (
    <div className="min-h-screen relative pb-20 bg-background">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[40%] h-[40%] rounded-full bg-primary/5 blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-[40%] h-[40%] rounded-full bg-secondary/5 blur-[100px]" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay" />
      </div>

      <div className="p-6 lg:p-10 space-y-10 relative z-10">
        {/* Header */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest">
            <Link to="/professor/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
            <span className="opacity-30">/</span>
            <Link to="/professor/analytics" className="hover:text-foreground transition-colors">Analytics</Link>
            <span className="opacity-30">/</span>
            <span className="text-foreground">Module Telemetry</span>
          </div>

          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-center gap-5">
              <button
                onClick={() => navigate('/professor/analytics')}
                className="w-12 h-12 rounded-2xl glass-panel border-white/5 flex items-center justify-center hover:bg-white/10 transition-all group"
              >
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              </button>
              <div>
                <motion.h1 initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  className="text-4xl font-bold text-foreground tracking-tight">
                  {selectedTitle}
                </motion.h1>
                <p className="text-body-md text-muted-foreground mt-1">Telemetry feed for orbital engagement and neural precision</p>
              </div>
            </div>

            <Button 
              onClick={fetchAiInsights} 
              disabled={aiLoading} 
              className="gap-3 rounded-2xl px-6 h-14 bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary border-none hover:opacity-90 transition-all font-bold"
            >
              {aiLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              {aiLoading ? 'Neural Analysis...' : 'Compute AI Insights'}
            </Button>
          </div>
        </div>

        {/* Loading overlay */}
        {analyticsLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
          </div>
        )}

        {!analyticsLoading && (
          <div className="space-y-10">
            {/* AI Insights - Executive Summary */}
            <AnimatePresence>
              {(aiInsights || aiLoading) && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }} className="overflow-hidden">
                  <div className="relative rounded-[32px] border border-primary/20 bg-surface-1/40 backdrop-blur-xl p-8 md:p-10 shadow-2xl overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 opacity-50" />
                    
                    <div className="flex flex-col lg:flex-row gap-10 items-start relative z-10">
                      <div className="w-16 h-16 rounded-[24px] bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0 shadow-glow-primary animate-float">
                        <Sparkles className="w-8 h-8 text-white" />
                      </div>
                      
                      <div className="flex-1 w-full">
                        <div className="flex items-center justify-between mb-6">
                          <h2 className="text-2xl font-bold text-foreground tracking-tight">Neural Intelligence Summary</h2>
                          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest">
                            <RefreshCw className={`w-3 h-3 ${aiLoading ? 'animate-spin' : ''}`} />
                            Live Telemetry
                          </div>
                        </div>

                        {aiLoading ? (
                          <div className="space-y-4">
                            <div className="h-4 w-full bg-white/5 rounded-full animate-pulse" />
                            <div className="h-4 w-3/4 bg-white/5 rounded-full animate-pulse" />
                            <div className="h-4 w-1/2 bg-white/5 rounded-full animate-pulse" />
                          </div>
                        ) : aiInsights ? (
                          <div className="space-y-8">
                            <p className="text-body-lg text-foreground/90 leading-relaxed font-medium">
                              {aiInsights.summary}
                            </p>

                            <div className="space-y-4">
                              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-white/5 pb-2">Adaptive Recommendations</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {aiInsights.suggestions.map((s, i) => (
                                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    className="p-5 glass-panel-strong border-white/10 rounded-2xl flex gap-4 hover:border-primary/40 transition-all">
                                    <div className="w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 text-primary font-bold text-[10px]">
                                      {i + 1}
                                    </div>
                                    <p className="text-sm text-foreground/80 leading-snug">{s}</p>
                                  </motion.div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatsCard title="Neural Nodes Active" value={uniqueStudents} icon={Users} variant="primary" />
              <StatsCard title="Precision Delta" value={`${averageScore}%`} icon={Target} variant="success" />
              <StatsCard title="Cognitive Attempts" value={totalAttempts} icon={Award} variant="xp" />
              <StatsCard title="Positive Heuristics" value={totalCorrect} icon={TrendingUp} variant="default" />
            </div>

            {/* Performance Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Engagement Timeline */}
              <div className="lg:col-span-2 space-y-8">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  className="glass-card border-white/5 rounded-3xl p-8 h-full">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-xl font-bold text-foreground">Slide Attention Heuristics</h3>
                      <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold">Avg Retention Seconds</p>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Clock className="w-5 h-5 text-primary" />
                    </div>
                  </div>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={slidePerformanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--white)/0.05)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                        <Tooltip content={<CustomTooltip valueFormatter={(value) => `${value}s`} />} cursor={{ fill: 'hsl(var(--white)/0.05)' }} />
                        <Bar dataKey="avgDuration" fill="url(#colorAvgDuration)" radius={[8, 8, 0, 0]} name="Avg Duration (s)" maxBarSize={40} />
                        <defs>
                          <linearGradient id="colorAvgDuration" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(234, 89%, 68%)" stopOpacity={1} />
                            <stop offset="95%" stopColor="hsl(234, 89%, 68%)" stopOpacity={0.4} />
                          </linearGradient>
                        </defs>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>
              </div>

              {/* Confidence Radar/Heuristics */}
              <div className="space-y-8">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  className="glass-card border-white/5 rounded-3xl p-8 h-full">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-xl font-bold text-foreground">Neural Confidence</h3>
                      <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-bold">Aggregate Comprehension</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="h-6 w-full rounded-full overflow-hidden flex bg-surface-2 p-1">
                      {confidenceEvents.length > 0 ? (
                        <>
                          <div
                            style={{ width: `${(confCounts.got_it / confidenceEvents.length) * 100}%` }}
                            className="h-full bg-success rounded-l-full transition-all duration-1000 shadow-glow-success"
                          />
                          <div
                            style={{ width: `${(confCounts.unsure / confidenceEvents.length) * 100}%` }}
                            className="h-full bg-warning transition-all duration-1000 shadow-glow-warning"
                          />
                          <div
                            style={{ width: `${(confCounts.confused / confidenceEvents.length) * 100}%` }}
                            className="h-full bg-destructive rounded-r-full transition-all duration-1000 shadow-glow-destructive"
                          />
                        </>
                      ) : (
                        <div className="w-full h-full bg-white/5 rounded-full animate-pulse" />
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {[
                        { emoji: '✅', label: 'Synthesized', count: confCounts.got_it, color: 'text-success', bg: 'bg-success/10' },
                        { emoji: '🤔', label: 'Processing', count: confCounts.unsure, color: 'text-warning', bg: 'bg-warning/10' },
                        { emoji: '❌', label: 'Anomalies', count: confCounts.confused, color: 'text-destructive', bg: 'bg-destructive/10' },
                      ].map(r => (
                        <div key={r.label} className={`flex items-center justify-between p-4 rounded-2xl ${r.bg} border border-white/5`}>
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{r.emoji}</span>
                            <span className="text-xs font-bold uppercase tracking-widest text-foreground">{r.label}</span>
                          </div>
                          <div className={`text-lg font-bold ${r.color}`}>{r.count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Performance Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Precision Chart */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="glass-card border-white/5 rounded-3xl p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold text-foreground">Quiz Precision Mapping</h3>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-success shadow-glow-success" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Accuracy</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-warning shadow-glow-warning" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Latent Time</span>
                    </div>
                  </div>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={slidePerformanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--white)/0.05)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="left" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} unit="%" />
                      <YAxis yAxisId="right" orientation="right" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} unit="s" />
                      <Tooltip content={<CustomTooltip />} />
                      <defs>
                        <linearGradient id="colorCorrectRate" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(158, 64%, 42%)" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="hsl(158, 64%, 42%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area yAxisId="left" type="monotone" dataKey="correctRate" stroke="hsl(158, 64%, 42%)" strokeWidth={4} fillOpacity={1} fill="url(#colorCorrectRate)" name="Accuracy" animationDuration={2000} activeDot={{ r: 8, strokeWidth: 4 }} />
                      <Line yAxisId="right" type="monotone" dataKey="avgTimeToAnswer" stroke="hsl(45, 93%, 47%)" strokeWidth={3} name="Latent Time" strokeDasharray="8 8" dot={false} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              {/* Activity Log */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="glass-card border-white/5 rounded-3xl p-8">
                <h3 className="text-xl font-bold text-foreground mb-8">Neural Event Stream</h3>
                <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                  {events.slice(0, 15).map((event, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 glass-panel border-white/5 rounded-2xl hover:bg-white/5 transition-colors group">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${
                        event.event_type === 'quiz_attempt' ? 'bg-primary/10 text-primary'
                        : event.event_type === 'lecture_complete' ? 'bg-success/10 text-success'
                        : event.event_type === 'confidence_rating' ? 'bg-xp/10 text-xp'
                        : 'bg-secondary/10 text-secondary'}`}>
                        {event.event_type === 'quiz_attempt' ? <Target className="w-6 h-6" />
                          : event.event_type === 'lecture_complete' ? <Award className="w-6 h-6" />
                            : event.event_type === 'confidence_rating' ? <CheckCircle2 className="w-6 h-6" />
                              : <Clock className="w-6 h-6" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground capitalize truncate">
                          {event.event_type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">{new Date(event.created_at).toLocaleString()}</p>
                      </div>
                      {event.event_type === 'quiz_attempt' && event.event_data?.correct !== undefined && (
                        <div className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${event.event_data.correct ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          {event.event_data.correct ? 'Synthesized' : 'Anomaly'}
                        </div>
                      )}
                    </div>
                  ))}
                  {events.length === 0 && (
                    <div className="text-center py-12 space-y-3">
                      <RefreshCw className="w-10 h-10 text-muted-foreground/20 mx-auto animate-spin-slow" />
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Waiting for telemetry...</p>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
