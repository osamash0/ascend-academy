/**
 * Tiny in-memory mock for the @supabase/supabase-js client.
 *
 * Implements the chain methods our app actually uses:
 *   .from(table).select(cols).eq(col, v).order().limit().single()
 *   .insert(payload), .update(patch).eq(...), .delete().eq(...)
 *   .upsert(payload, { onConflict })
 *   .auth.getSession(), .auth.signInWithPassword(), .auth.signUp(),
 *     .auth.signOut(), .auth.onAuthStateChange()
 *   .storage.from(bucket).upload(path, file).remove([paths]).getPublicUrl()
 *
 * Tests get a fresh instance via `createSupabaseMock()`. The default export
 * `supabase` is shared and reset between tests by callers.
 */
import { vi } from "vitest";

export interface MockTable {
  rows: Record<string, unknown>[];
}

export type MockData = Record<string, MockTable>;

interface QueryState {
  table: string;
  filters: { op: "eq" | "neq" | "in" | "contains"; col: string; val: unknown }[];
  order: { col: string; ascending: boolean } | null;
  limitN: number | null;
  rangeBounds: [number, number] | null;
  cols: string;
  // mutation state
  mutation: "select" | "insert" | "upsert" | "update" | "delete";
  payload?: unknown;
  patch?: Record<string, unknown>;
  onConflict?: string;
  countOption?: "exact" | "planned" | "estimated";
  headOption?: boolean;
}

function rowMatches(row: Record<string, unknown>, filters: QueryState["filters"]) {
  for (const f of filters) {
    const v = row[f.col];
    if (f.op === "eq" && v !== f.val) return false;
    if (f.op === "neq" && v === f.val) return false;
    if (f.op === "in" && !(f.val as unknown[]).includes(v)) return false;
    if (f.op === "contains" && typeof v === "object" && v !== null) {
      const sub = f.val as Record<string, unknown>;
      for (const k of Object.keys(sub)) {
        if ((v as Record<string, unknown>)[k] !== sub[k]) return false;
      }
    }
  }
  return true;
}

function executeQuery(data: MockData, q: QueryState) {
  const table = (data[q.table] ??= { rows: [] });

  if (q.mutation === "insert") {
    const items = Array.isArray(q.payload) ? q.payload : [q.payload];
    for (const it of items as Record<string, unknown>[]) {
      table.rows.push({ id: `mock-id-${table.rows.length + 1}`, ...it });
    }
    return { data: items, error: null };
  }
  if (q.mutation === "upsert") {
    const items = Array.isArray(q.payload) ? q.payload : [q.payload];
    for (const it of items as Record<string, unknown>[]) {
      const keys = (q.onConflict || "").split(",").filter(Boolean);
      const existing =
        keys.length > 0
          ? table.rows.find((r) => keys.every((k) => r[k] === it[k]))
          : undefined;
      if (existing) Object.assign(existing, it);
      else table.rows.push({ id: `mock-id-${table.rows.length + 1}`, ...it });
    }
    return { data: items, error: null };
  }

  let result = table.rows.filter((r) => rowMatches(r, q.filters));

  if (q.mutation === "update") {
    for (const r of table.rows) {
      if (rowMatches(r, q.filters)) Object.assign(r, q.patch || {});
    }
    return { data: result, error: null };
  }
  if (q.mutation === "delete") {
    table.rows = table.rows.filter((r) => !rowMatches(r, q.filters));
    return { data: result, error: null };
  }

  if (q.order) {
    result = [...result].sort((a, b) => {
      const av = a[q.order!.col];
      const bv = b[q.order!.col];
      if (av === bv) return 0;
      const cmp = (av ?? "") > (bv ?? "") ? 1 : -1;
      return q.order!.ascending ? cmp : -cmp;
    });
  }
  if (q.rangeBounds) {
    const [s, e] = q.rangeBounds;
    result = result.slice(s, e + 1);
  }
  if (q.limitN != null) result = result.slice(0, q.limitN);

  return { data: result, error: null, count: q.headOption ? result.length : undefined };
}

class QueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private state: QueryState;
  constructor(private store: MockData, table: string) {
    this.state = {
      table,
      filters: [],
      order: null,
      limitN: null,
      rangeBounds: null,
      cols: "*",
      mutation: "select",
    };
  }
  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    this.state.cols = cols;
    if (opts?.count) this.state.countOption = opts.count;
    if (opts?.head) this.state.headOption = opts.head;
    return this;
  }
  eq(col: string, val: unknown) {
    this.state.filters.push({ op: "eq", col, val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.state.filters.push({ op: "neq", col, val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.state.filters.push({ op: "in", col, val });
    return this;
  }
  contains(col: string, val: unknown) {
    this.state.filters.push({ op: "contains", col, val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.state.order = { col, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.state.limitN = n;
    return this;
  }
  range(start: number, end: number) {
    this.state.rangeBounds = [start, end];
    return this;
  }
  insert(payload: unknown) {
    this.state.mutation = "insert";
    this.state.payload = payload;
    return this;
  }
  upsert(payload: unknown, opts?: { onConflict?: string }) {
    this.state.mutation = "upsert";
    this.state.payload = payload;
    this.state.onConflict = opts?.onConflict;
    return this;
  }
  update(patch: Record<string, unknown>) {
    this.state.mutation = "update";
    this.state.patch = patch;
    return this;
  }
  delete() {
    this.state.mutation = "delete";
    return this;
  }
  single() {
    return Promise.resolve(executeQuery(this.store, this.state)).then((r) => {
      const arr = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
      if (arr.length === 0) {
        return { data: null, error: { code: "PGRST116", message: "no rows" } };
      }
      return { data: arr[0], error: null };
    });
  }
  maybeSingle() {
    return Promise.resolve(executeQuery(this.store, this.state)).then((r) => {
      const arr = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
      return { data: arr[0] ?? null, error: null };
    });
  }
  // PromiseLike: callers `await` the builder directly to run a SELECT.
  then<T>(onFulfilled?: (v: { data: unknown; error: unknown }) => T): Promise<T> {
    return Promise.resolve(executeQuery(this.store, this.state)).then(onFulfilled as never);
  }
}

export interface SupabaseMock {
  from: (table: string) => QueryBuilder;
  data: MockData;
  reset: () => void;
  seed: (table: string, rows: Record<string, unknown>[]) => void;
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    signInWithPassword: ReturnType<typeof vi.fn>;
    signUp: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
    resetPasswordForEmail: ReturnType<typeof vi.fn>;
  };
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
}

export function createSupabaseMock(): SupabaseMock {
  const data: MockData = {};
  const mock: SupabaseMock = {
    data,
    from: (table: string) => new QueryBuilder(data, table),
    reset() {
      for (const k of Object.keys(data)) delete data[k];
    },
    seed(table, rows) {
      data[table] = { rows: rows.map((r) => ({ ...r })) };
    },
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: "test-token" } }, error: null }),
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://fake/url" } }),
      }),
    },
  };
  return mock;
}

export const supabaseMock = createSupabaseMock();
