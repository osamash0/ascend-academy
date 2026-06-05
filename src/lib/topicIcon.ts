import {
  type LucideIcon,
  Binary,
  Boxes,
  Database,
  FileStack,
  GitBranch,
  GitMerge,
  KeyRound,
  Layers,
  LineChart,
  Lock,
  Network,
  Regex,
  Rocket,
  Share2,
  Shield,
  Sigma,
  Table2,
  Workflow,
} from 'lucide-react';

/**
 * Resolves a topic icon for a lecture/course tile so the UI stops stamping the
 * same book on everything.
 *
 * Two-tier, fully dynamic — no per-item hardcoding:
 *   1. Content-aware: match keywords in the title to a meaningful icon.
 *   2. Deterministic fallback: hash a stable key (id/title) into a varied pool,
 *      so the same item always gets the same icon and neighbours differ.
 */

// First regex to match wins — order from most specific to most general.
const KEYWORD_ICONS: Array<[RegExp, LucideIcon]> = [
  [/introduc|overview|getting started|welcome|kickoff/, Rocket],
  [/normal(i[sz]ation|i[sz]e|\bform)/, Layers],
  [/relational algebra|algebra|calculus|tuple|set theory/, Sigma],
  [/relational design|\bschema|entity|\ber\b|e-?r model|data model/, Network],
  [/sql|\bquery|select statement/, Table2],
  [/regex|pattern|grammar|parsing/, Regex],
  [/index(ing|es)?|b-?tree|hash(ing)?/, Binary],
  [/transaction|acid|concurren|isolation|deadlock/, GitMerge],
  [/lock|latch|serial/, Lock],
  [/security|auth|privac|access control|encrypt/, Shield],
  [/key|constraint|integrity|dependen/, KeyRound],
  [/join|relation|associat/, Share2],
  [/storage|disk|file|buffer|page|memory/, Database],
  [/optimi[sz]|performance|tuning|cost/, Workflow],
  [/aggregat|analytics|report|statistic|olap|warehouse/, LineChart],
  [/version|branch|log|recovery|history/, GitBranch],
  [/basic|fundament|foundation|primer|core concept/, Boxes],
  [/document|record|collection/, FileStack],
];

// Varied, visually distinct pool for items that match no keyword.
const FALLBACK_POOL: LucideIcon[] = [
  Boxes,
  Network,
  Layers,
  Table2,
  Database,
  GitBranch,
  Workflow,
  Binary,
  Share2,
  Sigma,
];

/** Stable, well-distributed string hash (FNV-1a style). */
function hashKey(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick an icon for a topic.
 * @param title  Human-readable title (drives keyword matching).
 * @param seed   Stable identity (e.g. lecture/course id) for the fallback hash;
 *               defaults to the title so it's still deterministic without an id.
 */
export function topicIcon(title: string | null | undefined, seed?: string | number): LucideIcon {
  const t = (title ?? '').toLowerCase();
  for (const [re, icon] of KEYWORD_ICONS) {
    if (re.test(t)) return icon;
  }
  const key = String(seed ?? title ?? '');
  return FALLBACK_POOL[hashKey(key) % FALLBACK_POOL.length];
}
