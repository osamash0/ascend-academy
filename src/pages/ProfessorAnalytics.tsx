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
      className="glass-card rounded-3xl p-6 shadow-sm flex items-center gap-5 hover:shadow-xl hover:border-primary/30 transition-all relative overflow-hidden group border-white/5">
      <div className={`absolute top-0 right-0 w-32 h-32 bg-${vColor}/5 rounded-full blur-3xl group-hover:bg-${vColor}/10 transition-colors pointer-events-none -mr-10 -mt-10`} />
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 gradient-${vColor} shadow-lg shadow-${vColor}/20`}>
        <Icon className={`w-7 h-7 text-${vColor}-foreground`} />
      </div>
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
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
    <div className="p-6 lg:p-10 space-y-10 pb-32 max-w-[1600px] mx-auto">
      {/* Neural Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 glass-panel p-6 rounded-[2rem] border-white/5 shadow-xl">
          <div className="flex items-center gap-5">
            <Button variant="ghost" size="icon" onClick={() => navigate('/professor/analytics')} className="rounded-full w-12 h-12 shadow-sm glass-card hover:bg-white/10 border-white/10"><ArrowLeft className="w-5 h-5"/></Button>
            <div>
              <h1 className="text-3xl font-black text-foreground flex items-center gap-3 tracking-tight"><Activity className="w-8 h-8 text-primary"/> {selectedTitle}</h1>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-[0.2em] mt-1 opacity-70">Neural Edge Semantic Dashboard</p>
            </div>
          </div>
          <Button onClick={fetchAiInsights} disabled={aiLoading || dashboard.isLoading} className="rounded-2xl h-14 px-8 shadow-glow-primary gradient-primary hover:opacity-90 transition-all font-bold text-base">
            {aiLoading ? <RefreshCw className="w-5 h-5 animate-spin mr-3" /> : <Sparkles className="w-5 h-5 mr-3" />}
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
               <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-panel-strong border-primary/20 p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 blur-[100px] rounded-full -mr-20 -mt-20" />
                 <h2 className="text-2xl font-black flex items-center gap-4 text-foreground mb-6"><BrainCircuit className="w-8 h-8 text-primary"/> Neural Synthesizer Report</h2>
                 <p className="text-xl leading-relaxed text-foreground/90 font-medium max-w-5xl border-l-4 border-primary/30 pl-6 italic">"{aiInsights.summary}"</p>
                 <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {aiInsights.suggestions.map((s:any, i:number) => (
                      <div key={i} className="glass-card hover:bg-white/5 p-5 rounded-2xl border-white/5 flex flex-col gap-4 group transition-all">
                         <div className="w-8 h-8 gradient-primary rounded-lg text-sm font-black flex text-white items-center justify-center shadow-glow-primary group-hover:scale-110 transition-transform">{i+1}</div>
                         <p className="text-sm font-bold leading-relaxed text-muted-foreground group-hover:text-foreground transition-colors">{s}</p>
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
             <div className="lg:col-span-2 glass-card rounded-[2.5rem] p-8 md:p-10 shadow-xl border-white/5">
                <div className="mb-10">
                  <h3 className="text-2xl font-black flex items-center gap-3"><Target className="w-7 h-7 text-primary"/> 3D Confusion Matrix</h3>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-2 opacity-60">Bubble size relative to frequency of AI Tutor queries and backward revisions.</p>
                </div>
                <div className="h-96">
                   <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-muted/20" />
                        <XAxis type="number" dataKey="avgDuration" name="Avg Time" unit="s" tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} />
                        <YAxis type="number" dataKey="correctRate" name="Accuracy" unit="%" tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} />
                        <ZAxis type="number" dataKey="confusionIndex" range={[50, 800]} name="Confusion" />
                        <Tooltip content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="glass-panel-strong p-5 rounded-2xl shadow-2xl min-w-[240px] border-white/10 animate-scale-in">
                                <p className="font-black text-lg mb-3 border-b border-white/10 pb-2 text-foreground">{d.name}</p>
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Accuracy</span><span className="font-black text-foreground">{d.correctRate}%</span></div>
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Time</span><span className="font-black text-muted-foreground">{d.avgDuration}s</span></div>
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">AI Queries</span><span className="font-black text-primary">{d.aiQueries}</span></div>
                                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Revisions</span><span className="font-black text-warning">{d.revisions}</span></div>
                                </div>
                                <div className="mt-4 pt-3 border-t border-white/10 flex justify-between items-center -mx-5 -mb-5 px-5 py-3 rounded-b-2xl bg-destructive/10">
                                   <span className="text-[10px] uppercase font-black tracking-[0.2em] text-destructive">Confusion Index</span>
                                   <span className="text-xl font-black text-destructive">{d.confusionIndex}</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }} />
                        <ReferenceArea x1={60} y1={0} y2={60} fill="var(--destructive)" fillOpacity={0.05} />
                        <Scatter name="Slides" data={dashboard.data.slidePerformance.filter((s:any) => s.quizAttempts > 0)}>
                          {dashboard.data.slidePerformance.map((entry: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={(entry.confusionIndex > 50) ? "var(--destructive)" : "var(--primary)"} opacity={0.8}/>
                          ))}
                        </Scatter>
                      </ScatterChart>
                   </ResponsiveContainer>
                </div>
             </div>

             {/* Live Student Interactive Ticker */}
             <div className="glass-card border-white/5 rounded-[2.5rem] p-8 shadow-xl flex flex-col">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-2xl font-black flex items-center gap-3"><Activity className="w-7 h-7 text-warning"/> Live Ticker</h3>
                  <span className="relative flex h-4 w-4"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span><span className="relative inline-flex rounded-full h-4 w-4 bg-warning"></span></span>
                </div>
                <div className="flex-1 overflow-y-auto pr-3 space-y-5 custom-scrollbar">
                  {dashboard.data.liveTicker.map((tick:any, i:number) => (
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
                  {dashboard.data.liveTicker.length === 0 && <p className="text-muted-foreground text-center py-20 font-bold opacity-40 uppercase tracking-widest text-xs">Listening for semantic events...</p>}
                </div>
             </div>
          </div>

          {/* Typology and Weekly Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             <div className="glass-card border-white/5 p-8 rounded-[2.5rem] shadow-xl">
                <h3 className="text-2xl font-black flex items-center gap-3 mb-8"><Users className="w-7 h-7 text-accent"/> Algorithmic Student Typology</h3>
                 <div className="h-64 flex">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={typologyData} cx="50%" cy="50%" innerRadius={70} outerRadius={90} paddingAngle={8} dataKey="value" 
                           label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} stroke="none">
                          {typologyData.map((d, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} opacity={0.8} />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                 </div>
             </div>

             <div className="glass-card border-white/5 p-8 rounded-[2.5rem] shadow-xl">
                <h3 className="text-2xl font-black flex items-center gap-3 mb-8"><TrendingUp className="w-7 h-7 text-success"/> Interaction Velocity</h3>
                <div className="h-64">
                   <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dashboard.data.activityByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                           <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                             <stop offset="5%" stopColor="var(--success)" stopOpacity={0.4}/>
                             <stop offset="95%" stopColor="var(--success)" stopOpacity={0}/>
                           </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} />
                        <YAxis tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 12, opacity: 0.5}} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="attempts" stroke="var(--success)" strokeWidth={4} fill="url(#colorVelocity)" activeDot={{ r: 8, strokeWidth: 0 }} />
                      </AreaChart>
                   </ResponsiveContainer>
                </div>
             </div>
          </div>

          {/* Predictive Warning Matrix */}
          <div className="glass-panel-strong rounded-[2.5rem] border-destructive/20 shadow-2xl overflow-hidden mt-12 relative">
            <div className="absolute top-0 left-0 w-3 h-full bg-gradient-to-b from-destructive via-destructive/50 to-destructive/20 shadow-glow-destructive/40"></div>
            <div className="p-8 md:px-10 border-b border-white/5 flex justify-between items-center bg-white/5">
               <div>
                  <h3 className="text-2xl font-black text-foreground flex items-center gap-4 tracking-tight">
                    <AlertTriangle className="w-8 h-8 text-destructive animate-pulse" /> Predictive Intervention Hub
                  </h3>
                  <p className="text-xs font-bold text-muted-foreground mt-2 uppercase tracking-[0.2em] opacity-60">Real-time identification based on interaction typologies, friction points, and scores.</p>
               </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-muted-foreground uppercase bg-white/5 font-black tracking-[0.25em]">
                  <tr>
                    <th className="px-10 py-6">Profile Entity</th>
                    <th className="px-10 py-6">Neural Classification</th>
                    <th className="px-10 py-6 text-center">Friction Events (Revisions)</th>
                    <th className="px-10 py-6">Matrix Score</th>
                    <th className="px-10 py-6 text-right">Execute Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {dashboard.data.studentsMatrix.map((student: any) => (
                    <tr key={student.student_id} className="hover:bg-white/5 transition-all group">
                      <td className="px-10 py-6 font-black text-foreground text-lg tracking-tight group-hover:text-primary transition-colors">{student.student_name}</td>
                      <td className="px-10 py-6">
                        <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border shadow-sm ${
                          student.typology.includes('Risk') || student.typology.includes('Critical') ? 'bg-destructive/10 text-destructive border-destructive/20 shadow-glow-destructive/10' 
                          : student.typology.includes('Reviser') ? 'bg-warning/10 text-warning border-warning/20' 
                          : student.typology.includes('Natural') ? 'bg-success/10 text-success border-success/20'
                          : 'bg-white/5 text-muted-foreground border-white/10'
                        }`}>
                          {student.typology}
                        </span>
                      </td>
                      <td className="px-10 py-6 text-center">
                         <div className="inline-flex gap-3">
                            <span className="font-black text-accent px-3 py-1.5 bg-accent/10 rounded-xl border border-accent/20 text-xs" title="AI Tutor Queries">🎓 {student.ai_interactions}</span>
                            <span className="font-black text-warning px-3 py-1.5 bg-warning/10 rounded-xl border border-warning/20 text-xs" title="Slide Revisions">🔄 {student.revisions}</span>
                         </div>
                      </td>
                      <td className="px-10 py-6 font-black text-xl tracking-tighter">{student.quiz_score}%</td>
                      <td className="px-10 py-6 text-right">
                         <Button variant="outline" size="sm" className={`font-black tracking-widest uppercase text-[10px] h-10 px-6 rounded-2xl shadow-sm transition-all ${student.typology.includes('Critical') || student.typology.includes('Risk') ? 'border-destructive/40 bg-destructive/5 hover:bg-destructive text-destructive hover:text-white shadow-glow-destructive/20' : 'border-white/10 hover:border-primary/50'}`}>
                            Intervene
                         </Button>
                      </td>
                    </tr>
                  ))}
                  {dashboard.data.studentsMatrix.length === 0 && (
                     <tr><td colSpan={5} className="px-10 py-20 text-center text-muted-foreground font-black uppercase tracking-[0.3em] opacity-40">Awaiting interaction topologies...</td></tr>
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
