import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { professorChat, getProfessorAskSuggestions, type ChatTurn } from '@/services/analyticsService';
import { useAiModel } from '@/hooks/use-ai-model';

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
}

/**
 * Owns the professor assistant's conversation state. Lifted out of the view so
 * the chat can move between layouts (centered idle ↔ left-docked panel) without
 * remounting and losing history.
 *
 * `onAsk` fires with each user message so the host can react (e.g. focus the
 * matching course/lecture in the right-hand console).
 */
export function useProfessorChat(opts?: { onAsk?: (text: string) => void }): ProfessorChat {
  const { aiModel } = useAiModel();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    getProfessorAskSuggestions()
      .then((s) => !cancelled && setSuggestions(s))
      .catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, []);

  const ask = useCallback(
    async (history: ChatMsg[]) => {
      setLoading(true);
      try {
        const reply = await professorChat(history.map((m) => ({ role: m.role, content: m.content })), aiModel);
        setMessages((prev) => [...prev, { id: nextId(), role: 'model', content: reply }]);
      } catch {
        setMessages((prev) => [...prev, { id: nextId(), role: 'model', content: "Sorry — I couldn't answer that just now. Please try again." }]);
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
      opts?.onAsk?.(t);
      const userMsg: ChatMsg = { id: nextId(), role: 'user', content: t };
      const next = [...messages, userMsg];
      setMessages(next);
      setInput('');
      ask(next);
    },
    [loading, messages, ask, opts],
  );

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
    active: messages.length > 0,
    aiModel,
    submit,
    regenerate,
  };
}
