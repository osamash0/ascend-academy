import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, ChevronLeft, Target, BookOpen, CheckCircle2,
  Sparkles, ArrowRight, Lightbulb, TrendingUp, Flame,
  Trophy, Award, Zap, Star, Network, GitBranch,
} from 'lucide-react';
import { InsightsMindmapView } from '@/components/InsightsMindmapView';
import { SkillTreeView } from '@/components/SkillTreeView';
import { AchievementCard } from '@/components/AchievementCard';
import { XPProgress } from '@/components/XPProgress';
import { buildKnowledgeMapTree } from '@/features/mindmap/knowledgeMapTree';
import { useSkillTree } from '@/features/skilltree/useSkillTree';
import { useNavigate } from 'react-router-dom';
import { SharedRoutes } from '@/lib/routes';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import { DepthScene } from '@/components/console';
import { toLectureView } from '@/features/student/homeFeed';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { fetchBadgeCatalog } from '@/services/gamificationService';
import { badgeLabel, categoryLabel } from '@/lib/gamification/badgeLabel';
import type { InsightsView } from '@/components/InsightsViewTabs';

// ─── types ───────────────────────────────────────────────────────────────────

type AscentView = 'overview' | 'trophies' | 'mindmap' | 'skills';

interface Achievement {
  id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  earned_at: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── sub-components ──────────────────────────────────────────────────────────

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
      <div className={`pointer-events-none absolute -top-10 -left-10 w-40 h-40 rounded-full blur-3xl bg-gradient-to-br ${insightGlow(color)} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
      <div className="relative z-10 space-y-4">
        <div className="flex items-center gap-2">
          <span className={insightColor(color)}>{icon}</span>
          <span className={`text-[10px] font-black uppercase tracking-[0.25em] ${insightColor(color)}`}>{label}</span>
        </div>
        <h3 className="text-xl font-black text-foreground leading-snug tracking-tight">{headline}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
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
      <span className={`text-4xl md:text-5xl font-black tracking-tighter ${insightColor(color)}`}>{value}</span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      {sub && <span className="mt-0.5 text-[10px] text-muted-foreground/60">{sub}</span>}
    </motion.div>
  );
}

// ─── Category colour tokens for milestone badges ──────────────────────────────
const CATEGORY_TOKENS: Record<string, {
  accent: string;      // left border bar
  iconBg: string;      // icon pill background
  iconRing: string;    // icon pill border
  glow: string;        // hover box-shadow glow class
  label: string;       // label text colour
}> = {
  learning:    { accent: 'bg-amber-400',    iconBg: 'bg-amber-400/15',   iconRing: 'border-amber-400/30',   glow: 'hover:shadow-[0_0_24px_-4px_theme(colors.amber.400/0.25)]',   label: 'text-amber-400' },
  streak:      { accent: 'bg-rose-400',     iconBg: 'bg-rose-400/15',    iconRing: 'border-rose-400/30',    glow: 'hover:shadow-[0_0_24px_-4px_theme(colors.rose.400/0.25)]',     label: 'text-rose-400' },
  social:      { accent: 'bg-violet-400',   iconBg: 'bg-violet-400/15',  iconRing: 'border-violet-400/30',  glow: 'hover:shadow-[0_0_24px_-4px_theme(colors.violet.400/0.25)]',   label: 'text-violet-400' },
  exploration: { accent: 'bg-sky-400',      iconBg: 'bg-sky-400/15',     iconRing: 'border-sky-400/30',     glow: 'hover:shadow-[0_0_24px_-4px_theme(colors.sky.400/0.25)]',      label: 'text-sky-400' },
  mastery:     { accent: 'bg-emerald-400',  iconBg: 'bg-emerald-400/15', iconRing: 'border-emerald-400/30', glow: 'hover:shadow-[0_0_24px_-4px_theme(colors.emerald.400/0.25)]',  label: 'text-emerald-400' },
  milestone:   { accent: 'bg-fuchsia-400',  iconBg: 'bg-fuchsia-400/15', iconRing: 'border-fuchsia-400/30', glow: 'hover:shadow-[0_0_24px_-4px_theme(colors.fuchsia.400/0.25)]',  label: 'text-fuchsia-400' },
  default:     { accent: 'bg-primary',      iconBg: 'bg-primary/15',     iconRing: 'border-primary/30',     glow: 'hover:shadow-glow-primary/20',                                  label: 'text-primary' },
};

function getCategoryTokens(category: string) {
  return CATEGORY_TOKENS[category.toLowerCase()] ?? CATEGORY_TOKENS.default;
}

interface MilestoneBadgeProps {
  name: string;
  description: string;
  icon: string;
  category: string;
  xpReward: number;
  index: number;
}

function MilestoneBadge({ name, description, icon, category, xpReward, index }: MilestoneBadgeProps) {
  const t = getCategoryTokens(category);
  const displayIcon = icon && icon.length <= 4 ? icon : '🏆';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3 }}
      className={`glass-card relative overflow-hidden flex items-center gap-4 p-4 pr-5 cursor-default group transition-all duration-300 ${t.glow} hover:border-white/15`}
    >
      {/* Left category accent bar */}
      <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full ${t.accent} opacity-70`} />

      {/* Icon pill */}
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${t.iconBg} ${t.iconRing} transition-transform duration-300 group-hover:scale-110`}>
        <span className="text-2xl select-none" role="img" aria-label={name}>{displayIcon}</span>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-foreground leading-tight truncate group-hover:text-foreground/100 transition-colors">
          {name}
        </p>
        <p className="text-xs text-muted-foreground/70 leading-snug mt-0.5 line-clamp-1">{description}</p>
      </div>

      {/* XP badge */}
      {xpReward > 0 && (
        <div className="shrink-0 flex items-center gap-0.5 bg-xp/10 border border-xp/20 rounded-lg px-2 py-1">
          <span className="text-[10px] font-black text-xp leading-none">+{xpReward}</span>
          <span className="text-[10px] text-muted-foreground/60 leading-none ml-0.5">XP</span>
        </div>
      )}
    </motion.div>
  );
}

function AscentTabs({ view, onChange }: { view: AscentView; onChange: (v: AscentView) => void }) {
  const TABS: { id: AscentView; label: string; icon: React.ComponentType<any> }[] = [
    { id: 'overview', label: 'Overview', icon: Brain },
    { id: 'trophies', label: 'Trophies', icon: Trophy },
    { id: 'mindmap', label: 'Mind Map', icon: Network },
    { id: 'skills', label: 'Skill Tree', icon: GitBranch },
  ];

  return (
    <div role="tablist" aria-label="Ascent view" className="inline-flex items-center gap-1 p-1 glass-card border-white/10 rounded-2xl">
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-pressed={active}
            data-testid={`ascent-tab-${id}`}
            onClick={() => onChange(id)}
            className={`flex items-center gap-2 px-4 h-10 rounded-xl text-xs font-bold uppercase tracking-widest cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
              active
                ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary/30'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Ascent() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const { data } = useStudentDashboard();
  const [view, setView] = useState<AscentView>('overview');
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [achLoading, setAchLoading] = useState(true);

  // The badge catalog (single source of truth) drives the "Potential Milestones"
  // list, so it stays in sync with the DB without hand-maintained arrays here.
  const { data: catalog = [] } = useQuery({
    queryKey: ['badge-catalog'],
    queryFn: fetchBadgeCatalog,
    staleTime: 1000 * 60 * 10,
  });

  const progress = data?.progress ?? [];
  const lectures = data?.lectures ?? [];

  // Fetch achievements (only once user is known)
  useEffect(() => {
    if (!user) return;
    supabase
      .from('achievements')
      .select('id, badge_name, badge_description, badge_icon, earned_at')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false })
      .limit(50)
      .then(({ data: rows }) => {
        if (rows) setAchievements(rows);
        setAchLoading(false);
      });
  }, [user?.id]);

  // ── Derived numbers ──────────────────────────────────────────────────────
  const byId = useMemo(() => new Map(progress.map(p => [p.lecture_id, p])), [progress]);

  const totalQuestionsAnswered = progress.reduce((s, p) => s + (p.total_questions_answered || 0), 0);
  const totalCorrect           = progress.reduce((s, p) => s + (p.correct_answers || 0), 0);
  const accuracy               = totalQuestionsAnswered > 0
    ? Math.round((totalCorrect / totalQuestionsAnswered) * 100)
    : 0;

  const lecturesDone = useMemo(
    () => lectures.filter(l => toLectureView(l, byId.get(l.id)).status === 'done').length,
    [lectures, byId],
  );

  const coursesStarted = useMemo(
    () => new Set(progress.map(p => p.lecture_id).filter(Boolean)).size,
    [progress],
  );

  // ── Narrative insight builder ────────────────────────────────────────────
  const insights = useMemo(() => {
    const items: InsightCardProps[] = [];
    const streak    = profile?.current_streak ?? 0;
    const bestStreak = profile?.best_streak ?? 0;

    if (totalQuestionsAnswered > 0) {
      if (accuracy >= 80) {
        items.push({
          icon: <Target className="w-4 h-4" />,
          label: 'Quiz Mastery',
          headline: `You're answering ${accuracy}% of questions correctly.`,
          body: 'Excellent retention! Your knowledge is solidifying well. Consider tackling harder concepts next to keep growing.',
          color: 'success',
          index: 0,
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
          index: 0,
          actionLabel: 'Review a lecture',
          onAction: () => navigate('/dashboard'),
        });
      } else {
        items.push({
          icon: <Target className="w-4 h-4" />,
          label: 'Quiz Performance',
          headline: `${accuracy}% accuracy — let's build that foundation.`,
          body: 'Active recall is the fastest way to learn. Try re-reading slides and then immediately testing yourself again.',
          color: 'warning',
          index: 0,
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
        index: 0,
        actionLabel: 'Open a lecture',
        onAction: () => navigate('/dashboard'),
      });
    }

    if (lecturesDone > 0) {
      const pct = lectures.length > 0 ? Math.round((lecturesDone / lectures.length) * 100) : 0;
      items.push({
        icon: <CheckCircle2 className="w-4 h-4" />,
        label: 'Completion',
        headline: `${lecturesDone} lecture${lecturesDone !== 1 ? 's' : ''} completed — ${pct}% of your content.`,
        body: pct >= 80
          ? 'You are almost at the finish line. A final review pass before the exam could make all the difference.'
          : pct >= 40
          ? 'Great momentum! Keep finishing lectures in sequence to maximize retention across topics.'
          : 'Every lecture you finish compounds your understanding. Aim for one lecture per day to build a strong habit.',
        color: pct >= 80 ? 'success' : 'primary',
        index: 1,
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
        index: 1,
        actionLabel: 'Browse lectures',
        onAction: () => navigate('/dashboard'),
      });
    }

    if (streak > 0) {
      items.push({
        icon: <Flame className="w-4 h-4" />,
        label: 'Study Streak',
        headline: streak >= 7
          ? `${streak}-day streak 🔥 — you are in a powerful rhythm.`
          : `${streak}-day streak — you are building a great habit.`,
        body: streak >= 7
          ? 'Consistency is your superpower. Students who study daily retain up to 40% more than those who cram. Keep it going.'
          : `Your personal best is ${bestStreak} days. Each day you show up moves you closer to mastery.`,
        color: 'xp',
        index: 2,
      });
    } else {
      items.push({
        icon: <TrendingUp className="w-4 h-4" />,
        label: 'Momentum',
        headline: 'Study today and start a streak.',
        body: 'Daily consistency — even just 15 minutes — dramatically improves long-term retention. One session is all it takes to begin.',
        color: 'primary',
        index: 2,
        actionLabel: 'Study now',
        onAction: () => navigate('/dashboard'),
      });
    }

    items.push({
      icon: <Lightbulb className="w-4 h-4" />,
      label: 'Smart Tip',
      headline: 'Space your reviews for maximum retention.',
      body: 'Instead of reviewing everything at once, come back to completed lectures after 1 day, then 1 week, then 1 month. This spaced repetition technique is proven by neuroscience to lock knowledge in long-term memory.',
      color: 'primary',
      index: 3,
    });

    return items;
  }, [accuracy, totalQuestionsAnswered, totalCorrect, lecturesDone, lectures, profile, navigate]);

  // ── Full-bleed view data ──────────────────────────────────────────────────
  const knowledgeTree = useMemo(() => buildKnowledgeMapTree(lectures), [lectures]);
  const skillTree = useSkillTree();

  const handleInsightsViewChange = (v: InsightsView) => {
    if (v === 'learning') setView('overview');
    else setView(v as AscentView);
  };

  if (view === 'mindmap') {
    return (
      <InsightsMindmapView
        tree={knowledgeTree}
        hasContent={lectures.length > 0}
        view="mindmap"
        onViewChange={handleInsightsViewChange}
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
        view="skills"
        onViewChange={handleInsightsViewChange}
        onOpenLecture={(id) => navigate(SharedRoutes.LECTURE(id))}
        onBack={() => navigate('/dashboard')}
      />
    );
  }

  const earnedBadgeNames = achievements.map(a => a.badge_name);
  const earnedSet = new Set(earnedBadgeNames);
  // Locked, non-secret badges grouped by category for the "Potential Milestones" view.
  const lockedByCategory = Object.entries(
    catalog
      .filter(b => !earnedSet.has(b.key) && !b.is_secret)
      .reduce<Record<string, typeof catalog>>((acc, b) => {
        (acc[b.category] ??= []).push(b);
        return acc;
      }, {}),
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DepthScene status="progress" gradientIndex={2}>
      <div className="min-h-screen">
        {/* ── Top bar ── */}
        <div className="sticky top-0 z-20 px-6 lg:px-12 pt-4 pb-3 flex items-center justify-between gap-4">
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary transition-colors group shrink-0"
          >
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Dashboard
          </motion.button>
          <AscentTabs view={view} onChange={setView} />
        </div>

        <div className="px-6 lg:px-12 pb-16 max-w-5xl mx-auto space-y-14 mt-4">

          {/* ── Page headline ── */}
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                {view === 'trophies'
                  ? <Trophy className="w-5 h-5 text-primary" />
                  : <Brain className="w-5 h-5 text-primary" />}
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
                {view === 'trophies' ? 'Hall of Valor' : 'Intelligence Center'}
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-foreground">
              My <span className="text-gradient">Ascent</span>
            </h1>
            <p className="text-muted-foreground text-base max-w-lg leading-relaxed">
              {view === 'trophies'
                ? 'Every badge represents a mission completed and a milestone earned in your learning journey.'
                : 'Clear, actionable takeaways from your learning journey — no noise, just what matters.'}
            </p>
          </motion.div>

          {/* ════════════════════ OVERVIEW TAB ════════════════════ */}
          {view === 'overview' && (
            <AnimatePresence mode="wait">
              <motion.div
                key="overview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-14"
              >
                {/* XP Progress hero */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                  <XPProgress
                    currentXP={profile?.total_xp || 0}
                    currentLevel={profile?.current_level || 1}
                    streak={profile?.current_streak || 0}
                  />
                </motion.div>

                {/* 3 floating metrics */}
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

                {/* Divider */}
                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-white/5" />
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.25em]">Your Insights</span>
                  </div>
                  <div className="flex-1 h-px bg-white/5" />
                </div>

                {/* Insight cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {insights.map((ins) => (
                    <InsightCard key={ins.label} {...ins} />
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          )}

          {/* ════════════════════ TROPHIES TAB ════════════════════ */}
          {view === 'trophies' && (
            <AnimatePresence mode="wait">
              <motion.div
                key="trophies"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-12"
              >
                {/* Quick stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { icon: <Award className="w-5 h-5 text-primary" />, bg: 'bg-primary/10', hover: 'hover:border-primary/30', value: achievements.length, label: 'Earned' },
                    { icon: <Star className="w-5 h-5 text-xp" />, bg: 'bg-xp/10', hover: 'hover:border-xp/30', value: profile?.current_level || 1, label: 'Level' },
                    { icon: <Flame className="w-5 h-5 text-warning" />, bg: 'bg-warning/10', hover: 'hover:border-warning/30', value: profile?.best_streak || 0, label: 'Best Streak' },
                    { icon: <Zap className="w-5 h-5 text-success" />, bg: 'bg-success/10', hover: 'hover:border-success/30', value: (profile?.total_xp || 0).toLocaleString(), label: 'Total XP' },
                  ].map(({ icon, bg, hover, value, label }, i) => (
                    <motion.div
                      key={label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.06 }}
                      className={`glass-panel border-white/5 p-6 flex flex-col items-center justify-center text-center group ${hover} transition-all`}
                    >
                      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                        {icon}
                      </div>
                      <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">{label}</p>
                    </motion.div>
                  ))}
                </div>

                {/* Earned badges */}
                <div className="space-y-8">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Trophy className="w-4 h-4 text-primary" />
                      </div>
                      Neural Badges Earned
                    </h2>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full">
                      {achievements.length} Badges
                    </span>
                  </div>

                  {achLoading ? (
                    <div className="flex justify-center py-16">
                      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
                    </div>
                  ) : achievements.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center glass-card border-white/5 rounded-3xl">
                      <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
                        <span className="text-4xl">🌱</span>
                      </div>
                      <h3 className="text-xl font-bold text-foreground mb-3">No neural signatures detected yet</h3>
                      <p className="text-muted-foreground max-w-md mx-auto text-sm leading-relaxed">
                        Your orbital journey has just begun. Complete your first cognitive mission to synchronize your first badge with the Hall of Valor.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {achievements.map((achievement, index) => {
                        const label = badgeLabel(t, {
                          key: achievement.badge_name,
                          name: achievement.badge_name,
                          description: achievement.badge_description || '',
                        });
                        return (
                          <motion.div
                            key={achievement.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.05 }}
                          >
                            <AchievementCard
                              name={label.name}
                              description={label.description}
                              icon={achievement.badge_icon || '🏆'}
                              earnedAt={achievement.earned_at}
                            />
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Potential milestones — grouped by category, circular badge style */}
                <div className="space-y-10">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-muted-foreground" />
                      </div>
                      Potential Milestones
                    </h2>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full">
                      {lockedByCategory.reduce((acc, [, b]) => acc + b.length, 0)} unlockable
                    </span>
                  </div>
                  {lockedByCategory.map(([category, badges]) => (
                    <div key={category} className="space-y-5">
                      <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground flex items-center gap-2">
                        <span className="inline-block w-4 h-px bg-white/10" />
                        {categoryLabel(t, category)}
                        <span className="inline-block flex-1 h-px bg-white/5" />
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {badges.map((badge, index) => {
                          const label = badgeLabel(t, badge);
                          return (
                            <MilestoneBadge
                              key={badge.key}
                              name={label.name}
                              description={label.description}
                              icon={badge.icon}
                              category={category}
                              xpReward={badge.xp_reward}
                              index={index}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </DepthScene>
  );
}
