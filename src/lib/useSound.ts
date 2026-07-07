/**
 * useSound — tiny WebAudio "console UI" cue layer.
 *
 * No asset files: every cue is synthesised from oscillators at call time, so the
 * bundle stays lean and the sounds inherit a coherent, game-console timbre. The
 * AudioContext is created lazily on first play (browsers keep it suspended until
 * a user gesture, which our clicks satisfy) and shared process-wide.
 *
 * Sound is ON by default to sell the "first boot" feeling, but the preference is
 * persisted and a `<SoundToggle />` lets users mute. Reduced-motion users start
 * muted — heavy motion and audio tend to bother the same people.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type SoundCue = 'advance' | 'back' | 'select' | 'avatar' | 'badge' | 'boot' | 'complete';

const STORAGE_KEY = 'ls.onboarding.sound';

let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One oscillator note with a short exponential decay envelope. */
function note(
  ac: AudioContext,
  freq: number,
  startAt: number,
  dur: number,
  type: OscillatorType,
  gain: number,
) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  env.gain.setValueAtTime(0.0001, startAt);
  env.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

/** Cue → sequence of [freqHz, offsetSec, durSec, type, gain] notes. */
function playCue(ac: AudioContext, cue: SoundCue) {
  const t = ac.currentTime;
  const tri: OscillatorType = 'triangle';
  const sine: OscillatorType = 'sine';
  switch (cue) {
    case 'select':
      note(ac, 660, t, 0.08, tri, 0.05);
      break;
    case 'avatar':
      note(ac, 880, t, 0.1, tri, 0.06);
      note(ac, 1320, t + 0.05, 0.12, sine, 0.04);
      break;
    case 'advance':
      note(ac, 587, t, 0.1, tri, 0.06);
      note(ac, 880, t + 0.07, 0.16, tri, 0.06);
      break;
    case 'back':
      note(ac, 587, t, 0.1, tri, 0.05);
      note(ac, 440, t + 0.07, 0.14, tri, 0.05);
      break;
    case 'badge':
      note(ac, 784, t, 0.14, tri, 0.07);
      note(ac, 988, t + 0.09, 0.14, tri, 0.07);
      note(ac, 1319, t + 0.18, 0.22, sine, 0.06);
      break;
    case 'boot':
      note(ac, 196, t, 0.5, sine, 0.07);
      note(ac, 294, t + 0.18, 0.5, sine, 0.05);
      note(ac, 392, t + 0.36, 0.6, sine, 0.04);
      break;
    case 'complete':
      note(ac, 523, t, 0.16, tri, 0.07);
      note(ac, 659, t + 0.12, 0.16, tri, 0.07);
      note(ac, 784, t + 0.24, 0.16, tri, 0.07);
      note(ac, 1047, t + 0.36, 0.4, sine, 0.07);
      break;
  }
}

function initialEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return stored === '1';
  // Default: on, unless the user prefers reduced motion.
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function useSound() {
  const [enabled, setEnabled] = useState(initialEnabled);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [enabled]);

  const play = useCallback((cue: SoundCue) => {
    if (!enabledRef.current) return;
    const ac = audioCtx();
    if (ac) {
      try {
        playCue(ac, cue);
      } catch {
        /* a denied/closed context should never break the flow */
      }
    }
  }, []);

  const toggle = useCallback(() => setEnabled((e) => !e), []);

  return { play, enabled, toggle };
}
