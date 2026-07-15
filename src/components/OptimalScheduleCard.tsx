import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, CheckCircle2, Circle, Clock, Sparkles,
  AlertCircle, BookOpen, Target, ChevronRight, Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/lib/apiClient';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PlanItem {
  item_id: string;
  lecture_id: string;
  lecture_title: string;
  est_minutes: number;
  reason: string;
  priority: 'assignment' | 'weak_concept' | 'continue';
  slide_start: number | null;
  slide_end: number | null;
}

interface PlanDay {
  date: string;          // YYYY-MM-DD
  items: PlanItem[];
  total_minutes: number;
  budget_minutes: number;
}

interface StudyPlan {
  days: PlanDay[];
  budget_minutes: number;
  has_assignments: boolean;
  has_weak_concepts: boolean;
}

interface PlanResponse {
  success: boolean;
  data: StudyPlan;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const dayLabel = (iso: string, todayISO: string): string => {
  if (iso === todayISO) return 'Today';
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(todayISO + 'T00:00:00');
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PRIORITY_META: Record<PlanItem['priority'], { icon: React.ReactNode; label: string; color: string }> = {
  assignment:    { icon: <AlertCircle className="w-3 h-3" />, label: 'Assignment', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  weak_concept:  { icon: <Target      className="w-3 h-3" />, label: 'Review',     color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  continue:      { icon: <BookOpen    className="w-3 h-3" />, label: 'Continue',   color: 'text-primary bg-primary/10 border-primary/20' },
};

// ─── Item row ───────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: PlanItem;
  isToday: boolean;
  onMarkDone: (id: string) => Promise<void>;
}

const ItemRow = React.forwardRef<HTMLDivElement, ItemRowProps>(({ item, isToday, onMarkDone }, ref) => {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const meta = PRIORITY_META[item.priority];

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending || done) return;
    setPending(true);
    try {
      await onMarkDone(item.item_id);
      setDone(true);
    } catch (err) {
      console.error('Failed to mark done:', err);
      setPending(false);
    }
  };

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: done ? 0.4 : 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-3 p-3 rounded-xl bg-surface-2/50 hover:bg-surface-2 transition-colors group/item"
    >
      {isToday ? (
        <button
          onClick={handleClick}
          disabled={pending || done}
          aria-label={done ? 'Marked done' : 'Mark done'}
          className="mt-0.5 flex-shrink-0 transition-transform hover:scale-110 disabled:cursor-default"
        >
          {pending ? (
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          ) : done ? (
            <CheckCircle2 className="w-5 h-5 text-success" />
          ) : (
            <Circle className="w-5 h-5 text-muted-foreground hover:text-primary transition-colors" />
          )}
        </button>
      ) : (
        <Circle className="w-5 h-5 text-muted-foreground/30 mt-0.5 flex-shrink-0" />
      )}

      <Link
        to={
          item.slide_start
            ? `/lecture/${item.lecture_id}?slide=${item.slide_start}`
            : `/lecture/${item.lecture_id}`
        }
        className="flex-1 min-w-0"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border ${meta.color}`}>
            {meta.icon}
            {meta.label}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-2.5 h-2.5" />
            {item.est_minutes}m
          </span>
        </div>
        <p className={`text-sm font-medium text-foreground truncate ${done ? 'line-through' : ''}`}>
          {item.lecture_title}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          {item.reason}
          {item.slide_start && item.slide_end ? ` · slides ${item.slide_start}–${item.slide_end}` : ''}
        </p>
      </Link>

      <ChevronRight className="w-4 h-4 text-muted-foreground/30 mt-1 flex-shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity" />
    </motion.div>
  );
});
ItemRow.displayName = 'ItemRow';

// ─── Day section ────────────────────────────────────────────────────────────

function DaySection({
  day,
  isToday,
  onMarkDone,
}: { day: PlanDay; isToday: boolean; onMarkDone: (id: string) => Promise<void> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className={`text-xs font-bold uppercase tracking-widest ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
          {dayLabel(day.date, todayISO())}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {day.total_minutes}/{day.budget_minutes} min
        </span>
      </div>
      {day.items.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
          {isToday ? 'All clear today — nice work.' : 'Nothing scheduled.'}
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          {day.items.map((it) => (
            <ItemRow key={it.item_id} item={it} isToday={isToday} onMarkDone={onMarkDone} />
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function OptimalScheduleCard() {
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadPlan = useCallback(async () => {
    try {
      const res = await apiClient.get<PlanResponse>('/api/schedule/me?days=7');
      if (res?.success) setPlan(res.data);
      else setError('Could not load study plan.');
    } catch (e) {
      console.error('Failed to load study plan:', e);
      setError('Could not load study plan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  const markDone = useCallback(async (itemId: string) => {
    await apiClient.post(`/api/schedule/items/${encodeURIComponent(itemId)}/done`, {});
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d, idx) =>
          idx === 0 ? { ...d, items: d.items.filter((it) => it.item_id !== itemId) } : d,
        ),
      };
    });
  }, []);

  if (loading) {
    return (
      <div className="glass-card p-6 animate-pulse space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-surface-2" />
          <div className="space-y-2">
            <div className="h-4 w-40 bg-surface-2 rounded" />
            <div className="h-3 w-24 bg-surface-2 rounded" />
          </div>
        </div>
        <div className="h-16 w-full bg-surface-2 rounded-xl" />
        <div className="h-16 w-full bg-surface-2 rounded-xl" />
      </div>
    );
  }

  const todayDay = plan?.days[0];
  const upcomingDays = plan?.days.slice(1) || [];
  const totalThisWeek = plan?.days.reduce((sum, d) => sum + d.items.length, 0) || 0;

  if (!plan || totalThisWeek === 0) {
    return (
      <div className="glass-card p-6 border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-50" />
        <div className="relative z-10 flex flex-col items-center text-center py-4">
          <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
            <Calendar className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-bold text-foreground mb-1">Your Study Plan</h3>
          <p className="text-xs text-muted-foreground max-w-[240px]">
            {error
              ? 'Could not load plan right now. Try again in a moment.'
              : 'Open a lecture to start studying — your personalized 7-day plan will appear here.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-6 border-white/5 relative overflow-hidden hover:border-primary/30 transition-colors"
    >
      <motion.div
        className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary/10 blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 8, repeat: Infinity }}
      />

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <motion.div
              className="relative"
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400 }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary rounded-2xl blur-md opacity-60" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
                <Calendar className="w-6 h-6 text-white" />
              </div>
            </motion.div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Your Study Plan</h3>
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
                Next 7 Days · {plan.budget_minutes} min/day
              </span>
            </div>
          </div>

          {(plan.has_assignments || plan.has_weak_concepts) && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20">
              <Sparkles className="w-3 h-3 text-primary" />
              <span className="text-[9px] font-bold text-primary uppercase tracking-wider">
                Personalized
              </span>
            </div>
          )}
        </div>

        {/* Today */}
        {todayDay && (
          <div className="mb-4">
            <DaySection day={todayDay} isToday={true} onMarkDone={markDone} />
          </div>
        )}

        {/* Upcoming */}
        {upcomingDays.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full text-left text-xs font-bold text-primary hover:text-primary/80 transition-colors flex items-center justify-between pt-3 border-t border-white/5"
            >
              <span>{expanded ? 'Hide' : 'Show'} upcoming days</span>
              <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-4 pt-3">
                    {upcomingDays.map((d) => (
                      <DaySection
                        key={d.date}
                        day={d}
                        isToday={false}
                        onMarkDone={markDone}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  );
}
