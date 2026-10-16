import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowLeft, Check, Circle, RefreshCw, UserX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { AdminRoutes } from '@/lib/routes';
import {
  launchControlService,
  type CatalogLecture,
  type LaunchGate,
  type LaunchOverview,
} from '@/services/launchControlService';

/**
 * Launch Control — the one screen to watch on launch day.
 *
 * Everything here is computed live by GET /admin/launch/overview. The two
 * gates the app cannot check by itself (a database dump, the privacy policy)
 * are confirmed by hand; that tick is a per-browser convenience, nothing more.
 */

const REFRESH_MS = 30_000;
const CONFIRM_KEY = 'launch-control-confirmed';

function readConfirmed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CONFIRM_KEY) || '{}');
  } catch {
    return {};
  }
}

function usd(n: number) {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function ago(iso: string) {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

function humanEvent(type: string) {
  return type.replace(/_/g, ' ');
}

export default function LaunchControl() {
  const { toast } = useToast();
  const [data, setData] = useState<LaunchOverview | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>(readConfirmed);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await launchControlService.fetchOverview());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const toggleConfirm = (id: string) => {
    setConfirmed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(CONFIRM_KEY, JSON.stringify(next));
      } catch {
        /* private window: the tick just won't persist */
      }
      return next;
    });
  };

  const markInternal = async (userId: string, who: string | null) => {
    try {
      await launchControlService.setClassification(userId, true, 'marked from Launch Control');
      toast({ title: `${who || 'Account'} no longer counts as a real user` });
      load();
    } catch (e: any) {
      toast({ title: 'Could not update the account', description: e?.message, variant: 'destructive' });
    }
  };

  const open = useMemo(
    () =>
      (data?.gates ?? []).filter(
        (g) => g.status === 'fail' || (g.status === 'confirm' && !confirmed[g.id]),
      ),
    [data, confirmed],
  );

  return (
    <div className="min-h-screen bg-[#050505] text-slate-200">
      <div className="container mx-auto max-w-[1400px] px-4 py-8 lg:px-8">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              to={AdminRoutes.DASHBOARD}
              className="mb-4 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Platform Console
            </Link>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Launch Control</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white md:text-5xl" data-testid="launch-verdict">
              {!data
                ? 'Checking…'
                : open.length === 0
                  ? 'Ready for lift-off'
                  : `${open.length} ${open.length === 1 ? 'thing' : 'things'} before launch`}
            </h1>
            {data && (
              <p className="mt-2 text-sm text-slate-500">
                Updated {ago(data.generated_at)} · refreshes every 30 s · AI on {data.models.quality} /{' '}
                {data.models.bulk}
              </p>
            )}
          </div>
          <Button
            onClick={load}
            disabled={loading}
            className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </header>

        {error && !data && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-300">
            Couldn't reach the launch overview.{' '}
            <button className="underline" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {!data && !error && (
          <div className="space-y-4">
            <div className="h-48 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
            <div className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <Gates gates={data.gates} confirmed={confirmed} onToggle={toggleConfirm} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <RealUsers data={data} onMarkInternal={markInternal} />
              <AiSpend data={data} />
            </div>
            <Catalog lectures={data.catalog} />
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {aside && <div className="text-sm text-slate-500">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Gates({
  gates,
  confirmed,
  onToggle,
}: {
  gates: LaunchGate[];
  confirmed: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  return (
    <Panel title="Readiness">
      <ul className="grid grid-cols-1 gap-x-8 gap-y-1 lg:grid-cols-2">
        {gates.map((g) => {
          const done = g.status === 'pass' || (g.status === 'confirm' && confirmed[g.id]);
          return (
            <li key={g.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5" data-testid={`gate-${g.id}`}>
              {g.status === 'confirm' ? (
                <button
                  onClick={() => onToggle(g.id)}
                  aria-label={confirmed[g.id] ? `Unconfirm: ${g.label}` : `Confirm: ${g.label}`}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    confirmed[g.id] ? 'border-emerald-400 bg-emerald-400/20' : 'border-amber-400/60'
                  }`}
                >
                  {confirmed[g.id] && <Check className="h-3.5 w-3.5 text-emerald-300" />}
                </button>
              ) : done ? (
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-label="Passing" />
              ) : (
                <X className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-label="Failing" />
              )}
              <div className="min-w-0">
                <p className={`text-sm font-medium ${done ? 'text-slate-300' : 'text-white'}`}>{g.label}</p>
                <p className="text-xs text-slate-500">{g.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Bars({ values, tone = 'bg-white/70' }: { values: number[]; tone?: string }) {
  const max = Math.max(...values, 0);
  return (
    <div className="flex h-16 items-end gap-[3px]" aria-hidden="true">
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${v > 0 ? tone : 'bg-white/10'}`}
          style={{ height: max > 0 && v > 0 ? `${Math.max(8, (v / max) * 100)}%` : '3px' }}
        />
      ))}
    </div>
  );
}

const FUNNEL_STEPS = [
  ['signed_up', 'Signed up'],
  ['onboarded', 'Finished onboarding'],
  ['activated', 'First learning activity'],
  ['came_back', 'Came back'],
  ['week_2_active', 'Active in week 2'],
] as const;

function RealUsers({
  data,
  onMarkInternal,
}: {
  data: LaunchOverview;
  onMarkInternal: (userId: string, who: string | null) => void;
}) {
  const { totals, funnel, signups_daily, sources, feed, classification_ready } = data.pulse;
  const signups30 = signups_daily.reduce((s, d) => s + d.signups, 0);
  return (
    <Panel
      title="Real users"
      aside={classification_ready ? `${totals.all_users - totals.real_users} test & staff accounts hidden` : 'test accounts not separated yet'}
    >
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat value={totals.signups_7d} label="new this week" />
        <Stat value={totals.active_24h} label="active today" />
        <Stat value={totals.active_7d} label="active this week" />
      </div>

      {funnel && (
        <div className="mb-6 space-y-2">
          {FUNNEL_STEPS.map(([key, label], i) => {
            const value = funnel[key];
            const prev = i === 0 ? null : funnel[FUNNEL_STEPS[i - 1][0]];
            const width = funnel.signed_up ? (value / funnel.signed_up) * 100 : 0;
            return (
              <div key={key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className="tabular-nums text-slate-300">
                    {value}
                    {prev ? <span className="text-slate-600"> · {Math.round((value / prev) * 100)}%</span> : null}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/5">
                  <div className="h-2 rounded-full bg-white/70" style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-6">
        <p className="mb-2 text-xs text-slate-500">{signups30} signups in the last 30 days</p>
        <Bars values={signups_daily.map((d) => d.signups)} />
      </div>

      {sources.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-xs text-slate-500">Where they came from</p>
          <ul className="space-y-1 text-sm">
            {sources.map((s) => (
              <li key={s.source} className="flex justify-between">
                <span className="text-slate-300">{s.source}</span>
                <span className="tabular-nums text-slate-500">
                  {s.activated}/{s.signed_up} activated
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mb-2 text-xs text-slate-500">Live</p>
      {feed.length === 0 ? (
        <p className="text-sm text-slate-500">No real-user activity in the last 14 days.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-white/5 overflow-y-auto text-sm" data-testid="launch-feed">
          {feed.map((f, i) => (
            <li key={`${f.at}-${i}`} className="group flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-white">{f.who || 'Someone'}</span>{' '}
                <span className="text-slate-500">{humanEvent(f.event_type)}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-600">{ago(f.at)}</span>
              {classification_ready && (
                <button
                  onClick={() => onMarkInternal(f.user_id, f.who)}
                  className="shrink-0 text-slate-600 opacity-0 hover:text-slate-300 focus:opacity-100 group-hover:opacity-100"
                  title="This is a test account"
                  aria-label={`Mark ${f.who || 'this account'} as a test account`}
                >
                  <UserX className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p className="text-3xl font-bold tabular-nums text-white">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function AiSpend({ data }: { data: LaunchOverview }) {
  const ai = data.ai;
  const pct = ai.ceiling_usd > 0 ? Math.min(100, (ai.today_usd / ai.ceiling_usd) * 100) : 0;
  const offProvider = ai.by_provider.filter((p) => p.provider !== 'openai');
  return (
    <Panel title="AI spend" aside={`${usd(ai.month_usd)} this month`}>
      <div className="mb-6">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-slate-400">Today</span>
          <span className="tabular-nums text-slate-300">
            {usd(ai.today_usd)} <span className="text-slate-600">of {usd(ai.ceiling_usd)} daily ceiling</span>
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/5">
          <div
            className={`h-2 rounded-full ${pct >= 80 ? 'bg-amber-400' : 'bg-white/70'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mb-6">
        <p className="mb-2 text-xs text-slate-500">Last 30 days</p>
        <Bars values={ai.daily.map((d) => d.usd)} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs text-slate-500">By feature, last 30 days</p>
          <ul className="space-y-1 text-sm">
            {ai.by_feature.length === 0 && <li className="text-slate-500">No calls yet.</li>}
            {ai.by_feature.map((f) => (
              <li key={f.feature} className="flex justify-between gap-3">
                <span className="truncate text-slate-300">{humanEvent(f.feature)}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{usd(f.usd)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs text-slate-500">Students closest to the {usd(ai.user_cap_usd)} cap</p>
          <ul className="space-y-2 text-sm">
            {ai.top_users.length === 0 && <li className="text-slate-500">No student spend yet.</li>}
            {ai.top_users.map((u) => (
              <li key={u.user_id}>
                <div className="flex justify-between gap-3">
                  <span className="truncate text-slate-300">{u.who || 'Student'}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">{usd(u.usd)}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-white/5">
                  <div
                    className="h-1 rounded-full bg-white/50"
                    style={{ width: `${Math.min(100, (u.usd / ai.user_cap_usd) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {offProvider.length > 0 && (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200/80">
          In the last 30 days, {offProvider.reduce((s, p) => s + p.calls, 0)} calls went to{' '}
          {[...new Set(offProvider.map((p) => p.provider))].join(', ')} — before the switch to OpenAI.
        </p>
      )}
    </Panel>
  );
}

function Catalog({ lectures }: { lectures: CatalogLecture[] }) {
  const courses = useMemo(() => {
    const byCourse = new Map<string, CatalogLecture[]>();
    for (const l of lectures) byCourse.set(l.course, [...(byCourse.get(l.course) ?? []), l]);
    return [...byCourse.entries()];
  }, [lectures]);
  // The pass count already lives in the Readiness gate; here the cells show it.
  return (
    <Panel title="What students can open">
      <div className="space-y-6">
        {courses.map(([course, items]) => {
          const gaps = items.filter((l) => l.missing.length > 0);
          return (
            <div key={course}>
              <p className="mb-2 font-medium text-white">{course}</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {items.map((l) => (
                  <span
                    key={l.id}
                    title={l.missing.length ? `${l.title}: needs ${l.missing.join(', ')}` : l.title}
                    className={`h-5 w-5 rounded ${l.missing.length ? 'border border-white/20' : 'bg-white/70'}`}
                  />
                ))}
              </div>
              {gaps.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {gaps.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2">
                      <Circle className="h-2 w-2 shrink-0 fill-slate-600 text-slate-600" />
                      <span className="text-slate-400">{l.title}</span>
                      {l.missing.map((m) => (
                        <span key={m} className="rounded bg-white/5 px-1.5 py-0.5 text-slate-500">
                          {m}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
