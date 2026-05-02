import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TTSState {
  isSpeaking: boolean;
  isPaused: boolean;
  isLoading: boolean;
}

interface UseTTSReturn extends TTSState {
  speak: (text: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/** Strip markdown syntax so TTS reads clean text */
function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

export function useTTS(): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    } else {
      window.speechSynthesis?.pause();
    }
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
    } else {
      window.speechSynthesis?.resume();
    }
    setIsPaused(false);
  }, []);

  const speak = useCallback(async (rawText: string) => {
    const text = stripMarkdown(rawText);
    if (!text.trim()) return;

    // If already speaking, toggle pause/resume
    if (isSpeaking && !isPaused) {
      pause();
      return;
    }
    if (isPaused) {
      resume();
      return;
    }

    setIsLoading(true);

    try {
      // Try backend high-quality AI voice first
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const res = await fetch(`${API_BASE}/api/ai/tts`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text, voice: "en-US-AvaNeural" })
      });

      if (!res.ok) throw new Error('Backend TTS failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onplay = () => { setIsSpeaking(true); setIsPaused(false); };
      audio.onended = () => { setIsSpeaking(false); setIsPaused(false); audioRef.current = null; };
      audio.onerror = () => { throw new Error('Audio play error'); };

      audioRef.current = audio;
      await audio.play();

    } catch (err) {
      console.warn('Fallback to browser TTS:', err);

      if (!ttsSupported) {
        setIsLoading(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.onstart = () => { setIsSpeaking(true); setIsPaused(false); };
      utterance.onend = () => { setIsSpeaking(false); setIsPaused(false); };
      utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); };

      utteranceRef.current = utterance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } finally {
      setIsLoading(false);
    }
  }, [isSpeaking, isPaused, pause, resume, ttsSupported]);

  return { speak, pause, resume, stop, isSpeaking, isPaused, isLoading };
}
