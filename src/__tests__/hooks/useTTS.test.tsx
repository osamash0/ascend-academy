/**
 * Tests for useTTS.
 *
 * The hook has two code paths:
 *   1. Backend TTS fetch (/api/ai/tts) succeeds → plays HTMLAudioElement
 *   2. Backend fails → browser speechSynthesis fallback
 *
 * I/O boundaries:
 *   - fetch (backend /api/ai/tts) → MSW intercepts
 *   - window.speechSynthesis → spied on per test
 *   - HTMLAudioElement → mocked globally
 *   - supabase.auth.getSession → sharedSupabaseMock
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

import { useTTS } from '@/hooks/useTTS';

// ─── Audio element mock ───────────────────────────────────────────────────────
// happy-dom's Audio() doesn't support blob URLs / play(). We replace it with
// a spy that captures lifecycle handlers for us to trigger manually.

class MockAudio {
  src = '';
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn().mockImplementation(() => {
    this.onplay?.();
    return Promise.resolve();
  });
  pause = vi.fn();
  currentTime = 0;
}

let mockAudioInstance: MockAudio;

// ─── speechSynthesis mock ─────────────────────────────────────────────────────

const synthCancel = vi.fn();
const synthSpeak = vi.fn().mockImplementation((utterance: SpeechSynthesisUtterance) => {
  utterance.onstart?.(new Event('start') as SpeechSynthesisEvent);
});
const synthPause = vi.fn();
const synthResume = vi.fn();

const TTS_URL = 'http://api.test/api/ai/tts';

// happy-dom doesn't define SpeechSynthesisUtterance — provide a minimal stub
class MockSpeechSynthesisUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  onstart: ((e: Event) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}
vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);

beforeEach(() => {
  supabaseMock.reset();
  vi.clearAllMocks();
  mockAudioInstance = new MockAudio();

  // Replace Audio constructor
  vi.stubGlobal('Audio', vi.fn().mockImplementation(() => mockAudioInstance));

  // Stub speechSynthesis
  vi.stubGlobal('speechSynthesis', {
    cancel: synthCancel,
    speak: synthSpeak,
    pause: synthPause,
    resume: synthResume,
  });

  // Default: backend TTS returns a blob
  server.use(
    http.post(TTS_URL, () =>
      new HttpResponse(new Uint8Array([0, 1, 2]).buffer, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    ),
  );
});

// ─── stop ─────────────────────────────────────────────────────────────────────

describe('useTTS — stop', () => {
  it('calls speechSynthesis.cancel and resets isSpeaking + isPaused', async () => {
    const { result } = renderHook(() => useTTS());

    act(() => { result.current.stop(); });

    expect(synthCancel).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.isPaused).toBe(false);
  });
});

// ─── pause / resume ───────────────────────────────────────────────────────────

describe('useTTS — pause and resume', () => {
  it('pause sets isPaused = true and calls speechSynthesis.pause (no audio)', () => {
    const { result } = renderHook(() => useTTS());
    act(() => { result.current.pause(); });
    expect(result.current.isPaused).toBe(true);
    expect(synthPause).toHaveBeenCalled();
  });

  it('resume sets isPaused = false and calls speechSynthesis.resume', () => {
    const { result } = renderHook(() => useTTS());
    act(() => { result.current.pause(); });
    act(() => { result.current.resume(); });
    expect(result.current.isPaused).toBe(false);
    expect(synthResume).toHaveBeenCalled();
  });
});

// ─── speak — empty text guard ─────────────────────────────────────────────────

describe('useTTS — speak with empty text', () => {
  it('does not start loading when called with empty string', async () => {
    const { result } = renderHook(() => useTTS());
    await act(async () => { await result.current.speak(''); });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSpeaking).toBe(false);
  });

  it('strips markdown and does not speak whitespace-only text', async () => {
    const { result } = renderHook(() => useTTS());
    // Markdown that strips to empty: "# " header with no words
    await act(async () => { await result.current.speak('# '); });
    expect(result.current.isSpeaking).toBe(false);
  });
});

// ─── speak — backend path ─────────────────────────────────────────────────────

describe('useTTS — speak via backend TTS', () => {
  it('sets isSpeaking=true when audio plays via backend', async () => {
    const { result } = renderHook(() => useTTS());

    await act(async () => { await result.current.speak('Hello, world!'); });

    // audio.play() was called and triggered onplay → isSpeaking
    expect(mockAudioInstance.play).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(true);
  });

  it('isLoading is false after speak resolves', async () => {
    const { result } = renderHook(() => useTTS());
    await act(async () => { await result.current.speak('Some text'); });
    expect(result.current.isLoading).toBe(false);
  });

  it('resets isSpeaking when audio ends', async () => {
    const { result } = renderHook(() => useTTS());
    await act(async () => { await result.current.speak('Hello!'); });
    expect(result.current.isSpeaking).toBe(true);

    // Simulate audio ending
    act(() => { mockAudioInstance.onended?.(); });
    expect(result.current.isSpeaking).toBe(false);
  });
});

// ─── speak — browser speechSynthesis fallback ────────────────────────────────

describe('useTTS — speak via browser speechSynthesis fallback', () => {
  it('falls back to speechSynthesis when backend TTS returns 500', async () => {
    server.use(
      http.post(TTS_URL, () => new HttpResponse('Server Error', { status: 500 })),
    );
    const { result } = renderHook(() => useTTS());

    await act(async () => { await result.current.speak('Fallback text'); });

    expect(synthSpeak).toHaveBeenCalled();
    // synthSpeak mock triggers onstart immediately → isSpeaking = true
    expect(result.current.isSpeaking).toBe(true);
  });

  it('strips markdown before speaking', async () => {
    server.use(
      http.post(TTS_URL, () => new HttpResponse('err', { status: 500 })),
    );
    const { result } = renderHook(() => useTTS());
    const captured: string[] = [];
    synthSpeak.mockImplementation((utt: SpeechSynthesisUtterance) => {
      captured.push(utt.text);
    });

    await act(async () => { await result.current.speak('**Bold** and _italic_'); });

    // Note: stripMarkdown strips **bold** but not _italic_ (underscore syntax).
    // The regex only covers * markers, not _ markers — this documents current behavior.
    expect(captured[0]).toBe('Bold and _italic_');
  });
});
