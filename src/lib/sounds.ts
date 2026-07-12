/**
 * Utility manager for playing UI sound effects.
 * We use simple audio synthesis for chimes/ticks so we don't need external audio files,
 * or fall back to silent if audio context fails.
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  constructor() {
    // Lazy initialization of AudioContext on first play to respect browser auto-play policies
  }

  private initCtx() {
    if (!this.ctx) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.ctx = new AudioContextClass();
      } catch (e) {
        console.warn("AudioContext not supported", e);
      }
    }
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public toggleMute() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  private playTone(freq: number, type: OscillatorType, duration: number, vol = 0.1, delay = 0) {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + duration);
  }

  public playHover() {
    // Subtle tick
    this.playTone(800, 'sine', 0.1, 0.02);
  }

  public playClick() {
    // Sharp click
    this.playTone(1200, 'sine', 0.1, 0.05);
  }

  public playSuccess() {
    // Nice chime (C E G)
    this.playTone(523.25, 'sine', 0.4, 0.05, 0); // C5
    this.playTone(659.25, 'sine', 0.4, 0.05, 0.1); // E5
    this.playTone(783.99, 'sine', 0.6, 0.05, 0.2); // G5
  }

  public playLevelUp() {
    // Fanfare!
    this.playTone(440, 'triangle', 0.2, 0.08, 0);
    this.playTone(440, 'triangle', 0.2, 0.08, 0.15);
    this.playTone(440, 'triangle', 0.2, 0.08, 0.3);
    this.playTone(554.37, 'triangle', 0.2, 0.08, 0.45);
    this.playTone(659.25, 'triangle', 0.6, 0.1, 0.6);
  }

  public playNudge() {
    // Two rapid plucks
    this.playTone(880, 'sine', 0.2, 0.06, 0);
    this.playTone(880, 'sine', 0.2, 0.06, 0.1);
  }
}

export const soundManager = new SoundManager();

// Global event listener so we can trigger sounds from anywhere without direct imports
if (typeof window !== 'undefined') {
  window.addEventListener('play-sound', ((e: CustomEvent<string>) => {
    switch (e.detail) {
      case 'hover': soundManager.playHover(); break;
      case 'click': soundManager.playClick(); break;
      case 'success': soundManager.playSuccess(); break;
      case 'levelUp': soundManager.playLevelUp(); break;
      case 'nudge': soundManager.playNudge(); break;
      case 'sendNudge': soundManager.playTone(1200, 'sine', 0.1, 0.05); break; // simple pop
    }
  }) as EventListener);
}
