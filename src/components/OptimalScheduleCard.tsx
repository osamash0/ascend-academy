import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Sparkles, TrendingUp, Brain, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface HourlyStat {
  hour: number;
  score: number;
  accuracy: number;
  intensity: number;
}

interface OptimalScheduleData {
  suggested_hours: HourlyStat[];
  peak_hour: number | null;
  message: string;
  accuracy_at_peak?: number;
}

export function OptimalScheduleCard() {
  const [data, setData] = useState<OptimalScheduleData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOptimalSchedule();
  }, []);

  const fetchOptimalSchedule = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/analytics/personal/optimal-schedule`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (response.ok) {
        const json = await response.json();
        if (json.success) {
          setData(json.data);
        }
      }
    } catch (error) {
      console.error('Error fetching optimal schedule:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatHour = (h: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour} ${ampm}`;
  };

  if (loading) {
    return (
      <div className="glass-card p-6 animate-pulse space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-2" />
          <div className="space-y-2">
            <div className="h-4 w-32 bg-surface-2 rounded" />
            <div className="h-3 w-20 bg-surface-2 rounded" />
          </div>
        </div>
        <div className="h-20 w-full bg-surface-2 rounded-2xl" />
      </div>
    );
  }

  if (!data || !data.suggested_hours.length) {
    return (
      <div className="glass-card p-6 border-white/5 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50" />
        <div className="relative z-10 flex flex-col items-center text-center py-4">
          <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
            <Calendar className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-bold text-foreground mb-1">Building Your Profile</h3>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            Complete more quizzes to unlock your personalized study schedule.
          </p>
        </div>
      </div>
    );
  }

  const peakHourStr = formatHour(data.peak_hour || 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 border-white/5 relative overflow-hidden group hover:border-primary/30 transition-all duration-500"
    >
      {/* Background Glow */}
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[60px] group-hover:bg-primary/20 transition-all duration-700" />
      
      <div className="relative z-10 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Optimal Window</h3>
              <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Circadian Analysis</p>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-2xl font-bold text-foreground">{peakHourStr}</span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Peak Performance</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-surface-1/50 border border-white/5 space-y-3">
          <div className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-xp mt-0.5" />
            <p className="text-xs font-medium text-foreground leading-relaxed italic">
              "{data.message}"
            </p>
          </div>
          
          {data.accuracy_at_peak !== undefined && (
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-success" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Accuracy at peak</span>
              </div>
              <span className="text-xs font-bold text-success">{data.accuracy_at_peak}%</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Other High-Focus Times</span>
            <TrendingUp className="w-3 h-3 text-primary" />
          </div>
          <div className="flex gap-2">
            {data.suggested_hours.slice(1, 3).map((stat) => (
              <div key={stat.hour} className="flex-1 p-3 rounded-xl bg-surface-2/30 border border-white/5 flex flex-col items-center gap-1 group/item hover:bg-surface-2/50 transition-colors">
                <span className="text-xs font-bold text-foreground">{formatHour(stat.hour)}</span>
                <div className="w-full h-1 bg-surface-3 rounded-full overflow-hidden mt-1">
                  <div 
                    className="h-full bg-primary" 
                    style={{ width: `${stat.score * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
