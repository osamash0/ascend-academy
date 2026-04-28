import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Users, TrendingUp, Clock, Target, Award,
  Sparkles, Lightbulb, RefreshCw, CheckCircle2, BookOpen,
  ChevronRight, ArrowLeft, MessageSquare, AlertTriangle, Zap,
  Brain, TrendingDown, Filter, Activity, BrainCircuit
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, AreaChart, Area, PieChart, Pie,
  ScatterChart, Scatter, ZAxis, ReferenceArea
} from 'recharts';
import { CustomTooltip } from '@/components/charts/CustomTooltip';
import { useAnalytics } from '@/features/analytics/hooks/useAnalytics';
import { NeuralBackground } from '@/components/NeuralBackground';
import { ThreeDScatterPlot } from '@/components/ThreeDScatterPlot';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Lecture {
  id: string;
  title: string;
  description: string | null;
  total_slides: number | null;
  created_at: string | null;
}

interface AIInsights {
  summary: string;
  suggestions: string[];
}

interface DashboardData {
  overview: {
    uniqueStudents: number;
    totalAttempts: number;
    totalCorrect: number;
    averageScore: number;
    totalEvents: number;
  };
  activityByDay: { date: string; attempts: number }[];
  slidePerformance: {
    id: string;
    name: string;
    avgDuration: number;
    correctRate: number;
    quizAttempts: number;
    aiQueries: number;
    revisions: number;
    confusionIndex: number;
  }[];
  studentsMatrix: {
    student_id: string;
    student_name: string;
    progress_percentage: number;
    quiz_score: number;
    typology: string;
    ai_interactions: number;
    revisions: number;
  }[];
  funnel: { stage: string; count: number }[];
  confidenceMap: { got_it: number; unsure: number; confused: number };
  liveTicker: { type: string; description: string; time: string }[];
  dropoffData: DropoffPoint[];
  aiQueryFeed: AIQueryItem[];
  confidenceBySlide: SlideConfidence[];
}

interface DropoffPoint {
  slide_number: number;
  title: string;
  dropout_count: number;
  dropout_percentage: number;
}

interface SlideConfidence {
  slide_number: number;
  title: string;
  got_it: number;
  unsure: number;
  confused: number;
  total: number;
  confusion_rate: number;
}

interface AIQueryItem {
  slide_title: string;
  query_text: string;
  created_at: string;
}

const COLORS = [
  'hsl(234, 89%, 68%)', 'hsl(270, 70%, 60%)', 'hsl(158, 64%, 42%)',
  'hsl(45, 93%, 47%)', 'hsl(346, 77%, 49%)',
];

// ── Helper Components ─────────────────────────────────────────────────────────

function Section({ 
  title, 
  subtitle, 
  icon: Icon, 
  children, 
  className = '', 
  interpretation,
  isLoading,
  isOpen,
  onToggle
}: { 
  title: string; 
  subtitle?: string; 
  icon: any; 
  children: React.ReactNode; 
  className?: string;
  interpretation?: string | null;
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`glass-card border-border/50 rounded-[2.5rem] p-8 shadow-xl relative overflow-hidden perspective-1000 ${className}`}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full -mr-16 -mt-16" />
      <div className="flex justify-between items-start mb-8 relative z-10">
        <div 
          className="cursor-pointer group/title"
          onClick={onToggle}
        >
          <h3 className="text-2xl font-black text-foreground flex items-center gap-3 tracking-tight group-hover/title:text-primary transition-colors">
            <Icon className="w-7 h-7 text-primary" /> {title}
            <div className="w-4 h-4 rounded-full border border-primary/30 flex items-center justify-center text-[10px] opacity-0 group-hover/title:opacity-100 transition-opacity">?</div>
          </h3>
          {subtitle && <p className="text-xs font-bold text-muted-foreground mt-2 uppercase tracking-[0.2em] opacity-60">{subtitle}</p>}
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-8 p-6 rounded-2xl bg-violet-500/10 border border-violet-500/20 overflow-hidden"
          >
            <div className="flex items-center gap-2 mb-3 text-primary">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest">Neural Interpretation</span>
            </div>
            {isLoading ? (
              <div className="flex gap-1.5 items-center py-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
              </div>
            ) : (
              <p className="text-sm font-medium text-foreground/90 leading-relaxed animate-in fade-in slide-in-from-top-2 duration-500">
                {interpretation || "Select a mission to begin interpretation."}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
}

const ThreeDBar = (props: any) => {
  const { x, y, width, height, fill } = props;
  if (!width || !height) return null;
  
  const depth = 6;
  
  return (
    <g className="bar-3d group cursor-pointer">
      {/* Right side face (3D depth) */}
      <path 
        d={`M ${x + width} ${y} L ${x + width + depth} ${y - depth} L ${x + width + depth} ${y + height - depth} L ${x + width} ${y + height} Z`}
        fill={fill}
        className="side-face brightness-75"
      />
      {/* Top face (3D depth) */}
      <path 
        d={`M ${x} ${y} L ${x + depth} ${y - depth} L ${x + width + depth} ${y - depth} L ${x + width} ${y} Z`}
        fill={fill}
        className="side-face brightness-110"
      />
      {/* Front Face */}
      <rect 
        x={x} 
        y={y} 
        width={width} 
        height={height} 
        fill={fill} 
        rx={2}
        className="transition-all duration-300 group-hover:brightness-125"
      />
    </g>
  );
};

function LecturePicker({ lectures, onSelect }: { lectures: Lecture[]; onSelect: (id: string) => void }) {
  return (
    <div className="p-6 lg:p-10 space-y-10 relative z-10">
      <div className="max-w-4xl">
        <div className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest mb-4">
          <Link to="/professor/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <span className="opacity-30">/</span>
          <span className="text-foreground">Command Analytics</span>
        </div>
        <motion.h1 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          className="text-4xl font-bold text-foreground tracking-tight flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
            <BarChart3 className="w-7 h-7 text-white" />
          </div>
          Intelligence Center
        </motion.h1>
        <p className="text-body-lg text-muted-foreground mt-3 max-w-2xl">
          Deep telemetry and performance heuristics for your orbital lectures. Select a module to begin analysis.
        </p>
      </div>

      {lectures?.length === 0 ? (
        <div className="glass-card rounded-3xl border-white/5 p-16 text-center">
          <BookOpen className="w-16 h-16 text-muted-foreground/20 mx-auto mb-6" />
          <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">No active missions found</p>
          <p className="text-muted-foreground/60 text-sm mt-2">Upload a lecture to start tracking neural engagement.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lectures?.map((lec, i) => (
            <motion.button key={lec.id} onClick={() => onSelect(lec.id)}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }} whileHover={{ y: -8, scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="group text-left glass-card border-border rounded-3xl p-8 transition-all duration-300 flex flex-col gap-5 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-start justify-between relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-border flex items-center justify-center group-hover:border-primary/50 transition-colors">
                  <BookOpen className="w-6 h-6 text-primary" />
                </div>
                <div className="w-8 h-8 rounded-full bg-surface-1 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                </div>
              </div>
              <div className="relative z-10">
                <h3 className="font-bold text-xl text-foreground leading-tight group-hover:text-primary transition-colors">{lec.title}</h3>
                {lec.description && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{lec.description}</p>
                )}
              </div>
              <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 mt-auto pt-4 border-t border-border relative z-10">
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

// ── Main Page Component ───────────────────────────────────────────────────────

export default function ProfessorAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { lectureId: selectedLectureId } = useParams();

  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [lecturesLoading, setLecturesLoading] = useState(true);
  const [isGamingMode, setIsGamingMode] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState('');

  // New endpoint data
  const [dropoffData, setDropoffData] = useState<DropoffPoint[]>([]);
  const [confidenceBySlide, setConfidenceBySlide] = useState<SlideConfidence[]>([]);
  const [aiQueryFeed, setAiQueryFeed] = useState<AIQueryItem[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);

  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [matrixView, setMatrixView] = useState<'2d' | '3d'>('3d');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [metricFeedback, setMetricFeedback] = useState<string | null>(null);
  const [metricLoading, setMetricLoading] = useState(false);
  const [metricInterpretations, setMetricInterpretations] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const handleMetricClick = async (id: string, title: string, value: any) => {
    // If it's a section toggle (not a small stat card), handle open state
    const isSection = ['matrix', 'confidence', 'dropoff', 'bySlide', 'velocity', 'distribution'].includes(id);
    
    if (isSection) {
      if (openSections[id]) {
        setOpenSections(prev => ({ ...prev, [id]: false }));
        return;
      }
      setOpenSections(prev => ({ ...prev, [id]: true }));
    } else {
      // Small stat card logic
      if (selectedMetric === title) {
        setSelectedMetric(null);
        setMetricFeedback(null);
        return;
      }
      setSelectedMetric(title);
    }

    // If we already have the interpretation, don't fetch again (unless you want it fresh)
    if (metricInterpretations[id]) return;

    setMetricLoading(true);
    if (!isSection) setMetricFeedback(null);

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const model = localStorage.getItem('ascend-academy-ai-model') || 'gemini-2.5-flash';
      
      const context = {
        average_score: dashboardData?.overview?.averageScore,
        total_students: dashboardData?.overview?.uniqueStudents,
        hard_slides: dashboardData?.slidePerformance
          ?.sort((a, b) => a.correctRate - b.correctRate)
          .slice(0, 2)
          .map(s => s.name)
          .join(', ')
      };

      const res = await fetch(`${API_BASE}/api/ai/metric-feedback`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          metric_name: title,
          metric_value: value,
          context_stats: context,
          ai_model: model
        }),
      });
      const data = await res.json();
      setMetricInterpretations(prev => ({ ...prev, [id]: data.feedback }));
      if (!isSection) setMetricFeedback(data.feedback);
    } catch (err) {
      console.error(err);
      const errorMsg = "Could not establish neural link for this metric.";
      setMetricInterpretations(prev => ({ ...prev, [id]: errorMsg }));
      if (!isSection) setMetricFeedback(errorMsg);
    } finally {
      setMetricLoading(false);
    }
  };

  // Dashboard hook
  const { dashboard } = useAnalytics(selectedLectureId ?? null);
  const dashboardData = dashboard.data as DashboardData | null;

  // Sync state with dashboard data when it arrives
  useEffect(() => {
    if (dashboardData) {
      setDropoffData(dashboardData.dropoffData || []);
      setConfidenceBySlide(dashboardData.confidenceBySlide || []);
      setAiQueryFeed(dashboardData.aiQueryFeed || []);
    }
  }, [dashboardData]);

  // Fetch lecture list
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('lectures')
          .select('id, title, description, total_slides, created_at')
          .eq('professor_id', user.id)
          .order('created_at', { ascending: false });
        
        if (error) throw error;
        setLectures(data || []);
      } catch (err) {
        console.error("Failed to fetch lectures:", err);
      } finally {
        setLecturesLoading(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (dashboard.isError) {
      toast.error("Telemetry failure: Could not load lecture analytics.");
    }
  }, [dashboard.isError]);

  // Sync title
  useEffect(() => {
    if (selectedLectureId) {
      if (lectures?.length > 0) {
        const lec = lectures.find(l => l.id === selectedLectureId);
        if (lec) setSelectedTitle(lec.title);
      } else if (!lecturesLoading) {
         // Best effort if not in owned list
         setSelectedTitle('Unknown Mission');
      }
    }
  }, [selectedLectureId, lectures, lecturesLoading]);

  // AI Insights Generator
  const fetchAiInsights = useCallback(async () => {
    if (!dashboardData) return;
    setAiLoading(true);
    setAiInsights(null);

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const model = localStorage.getItem('ascend-academy-ai-model') || 'gemini-2.5-flash';
      
      const hardSlides = dashboardData.slidePerformance
        ?.filter(s => s.quizAttempts > 0)
        .sort((a, b) => a.correctRate - b.correctRate)
        .slice(0, 3)
        .map(s => s.name)
        .join(', ');

      const res = await fetch(`${API_BASE}/api/ai/analytics-insights`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          total_students: dashboardData?.overview?.uniqueStudents,
          average_score: dashboardData?.overview?.averageScore,
          total_attempts: dashboardData?.overview?.totalAttempts,
          total_correct: dashboardData?.overview?.totalCorrect,
          hard_slides: hardSlides,
          ai_model: model
        }),
      });
      if (res.ok) setAiInsights(await res.json());
    } catch {
      setAiInsights({
        summary: 'AI insights unavailable — orbital connection interrupted.',
        suggestions: [
          'Neural engagement on critical slides is below target heuristics.',
          'Recommendation: Deploy adaptive quiz variants to increase precision.',
          'Strategic shift: Peer-based leaderboard could boost activity in this module.',
        ],
      });
    }
    setAiLoading(false);
  }, [dashboardData]);


  // ── RENDER ─────────────────────────────────────────────────────────────────

  if (lecturesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
      </div>
    );
  }

  if (!selectedLectureId) {
    return (
      <div className="min-h-screen relative overflow-hidden bg-background">
        <div className="fixed inset-0 pointer-events-none z-0">
           <NeuralBackground />
        </div>
        <LecturePicker lectures={lectures} onSelect={(id) => navigate(`/professor/analytics/${id}`)} />
      </div>
    );
  }

  return (
    <div className={`min-h-screen relative pb-32 bg-background max-w-[1600px] mx-auto overflow-hidden ${isGamingMode ? 'gaming-mode' : ''}`}>
      <div className="fixed inset-0 pointer-events-none z-0">
         <NeuralBackground />
      </div>

      <div className="p-6 lg:p-10 space-y-10 relative z-10">
        
        {/* Neural Header Controls */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 glass-panel p-6 rounded-[2rem] border-border/50 shadow-xl">
          <div className="flex items-center gap-5">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate('/professor/analytics')} 
              className="rounded-full w-12 h-12 shadow-sm glass-card hover:bg-primary/10 border-border"
            >
              <ArrowLeft className="w-5 h-5"/>
            </Button>
            <div>
              <h1 className="text-3xl font-black text-foreground flex items-center gap-3 tracking-tight">
                <Activity className="w-8 h-8 text-primary"/> {selectedTitle}
              </h1>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-[0.2em] mt-1 opacity-70">Neural Edge Semantic Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button 
              onClick={() => setIsGamingMode(!isGamingMode)}
              variant="outline"
              className={`rounded-2xl h-14 px-6 border-border/50 font-bold transition-all ${isGamingMode ? 'bg-primary/20 text-primary border-primary/40 shadow-glow-primary' : ''}`}
            >
              <Zap className={`w-5 h-5 mr-3 ${isGamingMode ? 'fill-primary' : ''}`} />
              {isGamingMode ? 'Gaming Mode ON' : 'Standard HUD'}
            </Button>
            <Button 
              onClick={fetchAiInsights} 
              disabled={aiLoading || dashboard.isLoading} 
              className="rounded-2xl h-14 px-8 shadow-glow-primary gradient-primary hover:opacity-90 transition-all font-bold text-base border-none text-white"
            >
              {aiLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-3" /> : <Sparkles className="w-5 h-5 mr-3" />}
              Generate Predictive Intervention
            </Button>
          </div>
        </div>

        {dashboard.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
          </div>
        ) : dashboardData ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
            
            {/* AI Neural Intelligence Summary */}
            <AnimatePresence>
              {(aiInsights || aiLoading) && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="intelligence-hub p-10 rounded-[2.5rem] relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 blur-[100px] rounded-full -mr-20 -mt-20 dark:block hidden" />
                  <div className="flex flex-col lg:flex-row gap-10 items-start relative z-10">
                    <div className="w-16 h-16 rounded-[24px] bg-primary flex items-center justify-center flex-shrink-0 shadow-glow-primary animate-float dark:bg-gradient-to-br dark:from-primary dark:to-secondary">
                      <BrainCircuit className="w-8 h-8 text-white" />
                    </div>
                    <div className="flex-1 w-full">
                      <h2 className="text-2xl font-black flex items-center gap-4 text-white mb-6">Neural Synthesizer Report</h2>
                      {aiLoading ? (
                        <div className="space-y-4">
                          <Skeleton className="h-4 w-full bg-surface-2 rounded-full" />
                          <Skeleton className="h-4 w-3/4 bg-surface-2 rounded-full" />
                          <Skeleton className="h-4 w-1/2 bg-surface-2 rounded-full" />
                        </div>
                      ) : (
                        <div className="space-y-8">
                          <p className="text-xl leading-relaxed text-white/90 font-medium max-w-5xl border-l-4 border-primary/30 pl-6 italic">
                            "{aiInsights?.summary || 'Synthesizing neural data...'}"
                          </p>
                          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {aiInsights?.suggestions?.map((s, i) => (
                              <div key={i} className="glass-card hover:bg-surface-1 p-5 rounded-2xl border-border flex flex-col gap-4 group transition-all">
                                <div className="w-8 h-8 gradient-primary rounded-lg text-sm font-black flex text-white items-center justify-center shadow-glow-primary group-hover:scale-110 transition-transform">
                                  {i + 1}
                                </div>
                                <p className="text-sm font-bold leading-relaxed text-white/60 group-hover:text-white transition-colors">
                                  {s}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { title: "Engaged Students", value: dashboardData.overview.uniqueStudents, icon: Users, variant: "primary" as const },
                { title: "Global Score Avg", value: `${dashboardData.overview.averageScore}%`, icon: Target, variant: "success" as const },
                { title: "Semantic Events", value: dashboardData.overview.totalEvents, icon: Activity, variant: "default" as const },
                { title: "Total Interactions", value: dashboardData.overview.totalAttempts, icon: Award, variant: "xp" as const },
              ].map((stat, idx) => (
                <motion.div
                  key={idx}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.1 }}
                  whileHover={{ scale: 1.05, rotateZ: 2, z: 50 }}
                  className={`perspective-500 transition-all duration-500 ${selectedMetric === stat.title ? 'col-span-2 row-span-1' : ''}`}
                >
                  <StatsCard 
                    {...stat} 
                    onClick={() => handleMetricClick(stat.title, stat.title, stat.value)}
                    className={selectedMetric === stat.title ? 'ring-2 ring-primary shadow-glow-primary' : ''}
                  />
                  <AnimatePresence>
                    {selectedMetric === stat.title && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 glass-panel-strong rounded-2xl p-4 overflow-hidden"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <BrainCircuit className={`w-4 h-4 text-primary ${metricLoading ? 'animate-pulse' : ''}`} />
                          <span className="text-[10px] font-black uppercase tracking-widest text-primary">Neural Feedback</span>
                        </div>
                        {metricLoading ? (
                          <div className="flex gap-1 items-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
                          </div>
                        ) : (
                          <p className="text-sm font-medium text-foreground leading-relaxed animate-in fade-in slide-in-from-top-1 duration-500">
                            {metricFeedback}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>

            {/* Row 1: Confusion Matrix + Neural Confidence */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Section 
                title={matrixView === '3d' ? "Spatial Neural Matrix" : "3D Confusion Matrix"} 
                subtitle={matrixView === '3d' ? "Interactive Volumetric Telemetry" : "Bubble size = AI Queries + Revisions"} 
                icon={Target} 
                className="lg:col-span-2"
                interpretation={metricInterpretations.matrix}
                isLoading={metricLoading && openSections.matrix}
                isOpen={openSections.matrix}
                onToggle={() => handleMetricClick('matrix', 'Spatial Neural Matrix', dashboardData.slidePerformance)}
              >
                <div className="absolute top-8 right-8 z-20 flex gap-2">
                  <Button 
                    variant={matrixView === '2d' ? 'default' : 'outline'} 
                    size="sm" 
                    onClick={() => setMatrixView('2d')}
                    className="rounded-xl h-8 text-[10px] font-black uppercase tracking-widest"
                  >
                    2D Map
                  </Button>
                  <Button 
                    variant={matrixView === '3d' ? 'default' : 'outline'} 
                    size="sm" 
                    onClick={() => setMatrixView('3d')}
                    className="rounded-xl h-8 text-[10px] font-black uppercase tracking-widest"
                  >
                    3D Spatial
                  </Button>
                </div>
                <div className="h-[500px] w-full relative">
                  {matrixView === '2d' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-muted/20" />
                        <XAxis type="number" dataKey="avgDuration" name="Avg Time" unit="s" tickLine={false} axisLine={false} tick={{fill: 'hsl(var(--foreground))', fontSize: 12, opacity: 0.5}} />
                        <YAxis type="number" dataKey="correctRate" name="Accuracy" unit="%" tickLine={false} axisLine={false} tick={{fill: 'hsl(var(--foreground))', fontSize: 12, opacity: 0.5}} />
                        <ZAxis type="number" dataKey="confusionIndex" range={[50, 800]} name="Confusion" />
                        <Tooltip content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="glass-panel-strong p-5 rounded-2xl shadow-2xl min-w-[240px] border-border animate-scale-in">
                                <p className="font-black text-lg mb-3 border-b border-border pb-2 text-foreground">{d.name}</p>
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Accuracy</span><span className="font-black text-foreground">{d.correctRate}%</span></div>
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Time</span><span className="font-black text-muted-foreground">{d.avgDuration}s</span></div>
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">AI Queries</span><span className="font-black text-primary">{d.aiQueries}</span></div>
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Revisions</span><span className="font-black text-warning">{d.revisions}</span></div>
                                </div>
                                <div className="mt-4 pt-3 border-t border-border flex justify-between items-center -mx-5 -mb-5 px-5 py-3 rounded-b-2xl bg-destructive/10">
                                   <span className="text-[10px] uppercase font-black tracking-[0.2em] text-destructive">Confusion Index</span>
                                   <span className="text-xl font-black text-destructive">{d.confusionIndex}</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }} />
                        <ReferenceArea x1={60} y1={0} y2={60} fill="hsl(var(--destructive))" fillOpacity={0.05} />
                        <Scatter name="Slides" data={dashboardData.slidePerformance?.filter(s => s.quizAttempts > 0)}>
                          {dashboardData.slidePerformance?.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={(entry.confusionIndex > 50) ? "hsl(var(--destructive))" : "hsl(var(--primary))"} opacity={0.8}/>
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  ) : (
                    <ThreeDScatterPlot data={dashboardData.slidePerformance?.filter(s => s.quizAttempts > 0)} />
                  )}
                </div>
              </Section>

              <Section 
                title="Neural Confidence" 
                subtitle="Aggregate Comprehension" 
                icon={Brain}
                interpretation={metricInterpretations.confidence}
                isLoading={metricLoading && openSections.confidence}
                isOpen={openSections.confidence}
                onToggle={() => handleMetricClick('confidence', 'Neural Confidence', dashboardData.confidenceMap)}
              >
                <div className="space-y-6">
                  <div className="mastery-track w-full">
                    <div className="flex h-full">
                      <div style={{ width: `${(dashboardData.confidenceMap.got_it / (dashboardData.confidenceMap.got_it + dashboardData.confidenceMap.unsure + dashboardData.confidenceMap.confused || 1)) * 100}%` }}
                        className="mastery-fill h-full transition-all duration-1000" />
                      <div style={{ width: `${(dashboardData.confidenceMap.unsure / (dashboardData.confidenceMap.got_it + dashboardData.confidenceMap.unsure + dashboardData.confidenceMap.confused || 1)) * 100}%` }}
                        className="bg-warning/50 h-full transition-all duration-1000" />
                      <div style={{ width: `${(dashboardData.confidenceMap.confused / (dashboardData.confidenceMap.got_it + dashboardData.confidenceMap.unsure + dashboardData.confidenceMap.confused || 1)) * 100}%` }}
                        className="bg-destructive/50 h-full transition-all duration-1000" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {[
                      { emoji: '✅', label: 'Synthesized', count: dashboardData.confidenceMap.got_it, color: 'text-success', bg: 'bg-success/5' },
                      { emoji: '🤔', label: 'Processing', count: dashboardData.confidenceMap.unsure, color: 'text-warning', bg: 'bg-warning/5' },
                      { emoji: '❌', label: 'Anomalies', count: dashboardData.confidenceMap.confused, color: 'text-destructive', bg: 'bg-destructive/5' },
                    ].map(r => (
                      <div key={r.label} className={`flex items-center justify-between p-4 rounded-2xl ${r.bg} border border-border`}>
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{r.emoji}</span>
                          <span className="text-xs font-bold uppercase tracking-widest text-foreground">{r.label}</span>
                        </div>
                        <div className={`text-lg font-bold ${r.color}`}>{r.count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Section>
            </div>

            {/* Row 2: Drop-off Map + Per-Slide Confidence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Section 
                title="Where Students Quit" 
                subtitle="Drop-off per slide (non-completers)" 
                icon={TrendingDown}
                interpretation={metricInterpretations.dropoff}
                isLoading={metricLoading && openSections.dropoff}
                isOpen={openSections.dropoff}
                onToggle={() => handleMetricClick('dropoff', 'Where Students Quit', dropoffData)}
              >
                {extraLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : dropoffData?.length === 0 ? (
                  <div className="text-center py-10 space-y-2">
                    <CheckCircle2 className="w-10 h-10 text-success/40 mx-auto" />
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">All students completed this lecture</p>
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dropoffData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--white)/0.05)" vertical={false} />
                        <XAxis dataKey="title" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v} students quit`} />} cursor={{ fill: 'hsl(var(--white)/0.05)' }} />
                        <Bar dataKey="dropout_count" shape={<ThreeDBar />} name="Dropouts" maxBarSize={40}>
                          {dropoffData?.map((entry, idx) => (
                            <Cell key={idx} fill={entry.dropout_percentage > 20 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Section>

              <Section 
                title="Confidence By Slide" 
                subtitle="Comprehension breakdown per node" 
                icon={Lightbulb}
                interpretation={metricInterpretations.bySlide}
                isLoading={metricLoading && openSections.bySlide}
                isOpen={openSections.bySlide}
                onToggle={() => handleMetricClick('bySlide', 'Confidence By Slide', confidenceBySlide)}
              >
                {extraLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : confidenceBySlide?.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground/50 text-xs font-bold uppercase tracking-widest">No confidence ratings yet</div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={confidenceBySlide?.slice(0, 10)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--white)/0.05)" vertical={false} />
                        <XAxis dataKey="title" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--surface-1))', border: '1px solid hsl(var(--border))', borderRadius: '1rem' }} />
                        <Bar dataKey="got_it" stackId="conf" fill="hsl(var(--success))" name="Got It" shape={<ThreeDBar />} />
                        <Bar dataKey="unsure" stackId="conf" fill="hsl(var(--warning))" name="Unsure" shape={<ThreeDBar />} />
                        <Bar dataKey="confused" stackId="conf" fill="hsl(var(--destructive))" name="Confused" shape={<ThreeDBar />} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Section>
            </div>

            {/* Row 3: Interaction Velocity + Score Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <Section 
                title="Interaction Velocity" 
                subtitle="Event density over 7 days" 
                icon={TrendingUp}
                interpretation={metricInterpretations.velocity}
                isLoading={metricLoading && openSections.velocity}
                isOpen={openSections.velocity}
                onToggle={() => handleMetricClick('velocity', 'Interaction Velocity', dashboardData.activityByDay)}
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dashboardData.activityByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--success)" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="var(--success)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-muted/20" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} />
                      <YAxis tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="attempts" stroke="var(--success)" strokeWidth={4} fill="url(#colorVelocity)" activeDot={{ r: 8, strokeWidth: 0 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Section>

              <Section 
                title="Score Distribution" 
                subtitle="Learner population per band" 
                icon={BarChart3}
                interpretation={metricInterpretations.distribution}
                isLoading={metricLoading && openSections.distribution}
                isOpen={openSections.distribution}
                onToggle={() => handleMetricClick('distribution', 'Score Distribution', dashboardData.studentsMatrix)}
              >
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={[
                        { range: '0–20%', count: dashboardData.studentsMatrix?.filter(s => s.quiz_score <= 20).length },
                        { range: '21–40%', count: dashboardData.studentsMatrix?.filter(s => s.quiz_score > 20 && s.quiz_score <= 40).length },
                        { range: '41–60%', count: dashboardData.studentsMatrix?.filter(s => s.quiz_score > 40 && s.quiz_score <= 60).length },
                        { range: '61–80%', count: dashboardData.studentsMatrix?.filter(s => s.quiz_score > 60 && s.quiz_score <= 80).length },
                        { range: '81–100%', count: dashboardData.studentsMatrix?.filter(s => s.quiz_score > 80).length },
                      ]} 
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-muted/20" />
                      <XAxis dataKey="range" tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Students" maxBarSize={50}>
                        {[0,1,2,3,4].map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            </div>

            {/* Predictive Intervention Hub */}
            <div className="intelligence-hub rounded-[2.5rem] overflow-hidden mt-12 relative">
              <div className="absolute top-0 left-0 w-3 h-full bg-destructive shadow-glow-destructive/20 dark:block hidden"></div>
              <div className="p-8 md:px-10 border-b border-border flex justify-between items-center bg-surface-1/50">
                 <div>
                    <h3 className="text-2xl font-black text-foreground flex items-center gap-4 tracking-tight">
                      <AlertTriangle className="w-8 h-8 text-destructive animate-pulse" /> Predictive Intervention Hub
                    </h3>
                    <p className="text-xs font-bold text-muted-foreground mt-2 uppercase tracking-[0.2em] opacity-60">Real-time identification based on interaction typologies and friction points.</p>
                 </div>
              </div>
              
              <div className="overflow-x-auto">
                <Table className="w-full">
                  <TableHeader className="bg-white/5">
                    <TableRow className="border-white/5 hover:bg-transparent">
                      <TableHead className="px-10 py-6 text-[10px] text-muted-foreground uppercase font-black tracking-[0.25em]">Profile Entity</TableHead>
                      <TableHead className="px-10 py-6 text-[10px] text-muted-foreground uppercase font-black tracking-[0.25em]">Neural Classification</TableHead>
                      <TableHead className="px-10 py-6 text-[10px] text-muted-foreground uppercase font-black tracking-[0.25em] text-center">Friction Events</TableHead>
                      <TableHead className="px-10 py-6 text-[10px] text-muted-foreground uppercase font-black tracking-[0.25em]">Matrix Score</TableHead>
                      <TableHead className="px-10 py-6 text-[10px] text-muted-foreground uppercase font-black tracking-[0.25em] text-right">Execute Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardData?.studentsMatrix?.map((student) => (
                      <TableRow key={student.student_id} className="border-white/5 hover:bg-white/5 transition-all group">
                        <TableCell className="px-10 py-6 font-black text-foreground text-lg tracking-tight group-hover:text-primary transition-colors">
                          {student.student_name}
                        </TableCell>
                        <TableCell className="px-10 py-6">
                          <Badge 
                            variant="outline" 
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border shadow-sm ${
                              student.typology.includes('Risk') || student.typology.includes('Critical') ? 'badge-advanced' 
                              : student.typology.includes('Reviser') ? 'badge-intermediate' 
                              : student.typology.includes('Natural') ? 'badge-beginner'
                              : 'bg-surface-2 text-muted-foreground border-border'
                            }`}
                          >
                            {student.typology}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-10 py-6 text-center">
                           <div className="inline-flex gap-3">
                              <span className="font-black text-accent px-3 py-1.5 bg-accent/10 rounded-xl border border-accent/20 text-xs" title="AI Tutor Queries">🎓 {student.ai_interactions}</span>
                              <span className="font-black text-warning px-3 py-1.5 bg-warning/10 rounded-xl border border-warning/20 text-xs" title="Slide Revisions">🔄 {student.revisions}</span>
                           </div>
                        </TableCell>
                        <TableCell className="px-10 py-6 font-black text-xl tracking-tighter">{student.quiz_score}%</TableCell>
                        <TableCell className="px-10 py-6 text-right">
                           <Button variant="outline" size="sm" className={`font-black tracking-widest uppercase text-[10px] h-10 px-6 rounded-2xl shadow-sm transition-all ${student.typology.includes('Critical') || student.typology.includes('Risk') ? 'border-destructive/40 bg-destructive/5 hover:bg-destructive text-destructive hover:text-white shadow-glow-destructive/20' : 'border-white/10 hover:border-primary/50'}`}>
                              Intervene
                           </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {dashboardData.studentsMatrix.length === 0 && (
                       <TableRow>
                        <TableCell colSpan={5} className="px-10 py-20 text-center text-muted-foreground font-black uppercase tracking-[0.3em] opacity-40">
                          Awaiting interaction topologies...
                        </TableCell>
                       </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Row 4: Live Ticker + AI Question Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Live Ticker */}
              <div className="glass-card border-white/5 rounded-[2.5rem] p-8 shadow-xl flex flex-col">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-2xl font-black flex items-center gap-3"><Activity className="w-7 h-7 text-warning"/> Live Ticker</h3>
                  <span className="relative flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-warning"></span>
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto pr-3 space-y-5 custom-scrollbar max-h-[400px]">
                  {dashboardData?.liveTicker?.map((tick, i) => (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                      key={i} className="text-sm glass-panel p-5 rounded-2xl border-white/5 flex gap-5 items-start hover:bg-white/5 transition-colors group">
                       <div className="mt-1 group-hover:scale-110 transition-transform">
                         {tick.type === 'ai_tutor_query' ? <BrainCircuit className="w-6 h-6 text-primary"/> 
                          : tick.type === 'slide_back_navigation' ? <RefreshCw className="w-6 h-6 text-warning"/>
                          : <CheckCircle2 className="w-6 h-6 text-success"/>}
                       </div>
                       <div>
                         <p className="font-bold text-foreground leading-snug text-base tracking-tight">{tick.description}</p>
                         <p className="text-[10px] font-black text-muted-foreground mt-3 uppercase tracking-[0.2em] opacity-60">{new Date(tick.time).toLocaleTimeString()}</p>
                       </div>
                    </motion.div>
                  ))}
                  {dashboardData.liveTicker.length === 0 && (
                    <p className="text-muted-foreground text-center py-20 font-bold opacity-40 uppercase tracking-widest text-xs">
                      Listening for semantic events...
                    </p>
                  )}
                </div>
              </div>

              {/* AI Question Feed */}
              <Section title="Student Questions Feed" subtitle="What students asked the AI tutor" icon={MessageSquare}>
                {extraLoading ? (
                  <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
                ) : aiQueryFeed.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground/50">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-xs font-bold uppercase tracking-widest">No AI tutor queries recorded yet</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                    {aiQueryFeed?.map((item, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="flex gap-4 p-4 glass-panel border-white/5 rounded-2xl hover:bg-white/5 transition-colors">
                        <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center flex-shrink-0">
                          <MessageSquare className="w-5 h-5 text-secondary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">{item.slide_title}</span>
                            <span className="text-[10px] text-muted-foreground/40">{new Date(item.created_at).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-foreground/80 leading-snug">"{item.query_text}"</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

          </motion.div>
        ) : (
          <div className="text-center py-20">
            <AlertTriangle className="w-16 h-16 text-warning mx-auto mb-6 opacity-20" />
            <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">Mission Data Unavailable</p>
            <p className="text-muted-foreground/60 text-sm mt-2">Could not establish telemetry link with this module.</p>
          </div>
        )}
      </div>
    </div>
  );
}
