import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, ChevronLeft, Target, BookOpen, CheckCircle2,
  Sparkles, ArrowRight, Lightbulb, TrendingUp, Flame,
} from 'lucide-react';
import { InsightsViewTabs, type InsightsView } from '@/components/InsightsViewTabs';
import { InsightsMindmapView } from '@/components/InsightsMindmapView';
import { SkillTreeView } from '@/components/SkillTreeView';
import { buildKnowledgeMapTree } from '@/features/mindmap/knowledgeMapTree';
import { useSkillTree } from '@/features/skilltree/useSkillTree';
import { useNavigate } from 'react-router-dom';
import { SharedRoutes } from '@/lib/routes';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import {
  DepthScene,
} from '@/components/console';
import { toLectureView } from '@/features/student/homeFeed';

// ─── helpers ────────────────────────────────────────────────────────────────

function insightColor(color: string) {
  const map: Record<string, string> = {
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    xp:      'text-xp',
  };
  return map[color] ?? 'text-primary';
}

function insightBorder(color: string) {
  const map: Record<string, string> = {
    primary: 'border-primary/20 hover:border-primary/50',
    success: 'border-success/20 hover:border-success/50',
    warning: 'border-warning/20 hover:border-warning/50',
    xp:      'border-xp/20 hover:border-xp/50',
  };
  return map[color] ?? 'border-primary/20 hover:border-primary/50';
}

function insightGlow(color: string) {
  const map: Record<string, string> = {
    primary: 'from-primary/10',
    success: 'from-success/10',
    warning: 'from-warning/10',
    xp:      'from-xp/10',
  };
  return map[color] ?? 'from-primary/10';
}

// ─── sub-components ─────────────────────────────────────────────────────────

interface InsightCardProps {
  icon: React.ReactNode;
  label: string;
  headline: string;
  body: string;
  color: string;
  index: number;
  actionLabel?: string;
  onAction?: () => void;
}

function InsightCard({ icon, label, headline, body, color, index, actionLabel, onAction }: InsightCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 * index, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className={`group relative overflow-hidden rounded-3xl border bg-black/30 backdrop-blur-xl p-7 cursor-default transition-colors duration-300 ${insightBorder(color)}`}
    >
      {/* ambient glow blob */}
      <div className={`pointer-events-none absolute -top-10 -left-10 w-40 h-40 rounded-full blur-3xl bg-gradient-to-br ${insightGlow(color)} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />

      <div className="relative z-10 space-y-4">
        {/* label row */}
        <div className="flex items-center gap-2">
          <span className={`${insightColor(color)}`}>{icon}</span>
          <span className={`text-[10px] font-black uppercase tracking-[0.25em] ${insightColor(color)}`}>{label}</span>
        </div>

        {/* headline — the main takeaway */}
        <h3 className="text-xl font-black text-foreground leading-snug tracking-tight">
          {headline}
        </h3>

        {/* supporting explanation */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {body}
        </p>

        {/* optional action */}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest ${insightColor(color)} hover:opacity-80 transition-opacity`}
          >
            {actionLabel}
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

interface FloatingMetricProps {
  value: string | number;
  label: string;
  sub?: string;
  color: string;
  index: number;
}

function FloatingMetric({ value, label, sub, color, index }: FloatingMetricProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center text-center"
    >
      <span className={`text-4xl md:text-5xl font-black tracking-tighter ${insightColor(color)}`}>
        {value}
      </span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      {sub && <span className="mt-0.5 text-[10px] text-muted-foreground/60">{sub}</span>}
    </motion.div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Insights() {
  const navigate = useNavigate();
  const { data } = useStudentDashboard();

  const progress = data?.progress ?? [];
  const lectures = data?.lectures ?? [];
  const profile  = data?.profile;

  // Build a progress index to determine lecture status
  const byId = useMemo(() => {
    const map = new Map(progress.map(p => [p.lecture_id, p]));
    return map;
  }, [progress]);

  // ── Derived numbers ──────────────────────────────────────────────────────
  const totalQuestionsAnswered = progress.reduce((s, p) => s + (p.total_questions_answered || 0), 0);
  const totalCorrect           = progress.reduce((s, p) => s + (p.correct_answers || 0), 0);
  const accuracy               = totalQuestionsAnswered > 0
    ? Math.round((totalCorrect / totalQuestionsAnswered) * 100)
    : 0;

  const lecturesDone = useMemo(
    () => lectures.filter(l => toLectureView(l, byId.get(l.id)).status === 'done').length,
    [lectures, byId],
  );

  // Unique courses that have at least one lecture started
  const coursesStarted = useMemo(
    () => new Set(progress.map(p => p.lecture_id).filter(Boolean)).size,
    [progress],
  );

  // ── Narrative insight builder ────────────────────────────────────────────
  // These are data-driven where possible, falling back to smart defaults.
  const insights = useMemo(() => {
    const items = [];

    // 1 — Quiz performance insight
    if (totalQuestionsAnswered > 0) {
      if (accuracy >= 80) {
        items.push({
          icon: <Target className="w-4 h-4" />,
          label: 'Quiz Mastery',
          headline: `You're answering ${accuracy}% of questions correctly.`,
          body: 'Excellent retention! Your knowledge is solidifying well. Consider tackling harder concepts next to keep growing.',
          color: 'success',
          actionLabel: 'Keep going',
          onAction: () => navigate('/dashboard'),
        });
      } else if (accuracy >= 50) {
        items.push({
          icon: <Target className="w-4 h-4" />,
          label: 'Quiz Performance',
          headline: `${accuracy}% accuracy — room to sharpen your recall.`,
          body: `You got ${totalCorrect} out of ${totalQuestionsAnswered} questions right. Revisiting recent lectures and doing a quick-check quiz can close the gap fast.`,
          color: 'warning',
          actionLabel: 'Review a lecture',
          onAction: () => navigate('/dashboard'),
        });
      } else {
        items.push({
          icon: <Target className="w-4 h-4" />,
          label: 'Quiz Performance',
          headline: `${accuracy}% accuracy — let's build that foundation.`,
          body: `Active recall is the fastest way to learn. Try re-reading slides and then immediately testing yourself again.`,
          color: 'warning',
          actionLabel: 'Start reviewing',
          onAction: () => navigate('/dashboard'),
        });
      }
    } else {
      items.push({
        icon: <Target className="w-4 h-4" />,
        label: 'Quiz Performance',
        headline: 'Answer your first quiz to unlock insights.',
        body: 'Open any lecture and complete the embedded quiz questions. Your accuracy and retention data will appear here.',
        color: 'primary',
        actionLabel: 'Open a lecture',
        onAction: () => navigate('/dashboard'),
      });
    }

    // 2 — Progress / completion insight
    if (lecturesDone > 0) {
      const pct = lectures.length > 0 ? Math.round((lecturesDone / lectures.length) * 100) : 0;
      items.push({
        icon: <CheckCircle2 className="w-4 h-4" />,
        label: 'Completion',
        headline: `${lecturesDone} lecture${lecturesDone !== 1 ? 's' : ''} completed — ${pct}% of your content.`,
        body: pct >= 80
          ? 'You are almost at the finish line. A final review pass before the exam could make all the difference.'
          : pct >= 40
          ? `Great momentum! Keep finishing lectures in sequence to maximize retention across topics.`
          : 'Every lecture you finish compounds your understanding. Aim for one lecture per day to build a strong habit.',
        color: pct >= 80 ? 'success' : 'primary',
        actionLabel: 'Continue learning',
        onAction: () => navigate('/dashboard'),
      });
    } else {
      items.push({
        icon: <BookOpen className="w-4 h-4" />,
        label: 'Progress',
        headline: 'Start your first lecture to begin your journey.',
        body: 'Your progress across all courses will be tracked here, showing you exactly how far you have come.',
        color: 'primary',
        actionLabel: 'Browse lectures',
        onAction: () => navigate('/dashboard'),
      });
    }

    // 3 — Streak / consistency insight
    const streak = profile?.current_streak ?? 0;
    const bestStreak = profile?.best_streak ?? 0;
    if (streak > 0) {
      items.push({
        icon: <Flame className="w-4 h-4" />,
        label: 'Study Streak',
        headline: streak >= 7
          ? `${streak}-day streak 🔥 — you are in a powerful rhythm.`
          : `${streak}-day streak — you are building a great habit.`,
        body: streak >= 7
          ? `Consistency is your superpower. Students who study daily retain up to 40% more than those who cram. Keep it going.`
          : `Your personal best is ${bestStreak} days. Each day you show up moves you closer to mastery.`,
        color: 'xp',
      });
    } else {
      items.push({
        icon: <TrendingUp className="w-4 h-4" />,
        label: 'Momentum',
        headline: 'Study today and start a streak.',
        body: 'Daily consistency — even just 15 minutes — dramatically improves long-term retention. One session is all it takes to begin.',
        color: 'primary',
        actionLabel: 'Study now',
        onAction: () => navigate('/dashboard'),
      });
    }

    // 4 — Encouragement / smart tip
    items.push({
      icon: <Lightbulb className="w-4 h-4" />,
      label: 'Smart Tip',
      headline: 'Space your reviews for maximum retention.',
      body: 'Instead of reviewing everything at once, come back to completed lectures after 1 day, then 1 week, then 1 month. This spaced repetition technique is proven by neuroscience to lock knowledge in long-term memory.',
      color: 'primary',
    });

    return items;
  }, [accuracy, totalQuestionsAnswered, totalCorrect, lecturesDone, lectures, profile, navigate]);

  // ── Tabs (mindmap / skills are full-bleed) ──────────────────────────────
  const knowledgeTree = useMemo(() => buildKnowledgeMapTree(lectures), [lectures]);
  const [view, setView] = useState<InsightsView>('learning');
  const skillTree = useSkillTree();

  if (view === 'mindmap') {
    return (
      <InsightsMindmapView
        tree={knowledgeTree}
        hasContent={lectures.length > 0}
        view={view}
        onViewChange={setView}
        onOpenLecture={(id) => navigate(SharedRoutes.LECTURE(id))}
        onBack={() => navigate('/dashboard')}
      />
    );
  }

  if (view === 'skills') {
    return (
      <SkillTreeView
        tree={skillTree.tree}
        counts={skillTree.counts}
        conceptsAvailable={skillTree.conceptsAvailable}
        hasContent={skillTree.hasContent}
        view={view}
        onViewChange={setView}
        onOpenLecture={(id) => navigate(SharedRoutes.LECTURE(id))}
        onBack={() => navigate('/dashboard')}
      />
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <DepthScene status="progress" gradientIndex={2}>
      <div className="min-h-screen">
        {/* ── Top bar ── */}
        <div className="sticky top-0 z-20 px-6 lg:px-12 pt-4 pb-3 flex items-center justify-between">
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-colors group"
          >
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Dashboard
          </motion.button>

          <InsightsViewTabs view={view} onChange={setView} />
        </div>

        <div className="px-6 lg:px-12 pb-16 max-w-5xl mx-auto space-y-14 mt-4">

          {/* ── Page headline ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Brain className="w-5 h-5 text-primary" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
                Intelligence Center
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-foreground">
              Learning <span className="text-gradient">Insights</span>
            </h1>
            <p className="text-muted-foreground text-base max-w-lg leading-relaxed">
              Clear, actionable takeaways from your learning journey — no noise, just what matters.
            </p>
          </motion.div>

          {/* ── 3 floating metrics ── */}
          <div className="flex flex-wrap gap-10 md:gap-16 items-start">
            <FloatingMetric
              index={0}
              value={`${accuracy}%`}
              label="Quiz Accuracy"
              sub={totalQuestionsAnswered > 0 ? `${totalCorrect}/${totalQuestionsAnswered} correct` : 'No quizzes yet'}
              color={accuracy >= 80 ? 'success' : accuracy >= 50 ? 'warning' : 'primary'}
            />
            <div className="w-px h-14 self-center bg-white/10 hidden md:block" />
            <FloatingMetric
              index={1}
              value={lecturesDone}
              label="Lectures Done"
              sub={lectures.length > 0 ? `out of ${lectures.length} total` : undefined}
              color="primary"
            />
            <div className="w-px h-14 self-center bg-white/10 hidden md:block" />
            <FloatingMetric
              index={2}
              value={coursesStarted}
              label="Courses Started"
              color="xp"
            />
          </div>

          {/* ── Divider ── */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-white/5" />
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-[0.25em]">Your Insights</span>
            </div>
            <div className="flex-1 h-px bg-white/5" />
          </div>

          {/* ── Insight cards — narrative, no sub-boxes ── */}
          <AnimatePresence>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {insights.map((ins, i) => (
                <InsightCard
                  key={ins.label}
                  index={i}
                  icon={ins.icon}
                  label={ins.label}
                  headline={ins.headline}
                  body={ins.body}
                  color={ins.color}
                  actionLabel={ins.actionLabel}
                  onAction={ins.onAction}
                />
              ))}
            </div>
          </AnimatePresence>

        </div>
      </div>
    </DepthScene>
  );
}
