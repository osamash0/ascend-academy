import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { professorChat, getProfessorAskSuggestions, type ChatTurn } from '@/services/analyticsService';
import { useAiModel } from '@/hooks/use-ai-model';
import { useAuth } from '@/lib/auth';

export interface ChatMsg extends ChatTurn {
  id: string;
}

let _idSeq = 0;
const nextId = () => `m${++_idSeq}`;

export interface ProfessorChat {
  messages: ChatMsg[];
  input: string;
  setInput: (s: string) => void;
  loading: boolean;
  suggestions: string[];
  active: boolean;
  aiModel: string;
  submit: (text: string) => void;
  regenerate: () => void;
  /** Clears the conversation and starts fresh. */
  reset: () => void;
  /** Hides the chat panel (back to full lecture browsing) without losing history. */
  close: () => void;
}

/**
 * Owns the professor assistant's conversation state. Lifted out of the view so
 * the chat can move between layouts (centered idle ↔ left-docked panel) without
 * remounting and losing history.
 *
 * `onAsk` fires with each user message so the host can react (e.g. focus the
 * matching course/lecture in the right-hand console).
 */
const STORAGE_KEY = 'ascend_prof_chat_v1';
const EXPIRY_MS = 1000 * 60 * 30; // 30 minutes

export function useProfessorChat(opts?: { onAsk?: (text: string) => void }): ProfessorChat {
  const { aiModel } = useAiModel();
  const { user } = useAuth();
  const storageKey = user?.id ? `${STORAGE_KEY}_${user.id}` : STORAGE_KEY;
  const tsKey = `${storageKey}_ts`;
  const closedKey = `${storageKey}_closed`;

  const loadMessages = (sKey: string, tKey: string): ChatMsg[] => {
    if (typeof window === 'undefined') return [];
    try {
      const storedTs = localStorage.getItem(tKey);
      if (storedTs) {
        if (Date.now() - parseInt(storedTs, 10) > EXPIRY_MS) {
          localStorage.removeItem(sKey);
          localStorage.removeItem(tKey);
          return [];
        }
      }
      const stored = localStorage.getItem(sKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  };

  const loadClosed = (cKey: string): boolean =>
    typeof window !== 'undefined' && localStorage.getItem(cKey) === '1';

  const [messages, setMessages] = useState<ChatMsg[]>(() => loadMessages(storageKey, tsKey));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Whether the professor explicitly closed the chat panel. Persisted so it
  // survives navigating away from /professor/analytics and back — without
  // this, the docked chat would silently reopen every time the page remounts
  // (messages persist, but component state like `closed` doesn't).
  const [closed, setClosed] = useState<boolean>(() => loadClosed(closedKey));

  useEffect(() => {
    let cancelled = false;
    getProfessorAskSuggestions()
      .then((s) => !cancelled && setSuggestions(s))
      .catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, []);

  // Load messages whenever the storage key changes (e.g. login/logout)
  // or on mount if coming back from another tab after expiry.
  useEffect(() => {
    setMessages(loadMessages(storageKey, tsKey));
    setClosed(loadClosed(closedKey));
  }, [storageKey, tsKey, closedKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages));
    localStorage.setItem(tsKey, Date.now().toString());
  }, [messages, storageKey, tsKey]);

  useEffect(() => {
    localStorage.setItem(closedKey, closed ? '1' : '0');
  }, [closed, closedKey]);

  const ask = useCallback(
    async (history: ChatMsg[]) => {
      setLoading(true);
      try {
        const reply = await professorChat(history.map((m) => ({ role: m.role, content: m.content })), aiModel);
        setMessages((prev) => [...prev, { id: nextId(), role: 'model', content: reply }]);
      } catch (err: any) {
        const errMsg = err?.message || (err?.response?.data?.detail) || JSON.stringify(err);
        setMessages((prev) => [...prev, { id: nextId(), role: 'model', content: `Sorry — I couldn't answer that just now. API Error: ${errMsg}` }]);
      } finally {
        setLoading(false);
      }
    },
    [aiModel],
  );

  const submit = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || loading) return;
      setClosed(false);
      opts?.onAsk?.(t);
      const userMsg: ChatMsg = { id: nextId(), role: 'user', content: t };
      const next = [...messages, userMsg];
      setMessages(next);
      setInput('');
      ask(next);
    },
    [loading, messages, ask, opts],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setClosed(false);
    localStorage.removeItem(storageKey);
    localStorage.removeItem(tsKey);
    localStorage.removeItem(closedKey);
  }, [storageKey, tsKey, closedKey]);

  const close = useCallback(() => setClosed(true), []);

  const regenerate = useCallback(() => {
    if (loading) return;
    const lastUserIdx = [...messages].map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) return;
    const upto = messages.slice(0, lastUserIdx + 1);
    setMessages(upto);
    ask(upto).catch(() => toast.error('Could not regenerate.'));
  }, [loading, messages, ask]);

  return {
    messages,
    input,
    setInput,
    loading,
    suggestions,
    active: messages.length > 0 && !closed,
    aiModel,
    submit,
    regenerate,
    reset,
    close,
  };
}
