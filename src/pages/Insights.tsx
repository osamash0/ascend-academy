import { motion } from 'framer-motion';
import { Brain, Sparkles, TrendingUp, Zap, Clock, Calendar, Activity, ChevronLeft } from 'lucide-react';
import { OptimalScheduleCard } from '@/components/OptimalScheduleCard';
import { useNavigate } from 'react-router-dom';

export default function Insights() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-colors w-fit group"
        >
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </motion.button>
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Brain className="w-6 h-6 text-primary" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Intelligence Center</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-foreground tracking-tighter">
              Learning <span className="text-gradient">Insights</span>
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl">
              Deep-dive into your cognitive patterns. Our AI analyzes your performance and behavior to optimize your study routine.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center gap-4 bg-surface-1/50 border border-white/5 p-4 rounded-2xl"
          >
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Global Rank</p>
              <p className="text-xl font-black text-foreground tracking-tighter">Top 5%</p>
            </div>
            <div className="w-px h-10 bg-white/5" />
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-success/10">
              <TrendingUp className="w-5 h-5 text-success" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Insight - Circadian Analysis */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-8">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Circadian Rhythm Analysis
              </h2>
              <div className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                <span className="text-[9px] font-bold text-primary uppercase">Real-time Calibration</span>
              </div>
            </div>
            <OptimalScheduleCard />
          </section>

          {/* Secondary Insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InsightMiniCard 
              icon={<Zap className="w-5 h-5 text-xp" />}
              title="Focus Intensity"
              value="8.4/10"
              description="Your focus peaked during the morning lecture. You were 15% more efficient than last week."
              color="xp"
            />
            <InsightMiniCard 
              icon={<Activity className="w-5 h-5 text-success" />}
              title="Retention Rate"
              value="92%"
              description="High retention detected in visual-based slides. Consider using more diagrams in your notes."
              color="success"
            />
          </div>
        </div>

        {/* Sidebar Insights */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6">
          <div className="glass-card p-6 border-white/5 space-y-6">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-widest flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Recommendations
            </h3>
            
            <div className="space-y-4">
              <RecommendationItem 
                title="Optimize Study Window"
                desc="Move your complex logic sessions to 10:00 AM based on your performance peak."
              />
              <RecommendationItem 
                title="Active Recall Session"
                desc="Schedule a quick quiz for 'Neural Networks' today to prevent forgetting curve drop-off."
              />
              <RecommendationItem 
                title="Energy Management"
                desc="Take a 10-minute break at 3:00 PM to combat the detected afternoon slump."
              />
            </div>

            <button className="w-full py-3 rounded-xl bg-surface-2 border border-white/5 text-xs font-bold text-primary hover:bg-surface-3 transition-colors uppercase tracking-widest">
              Refresh Analysis
            </button>
          </div>

          <div className="glass-card p-6 border-white/5">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-widest flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-secondary" />
              Weekly Progress
            </h3>
            <div className="h-32 flex items-end gap-1 px-2">
              {[40, 65, 45, 80, 55, 90, 70].map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: `${h}%` }}
                    className={`w-full rounded-t-lg bg-gradient-to-t from-primary/20 to-primary/80 ${i === 5 ? 'opacity-100 shadow-glow-primary' : 'opacity-40'}`}
                  />
                  <span className="text-[8px] font-bold text-muted-foreground uppercase">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightMiniCard({ icon, title, value, description, color }: { icon: any, title: string, value: string, description: string, color: string }) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className="glass-card p-6 border-white/5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-xl bg-${color}/10 flex items-center justify-center`}>
          {icon}
        </div>
        <span className={`text-2xl font-black text-foreground`}>{value}</span>
      </div>
      <div>
        <h4 className="text-sm font-bold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {description}
        </p>
      </div>
    </motion.div>
  );
}

function RecommendationItem({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="p-4 rounded-xl bg-surface-1/50 border border-white/5 space-y-1 group hover:border-primary/30 transition-colors">
      <h5 className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">{title}</h5>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {desc}
      </p>
    </div>
  );
}
