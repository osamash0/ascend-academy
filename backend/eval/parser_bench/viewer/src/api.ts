/* The local server's JSON API (backend/eval/parser_bench/api_*.py), typed. */

export type Choice = "left" | "right" | "same" | "both_bad";

export interface Checks {
  page: number;
  footer_leaks: number | null;
  footer_leaked: boolean | null;
  footer_token_share?: number | null;
  title_first: boolean | null;
  wrong_symbols: number | null;
  lonely_bullets: number | null;
  broken_line_pct: number | null;
  line_breaks?: number | null;
  broken_lines?: number | null;
  headings: number | null;
  list_items: number | null;
  max_depth: number | null;
  tables: number | null;
  math_spans: number | null;
  dropped_words_pct: number | null;
  invented_words_pct: number | null;
  chars: number | null;
}

export interface RunRow {
  run_id: string;
  kind: "extract" | "compare";
  tool: string | null;
  version: string | null;
  purpose: string | null;
  status: string;
  reason?: string | null;
  started_at: string | null;
  finished_at?: string | null;
  file?: string | null;
  sha256?: string | null;
  pages_total?: number | null;
  pages: number[];
  seconds_per_page?: number | null;
  peak_memory_mb?: number | null;
  /** Paid runs: the dollars spent (null when the usage was lost; a lower bound when pages were billed without usage). */
  cost_usd?: number | null;
  commit: string | null;
  dirty?: boolean | null;
  done?: number;
  total?: number;
  record_version: number;
  checks_version: number;
}

export interface RunDetail extends RunRow {
  environment: string[] | null;
  settings?: unknown;
  machine?: unknown;
  failed_stage: string | null;
  warmup_seconds: number | null;
  seconds_total: number | null;
  protocol_commit: string | null;
  page_list: { page: number; locked: boolean }[];
  checks: Checks[];
  /** Paid runs only. */
  cost?: Cost | null;
  /** Paid runs: the pages sent to OpenAI; null when the runner was stopped before it wrote a record (unknown, not "none"). */
  pages_sent?: number[] | null;
  /** Paid runs: the usage per page, for the pages the blinding lock lets open. */
  api_pages?: Record<string, unknown> | null;
}

export interface PageOutput {
  run_id: string;
  page: number;
  markdown: string;
  footer_lines: number[];
  checks: Checks | null;
}

export type NamedOutput = RunRow & { markdown: string; footer_lines: number[]; checks: Checks | null };

export interface SourceInfo {
  sha256: string;
  name: string;
  pages_total: number | null;
  pages: number[];
  locked: number[];
  runs: number;
}

export interface DiffOp {
  op: "equal" | "delete" | "insert";
  text: string;
}

export interface ComparisonSummary {
  run_id: string;
  purpose: string;
  status: "judging" | "finished";
  started_at: string;
  done: number;
  total: number;
  rounds: number | null;
  unlocked_early: { at: string; reason: string } | null;
  locked: boolean;
  pages: { key: string; type: string }[];
}

export interface NextDuel {
  finished: boolean;
  done: number;
  total: number;
  duel?: number;
  round?: number;
  page?: { key: string; type: string; number: number; file: string; png: string };
  left?: { markdown: string };
  right?: { markdown: string };
}

export interface RankingRow {
  entrant: string;
  points: number;
  lo: number;
  hi: number;
  /** Bonferroni-corrected lower bound ((2.5/k)th percentile); null for the anchor. H1 is decided on this. */
  h1_lower: number | null;
  duels: number;
  wins: number;
  losses: number;
  same: number;
  both_bad: number;
}

export interface CheckSummary {
  pages: number;
  footer_leaks: number;
  pages_with_footer_leak: number;
  footer_token_share: number | null;
  title_first: number | null;
  wrong_symbols: number;
  lonely_bullets: number;
  broken_line_pct: number | null;
  dropped_words_pct: number | null;
  invented_words_pct: number | null;
  headings: number;
  list_items: number;
  tables: number;
  math_spans: number;
  seconds_per_page: number | null;
  peak_memory_mb: number | null;
  reference_biased: boolean;
}

export interface Results {
  run_id: string;
  status: string;
  votes_digest?: string;
  votes: number;
  retracted: number;
  scheduled: number;
  rounds: number;
  round2_duels: number;
  anchor: string;
  bootstrap: { resamples: number; seed: number };
  ranking: RankingRow[];
  h1: { holds: boolean; above_anchor: string[] };
  /** k: the number of challengers H1 is corrected over. */
  h1_k?: number;
  self_consistency: { agree: number; total: number; share: number | null };
  win_rate_by_type: Record<string, Record<string, { duels: number; score: number }>>;
  median_seconds: number | null;
  checks: Record<string, CheckSummary>;
  /** Only for a comparison that builds on finished ones: the ratings pool their votes with its own. */
  pooled?: {
    builds_on: string[];
    new_entrants: string[];
    votes: number;
    sources: Record<string, { status: string; votes: number; votes_digest: string; unlocked_early: boolean }>;
    note: string;
  };
  /** Pooled comparisons only: H1 on round-1 duels alone, descriptive (round 2 depends on round 1). */
  sensitivity?: { round1_only: { votes: number; h1_above: string[]; h1_k: number; h1_lower: Record<string, number> } };
}

export interface MyVote {
  vote_id: string;
  duel: number;
  page: string;
  type: string | null;
  left: string;
  right: string;
  choice: Choice;
  seconds: number;
  note: string | null;
  at?: string;
  session?: string;
  withdrawn: boolean;
}

export interface Method {
  id: string;
  label: string;
  group: "fast" | "heavy" | "paid";
  description: string;
  ready: boolean;
  missing: string[];
  size_mb: number;
  needs_install: boolean;
  paid: boolean;
  model: string | null;
  /** Paid methods: the key file is missing or unusable (never the key itself); null for the others. */
  key_missing: boolean | null;
}

export interface Estimate {
  tool: string;
  label: string;
  model: string;
  pages: number;
  usd: number;
  max_usd: number;
}

/** What a paid run spent. A run whose usage was lost has only usd: null, usage_lost and basis; a blinded run has no price. */
export interface Cost {
  requests?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  usd: number | null;
  usd_is_lower_bound?: boolean;
  pages_billed_without_usage?: number;
  usage_lost?: boolean;
  basis?: string;
  price?: { model: string; input_per_m: number; output_per_m: number; checked_on: string; source: string };
}

export interface StoredFile {
  sha256: string;
  name: string;
  pages: number;
  size: number;
  benchmark_pages: number[];
}

export interface Job {
  job_id: string;
  kind: "run" | "install";
  tool: string;
  sha256: string | null;
  file_name: string | null;
  purpose: string | null;
  state: "queued" | "running" | "finished" | "failed" | "cancelled" | "interrupted";
  stage: string | null;
  run_id: string | null;
  error: string | null;
  queued_at?: string;
  started_at?: string | null;
  ended_at?: string | null;
  cost_ok?: boolean;
  estimate?: Omit<Estimate, "tool" | "label"> | null;
}

/** A page whose outputs stay hidden while it is judged blind (HTTP 423). */
export class Locked extends Error {
  name = "Locked";
}

const WRITE = { "X-Parser-Bench": "1" };

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...WRITE, ...(init.headers ?? {}) } });
  if (res.ok) return (await res.json()) as T;
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
    // FastAPI's 422 lists each refused field
    else if (Array.isArray(body?.detail))
      detail = body.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`).join("; ");
  } catch {
    // not JSON: keep the status line
  }
  if (res.status === 423) throw new Locked(detail);
  throw new Error(detail);
}

function post<T>(url: string, body: unknown): Promise<T> {
  return call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const q = encodeURIComponent;

export const api = {
  runs: () => call<{ runs: RunRow[] }>("/api/runs"),
  run: (id: string) => call<RunDetail>(`/api/runs/${q(id)}`),
  page: (id: string, page: number) => call<PageOutput>(`/api/runs/${q(id)}/pages/${page}`),
  diff: (a: string, b: string, page: number) =>
    call<{ ops: DiffOp[] }>(`/api/diff?a=${q(a)}&b=${q(b)}&page=${page}`),
  sources: () => call<{ sources: SourceInfo[] }>("/api/sources"),
  outputs: (sha: string, page: number) =>
    call<{ outputs: NamedOutput[]; hidden?: number }>(`/api/outputs/${sha}/${page}`),
  comparisons: () => call<{ comparisons: ComparisonSummary[] }>("/api/comparisons"),
  next: (cid: string) => call<NextDuel>(`/api/comparisons/${q(cid)}/next`),
  vote: (cid: string, body: { duel: number; choice: Choice; seconds: number; session: string; note: string | null }) =>
    post<{ vote_id: string; done: number; total: number; added?: number; finished: boolean }>(
      `/api/comparisons/${q(cid)}/votes`,
      body,
    ),
  undo: (cid: string, session: string) => post<{ retracted: number | null }>(`/api/comparisons/${q(cid)}/undo`, { session }),
  results: (cid: string) => call<Results>(`/api/comparisons/${q(cid)}/results`),
  myVotes: (cid: string) => call<{ votes: MyVote[] }>(`/api/comparisons/${q(cid)}/votes`),
  unlock: (cid: string, reason: string) => post<ComparisonSummary>(`/api/comparisons/${q(cid)}/unlock`, { reason }),
  methods: () => call<{ groups: string[]; methods: Method[] }>("/api/methods"),
  files: () => call<{ files: StoredFile[] }>("/api/files"),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<StoredFile>("/api/files", { method: "POST", body: form });
  },
  jobs: () => call<{ jobs: Job[] }>("/api/jobs"),
  startJobs: (body: { sha256: string; tools: string[]; purpose: string; cost_ok?: boolean }) => post<{ jobs: Job[] }>("/api/jobs", body),
  estimate: (sha: string, tools: string[], purpose: string) =>
    call<{ file: string; purpose: string; estimates: Estimate[] }>(
      `/api/estimate?sha256=${q(sha)}&tools=${q(tools.join(","))}&purpose=${q(purpose)}`,
    ),
  cancel: (id: string) => post<Job>(`/api/jobs/${q(id)}/cancel`, {}),
  install: (tool: string) => post<Job>(`/api/methods/${q(tool)}/install`, {}),
};

export const pngUrl = (sha: string, page: number) => `/api/files/${sha}/pages/${page}.png`;
