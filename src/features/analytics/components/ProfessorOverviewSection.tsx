import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, TrendingUp, Target, Clock, AlertTriangle, Activity } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useProfessorOverview } from '@/features/analytics/hooks/useAnalytics';
import { StatsCard } from '@/components/StatsCard';
import type { Course } from '@/services/coursesService';

interface Props {
  courses: Course[];
}

export function ProfessorOverviewSection({ courses }: Props) {
  const [courseId, setCourseId] = useState<string | null>(null);

  const activeCourseId = useMemo(() => {
    if (courseId) return courseId;
    return courses.length > 0 ? courses[0].id : null;
  }, [courseId, courses]);

  const { data, isLoading, isError } = useProfessorOverview(activeCourseId, 7);

  if (courses.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-foreground tracking-tight">Course Overview</h2>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mt-1 opacity-60">
              Last 7 days · whole-course aggregate
            </p>
          </div>
        </div>
        <select
          value={activeCourseId ?? ''}
          onChange={(e) => setCourseId(e.target.value || null)}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium"
          aria-label="Course selector for overview"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          Couldn't load the course overview. Try again in a moment.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatsCard
              title="Active Students (7d)"
              value={data.active_students}
              icon={Users}
              variant="primary"
            />
            <StatsCard
              title="Avg Completion"
              value={`${data.average_completion}%`}
              icon={TrendingUp}
              variant="default"
            />
            <StatsCard
              title="Avg Quiz Accuracy"
              value={`${data.average_quiz_accuracy}%`}
              icon={Target}
              variant="success"
            />
            <StatsCard
              title="Median Time (min)"
              value={data.median_time_minutes}
              icon={Clock}
              variant="xp"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="lg:col-span-2 glass-card rounded-2xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
                  7-Day Activity
                </h3>
                <span className="text-xs text-muted-foreground">
                  {data.lecture_count} lecture{data.lecture_count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.activity_sparkline} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="overviewGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short' })}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--surface-1))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.75rem',
                      }}
                      labelFormatter={(d) => new Date(d).toLocaleDateString()}
                      formatter={(v: number) => [`${v} events`, 'Activity']}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#overviewGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-card rounded-2xl p-6"
              data-testid="weakest-list"
            >
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
                  Weakest {data.weakest_concepts.length > 0 ? 'Concepts' : 'Slides'}
                </h3>
              </div>
              {data.weakest_concepts.length > 0 ? (
                <ul className="space-y-2">
                  {data.weakest_concepts.map((c) => (
                    <li key={c.concept} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium truncate">{c.concept}</span>
                      <span className="font-black text-destructive shrink-0">{c.miss_rate}%</span>
                    </li>
                  ))}
                </ul>
              ) : data.weakest_slides.length > 0 ? (
                <ul className="space-y-2">
                  {data.weakest_slides.map((s) => (
                    <li key={s.slide_id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium truncate">{s.title}</span>
                      <span className="font-black text-destructive shrink-0">{s.miss_rate}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not enough quiz attempts to flag weak spots yet.
                </p>
              )}
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}
