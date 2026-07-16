import { motion } from 'framer-motion';
import { Flame, Trophy, Layers, Play, ChevronRight, Sparkles, UploadCloud, NotebookText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConsoleTile } from '@/components/console';
import type {
  Widget,
  StreakWidget,
  TrophiesWidget,
  UpNextWidget,
  CourseProgressWidget,
  ReviewWidget,
  MyMaterialsWidget,
  StudyGuideWidget,
} from '@/features/student/homeFeed';

/** XP needed per level (matches the dashboard "/ 100 XP" copy). */
const XP_PER_LEVEL = 100;

interface BentoGridProps {
  widgets: Widget[];
  onOpenLecture: (id: string) => void;
  onViewTrophies: () => void;
  onOpenReview: () => void;
  onOpenMyMaterials: () => void;
  onOpenStudyGuide: (courseId: string) => void;
}

/** Floating glass cell — the depth "panel" every widget sits in. */
function Cell({
  className,
  children,
  onClick,
  label,
  dataTour,
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  label?: string;
  dataTour?: string;
}) {
  const interactive = !!onClick;

  const itemVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.98 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 400, damping: 30 } }
  };

  const handleHover = () => {
    if (interactive && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('play-sound', { detail: 'hover' }));
    }
  };

  const handleClick = () => {
    if (interactive && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('play-sound', { detail: 'click' }));
      onClick?.();
    }
  };
  return (
    <motion.div
      variants={itemVariants}
      whileHover={interactive ? { scale: 1.02, y: -2 } : undefined}
      whileTap={interactive ? { scale: 0.98 } : undefined}
      onMouseEnter={handleHover}
      className={cn(
        'depth-card p-5 lg:p-6 transition-colors',
        interactive && 'cursor-pointer hover:border-primary/30 hover:shadow-glow-primary',
        className
      )}
      onClick={handleClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      data-tour={dataTour}
      onKeyDown={interactive ? (e) => (e.key === 'Enter' || e.key === ' ') && handleClick() : undefined}
    >
      {children}
    </motion.div>
  );
}

function ProgressRing({ pct, label }: { pct: number; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="url(#bentoRing)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.min(100, Math.max(0, pct))) / 100}
        />
        <defs>
          <linearGradient id="bentoRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--secondary))" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black">{label}</span>
    </div>
  );
}

function StreakCell({ w }: { w: StreakWidget }) {
  const xpInLevel = w.xp % XP_PER_LEVEL;
  return (
    <Cell className="flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">Streak</span>
        <Flame className={cn('h-4 w-4', w.current > 0 ? 'text-orange-400' : 'text-white/30')} />
      </div>
      <div className="flex items-end gap-2">
        <span className="text-5xl font-black leading-none">{w.current}</span>
        <span className="pb-1 text-xs font-bold uppercase tracking-wider text-white/50">days</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-white/50">
          <span>Level {w.level}</span>
          <span>{xpInLevel}/{XP_PER_LEVEL} XP</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
            style={{ width: `${(xpInLevel / XP_PER_LEVEL) * 100}%` }}
          />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Best {w.best} days</span>
      </div>
    </Cell>
  );
}

function TrophiesCell({ w, onView }: { w: TrophiesWidget; onView: () => void }) {
  return (
    <Cell className="flex flex-col justify-between" onClick={onView} label="View all trophies">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">Trophies</span>
        <Trophy className="h-4 w-4 text-amber-400" />
      </div>
      <div className="flex items-end gap-2">
        <span className="text-5xl font-black leading-none">{w.total}</span>
        <span className="pb-1 text-xs font-bold uppercase tracking-wider text-white/50">earned</span>
      </div>
      {w.recent.length > 0 ? (
        <div className="flex items-center gap-2">
          {w.recent.map((a) => (
            <div
              key={a.id}
              className="flex h-9 w-9 shrink-0 overflow-hidden items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-secondary/30 text-lg"
              title={a.badge_name}
            >
              {a.badge_icon?.startsWith('/') || a.badge_icon?.startsWith('http') ? (
                <img src={a.badge_icon} alt={a.badge_name} className="w-full h-full object-cover" />
              ) : (
                <span>{a.badge_icon || '🏆'}</span>
              )}
            </div>
          ))}
          <span className="ml-auto inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-primary">
            View all <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      ) : (
        <span className="text-[11px] text-white/40">Complete lectures and quizzes to earn your first trophy.</span>
      )}
    </Cell>
  );
}

function UpNextCell({ w, onOpen }: { w: UpNextWidget; onOpen: (id: string) => void }) {
  const { lecture, pct, badge, cleanTitle } = w.view;
  return (
    <Cell className="flex gap-4 md:col-span-2" onClick={() => onOpen(lecture.id)} label={`Up next: ${cleanTitle}`}>
      <div className="h-[148px] w-[110px] shrink-0">
        <ConsoleTile
          isActive
          selection="scale"
          gradientIndex={2}
          title={cleanTitle}
          progress={pct}
          watermark={badge ?? <Layers className="h-10 w-10 text-white/15" />}
        />
      </div>
      <div className="flex min-w-0 flex-col justify-between py-1">
        <div className="space-y-1.5">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Up next</span>
          <h3 className="line-clamp-2 text-xl font-black leading-tight">{cleanTitle}</h3>
          {lecture.course?.title && (
            <p className="text-xs font-bold uppercase tracking-wider text-white/40">{lecture.course.title}</p>
          )}
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-black text-slate-900">
          <Play className="h-4 w-4 fill-slate-900" /> {pct > 0 ? 'Continue' : 'Start'}
        </span>
      </div>
    </Cell>
  );
}

function CourseProgressCell({ w }: { w: CourseProgressWidget }) {
  return (
    <Cell className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">Progress</span>
        <ProgressRing pct={w.overallPct} label={`${w.overallPct}%`} />
      </div>
      <div className="space-y-2.5">
        {w.courses.slice(0, 4).map((c) => (
          <div key={c.courseId} className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span className="truncate text-white/80">{c.title}</span>
              <span className="text-white/40">
                {c.completed}/{c.total}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
                style={{ width: `${c.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Cell>
  );
}

function ReviewCell({ w, onOpen }: { w: ReviewWidget; onOpen: () => void }) {
  return (
    <Cell
      className="flex flex-col justify-between md:col-span-2"
      onClick={onOpen}
      label={`Daily review — ${w.dueCount} due`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">Daily Review</span>
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="flex items-end gap-2">
        <span className="text-5xl font-black leading-none">{w.dueCount}</span>
        <span className="pb-1 text-xs font-bold uppercase tracking-wider text-white/50">due</span>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-black text-slate-900">
        <Play className="h-4 w-4 fill-slate-900" /> Start review
      </span>
    </Cell>
  );
}

function MyMaterialsCell({ w, onOpen }: { w: MyMaterialsWidget; onOpen: () => void }) {
  return (
    <Cell
      className="flex flex-col justify-between"
      onClick={onOpen}
      label={`My Materials — ${w.count} uploaded`}
      dataTour="my-materials"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">My Materials</span>
        <UploadCloud className="h-4 w-4 text-primary" />
      </div>
      <div className="flex items-end gap-2">
        <span className="text-4xl font-black leading-none">{w.count}</span>
        <span className="pb-1 text-xs font-bold uppercase tracking-wider text-white/50">uploaded</span>
      </div>
      <span className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-white/70">
        Upload a PDF <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Cell>
  );
}

function StudyGuideCell({ w, onOpen }: { w: StudyGuideWidget; onOpen: (courseId: string) => void }) {
  return (
    <Cell
      className="flex flex-col justify-between"
      onClick={() => onOpen(w.courseId)}
      label={`Study guide for ${w.courseTitle}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">Study Guide</span>
        <NotebookText className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-bold text-white/80 truncate mt-2 mb-0.5">{w.courseTitle}</p>
        <p className="text-xs text-white/40">AI-generated course summary</p>
      </div>
      <span className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-primary">
        Open guide <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Cell>
  );
}

/**
 * The PS5-style bento: a grid of floating glass widgets (streak, trophies, up
 * next, course progress). Renders whatever buildWidgets() returns, in order.
 */
export function BentoGrid({ widgets, onOpenLecture, onViewTrophies, onOpenReview, onOpenMyMaterials, onOpenStudyGuide }: BentoGridProps) {
  if (widgets.length === 0) return null;

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08
      }
    }
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
    >
      {widgets.map((w) => {
        switch (w.kind) {
          case 'streak':
            return <StreakCell key="streak" w={w} />;
          case 'trophies':
            return <TrophiesCell key="trophies" w={w} onView={onViewTrophies} />;
          case 'upNext':
            return <UpNextCell key="upNext" w={w} onOpen={onOpenLecture} />;
          case 'courseProgress':
            return <CourseProgressCell key="courseProgress" w={w} />;
          case 'review':
            return <ReviewCell key="review" w={w} onOpen={onOpenReview} />;
          case 'myMaterials':
            return <MyMaterialsCell key="myMaterials" w={w} onOpen={onOpenMyMaterials} />;
          case 'studyGuide':
            return <StudyGuideCell key="studyGuide" w={w} onOpen={onOpenStudyGuide} />;
          default:
            return null;
        }
      })}
    </motion.div>
  );
}
