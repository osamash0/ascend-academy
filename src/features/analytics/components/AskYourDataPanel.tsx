import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, Info, MessageCircleQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RTooltip,
} from 'recharts';
import { toast } from 'sonner';
import {
  askLectureData, getAskSuggestions, type AskAnswer,
} from '@/services/analyticsService';
import { useAiModel } from '@/hooks/use-ai-model';

// Mirror of backend `PUBLIC_MAX_QUESTION_LENGTH` in
// backend/services/ai/ask_data.py. Keep in sync.
const MAX_LEN = 500;
const MAX_RECENT = 5;

const recentStorageKey = (lectureId: string) => `ask-your-data:recent:${lectureId}`;

function loadRecent(lectureId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(recentStorageKey(lectureId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT);
    }
  } catch {
    /* ignore corrupted storage */
  }
  return [];
}

function saveRecent(lectureId: string, list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(recentStorageKey(lectureId), JSON.stringify(list));
  } catch {
    /* quota / disabled — silently ignore */
  }
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const maybeAxios = err as { response?: { data?: { detail?: unknown } }; message?: unknown };
    const detail = maybeAxios.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    const msg = maybeAxios.message;
    if (typeof msg === 'string') {
      // apiClient throws `Error("METHOD path → STATUS: <body>")` — pull the
      // server-provided `detail` out of the trailing JSON when present so we
      // surface a clean message instead of the raw transport string.
      const jsonStart = msg.indexOf('{');
      if (jsonStart >= 0) {
        try {
          const parsed = JSON.parse(msg.slice(jsonStart));
          if (parsed && typeof parsed === 'object' && typeof (parsed as { detail?: unknown }).detail === 'string') {
            return (parsed as { detail: string }).detail;
          }
        } catch { /* fall through */ }
      }
      return msg;
    }
  }
  return 'Could not answer that question.';
}

export function AskYourDataPanel({ lectureId }: { lectureId: string }) {
  const { aiModel } = useAiModel();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<AskAnswer | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(lectureId));
  const [suggestions, setSuggestions] = useState<string[]>([
    'Which slide had the highest drop-off rate?',
    'Which 3 quiz questions had the lowest correct rate?',
    'Show me students whose quiz accuracy is below 40%',
    'How many students finished the lecture?',
    'What concepts are students most confused about?',
  ]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    getAskSuggestions(lectureId)
      .then((s) => { if (alive && s.length) setSuggestions(s); })
      .catch(() => { /* keep defaults */ });
    return () => { alive = false; };
  }, [lectureId]);

  // Re-load recents when switching lectures.
  useEffect(() => {
    setRecent(loadRecent(lectureId));
    setCurrent(null);
    setError(null);
  }, [lectureId]);

  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const ans = await askLectureData(lectureId, trimmed.slice(0, MAX_LEN), aiModel || 'cerebras');
      setCurrent(ans);
      setRecent((prev) => {
        const next = [trimmed, ...prev.filter((r) => r !== trimmed)].slice(0, MAX_RECENT);
        saveRecent(lectureId, next);
        return next;
      });
      setQuestion('');
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      setError(msg);
      toast.error('Ask Your Data failed', { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(question);
  };

  const tableColumns = current?.table?.[0] ? Object.keys(current.table[0]) : [];

  return (
    <section
      id="ask-your-data"
      className="glass-panel rounded-3xl p-8 border border-border space-y-6"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <MessageCircleQuestion className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-foreground tracking-tight flex items-center gap-2">
              Ask Your Data
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="About Ask Your Data" className="text-muted-foreground hover:text-foreground">
                      <Info className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p className="text-xs leading-relaxed">
                      Answers come from your lecture analytics only. The AI
                      picks from a fixed list of questions it knows how to
                      answer — it never writes raw queries against your data.
                      Always spot-check important numbers against the
                      dashboards before acting on them.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Ask about slides, quizzes, students, or concepts in this lecture —
              get a summary, a table, and a chart.
              AI answers can be off; spot-check important numbers against the dashboards.
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="gap-1 text-xs">
          <Sparkles className="w-3 h-3" /> AI-assisted
        </Badge>
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_LEN))}
          placeholder="e.g. Which slide had the highest drop-off rate?"
          disabled={loading}
          className="flex-1"
          aria-label="Ask a question about this lecture"
        />
        <Button type="submit" disabled={loading || !question.trim()} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Ask
        </Button>
      </form>

      {/* Suggested chips */}
      {!current && !loading && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted hover:border-primary/40 text-foreground transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Thinking through your lecture data…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Answer */}
      {current && !loading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-300">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 max-h-64 overflow-y-auto">
            <p className="text-sm font-medium text-foreground leading-relaxed whitespace-pre-wrap break-words">{current.answer_text}</p>
            {current.intent !== 'unknown' && (
              <p className="text-[10px] mt-2 uppercase tracking-widest text-muted-foreground">
                Intent: {current.intent.replace(/_/g, ' ')}
              </p>
            )}
          </div>

          {current.chart && current.chart.data.length > 0 && (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={current.chart.data} margin={{ top: 10, right: 16, bottom: 40, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted/20" vertical={false} />
                  <XAxis
                    dataKey={current.chart.x_key}
                    tick={{ fill: 'hsl(var(--foreground))', fontSize: 11, opacity: 0.7 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fill: 'hsl(var(--foreground))', fontSize: 11, opacity: 0.7 }} />
                  <RTooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.75rem',
                      fontSize: '0.75rem',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey={current.chart.y_key} fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} name={current.chart.y_label || current.chart.y_key} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {current.table.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {tableColumns.map((c) => (
                      <th key={c} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {c.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {current.table.map((row, i) => (
                    <tr key={i} className="border-t border-border hover:bg-muted/20">
                      {tableColumns.map((c) => (
                        <td key={c} className="px-4 py-3 text-foreground">
                          {formatCell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {current.table.length === 0 && current.intent !== 'unknown' && (
            <p className="text-sm text-muted-foreground italic">No matching data yet for this lecture.</p>
          )}
        </div>
      )}

      {/* Recent */}
      {recent.length > 0 && (
        <div className="pt-4 border-t border-border space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent questions</p>
            <button
              type="button"
              onClick={() => { setRecent([]); saveRecent(lectureId, []); }}
              className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => submit(q)}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors max-w-[260px] truncate disabled:opacity-50"
                title={`Re-run: ${q}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : val.toFixed(1);
  }
  return String(val);
}
