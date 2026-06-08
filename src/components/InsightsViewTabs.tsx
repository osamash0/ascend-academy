/**
 * Segmented "My Learning · Mindmap" switcher for the Learning Insights page.
 *
 * Glass pill in the app's console aesthetic. Follows the uiux-designer rules:
 * SVG icons (not emoji), cursor-pointer, 200ms colour transitions, visible
 * focus rings, and `aria-pressed` so the active tab is announced.
 */
import { GraduationCap, Network, GitBranch } from 'lucide-react';

export type InsightsView = 'learning' | 'mindmap' | 'skills';

const TABS: { id: InsightsView; label: string; icon: typeof GraduationCap }[] = [
  { id: 'learning', label: 'My Learning', icon: GraduationCap },
  { id: 'mindmap', label: 'Mindmap', icon: Network },
  { id: 'skills', label: 'Skills', icon: GitBranch },
];

export function InsightsViewTabs({
  view,
  onChange,
  className = '',
}: {
  view: InsightsView;
  onChange: (v: InsightsView) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Insights view"
      className={`inline-flex items-center gap-1 p-1 glass-card border-white/10 rounded-2xl ${className}`}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-pressed={active}
            data-testid={`insights-tab-${id}`}
            onClick={() => onChange(id)}
            className={`flex items-center gap-2 px-4 h-10 rounded-xl text-xs font-bold uppercase tracking-widest cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
              active
                ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-glow-primary/30'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
