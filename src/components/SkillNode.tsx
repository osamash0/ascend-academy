/**
 * A single skill-tree node (the DOM rendered inside an SVG <foreignObject> by
 * SkillTreeView). Visuals are keyed by node kind (course / lecture / concept)
 * and state (locked → available → in_progress → owned). Lucide icons only
 * (uiux-designer rule: no emoji); owned nodes carry a glow halo that anime.js
 * pulses, in_progress nodes show a conic progress ring.
 */
import { Lock, Check, GraduationCap, BookOpen, Lightbulb, Sparkles, ChevronRight } from 'lucide-react';
import type { SkillNode as SkillNodeData, SkillNodeKind } from '@/features/skilltree/skillTree';

interface KindConfig {
  size: number;
  Icon: typeof BookOpen;
  /** Tailwind gradient for the owned fill. */
  ownedFill: string;
  /** Ring / accent colour utility. */
  accent: string;
}

const KIND: Record<SkillNodeKind, KindConfig> = {
  root: { size: 64, Icon: Sparkles, ownedFill: 'from-primary to-secondary', accent: 'text-primary' },
  course: { size: 60, Icon: GraduationCap, ownedFill: 'from-primary to-secondary', accent: 'text-primary' },
  lecture: { size: 48, Icon: BookOpen, ownedFill: 'from-secondary to-primary', accent: 'text-secondary' },
  'course-concept': { size: 42, Icon: Lightbulb, ownedFill: 'from-primary to-secondary', accent: 'text-primary' },
  'lecture-concept': { size: 38, Icon: Lightbulb, ownedFill: 'from-xp to-warning', accent: 'text-xp' },
};

export const BOX_W = 160;
export const BOX_H = 120;

export function SkillNode({
  node,
  clickable,
  selected,
  expandable,
  collapsed,
  onClick,
  onHover,
}: {
  node: SkillNodeData;
  clickable: boolean;
  selected?: boolean;
  /** Node has children that can be revealed/hidden. */
  expandable?: boolean;
  /** Whether those children are currently hidden. */
  collapsed?: boolean;
  onClick?: () => void;
  onHover?: (id: string | null) => void;
}) {
  const cfg = KIND[node.kind];
  const { size } = cfg;
  const { state } = node;
  const locked = state === 'locked';
  const owned = state === 'owned';
  const inProgress = state === 'in_progress';

  const circleClasses = owned
    ? `bg-gradient-to-br ${cfg.ownedFill} text-white border-transparent shadow-glow-primary/30`
    : locked
      ? 'bg-surface-2/60 text-muted-foreground/60 border-white/5'
      : 'bg-surface-1/80 text-foreground border-white/15';

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        aria-label={`${node.label} — ${state.replace('_', ' ')}`}
        data-node-id={node.id}
        data-state={state}
        data-owned={owned ? 'true' : 'false'}
        data-testid={`skill-node-${node.kind}`}
        onClick={clickable ? onClick : undefined}
        onKeyDown={(e) => {
          if (clickable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick?.();
          }
        }}
        onMouseEnter={() => onHover?.(node.id)}
        onMouseLeave={() => onHover?.(null)}
        className={`skill-node-inner relative flex items-center justify-center rounded-full border transition-colors duration-200 ${circleClasses} ${
          clickable ? 'cursor-pointer hover:brightness-110' : 'cursor-default'
        } ${locked ? 'opacity-60 grayscale' : ''} ${
          selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
        style={{ width: size, height: size }}
      >
        {/* glow halo — pulsed by anime.js on owned nodes */}
        {owned && (
          <span
            className={`skill-glow pointer-events-none absolute inset-[-6px] rounded-full bg-gradient-to-br ${cfg.ownedFill} blur-md opacity-40`}
            aria-hidden="true"
          />
        )}

        {/* conic progress ring for in_progress nodes */}
        {inProgress && (
          <span
            className={`pointer-events-none absolute inset-[-4px] rounded-full ${cfg.accent}`}
            aria-hidden="true"
            style={{
              background: `conic-gradient(currentColor ${Math.round((node.progress ?? 0) * 360)}deg, transparent 0)`,
              WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 0)',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 0)',
            }}
          />
        )}

        <cfg.Icon
          className="relative"
          style={{ width: size * 0.42, height: size * 0.42 }}
          aria-hidden="true"
        />

        {/* expand/collapse hint */}
        {expandable && (
          <span
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-surface-3 text-foreground"
            aria-hidden="true"
          >
            <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} />
          </span>
        )}

        {/* status badge */}
        {(owned || locked) && (
          <span
            className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background ${
              owned ? 'bg-success text-white' : 'bg-surface-3 text-muted-foreground'
            }`}
            aria-hidden="true"
          >
            {owned ? <Check className="h-3 w-3" /> : <Lock className="h-2.5 w-2.5" />}
          </span>
        )}
      </div>

      {/* label below the node */}
      <span
        className={`absolute left-1/2 max-w-[150px] -translate-x-1/2 truncate text-center text-[11px] font-bold leading-tight ${
          locked ? 'text-muted-foreground/60' : 'text-foreground'
        }`}
        style={{ top: `calc(50% + ${size / 2 + 6}px)` }}
        title={node.label}
      >
        {node.label}
      </span>
    </div>
  );
}
