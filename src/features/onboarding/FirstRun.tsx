import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Dices, Volume2, VolumeX } from 'lucide-react';
import { LanguageToggle } from '@/components/LanguageToggle';
import { LunaHero } from '@/features/avatar/LunaHero';
import { LunaSays } from '@/features/avatar/LunaSays';
import { backLink, whitePill } from '@/features/spaces/components/stage';
import { firstRunExit } from '@/lib/firstRun';
import { useSound } from '@/lib/useSound';
import { cn } from '@/lib/utils';
import { REEL_MS, reel } from './aliases';
import { LIGHTS, lightColor } from './lights';
import { Segments } from './Segments';
import { StagePage } from './StagePage';
import { useLunaSize } from './stageKit';
import { NAME_MAX, useFirstRun } from './useFirstRun';

/**
 * First run (2026-10-24): one room, one Luna, one light you switch on.
 *
 * Two moments, about twenty seconds. Luna asks your name and says it back.
 * Then you pick her light: her helmet ring takes the colour, her halo and the
 * room's light follow, and the progress lights relight in it. When you keep
 * it, the page fades to black and v4 Home fades in already lit in that colour,
 * greeting you by the name you just typed.
 *
 * Luna sits outside the moments' AnimatePresence so she never remounts; only
 * the words and the controls beneath her change.
 *
 * "Pick one for me" rolls a friendly alias for anyone who would rather not
 * give their real name; she tries the whole alias out, not its first word.
 */

type Bubble = { kind: 'ask' | 'hi'; name: string } | { kind: 'suits' } | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const ASK_PAUSE_MS = 450;
const HI_MS = 700;
const FADE_MS = 400;

export function FirstRun({ v4First }: { v4First: boolean }) {
  const { t } = useTranslation(['onboarding', 'avatar']);
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const sound = useSound();
  const lunaSize = useLunaSize(230, 300);
  const { initialName, loadout, saveName, finish } = useFirstRun(v4First);

  const [step, setStep] = useState<0 | 1>(0);
  const [name, setName] = useState(initialName);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // The alias the last roll landed on; while it is what the field holds,
  // Luna says all of it ("Quiet Comet?"), not just "Quiet".
  const [rolled, setRolled] = useState<string | null>(null);
  const spin = useRef<number[]>([]);

  // Luna.
  const [focused, setFocused] = useState(false);
  const [keys, setKeys] = useState(0);
  const [cheer, setCheer] = useState(0);
  const [bubble, setBubble] = useState<Bubble>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const stopSpin = () => {
    spin.current.forEach(window.clearTimeout);
    spin.current = [];
  };
  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      stopSpin();
    },
    [],
  );

  const light = LIGHTS[pick];
  const accent = step === 1 ? lightColor(light) : null;
  const firstName = rolled && name === rolled ? rolled : (name.trim().split(/\s+/)[0] ?? '');

  const { play } = sound;
  useEffect(() => {
    play('boot');
  }, [play]);

  // A pause in typing: she tries the name out.
  useEffect(() => {
    if (step !== 0 || !firstName || bubble?.kind === 'hi') return;
    const id = window.setTimeout(() => setBubble({ kind: 'ask', name: firstName }), ASK_PAUSE_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, step]);

  const onName = (value: string) => {
    stopSpin();
    setName(value.slice(0, NAME_MAX));
    setKeys((k) => k + 1);
    setError(null);
    if (bubble?.kind === 'ask') setBubble(null);
  };

  const roll = () => {
    stopSpin();
    const aliases = t('firstRun.name.aliases', { returnObjects: true }) as unknown as string[];
    const frames = reel(aliases, name);
    const landed = frames[frames.length - 1];
    setError(null);
    if (bubble?.kind === 'ask') setBubble(null);
    const land = () => {
      setName(landed);
      setRolled(landed);
      // The same nudge as a keystroke: she looks, then tries it out.
      setKeys((k) => k + 1);
      play('select');
    };
    if (reduce) return land();
    let at = 0;
    frames.slice(0, -1).forEach((frame, i) => {
      at += REEL_MS[i];
      spin.current.push(window.setTimeout(() => setName(frame), at));
    });
    spin.current.push(window.setTimeout(land, at + REEL_MS[REEL_MS.length - 1]));
  };

  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    stopSpin();
    setBusy(true);
    setError(null);
    try {
      await saveName(name);
      setCheer((c) => c + 1);
      setBubble({ kind: 'hi', name: firstName });
      play('advance');
      later(
        () => {
          setStep(1);
          setBubble(null);
          setBusy(false);
        },
        reduce ? 0 : HI_MS,
      );
    } catch {
      setError(t('firstRun.error.save'));
      setBusy(false);
    }
  };

  const choose = (index: number) => {
    if (index === pick) return;
    setPick(index);
    setCheer((c) => c + 1);
    setBubble({ kind: 'suits' });
    play('select');
  };

  const onLightsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (move) {
      e.preventDefault();
      const next = (pick + move + LIGHTS.length) % LIGHTS.length;
      choose(next);
      radios.current[next]?.focus();
    }
  };

  // 1–4 pick a light directly, wherever focus is on that moment.
  useEffect(() => {
    if (step !== 1) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= LIGHTS.length) choose(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pick]);

  const keep = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await finish(light);
      play('complete');
      setLeaving(true);
      later(() => navigate(firstRunExit(v4First), { replace: true }), reduce ? 0 : FADE_MS);
    } catch {
      setError(t('firstRun.error.save'));
      setBusy(false);
    }
  };

  const said =
    bubble?.kind === 'ask'
      ? t('firstRun.name.ask', { name: bubble.name })
      : bubble?.kind === 'hi'
        ? t('firstRun.name.hi', { name: bubble.name })
        : bubble?.kind === 'suits'
          ? t('firstRun.light.bubble')
          : null;

  const soundToggle = (
    <button
      type="button"
      onClick={sound.toggle}
      aria-label={sound.enabled ? t('sound.muteAria') : t('sound.unmuteAria')}
      title={sound.enabled ? t('sound.onTitle') : t('sound.offTitle')}
      className="console-focusable flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition-colors hover:text-white"
    >
      {sound.enabled ? <Volume2 aria-hidden className="h-[18px] w-[18px]" /> : <VolumeX aria-hidden className="h-[18px] w-[18px]" />}
    </button>
  );

  return (
    <StagePage
      accent={accent}
      topRight={
        <>
          {soundToggle}
          <LanguageToggle variant="icon-dark" />
        </>
      }
      className="pt-20"
    >
      <Segments
        total={2}
        current={step}
        label={t('firstRun.progress.label')}
        valueText={step === 0 ? t('firstRun.progress.name') : t('firstRun.progress.light')}
        accent={accent}
      />

      <div className="relative mt-6">
        <LunaHero
          size={lunaSize}
          loadout={{ ...loadout, visor: step === 1 ? light.visor : loadout.visor }}
          accent={accent}
          attention={step === 0 && focused ? 'listening' : 'idle'}
          nudge={keys}
          cheer={cheer}
        />
        <div aria-live="polite">
          <AnimatePresence mode="wait">
            {said && (
              <LunaSays key={said} side="right" className="left-[calc(100%-18px)] top-[16%]">
                {said}
              </LunaSays>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {step === 0 ? (
          <motion.form
            key="name"
            onSubmit={submitName}
            className="mt-4 flex w-full flex-col items-center text-center"
            initial={reduce ? false : { opacity: 0, filter: 'blur(10px)', scale: 0.985 }}
            animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
            exit={{ opacity: 0, filter: 'blur(10px)', scale: 0.985 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <h1 className="text-[36px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">
              {t('firstRun.name.title')}
            </h1>
            <label htmlFor="first-run-name" className="sr-only">
              {t('firstRun.name.label')}
            </label>
            <input
              id="first-run-name"
              autoFocus
              autoComplete="given-name"
              maxLength={NAME_MAX}
              value={name}
              placeholder={t('firstRun.name.placeholder')}
              onChange={(e) => onName(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-invalid={!!error}
              className="mt-8 w-full max-w-[320px] border-0 border-b border-white/20 bg-transparent pb-2 text-center text-[22px] font-medium tracking-[-0.01em] text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/70"
            />
            <button type="button" onClick={roll} disabled={busy} className={cn(backLink, 'ml-0 mt-3')}>
              <Dices aria-hidden className="h-4 w-4" />
              {t('firstRun.name.roll')}
            </button>
            <button type="submit" disabled={!name.trim() || busy} className={cn(whitePill, 'mt-6 min-w-[180px]')}>
              {t('firstRun.name.continue')}
            </button>
          </motion.form>
        ) : (
          <motion.form
            key="light"
            onSubmit={keep}
            className="mt-4 flex w-full flex-col items-center text-center"
            initial={reduce ? false : { opacity: 0, filter: 'blur(10px)', scale: 0.985 }}
            animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
            exit={{ opacity: 0, filter: 'blur(10px)', scale: 0.985 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <h1 className="text-[36px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">
              {t('firstRun.light.title')}
            </h1>
            <div
              role="radiogroup"
              aria-label={t('firstRun.light.group')}
              onKeyDown={onLightsKey}
              className="mt-8 flex items-center gap-3.5"
            >
              {LIGHTS.map((l, i) => {
                const on = i === pick;
                const color = lightColor(l);
                return (
                  <button
                    key={l.visor}
                    ref={(el) => (radios.current[i] = el)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={t(`avatar:items.${l.visor}`)}
                    tabIndex={on ? 0 : -1}
                    onClick={() => choose(i)}
                    className="console-focusable relative flex h-14 w-14 items-center justify-center rounded-full sm:h-16 sm:w-16"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full transition-[box-shadow,opacity] duration-500"
                      style={{
                        boxShadow: on ? `0 0 0 2px #000, 0 0 0 4px ${color}, 0 0 28px 2px ${color}` : 'none',
                        opacity: on ? 1 : 0,
                      }}
                    />
                    <motion.span
                      aria-hidden
                      className="h-full w-full rounded-full"
                      style={{
                        background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 55%, white), ${color} 62%)`,
                      }}
                      animate={{ scale: on ? 1 : 0.78, opacity: on ? 1 : 0.7 }}
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 22 }}
                    />
                  </button>
                );
              })}
            </div>
            <button type="submit" disabled={busy} className={cn(whitePill, 'mt-10 min-w-[180px]')}>
              {t('firstRun.light.continue')}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(0);
                setBubble(null);
                setError(null);
              }}
              disabled={busy}
              className={cn(backLink, 'ml-0 mt-4')}
            >
              {t('firstRun.back')}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {error && (
        <p role="alert" className="mt-5 text-center text-[13.5px] text-rose-300">
          {error}
        </p>
      )}

      {/* The hand-off: the room goes dark, and Home comes up in the same light. */}
      <AnimatePresence>
        {leaving && (
          <motion.div
            aria-hidden
            className="fixed inset-0 z-50 bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: FADE_MS / 1000, ease: 'easeIn' }}
          />
        )}
      </AnimatePresence>
    </StagePage>
  );
}
