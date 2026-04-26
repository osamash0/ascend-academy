import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Users, TrendingUp, Clock, Target, Award,
  Sparkles, RefreshCw, CheckCircle2, BookOpen,
  ArrowLeft, BrainCircuit, Activity, AlertTriangle
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useAnalytics } from '@/features/analytics/hooks/useAnalytics';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter, ZAxis, ReferenceArea,
  PieChart, Pie, Cell, LineChart, Line, BarChart, Bar
} from 'recharts';
import { CustomTooltip } from '@/components/charts/CustomTooltip';

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/analytics";
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

const StatsCard = ({ title, value, icon: Icon, variant, delay = 0 }: any) => {
  const vColor = variant === 'primary' ? 'primary' : variant === 'success' ? 'success' : variant === 'xp' ? 'xp' : 'accent';
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="bg-card rounded-3xl border border-border p-6 shadow-sm flex items-center gap-5 hover:shadow-lg transition-shadow relative overflow-hidden group">
      <div className={`absolute top-0 right-0 w-32 h-32 bg-${vColor}/5 rounded-full blur-3xl group-hover:bg-${vColor}/10 transition-colors pointer-events-none -mr-10 -mt-10`} />
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 gradient-${vColor} shadow-lg shadow-${vColor}/20`}>
        <Icon className={`w-7 h-7 text-${vColor}-foreground`} />
      </div>
      <div>
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">{title}</p>
        <h4 className="text-3xl font-black text-foreground mt-1 tracking-tight">{value}</h4>
      </div>
    </motion.div>
  );
};

export default function ProfessorAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { lectureId } = useParams();

  const [lectures, setLectures] = useState<any[]>([]);
  const [lecturesLoading, setLecturesLoading] = useState(true);
  const [selectedTitle, setSelectedTitle] = useState('');

  const [aiInsights, setAiInsights] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Fetch lectures list once
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('lectures').select('*').eq('professor_id', user.id).order('created_at', { ascending: false });
      if (data) setLectures(data);
      setLecturesLoading(false);
    })();
  }, [user?.id]);

  useEffect(() => {
    if (lectureId && lectures.length > 0) {
      const lec = lectures.find(l => l.id === lectureId);
      if (lec) setSelectedTitle(lec.title);
    }
  }, [lectureId, lectures]);

  const { dashboard } = useAnalytics(lectureId || null);

  const fetchAiInsights = useCallback(async () => {
    if (!dashboard.data) return;
    setAiLoading(true);
    setAiInsights(null);

    const d = dashboard.data;
    try {
      const res = await fetch(`${API_BASE}/api/ai/analytics-insights`.replace('/api/analytics/api/ai', '/api/ai'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          total_students: d.overview.uniqueStudents, average_score: d.overview.averageScore,
          total_attempts: d.overview.totalAttempts, total_correct: d.overview.totalCorrect,
          hard_slides: d.slidePerformance.slice(0, 3).map((s: any) => s.name).join(', '),
          engaging_slides: "Varies", weekly_trend: "Varies", confidence_summary: "Varies",
          ai_model: localStorage.getItem('ascend-academy-ai-model') || 'groq'
        }),
      });
      const data = await res.json();
      setAiInsights(data);
    } catch {
      setAiInsights({
        summary: 'Advanced Neural Analytics connected. AI model connection offline.',
        suggestions: ['Review slides with highest Confusion Index.', 'Contact "Struggling (Critical)" students.']
      });
    }
    setAiLoading(false);
  }, [dashboard.data]);

  const typologyData = useMemo(() => {
    if (!dashboard.data) return [];
    const counts = dashboard.data.studentsMatrix.reduce((acc: any, s: any) => {
      acc[s.typology] = (acc[s.typology] || 0) + 1;
      return acc;
    }, {});
    return Object.keys(counts).map(k => ({ name: k, value: counts[k] }));
  }, [dashboard.data]);

  if (lecturesLoading) return <div className="flex justify-center items-center h-screen"><RefreshCw className="animate-spin w-8 h-8 text-primary" /></div>;

  if (!lectureId) {
    return (
      <div className="p-8 pb-32">
        <h1 className="text-3xl font-bold flex items-center gap-3 mb-8"><BarChart3 className="text-primary w-8 h-8"/> Analytics Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lectures.map((lec: any, i: number) => (
             <motion.button key={lec.id} onClick={() => navigate(`/professor/analytics/${lec.id}`)}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="text-left bg-card p-6 rounded-3xl border border-border hover:shadow-xl hover:border-primary/50 transition-all">
               <div className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center mb-4"><BookOpen className="text-primary-foreground"/></div>
               <h3 className="text-lg font-bold">{lec.title}</h3>
             </motion.button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8 pb-32 max-w-[1600px] mx-auto">
      {/* Neural Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/30 p-4 rounded-3xl border border-border">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/professor/analytics')} className="rounded-full shadow-sm bg-card hover:bg-muted border border-border"><ArrowLeft className="w-5 h-5"/></Button>
            <div>
              <h1 className="text-2xl font-black text-foreground flex items-center gap-2"><Activity className="w-6 h-6 text-primary"/> {selectedTitle}</h1>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mt-1">Neural Edge Semantic Dashboard</p>
            </div>
          </div>
          <Button onClick={fetchAiInsights} disabled={aiLoading || dashboard.isLoading} className="rounded-full px-6 shadow-xl gradient-primary">
            {aiLoading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Generate Predictive Intervention
          </Button>
      </div>

      {dashboard.isLoading && (
        <div className="flex justify-center items-center py-40"><div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"/></div>
      )}

      {dashboard.data && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          
          <AnimatePresence>
            {aiInsights && (
               <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-gradient-to-r from-primary/10 via-card to-card border border-primary/20 p-8 rounded-3xl shadow-2xl relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-3xl rounded-full" />
                 <h2 className="text-xl font-bold flex items-center gap-3 text-foreground mb-4"><BrainCircuit className="w-6 h-6 text-primary"/> Neural Synthesizer Report</h2>
                 <p className="text-lg leading-relaxed text-foreground/90 font-medium max-w-4xl">{aiInsights.summary}</p>
                 <div className="mt-6 flex flex-col md:flex-row gap-4">
                    {aiInsights.suggestions.map((s:any, i:number) => (
                      <div key={i} className="flex-1 bg-background/50 backdrop-blur-md p-4 rounded-2xl border border-border/50 flex gap-3">
                         <div className="w-6 h-6 gradient-primary rounded-full text-xs font-bold flex text-white items-center justify-center pt-0.5">{i+1}</div>
                         <p className="text-sm font-semibold leading-snug">{s}</p>
                      </div>
                    ))}
                 </div>
               </motion.div>
            )}
          </AnimatePresence>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatsCard title="Engaged Students" value={dashboard.data.overview.uniqueStudents} icon={Users} variant="primary" delay={0.1}/>
            <StatsCard title="Global Score Avg" value={`${dashboard.data.overview.averageScore}%`} icon={Target} variant="success" delay={0.2}/>
            <StatsCard title="Semantic Events" value={dashboard.data.overview.totalEvents} icon={Activity} variant="accent" delay={0.3}/>
            <StatsCard title="Total Interactions" value={dashboard.data.overview.totalAttempts} icon={Award} variant="xp" delay={0.4}/>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             {/* The Frustration Matrix Map */}
             <div className="lg:col-span-2 bg-card border border-border rounded-3xl p-6 md:p-8 shadow-sm">
                <div className="mb-8">
                  <h3 className="text-xl font-bold flex items-center gap-2"><Target className="w-6 h-6 text-primary"/> 3D Confusion Matrix</h3>
                  <p className="text-sm font-medium text-muted-foreground mt-1">Bubble size relative to frequency of AI Tutor queries and backward revisions.</p>
                </div>
                <div className="h-96">
                   <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.3}/>
                        <XAxis type="number" dataKey="avgDuration" name="Avg Time" unit="s" tickLine={false} axisLine={false} />
                        <YAxis type="number" dataKey="correctRate" name="Accuracy" unit="%" tickLine={false} axisLine={false} />
                        <ZAxis type="number" dataKey="confusionIndex" range={[50, 800]} name="Confusion" />
                        <Tooltip content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="bg-card border border-border p-4 rounded-2xl shadow-2xl min-w-[200px]">
                                <p className="font-bold text-base mb-2 border-b border-border pb-2">{d.name}</p>
                                <p className="text-sm font-medium">Confidence: <span className="font-black float-right">{d.correctRate}%</span></p>
                                <p className="text-sm font-medium">Duration: <span className="font-black float-right text-muted-foreground">{d.avgDuration}s</span></p>
                                <p className="text-sm font-medium">AI Queries: <span className="font-black float-right text-primary">{d.aiQueries}</span></p>
                                <p className="text-sm font-medium">Revisions: <span className="font-black float-right text-warning">{d.revisions}</span></p>
                                <div className="mt-3 pt-2 border-t border-border flex justify-between items-center bg-muted -mx-4 -mb-4 px-4 py-2 rounded-b-xl border-t">
                                   <span className="text-xs uppercase font-bold tracking-widest text-muted-foreground">Index</span>
                                   <span className="text-sm font-black text-destructive">{d.confusionIndex}</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }} />
                        <ReferenceArea x1={60} y1={0} y2={60} fill="hsl(var(--destructive))" fillOpacity={0.03} />
                        <Scatter name="Slides" data={dashboard.data.slidePerformance.filter((s:any) => s.quizAttempts > 0)} fill="hsl(var(--primary))">
                          {dashboard.data.slidePerformance.map((entry: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={(entry.confusionIndex > 50) ? "hsl(var(--destructive))" : "hsl(var(--primary))"} opacity={0.8}/>
                          ))}
                        </Scatter>
                      </ScatterChart>
                   </ResponsiveContainer>
                </div>
             </div>

             {/* Live Student Interactive Ticker */}
             <div className="bg-card border border-border rounded-3xl p-6 shadow-sm flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold flex items-center gap-2"><Activity className="w-6 h-6 text-warning"/> Live Ticker</h3>
                  <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-warning"></span></span>
                </div>
                <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                  {dashboard.data.liveTicker.map((tick:any, i:number) => (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                      key={i} className="text-sm bg-muted/40 p-4 rounded-2xl border border-muted-foreground/10 flex gap-4 items-start">
                       <div className="mt-0.5">
                         {tick.type === 'ai_tutor_query' ? <BrainCircuit className="w-5 h-5 text-primary"/> 
                          : tick.type === 'slide_back_navigation' ? <RefreshCw className="w-5 h-5 text-warning"/>
                          : <CheckCircle2 className="w-5 h-5 text-success"/>}
                       </div>
                       <div>
                         <p className="font-semibold text-foreground leading-snug">{tick.description}</p>
                         <p className="text-xs font-bold text-muted-foreground mt-2 uppercase tracking-wide">{new Date(tick.time).toLocaleTimeString()}</p>
                       </div>
                    </motion.div>
                  ))}
                  {dashboard.data.liveTicker.length === 0 && <p className="text-muted-foreground text-center py-10 font-medium">Listening for semantic events...</p>}
                </div>
             </div>
          </div>

          {/* Typology and Weekly Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             <div className="bg-card border border-border p-6 rounded-3xl shadow-sm">
                <h3 className="text-xl font-bold flex items-center gap-2 mb-6"><Users className="w-6 h-6 text-accent"/> Algorithmic Student Typology</h3>
                 <div className="h-64 flex">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={typologyData} cx="50%" cy="50%" innerRadius={70} outerRadius={90} paddingAngle={5} dataKey="value" 
                           label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} stroke="none">
                          {typologyData.map((d, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                 </div>
             </div>

             <div className="bg-card border border-border p-6 rounded-3xl shadow-sm">
                <h3 className="text-xl font-bold flex items-center gap-2 mb-6"><TrendingUp className="w-6 h-6 text-success"/> Interaction Velocity</h3>
                <div className="h-64">
                   <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={dashboard.data.activityByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                       <defs>
                          <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0}/>
                          </linearGradient>
                       </defs>
                       <XAxis dataKey="date" tickLine={false} axisLine={false} />
                       <YAxis tickLine={false} axisLine={false} />
                       <Tooltip content={<CustomTooltip />} />
                       <Area type="monotone" dataKey="attempts" stroke="hsl(var(--success))" strokeWidth={4} fill="url(#colorVelocity)" activeDot={{ r: 8 }} />
                     </AreaChart>
                   </ResponsiveContainer>
                </div>
             </div>
          </div>

          {/* Predictive Warning Matrix */}
          <div className="bg-card rounded-3xl border border-destructive/20 shadow-xl overflow-hidden mt-8 relative">
            <div className="absolute top-0 left-0 w-2 h-full bg-destructive/80"></div>
            <div className="p-6 md:px-8 border-b border-border flex justify-between items-center">
               <div>
                  <h3 className="text-xl font-black text-foreground flex items-center gap-3">
                    <AlertTriangle className="w-6 h-6 text-destructive" /> Predictive Intervention Hub
                  </h3>
                  <p className="text-sm font-semibold text-muted-foreground mt-1 tracking-wide">Real-time identification based on interaction typologies, friction points, and scores.</p>
               </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/40 font-black tracking-widest">
                  <tr>
                    <th className="px-8 py-5">Profile Entity</th>
                    <th className="px-8 py-5">Neural Classification</th>
                    <th className="px-8 py-5 text-center">Friction Events (Revisions)</th>
                    <th className="px-8 py-5">Matrix Score</th>
                    <th className="px-8 py-5 text-right">Execute Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {dashboard.data.studentsMatrix.map((student: any) => (
                    <tr key={student.student_id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-8 py-5 font-bold text-foreground text-base tracking-tight">{student.student_name}</td>
                      <td className="px-8 py-5">
                        <span className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${
                          student.typology.includes('Risk') || student.typology.includes('Critical') ? 'bg-destructive/10 text-destructive border border-destructive/20' 
                          : student.typology.includes('Reviser') ? 'bg-warning/10 text-warning border border-warning/20' 
                          : student.typology.includes('Natural') ? 'bg-success/10 text-success border border-success/20'
                          : 'bg-muted text-muted-foreground border border-border'
                        }`}>
                          {student.typology}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-center">
                         <div className="inline-flex gap-2">
                            <span className="font-bold text-accent px-2 py-1 bg-accent/10 rounded-md border border-accent/20" title="AI Tutor Queries">🎓 {student.ai_interactions}</span>
                            <span className="font-bold text-warning px-2 py-1 bg-warning/10 rounded-md border border-warning/20" title="Slide Revisions">🔄 {student.revisions}</span>
                         </div>
                      </td>
                      <td className="px-8 py-5 font-black text-lg">{student.quiz_score}%</td>
                      <td className="px-8 py-5 text-right">
                         <Button variant="outline" size="sm" className={`font-bold tracking-widest uppercase text-xs h-9 px-4 rounded-xl shadow-sm ${student.typology.includes('Critical') || student.typology.includes('Risk') ? 'border-destructive/40 bg-destructive/5 hover:bg-destructive text-destructive hover:text-white' : ''}`}>
                            Intervene
                         </Button>
                      </td>
                    </tr>
                  ))}
                  {dashboard.data.studentsMatrix.length === 0 && (
                     <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground font-medium">Awaiting interaction topologies...</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
