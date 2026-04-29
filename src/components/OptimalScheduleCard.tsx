import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import { 
  Clock, Sparkles, TrendingUp, Brain, Calendar, Moon, Sun, 
  Battery, Activity, Zap, Award, ChevronRight, Info 
} from 'lucide-react';
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
  energy_pattern?: string;
  circadian_score?: number;
}

// Helper: Format hour to 12h format with AM/PM
const formatHour = (h: number): string => {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour} ${ampm}`;
};

// Helper: Get emoji for energy level
const getEnergyEmoji = (score: number): string => {
  if (score >= 0.8) return '⚡';
  if (score >= 0.6) return '🔋';
  if (score >= 0.4) return '😴';
  return '🌙';
};

// Helper: Get color based on score
const getScoreColor = (score: number): string => {
  if (score >= 0.8) return 'from-green-400 to-emerald-500';
  if (score >= 0.6) return 'from-primary to-secondary';
  if (score >= 0.4) return 'from-amber-400 to-orange-500';
  return 'from-rose-400 to-red-500';
};

// ── 3D Circular Progress Ring ──
function CircadianRing({ percentage, size = 120 }: { percentage: number; size?: number }) {
  const radius = (size - 20) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;
  
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          className="text-white/5"
        />
        {/* Progress arc with gradient */}
        <defs>
          <linearGradient id="circadianGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="50%" stopColor="hsl(var(--secondary))" />
            <stop offset="100%" stopColor="hsl(var(--xp))" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#circadianGradient)"
          strokeWidth={6}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{percentage}%</span>
        <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Alignment</span>
      </div>
    </div>
  );
}

// ── Animated Waveform for Energy Pattern ──
function EnergyWaveform({ data, isActive }: { data: number[]; isActive: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-12">
      {data.map((height, i) => (
        <motion.div
          key={i}
          className="w-1.5 rounded-full bg-gradient-to-t from-primary to-secondary"
          animate={{
            height: isActive ? [height, height * 1.3, height] : height,
            opacity: isActive ? [0.6, 1, 0.6] : 0.4,
          }}
          transition={{
            duration: 1,
            repeat: isActive ? Infinity : 0,
            delay: i * 0.1,
            ease: "easeInOut",
          }}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

// ── Main Component ──
export function OptimalScheduleCard() {
  const [data, setData] = useState<OptimalScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(mouseY, { stiffness: 100, damping: 30 });
  const rotateY = useSpring(mouseX, { stiffness: 100, damping: 30 });

  useEffect(() => {
    fetchOptimalSchedule();
  }, []);

  const fetchOptimalSchedule = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/analytics/personal/optimal-schedule`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
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

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      // Map mouse position to -10 to 10 degrees of rotation
      mouseX.set((e.clientX - centerX) / (rect.width / 2) * 10);
      mouseY.set((e.clientY - centerY) / (rect.height / 2) * -10);
    }
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
    setHoveredHour(null);
  };

  // Loading state
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

  // Empty state
  if (!data || !data.suggested_hours.length) {
    return (
      <div className="glass-card p-6 border-white/5 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50" />
        <div className="relative z-10 flex flex-col items-center text-center py-4">
          <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
            <Calendar className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-bold text-foreground mb-1">Calibrating Your Rhythm</h3>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            Complete 5+ quizzes to unlock your personalized circadian analysis.
          </p>
          <div className="mt-4 w-full bg-surface-2 rounded-full h-1.5">
            <motion.div 
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
              initial={{ width: 0 }}
              animate={{ width: '30%' }}
              transition={{ duration: 1, delay: 0.5 }}
            />
          </div>
        </div>
      </div>
    );
  }

  const peakHourStr = formatHour(data.peak_hour || 0);
  const circadianAlignment = data.circadian_score || Math.round((data.accuracy_at_peak || 75) * 1.2);
  const waveformData = data.suggested_hours.map(h => h.score * 80 + 20);
  
  // Find peak hour index for animation
  const peakIndex = data.suggested_hours.findIndex(h => h.hour === data.peak_hour);

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ rotateX, rotateY, perspective: 1000 }}
      className="relative group touch-none"
    >
      {/* Main Card */}
      <div className="glass-card p-6 border-white/5 relative overflow-hidden transition-all duration-500 hover:border-primary/30 hover:shadow-glow-primary/20">
        {/* Animated Background Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
        
        {/* Floating energy orbs */}
        <motion.div
          className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary/10 blur-3xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity }}
        />
        
        <div className="relative z-10">
          {/* Header with Animated Icon */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <motion.div
                className="relative"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary rounded-2xl blur-md opacity-60 animate-pulse" />
                <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
                  <Clock className="w-6 h-6 text-white" />
                </div>
              </motion.div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Optimal Window</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Circadian Analysis</span>
                  <button 
                    onClick={() => setExpanded(!expanded)}
                    className="text-muted-foreground/50 hover:text-primary transition-colors"
                  >
                    <Info className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Peak Time Badge */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="flex flex-col items-end"
            >
              <div className="text-3xl font-black text-foreground tracking-tighter flex items-center gap-1">
                {peakHourStr}
                <motion.span
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  🧠
                </motion.span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Peak Performance</span>
                {data.accuracy_at_peak && (
                  <span className="text-[9px] font-bold text-success">{data.accuracy_at_peak}%</span>
                )}
              </div>
            </motion.div>
          </div>

          {/* Circadian Alignment Ring + Message */}
          <div className="flex items-center gap-6 mb-6">
            <CircadianRing percentage={circadianAlignment} size={100} />
            
            <div className="flex-1 space-y-2">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-xp mt-0.5 flex-shrink-0 animate-pulse" />
                <p className="text-sm font-medium text-foreground leading-relaxed italic">
                  "{data.message}"
                </p>
              </div>
              
              {/* Energy Pattern Tags */}
              <div className="flex flex-wrap gap-2 mt-2">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20">
                  <Activity className="w-3 h-3 text-primary" />
                  <span className="text-[9px] font-bold text-primary uppercase tracking-wider">
                    {data.energy_pattern || "Morning Peak"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-success/10 border border-success/20">
                  <Brain className="w-3 h-3 text-success" />
                  <span className="text-[9px] font-bold text-success uppercase tracking-wider">
                    {circadianAlignment >= 80 ? "Optimal Sync" : "Calibrating"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 24-Hour Energy Timeline */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Battery className="w-3 h-3" />
                Energy Rhythm
              </span>
              <span className="text-[9px] text-muted-foreground">→ Your focus varies by hour</span>
            </div>
            
            {/* Hourly bars */}
            <div className="flex items-end gap-1 h-24">
              {data.suggested_hours.map((stat, idx) => {
                const isPeak = stat.hour === data.peak_hour;
                const isHovered = hoveredHour === stat.hour;
                const barHeight = stat.score * 100;
                const colorClass = getScoreColor(stat.score);
                
                return (
                  <motion.div
                    key={stat.hour}
                    className="flex-1 flex flex-col items-center gap-1 group/hour"
                    onMouseEnter={() => setHoveredHour(stat.hour)}
                    onMouseLeave={() => setHoveredHour(null)}
                  >
                    <motion.div
                      className={`w-full rounded-t-lg bg-gradient-to-t ${colorClass} cursor-pointer relative overflow-hidden`}
                      initial={{ height: 0 }}
                      animate={{ height: `${barHeight}%` }}
                      transition={{ duration: 0.8, delay: idx * 0.05, ease: [0.34, 1.56, 0.64, 1] }}
                      style={{ minHeight: 4 }}
                    >
                      {/* Animated shimmer on hover */}
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-t from-white/0 via-white/20 to-white/0"
                        animate={{ y: isHovered ? ['-100%', '100%'] : '0%' }}
                        transition={{ duration: 0.6, repeat: isHovered ? Infinity : 0 }}
                      />
                      
                      {/* Peak indicator */}
                      {isPeak && (
                        <motion.div
                          className="absolute -top-1 left-1/2 -translate-x-1/2"
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          <div className="w-2 h-2 rounded-full bg-white shadow-glow-primary" />
                        </motion.div>
                      )}
                    </motion.div>
                    
                    {/* Hour label */}
                    <span className={`text-[8px] font-bold transition-all duration-300 ${
                      isHovered ? 'text-primary scale-110' : 'text-muted-foreground/50'
                    }`}>
                      {stat.hour === 0 ? '12a' : stat.hour === 12 ? '12p' : stat.hour > 12 ? `${stat.hour - 12}p` : `${stat.hour}a`}
                    </span>
                    
                    {/* Tooltip on hover */}
                    <AnimatePresence>
                      {isHovered && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute bottom-full mb-2 bg-surface-1 px-2 py-1 rounded-md shadow-lg border border-white/10 z-20 whitespace-nowrap"
                        >
                          <span className="text-[10px] font-bold">{formatHour(stat.hour)}</span>
                          <span className="text-[9px] text-muted-foreground ml-1">
                            {Math.round(stat.score * 100)}% focus
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
            
            {/* Timeline markers */}
            <div className="flex justify-between mt-2 px-1">
              <span className="text-[7px] text-muted-foreground/40">12a</span>
              <span className="text-[7px] text-muted-foreground/40">6a</span>
              <span className="text-[7px] text-muted-foreground/40">12p</span>
              <span className="text-[7px] text-muted-foreground/40">6p</span>
              <span className="text-[7px] text-muted-foreground/40">12a</span>
            </div>
          </div>

          {/* Waveform Preview + Action */}
          <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <div className="flex items-center gap-3">
              <EnergyWaveform 
                data={waveformData.slice(0, 8)} 
                isActive={hoveredHour !== null} 
              />
              <div className="text-[9px] text-muted-foreground">
                {hoveredHour !== null ? (
                  <span className="text-primary font-bold">
                    {formatHour(hoveredHour)} → {Math.round(data.suggested_hours.find(h => h.hour === hoveredHour)?.score! * 100)}% energy
                  </span>
                ) : (
                  <span>Hover over timeline</span>
                )}
              </div>
            </div>
            
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1 text-xs font-bold text-primary group/btn"
            >
              <span>View Insights</span>
              <ChevronRight className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
            </motion.button>
          </div>

          {/* Expanded Details Panel */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="mt-6 pt-6 border-t border-white/5 overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Best Focus Hours</p>
                    <div className="space-y-1">
                      {data.suggested_hours.slice(0, 3).map(stat => (
                        <div key={stat.hour} className="flex items-center justify-between text-xs">
                          <span className="font-medium">{formatHour(stat.hour)}</span>
                          <div className="flex-1 mx-3 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                              initial={{ width: 0 }}
                              animate={{ width: `${stat.score * 100}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                          <span className="text-muted-foreground text-[10px]">{Math.round(stat.score * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Study Tips</p>
                    <ul className="space-y-1.5 text-[10px] text-muted-foreground">
                      <li className="flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5 text-primary" />
                        Study during {peakHourStr} for best retention
                      </li>
                      <li className="flex items-center gap-1">
                        <Moon className="w-2.5 h-2.5 text-primary" />
                        Avoid complex topics after 9 PM
                      </li>
                      <li className="flex items-center gap-1">
                        <Award className="w-2.5 h-2.5 text-primary" />
                        Your circadian alignment is {circadianAlignment}%
                      </li>
                    </ul>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
