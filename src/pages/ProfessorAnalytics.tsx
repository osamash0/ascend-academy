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
    <div className="p-6 lg:p-8 space-y-8">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link to="/professor/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
          <span>/</span>
          <span className="text-foreground">Analytics</span>
        </div>
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-bold text-foreground flex items-center gap-3"
        >
          <BarChart3 className="w-8 h-8 text-primary" />
          Analytics
        </motion.h1>
        <p className="text-muted-foreground mt-1">Select a lecture to view its performance data</p>
      </div>

      {lectures.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No lectures yet. Upload one to start tracking analytics.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {lectures.map((lec, i) => (
            <motion.button
              key={lec.id}
              onClick={() => onSelect(lec.id)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              whileHover={{ y: -4, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="group text-left bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-lg hover:border-primary/30 transition-all duration-200 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-5 h-5 text-primary-foreground" />
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors mt-1 flex-shrink-0" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground leading-snug">{lec.title}</h3>
                {lec.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{lec.description}</p>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-auto">
                <span>{lec.total_slides ?? 0} slides</span>
                <span>·</span>
                <span>{lec.created_at ? new Date(lec.created_at).toLocaleDateString() : '—'}</span>
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
      // Slug is no longer used, so if an old url provides a non-uuid slug, we simply assume it's an ID
      // If it throws an error in fetch, they will be sent back. Here we just try to fetch by ID.
      let lectureId = selectedLectureId;

      const [
        { data: progress },
        { data: eventData },
        { data: slidesData }
      ] = await Promise.all([
        supabase.from('student_progress').select('*').eq('lecture_id', lectureId),
        supabase.from('learning_events').select('*')
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
        summary: 'AI insights unavailable — make sure the backend is running.',
        suggestions: [
          'Check slides with low quiz correct rates and simplify the content.',
          'Reach out to students who have not yet started the lecture.',
          'Add more examples to slides where students spend little time.',
        ],
      });
    }
    setAiLoading(false);
  }, [uniqueStudents, averageScore, totalAttempts, totalCorrect, slidePerformanceData, activityByDay, confCounts]);

  // ── RENDER ─────────────────────────────────────────────────────────────────
  if (lecturesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Step 1 — No lecture selected yet → show picker
  if (!selectedLectureId) {
    return <LecturePicker lectures={lectures} onSelect={(id) => {
      navigate(`/professor/analytics/${id}`);
    }} />;
  }

  // Step 2 — Lecture selected → show analytics
  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link to="/professor/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
          <span>/</span>
          <Link to="/professor/analytics" className="hover:text-primary transition-colors">Analytics</Link>
          <span>/</span>
          <span className="text-foreground">{selectedTitle}</span>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/professor/analytics')}
              className="w-9 h-9 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                className="text-3xl font-bold text-foreground flex items-center gap-3">
                <BarChart3 className="w-8 h-8 text-primary" />
                {selectedTitle}
              </motion.h1>
              <p className="text-muted-foreground mt-1">Detailed performance metrics for this lecture</p>
            </div>
          </div>

          <Button onClick={fetchAiInsights} disabled={aiLoading} className="flex items-center gap-2">
            {aiLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {aiLoading ? 'Analysing...' : 'Get AI Insights'}
          </Button>
        </div>
      </div>

      {/* Loading overlay */}
      {analyticsLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!analyticsLoading && (
        <>
          {/* AI Insights - Executive Summary */}
          <AnimatePresence>
            {(aiInsights || aiLoading) && (
              <motion.div initial={{ opacity: 0, y: -10, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -10, height: 0 }} className="overflow-hidden mb-8">
                <div className="relative rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-primary/3 to-xp/5 p-6 md:p-8">
                  <div className="flex flex-col md:flex-row gap-6 items-start">
                    <div className="w-12 h-12 gradient-primary rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Sparkles className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <div className="flex-1 w-full flex flex-col justify-center min-h-[48px]">
                      <h2 className="text-xl font-bold text-foreground">AI Executive Summary</h2>

                      {aiLoading ? (
                        <div className="mt-4 flex items-center gap-3 py-4">
                          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                          <p className="text-muted-foreground text-sm">Analysing student data patterns...</p>
                        </div>
                      ) : aiInsights ? (
                        <div className="mt-4 space-y-6">
                          <p className="text-base text-foreground leading-relaxed">
                            {aiInsights.summary}
                          </p>

                          <div>
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 border-b border-border/50 pb-2">Actionable Suggestions</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {aiInsights.suggestions.map((s, i) => (
                                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: i * 0.1 }}
                                  className="flex items-start gap-3 p-4 bg-card/80 backdrop-blur-sm shadow-sm rounded-xl border border-primary/10">
                                  <div className="w-6 h-6 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="text-[10px] font-bold text-primary-foreground">{i + 1}</span>
                                  </div>
                                  <p className="text-sm text-foreground">{s}</p>
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

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard title="Students Engaged" value={uniqueStudents} icon={Users} variant="primary" />
            <StatsCard title="Average Score" value={`${averageScore}%`} icon={Target} variant="success" />
            <StatsCard title="Quiz Attempts" value={totalAttempts} icon={Award} variant="xp" />
            <StatsCard title="Correct Answers" value={totalCorrect} icon={TrendingUp} variant="default" />
          </div>

          {/* Confidence Ratings Segmented Bar */}
          {confidenceEvents.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6 mt-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">Student Confidence Overview</h3>
                <span className="text-sm text-muted-foreground">{confidenceEvents.length} total ratings</span>
              </div>

              <div className="h-4 w-full rounded-full overflow-hidden flex mb-6 bg-muted">
                {confCounts.got_it > 0 && (
                  <div
                    style={{ width: `${(confCounts.got_it / confidenceEvents.length) * 100}%` }}
                    className="h-full bg-success transition-all duration-1000"
                  />
                )}
                {confCounts.unsure > 0 && (
                  <div
                    style={{ width: `${(confCounts.unsure / confidenceEvents.length) * 100}%` }}
                    className="h-full bg-warning transition-all duration-1000"
                  />
                )}
                {confCounts.confused > 0 && (
                  <div
                    style={{ width: `${(confCounts.confused / confidenceEvents.length) * 100}%` }}
                    className="h-full bg-destructive transition-all duration-1000"
                  />
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                {[
                  { key: 'got_it', emoji: '✅', label: 'Got it', count: confCounts.got_it, color: 'text-success' },
                  { key: 'unsure', emoji: '🤔', label: 'Unsure', count: confCounts.unsure, color: 'text-warning' },
                  { key: 'confused', emoji: '❌', label: 'Confused', count: confCounts.confused, color: 'text-destructive' },
                ].map(r => (
                  <div key={r.key} className="text-center rounded-xl p-3 bg-muted/30">
                    <div className="text-2xl mb-1">{r.emoji}</div>
                    <div className={`text-xl font-bold ${r.color}`}>{r.count}</div>
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{r.label}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Section 1: Engagement */}
          <div className="mt-12 mb-6">
            <h2 className="text-2xl font-bold text-foreground">Student Engagement</h2>
            <p className="text-muted-foreground mt-1">Activity over time and slide-level attention</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="bg-card rounded-2xl border border-border p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-foreground">Slide Engagement</h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Avg seconds per slide
                </span>
              </div>
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={slidePerformanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
                    <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip valueFormatter={(value) => `${value}s`} />} cursor={{ fill: 'hsl(var(--muted)/0.5)' }} />
                    <Bar dataKey="avgDuration" fill="url(#colorAvgDuration)" radius={[6, 6, 0, 0]} name="Avg Duration (s)" maxBarSize={50} />
                    <defs>
                      <linearGradient id="colorAvgDuration" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(234, 89%, 54%)" stopOpacity={0.9} />
                        <stop offset="95%" stopColor="hsl(234, 89%, 54%)" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Replaced Quiz Precision here with Weekly Activity */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="bg-card rounded-2xl border border-border p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-foreground">Weekly Activity</h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Quiz Attempts
                </span>
              </div>
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activityByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
                    <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <defs>
                      <linearGradient id="colorAttempts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(270, 70%, 60%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(270, 70%, 60%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="attempts" stroke="hsl(270, 70%, 60%)" strokeWidth={3} fillOpacity={1} fill="url(#colorAttempts)" name="Quiz Attempts" activeDot={{ r: 6, fill: "hsl(270, 70%, 60%)", stroke: "hsl(var(--background))", strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* Section 2: Performance & Comprehension */}
          <div className="mt-12 mb-6">
            <h2 className="text-2xl font-bold text-foreground">Performance & Comprehension</h2>
            <p className="text-muted-foreground mt-1">Score distributions and per-slide quiz accuracy</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="bg-card rounded-2xl border border-border p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-foreground">Score Distribution</h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" /> Students by grade bracket
                </span>
              </div>
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
                    <XAxis dataKey="range" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted)/0.5)' }} />
                    <defs>
                      <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(158, 64%, 42%)" stopOpacity={0.9} />
                        <stop offset="95%" stopColor="hsl(158, 64%, 42%)" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <Bar dataKey="count" fill="url(#colorScore)" radius={[6, 6, 0, 0]} name="Students" maxBarSize={50} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="bg-card rounded-2xl border border-border p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-foreground">Quiz Precision</h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" /> Correct Rate vs Time
                </span>
              </div>
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={slidePerformanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
                    <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} unit="s" />
                    <Tooltip content={<CustomTooltip />} />
                    <defs>
                      <linearGradient id="colorCorrectRate" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(158, 64%, 42%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(158, 64%, 42%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area yAxisId="left" type="monotone" dataKey="correctRate" stroke="hsl(158, 64%, 42%)" strokeWidth={3} fillOpacity={1} fill="url(#colorCorrectRate)" name="Correct Rate" activeDot={{ r: 6, strokeWidth: 2 }} />
                    <Line yAxisId="right" type="monotone" dataKey="avgTimeToAnswer" stroke="hsl(45, 93%, 47%)" strokeWidth={2} name="Time to Answer" strokeDasharray="5 5" dot={false} activeDot={{ r: 6 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* Section 3: Details */}
          <div className="mt-12 mb-6">
            <h2 className="text-2xl font-bold text-foreground">Activity Breakdown</h2>
          </div>

          {/* Charts Row 3 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="bg-card rounded-2xl border border-border p-6">
              <h3 className="text-lg font-semibold text-foreground mb-6">Event Types</h3>
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={eventTypeData} cx="50%" cy="50%" innerRadius={70} outerRadius={90} paddingAngle={5} dataKey="value" stroke="none" labelLine={false} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {eventTypeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.1))' }} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
              className="bg-card rounded-2xl border border-border p-6 lg:col-span-2">
              <h3 className="text-lg font-semibold text-foreground mb-6">Recent Activity</h3>
              <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar">
                {events.slice(0, 10).map((event, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${event.event_type === 'quiz_attempt' ? 'bg-primary/10 text-primary'
                      : event.event_type === 'lecture_complete' ? 'bg-success/10 text-success'
                        : event.event_type === 'confidence_rating' ? 'bg-xp/10 text-xp'
                          : 'bg-accent/10 text-accent'}`}>
                      {event.event_type === 'quiz_attempt' ? <Target className="w-5 h-5" />
                        : event.event_type === 'lecture_complete' ? <Award className="w-5 h-5" />
                          : event.event_type === 'confidence_rating' ? <CheckCircle2 className="w-5 h-5" />
                            : <Clock className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground capitalize truncate">
                        {event.event_type.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                    {event.event_type === 'quiz_attempt' && event.event_data?.correct !== undefined && (
                      <span className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${event.event_data.correct ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                        {event.event_data.correct ? '✓ Correct' : '✗ Wrong'}
                      </span>
                    )}
                    {event.event_type === 'confidence_rating' && (
                      <span className="text-lg flex-shrink-0">
                        {(event.event_data as any)?.rating === 'got_it' ? '✅'
                          : (event.event_data as any)?.rating === 'unsure' ? '🤔' : '❌'}
                      </span>
                    )}
                  </div>
                ))}
                {events.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-8">No activity recorded yet.</p>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}
