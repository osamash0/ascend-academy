import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search, Sparkles, BookOpen, Layers, FileText, Lightbulb, Loader2, ArrowLeft, Send, X } from 'lucide-react';
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import { OrbitExplorer, LunaLoader } from '../../learnstation-luna';
import { cn } from '@/lib/utils';
import {
  globalSearch,
  askCourseTutor,
  type GlobalSearchResults,
  type CourseTutorCitation,
} from '@/services/searchService';
import { listCourses, type Course } from '@/services/coursesService';
import { SharedRoutes } from '@/lib/routes';

const RECENT_SEARCHES_KEY = 'ascend.recentSearches';
const MAX_RECENT = 5;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-scopes straight into Ask mode for a specific course (the "Ask this course" entry point). */
  initialCourseId?: string;
  initialCourseTitle?: string;
}

type FlatItem = {
  key: string;
  icon: typeof BookOpen;
  label: string;
  sublabel?: string;
  onSelect: () => void;
};

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  citations?: CourseTutorCitation[];
  grounded?: boolean;
}

function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function pushRecentSearch(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const existing = readRecentSearches().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...existing].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
}

export function CommandPalette({ open, onOpenChange, initialCourseId, initialCourseTitle }: CommandPaletteProps) {
  const { t } = useTranslation('search');
  const navigate = useNavigate();

  const [mode, setMode] = useState<'search' | 'ask'>(initialCourseId ? 'ask' : 'search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [askCourseId, setAskCourseId] = useState<string | undefined>(initialCourseId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const reset = useCallback(() => {
    setMode(initialCourseId ? 'ask' : 'search');
    setQuery('');
    setResults(null);
    setActiveIndex(0);
    setAskCourseId(initialCourseId);
    setMessages([]);
    setChatInput('');
  }, [initialCourseId]);

  useEffect(() => {
    if (open) {
      setRecent(readRecentSearches());
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      reset();
    }
  }, [open, reset]);

  // Debounced search as the user types.
  useEffect(() => {
    if (mode !== 'search') return;
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await globalSearch(query);
        setResults(r);
      } catch {
        setResults({ lectures: [], slides: [], concepts: [], worksheets: [] });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode]);

  const goToLecture = useCallback((lectureId: string, slideIndex?: number) => {
    pushRecentSearch(query);
    onOpenChange(false);
    // `slide` in the route is 1-based (LectureView derives slideIndex = slideNum - 1).
    navigate(SharedRoutes.LECTURE(lectureId, slideIndex !== undefined ? slideIndex + 1 : undefined));
  }, [navigate, onOpenChange, query]);

  const startAskMode = useCallback(async (seedQuestion?: string) => {
    pushRecentSearch(query);
    setMode('ask');
    if (seedQuestion) setChatInput(seedQuestion);
    if (!askCourseId && courses === null) {
      try {
        const list = await listCourses();
        setCourses(list);
        if (list.length === 1) setAskCourseId(list[0].id);
      } catch {
        setCourses([]);
      }
    }
  }, [askCourseId, courses, query]);

  const items: FlatItem[] = useMemo(() => {
    if (mode !== 'search' || !results) return [];
    const out: FlatItem[] = [];
    for (const l of results.lectures) {
      out.push({
        key: `lecture-${l.id}`, icon: BookOpen, label: l.title,
        sublabel: t('palette.sections.lectures'),
        onSelect: () => goToLecture(l.id),
      });
    }
    for (const s of results.slides) {
      out.push({
        key: `slide-${s.lecture_id}-${s.slide_index}`, icon: Layers,
        label: s.title || `Slide ${s.slide_index + 1}`,
        sublabel: s.lecture_title,
        onSelect: () => goToLecture(s.lecture_id, s.slide_index),
      });
    }
    for (const c of results.concepts) {
      out.push({
        key: `concept-${c.id}`, icon: Lightbulb, label: c.canonical_name,
        sublabel: t('palette.sections.concepts'),
        onSelect: () => goToLecture(c.lecture_id),
      });
    }
    for (const w of results.worksheets) {
      out.push({
        key: `worksheet-${w.id}`, icon: FileText, label: w.title,
        sublabel: t('palette.sections.worksheets'),
        onSelect: () => goToLecture(w.lecture_id),
      });
    }
    return out;
  }, [mode, results, goToLecture, t]);

  useEffect(() => setActiveIndex(0), [items.length, query]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1 + (query.trim() ? 1 : 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex === items.length && query.trim()) {
        startAskMode(query.trim());
      } else if (items[activeIndex]) {
        items[activeIndex].onSelect();
      } else if (query.trim()) {
        startAskMode(query.trim());
      }
    }
  };

  const sendChat = useCallback(async (question: string, allowUngrounded = false) => {
    if (!askCourseId || !question.trim() || chatLoading) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: question };
    setMessages((m) => [...m, userMsg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await askCourseTutor({ courseId: askCourseId, question, history, allowUngrounded });
      setMessages((m) => [...m, {
        id: `a-${Date.now()}`, role: 'model', content: res.reply,
        citations: res.citations, grounded: res.grounded,
      }]);
    } catch {
      setMessages((m) => [...m, {
        id: `err-${Date.now()}`, role: 'model',
        content: "I'm sorry, something went wrong. Please try again.",
      }]);
    } finally {
      setChatLoading(false);
    }
  }, [askCourseId, chatLoading, messages]);

  useEffect(() => {
    if (mode === 'ask' && askCourseId && chatInput && messages.length === 0) {
      const seed = chatInput;
      sendChat(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, askCourseId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-[10%] z-50 w-full max-w-2xl -translate-x-1/2 overflow-hidden',
            'rounded-2xl border border-white/10 bg-[#0b0f1a] shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
          onKeyDown={mode === 'search' ? handleSearchKeyDown : undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            {mode === 'search' ? t('palette.placeholder') : t('ask.title')}
          </DialogPrimitive.Title>

          {mode === 'search' ? (
            <>
              <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('palette.placeholder')}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {loading && <LunaLoader type="orbit-scanning" size={18} />}
                <DialogPrimitive.Close aria-label={t('palette.closeHint')} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-2">
                {!query.trim() && (
                  <RecentSearches recent={recent} onPick={setQuery} label={t('palette.recent')} empty={t('palette.emptyPrompt')} />
                )}

                {query.trim() && items.length === 0 && !loading && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t('palette.noResults', { query })}
                  </div>
                )}

                {items.map((item, i) => (
                  <ResultRow key={item.key} item={item} active={i === activeIndex} onHover={() => setActiveIndex(i)} />
                ))}

                {query.trim() && (
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(items.length)}
                    onClick={() => startAskMode(query.trim())}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                      activeIndex === items.length ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-white/5',
                    )}
                  >
                    <Sparkles className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t('palette.askAiHint', { query })}</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <AskPanel
              t={t}
              courses={courses}
              askCourseId={askCourseId}
              onCourseChange={setAskCourseId}
              initialCourseTitle={initialCourseTitle}
              messages={messages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              chatLoading={chatLoading}
              onSend={() => sendChat(chatInput)}
              onAskAnyway={(question) => sendChat(question, true)}
              onBack={initialCourseId ? undefined : () => { setMode('search'); setMessages([]); }}
              onClose={() => onOpenChange(false)}
              onCitationClick={(c) => goToLecture(c.lecture_id, c.slide_index)}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function RecentSearches({ recent, onPick, label, empty }: { recent: string[]; onPick: (q: string) => void; label: string; empty: string }) {
  if (recent.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground">
        <OrbitExplorer size="sm" />
        {empty}
      </div>
    );
  }
  return (
    <div>
      <div className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</div>
      {recent.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onPick(q)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-white/5"
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{q}</span>
        </button>
      ))}
    </div>
  );
}

function ResultRow({ item, active, onHover }: { item: FlatItem; active: boolean; onHover: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={item.onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
        active ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-white/5',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.sublabel && <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{item.sublabel}</span>}
    </button>
  );
}

interface AskPanelProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  courses: Course[] | null;
  askCourseId?: string;
  onCourseChange: (id: string) => void;
  initialCourseTitle?: string;
  messages: ChatMessage[];
  chatInput: string;
  setChatInput: (v: string) => void;
  chatLoading: boolean;
  onSend: () => void;
  onAskAnyway: (question: string) => void;
  onBack?: () => void;
  onClose: () => void;
  onCitationClick: (c: CourseTutorCitation) => void;
}

function AskPanel({
  t, courses, askCourseId, onCourseChange, initialCourseTitle, messages, chatInput, setChatInput,
  chatLoading, onSend, onAskAnyway, onBack, onClose, onCitationClick,
}: AskPanelProps) {
  const needsCoursePicker = !initialCourseTitle && courses && courses.length > 1 && !askCourseId;

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        {onBack && (
          <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">
            {initialCourseTitle ? t('entry.askThisCourse') : t('ask.title')}
          </div>
          {initialCourseTitle && <div className="truncate text-xs text-muted-foreground">{initialCourseTitle}</div>}
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {needsCoursePicker ? (
        <div className="p-4">
          <p className="mb-2 text-xs text-muted-foreground">{t('ask.subtitle')}</p>
          <select
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground"
            value={askCourseId ?? ''}
            onChange={(e) => onCourseChange(e.target.value)}
          >
            <option value="" disabled>Select a course…</option>
            {courses!.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('ask.subtitle')}</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn('flex flex-col gap-1', m.role === 'user' ? 'items-end' : 'items-start')}>
                <div className={cn(
                  'max-w-[85%] rounded-xl px-3 py-2 text-sm',
                  m.role === 'user' ? 'bg-primary/20 text-foreground' : 'bg-white/5 text-foreground',
                )}>
                  {m.content}
                </div>
                {m.role === 'model' && m.grounded === false && (
                  <button
                    type="button"
                    onClick={() => {
                      const last = [...messages].reverse().find((mm) => mm.role === 'user');
                      if (last) onAskAnyway(last.content);
                    }}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    {t('ask.askAnyway')}
                  </button>
                )}
                {m.role === 'model' && m.citations && m.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.citations.map((c) => (
                      <button
                        key={`${m.id}-${c.source_index}`}
                        type="button"
                        onClick={() => onCitationClick(c)}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                      >
                        <BookOpen className="h-2.5 w-2.5" />
                        {t('ask.citeLabel', { number: c.slide_index + 1 })}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('ask.thinking')}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-white/10 p-3">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !chatLoading) onSend(); }}
              placeholder={t('palette.askPlaceholder')}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
              disabled={chatLoading}
            />
            <button
              type="button"
              onClick={onSend}
              disabled={chatLoading || !chatInput.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
              aria-label={t('ask.send')}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
