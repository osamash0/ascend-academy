import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Play, Pause, RotateCcw, Coffee, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

type TimerMode = 'focus' | 'shortBreak' | 'longBreak';

interface ModeConfig {
  label: string;
  durationMinutes: number;
  color: string;
  gradient: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STORAGE_KEY = 'ascend_pomodoro_persistent_state';

function getPersistentState() {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val) {
      const parsed = JSON.parse(val);
      const now = Date.now();
      if (parsed.isRunning && parsed.targetEndTime) {
        const remaining = Math.round((parsed.targetEndTime - now) / 1000);
        if (remaining > 0) {
          return {
            mode: parsed.mode || 'focus',
            timeLeft: remaining,
            isRunning: true,
            completedSessions: parsed.completedSessions || 0,
            targetEndTime: parsed.targetEndTime,
          };
        }
      }
      return {
        mode: parsed.mode || 'focus',
        timeLeft: parsed.timeLeft || 25 * 60,
        isRunning: false,
        completedSessions: parsed.completedSessions || 0,
        targetEndTime: null,
      };
    }
  } catch (e) {
    // Ignore persistent state reading/parsing errors
  }
  return null;
}

function savePersistentState(state: {
  mode: TimerMode;
  timeLeft: number;
  isRunning: boolean;
  completedSessions: number;
  targetEndTime: number | null;
}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Ignore persistent state save failures (e.g. quota exceeded)
  }
}

function TomatoIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      {/* Tomato body */}
      <path 
        d="M12 22C17.5228 22 22 18.5 22 13C22 7.5 17.5228 5 12 5C6.47715 5 2 7.5 2 13C2 18.5 6.47715 22 12 22Z" 
        fill="currentColor" 
        className="text-rose-500"
      />
      {/* Leaves */}
      <path 
        d="M12 5C10.5 2.5 8 2 8 2C10.5 3.5 11.2 4.5 11.5 5C11.8 4.5 12.5 3.5 15 2C15 2 12.5 2.5 12 5Z" 
        fill="currentColor" 
        className="text-emerald-500"
      />
      <path 
        d="M11.5 5C9.5 4.5 6.5 3.5 5 3.5C6.5 4.5 9.5 5.2 11.5 5.5Z" 
        fill="currentColor" 
        className="text-emerald-500"
      />
      <path 
        d="M12.5 5C14.5 4.5 17.5 3.5 19 3.5C17.5 4.5 14.5 5.2 12.5 5.5Z" 
        fill="currentColor" 
        className="text-emerald-500"
      />
      {/* Soft gloss highlight */}
      <ellipse cx="7" cy="10" rx="1.5" ry="3" fill="white" opacity="0.35" transform="rotate(-25 7 10)" />
    </svg>
  );
}

export function PomodoroTimer() {
  const { t } = useTranslation(['common']);
  
  // Custom durations (in minutes)
  const [durations, setDurations] = useState<Record<TimerMode, number>>({
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
  });

  const initialState = getPersistentState();

  const [mode, setMode] = useState<TimerMode>(initialState?.mode || 'focus');
  const [timeLeft, setTimeLeft] = useState<number>(initialState?.timeLeft || 25 * 60);
  const [isRunning, setIsRunning] = useState<boolean>(initialState?.isRunning || false);
  const [targetEndTime, setTargetEndTime] = useState<number | null>(initialState?.targetEndTime || null);
  const [completedSessions, setCompletedSessions] = useState<number>(initialState?.completedSessions || 0);

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const popoverRef = useRef<HTMLDivElement>(null);

  const modes: Record<TimerMode, ModeConfig> = {
    focus: {
      label: 'Focus',
      durationMinutes: durations.focus,
      color: 'hsl(340 82% 52%)',
      gradient: 'from-pink-500 to-rose-500',
      icon: Sparkles,
    },
    shortBreak: {
      label: 'Short Break',
      durationMinutes: durations.shortBreak,
      color: 'hsl(160 84% 39%)',
      gradient: 'from-emerald-400 to-teal-500',
      icon: Coffee,
    },
    longBreak: {
      label: 'Long Break',
      durationMinutes: durations.longBreak,
      color: 'hsl(210 90% 50%)',
      gradient: 'from-blue-400 to-indigo-500',
      icon: Coffee,
    },
  };

  const currentModeConfig = modes[mode];

  // Sync state changes back to persistent storage
  useEffect(() => {
    savePersistentState({
      mode,
      timeLeft,
      isRunning,
      completedSessions,
      targetEndTime,
    });
  }, [mode, timeLeft, isRunning, completedSessions, targetEndTime]);

  // Synchronize component when durations update while idle
  useEffect(() => {
    if (!isRunning) {
      setTimeLeft(durations[mode] * 60);
    }
  }, [mode, durations]);

  // Play synthesized notification chime
  const playNotificationSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      // Ignore audio synthesis errors on blocked/unsupported browsers
    }
  }, [soundEnabled]);

  // High-precision clock check computing difference from targetEndTime directly
  useEffect(() => {
    let interval: number | undefined = undefined;
    if (isRunning && targetEndTime) {
      interval = window.setInterval(() => {
        const now = Date.now();
        const rem = Math.round((targetEndTime - now) / 1000);
        if (rem <= 0) {
          setTimeLeft(0);
        } else {
          setTimeLeft(rem);
        }
      }, 500);
    }
    return () => {
      if (interval !== undefined) {
        clearInterval(interval);
      }
    };
  }, [isRunning, targetEndTime]);

  // Handle countdown boundary reaching zero
  useEffect(() => {
    if (isRunning && timeLeft === 0) {
      setIsRunning(false);
      setTargetEndTime(null);
      playNotificationSound();
      
      // Advance stage logic
      if (mode === 'focus') {
        const nextSessions = completedSessions + 1;
        setCompletedSessions(nextSessions);
        if (nextSessions % 4 === 0) {
          setMode('longBreak');
          setTimeLeft(durations.longBreak * 60);
        } else {
          setMode('shortBreak');
          setTimeLeft(durations.shortBreak * 60);
        }
      } else {
        setMode('focus');
        setTimeLeft(durations.focus * 60);
      }
    }
  }, [isRunning, timeLeft, mode, completedSessions, durations, playNotificationSound]);

  // Listen to external page updates/mounts to automatically sync live timers cross-tab/layout
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          const now = Date.now();
          if (parsed.isRunning && parsed.targetEndTime) {
            const rem = Math.round((parsed.targetEndTime - now) / 1000);
            if (rem > 0) {
              setMode(parsed.mode || 'focus');
              setTimeLeft(rem);
              setIsRunning(true);
              setTargetEndTime(parsed.targetEndTime);
              setCompletedSessions(parsed.completedSessions || 0);
              return;
            }
          }
          // Idle state sync
          setMode(parsed.mode || 'focus');
          setTimeLeft(parsed.timeLeft || 25 * 60);
          setIsRunning(false);
          setTargetEndTime(null);
          setCompletedSessions(parsed.completedSessions || 0);
        } catch (err) {
          // Ignore parse errors from external tab updates
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Click outside auto-close popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const totalSeconds = currentModeConfig.durationMinutes * 60;
  const progressPct = ((totalSeconds - timeLeft) / totalSeconds) * 100;

  const toggleTimer = () => {
    if (!isRunning) {
      const end = Date.now() + timeLeft * 1000;
      setTargetEndTime(end);
      setIsRunning(true);
    } else {
      setTargetEndTime(null);
      setIsRunning(false);
    }
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTargetEndTime(null);
    const defaultDuration = durations[mode] * 60;
    setTimeLeft(defaultDuration);
  };

  const handleModeChange = (newMode: TimerMode) => {
    setIsRunning(false);
    setTargetEndTime(null);
    setMode(newMode);
    setTimeLeft(durations[newMode] * 60);
  };

  return (
    <div className={`relative inline-block ${isOpen ? 'z-50' : ''}`} ref={popoverRef}>
      {/* compact Trigger Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-300 backdrop-blur-md ${
          isRunning 
            ? 'bg-primary/10 border-primary/30 text-primary shadow-glow-primary/20' 
            : 'bg-surface-2 border-border/40 text-muted-foreground hover:text-foreground'
        }`}
        aria-label="Pomodoro Timer"
      >
        <div className="relative flex items-center justify-center">
          <Timer className={`w-3.5 h-3.5 ${isRunning ? 'animate-pulse text-primary' : ''}`} />
          {isRunning && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <span className="text-xs font-bold tracking-wider font-mono">
          {formatTime(timeLeft)}
        </span>
      </motion.button>

      {/* Stunning Glassmorphism Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute right-0 top-full mt-2 w-72 glass-panel-strong border border-white/10 rounded-2xl shadow-2xl p-5 z-50 backdrop-blur-xl overflow-hidden"
          >
            {/* Background dynamic glow */}
            <div 
              className={`absolute -top-24 -right-24 w-48 h-48 rounded-full bg-gradient-to-br ${currentModeConfig.gradient} opacity-10 blur-3xl pointer-events-none transition-all duration-700`} 
            />

            {/* Header / Sound Toggle */}
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <TomatoIcon className="w-4 h-4" />
                <span>Pomodoro</span>
              </div>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-white/5"
                title={soundEnabled ? 'Disable Audio' : 'Enable Audio'}
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Mode Selector Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-surface-2 rounded-xl mb-5">
              {(['focus', 'shortBreak', 'longBreak'] as TimerMode[]).map((m) => {
                const config = modes[m];
                const isActive = mode === m;
                return (
                  <button
                    key={m}
                    onClick={() => handleModeChange(m)}
                    className={`relative py-1.5 rounded-lg text-[10px] font-bold transition-all duration-300 z-10 ${
                      isActive ? 'text-white shadow-md' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activePomodoroMode"
                        className={`absolute inset-0 rounded-lg bg-gradient-to-r ${config.gradient}`}
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span className="relative z-10 block truncate px-1">{config.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Beautiful Circular/Pill Progress & Timer Display */}
            <div className="flex flex-col items-center justify-center py-4 relative">
              {/* Subtle background track */}
              <div className="w-48 h-2 bg-surface-2 rounded-full overflow-hidden absolute top-0">
                <motion.div 
                  className={`h-full bg-gradient-to-r ${currentModeConfig.gradient}`}
                  style={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>

              <motion.div 
                key={mode}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-4xl font-extrabold tracking-tighter font-mono my-2 text-foreground select-none bg-clip-text"
              >
                {formatTime(timeLeft)}
              </motion.div>

              <div className="flex items-center gap-1.5 mt-1 text-[11px] font-bold text-muted-foreground">
                <span>{currentModeConfig.label}</span>
                <span>•</span>
                <span>Session #{completedSessions + 1}</span>
              </div>
            </div>

            {/* Control Actions */}
            <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-white/5">
              <Button
                variant="ghost"
                size="icon"
                onClick={resetTimer}
                className="w-9 h-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5"
                title="Reset Timer"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>

              <Button
                onClick={toggleTimer}
                className={`flex-1 gap-2 rounded-xl h-10 font-bold shadow-lg transition-all duration-300 border-none ${
                  isRunning
                    ? 'bg-surface-2 hover:bg-surface-2/80 text-foreground'
                    : `bg-gradient-to-r ${currentModeConfig.gradient} text-white hover:opacity-90`
                }`}
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4 fill-current" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Start</span>
                  </>
                )}
              </Button>
            </div>

            {/* Custom durations quick tweak */}
            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Duration:</span>
              <div className="flex items-center gap-2 font-bold">
                <button 
                  onClick={() => {
                    const next = Math.max(1, durations[mode] - 1);
                    setDurations(prev => ({ ...prev, [mode]: next }));
                    if (!isRunning) {
                      setTimeLeft(next * 60);
                    } else if (targetEndTime) {
                      setTargetEndTime(targetEndTime - 60 * 1000);
                    }
                  }}
                  className="hover:text-foreground px-1 py-0.5 rounded bg-surface-2"
                >
                  -
                </button>
                <span>{durations[mode]}m</span>
                <button 
                  onClick={() => {
                    const next = Math.min(60, durations[mode] + 1);
                    setDurations(prev => ({ ...prev, [mode]: next }));
                    if (!isRunning) {
                      setTimeLeft(next * 60);
                    } else if (targetEndTime) {
                      setTargetEndTime(targetEndTime + 60 * 1000);
                    }
                  }}
                  className="hover:text-foreground px-1 py-0.5 rounded bg-surface-2"
                >
                  +
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
