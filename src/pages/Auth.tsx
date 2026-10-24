import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { logLearningEvent } from '@/services/studentService';
import { recordOnboardingSecondSession } from '@/services/onboardingService';
import { LanguageToggle } from '@/components/LanguageToggle';
import { LunaHero } from '@/features/avatar/LunaHero';
import { LunaSays } from '@/features/avatar/LunaSays';
import { StagePage } from '@/features/onboarding/StagePage';
import { stageInput, useLunaSize } from '@/features/onboarding/stageKit';
import { whitePill, ghostPill } from '@/features/spaces/components/stage';
import { PublicRoutes, StudentRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Sign in and sign up, on the stage (2026-10-24).
 *
 * One page, two modes; `?mode=signup` opens the second, which is where every
 * "Start learning" on the landing points. Everyone signs up as a learner.
 * Luna is here, alive: she looks down at what you type, nods with each key,
 * and hops when you get in. She never comments on a mistake; the page owns
 * those, in one plain sentence under the field.
 */

type Mode = 'signin' | 'signup';
type FieldErrors = { email?: string; password?: string; consent?: string; form?: string };

const EASE = [0.22, 1, 0.36, 1] as const;

export default function Auth() {
  const { t } = useTranslation('auth');
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const lunaSize = useLunaSize(150, 200);
  const ids = useId();

  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  const signingUp = mode === 'signup';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [stage, setStage] = useState<'form' | 'inbox'>('form');
  const [resent, setResent] = useState(false);

  // Luna.
  const [focused, setFocused] = useState(false);
  const [keys, setKeys] = useState(0);
  const [cheer, setCheer] = useState(0);
  const [greeted, setGreeted] = useState(false);
  const [inside, setInside] = useState(false);

  // PublicRoute replaces this page as soon as the new session lands, so a
  // pending hand-off must not fire after it has gone.
  const handOff = useRef<number>();
  useEffect(() => () => window.clearTimeout(handOff.current), []);

  // Sign-up opens with a quiet "Hi." once she has landed. Returning people
  // need no greeting; she looks at them, and winks if they click her.
  useEffect(() => {
    if (!signingUp) return;
    const id = window.setTimeout(() => setGreeted(true), reduce ? 0 : 500);
    return () => window.clearTimeout(id);
  }, [signingUp, reduce]);

  const bubble = inside ? t('luna.inside') : signingUp && greeted && !focused && stage === 'form' ? t('luna.hi') : null;

  const schema = z.object({
    email: z.string().email(t('errors.email')),
    // New passwords need 8 characters (decided 2026-10-24). Sign-in only asks
    // for one, so accounts made under the old 6-character rule still get in.
    password: signingUp ? z.string().min(8, t('errors.password')) : z.string().min(1, t('errors.passwordRequired')),
  });

  const setMode = (next: Mode) => {
    // Touch only `mode`: a shared link's `?next=` must survive the switch.
    const updated = new URLSearchParams(params);
    if (next === 'signup') updated.set('mode', 'signup');
    else updated.delete('mode');
    setParams(updated, { replace: true });
    setErrors({});
    setForgot('idle');
  };

  const type = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setKeys((k) => k + 1);
    if (errors.form) setErrors((e) => ({ ...e, form: undefined }));
  };

  const validate = (): FieldErrors => {
    const parsed = schema.safeParse({ email: email.trim(), password });
    const next: FieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email') next.email ??= issue.message;
        if (issue.path[0] === 'password') next.password ??= issue.message;
      }
    }
    if (signingUp && !consent) next.consent = t('errors.consent');
    return next;
  };

  const signInError = (message: string) => {
    if (/invalid login credentials/i.test(message)) return t('errors.invalid');
    if (/email not confirmed/i.test(message)) return t('errors.unconfirmed');
    if (/deleted/i.test(message)) return t('errors.deleted');
    return t('errors.generic');
  };

  const signUpError = (message: string) => {
    if (/already (registered|exists)/i.test(message)) return t('errors.exists');
    if (/password/i.test(message)) return t('errors.password');
    return t('errors.generic');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    const address = email.trim();
    try {
      if (!signingUp) {
        const { error } = await signIn(address, password);
        if (error) {
          setErrors({ form: signInError(error.message) });
          return;
        }
        setCheer((c) => c + 1);
        // No navigate here: PublicRoute, which wraps this page, sends each
        // person where they belong once the auth context has their role.
        void logSignIn();
        return;
      }

      try {
        sessionStorage.setItem('ascend:account-creation-started', new Date().toISOString());
      } catch {
        // Funnel timing must never block account creation.
      }
      const { error, needsConfirmation } = await signUp(address, password);
      if (error) {
        setErrors({ form: signUpError(error.message) });
        return;
      }
      setCheer((c) => c + 1);
      setInside(true);
      if (needsConfirmation) {
        setStage('inbox');
        return;
      }
      void logAccountCreated();
      handOff.current = window.setTimeout(() => navigate(StudentRoutes.ONBOARDING), reduce ? 0 : 450);
    } catch {
      setErrors({ form: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    const address = email.trim();
    if (!address) {
      setErrors({ email: t('forgot.needEmail') });
      return;
    }
    setForgot('sending');
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}${PublicRoutes.RESET_PASSWORD}`,
    });
    if (error) {
      setForgot('idle');
      setErrors({ form: t('errors.generic') });
      return;
    }
    setForgot('sent');
  };

  const onResend = async () => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (!error) setResent(true);
  };

  const emailError = errors.email ? `${ids}-email-error` : undefined;
  const passwordNote = `${ids}-password-note`;

  return (
    <StagePage home={PublicRoutes.LANDING} homeLabel={t('home')} topRight={<LanguageToggle variant="icon-dark" />}>
      {/* Luna lands once, then stays put while the words beneath her change. */}
      <motion.div
        className="relative"
        initial={reduce ? false : { y: -140, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 170, damping: 16, mass: 0.9 }}
      >
        <LunaHero size={lunaSize} attention={focused ? 'listening' : 'idle'} nudge={keys} cheer={cheer} />
        <div aria-live="polite">
          <AnimatePresence mode="wait">
            {bubble && (
              <LunaSays key={bubble} side="right" className="left-[calc(100%-12px)] top-[14%]">
                {bubble}
              </LunaSays>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <AnimatePresence mode="wait" initial={false}>
        {stage === 'inbox' ? (
          <motion.section
            key="inbox"
            className="mt-6 w-full text-center"
            initial={reduce ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <h1 className="text-[36px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">{t('inbox.title')}</h1>
            <p className="mx-auto mt-4 max-w-[34ch] text-[15.5px] leading-relaxed text-quiet">
              {t('inbox.lede', { email: email.trim() })}
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <button type="button" onClick={onResend} disabled={resent} className={whitePill}>
                {resent ? t('inbox.resent') : t('inbox.resend')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage('form');
                  setInside(false);
                  setResent(false);
                }}
                className={ghostPill}
              >
                {t('inbox.change')}
              </button>
            </div>
          </motion.section>
        ) : (
          <motion.section
            key="form"
            className="mt-6 w-full"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, filter: 'blur(8px)' }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.h1
                key={mode}
                className="text-center text-[36px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                {signingUp ? t('title.signUp') : t('title.signIn')}
              </motion.h1>
            </AnimatePresence>

            <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[13px] text-quiet">
                  {t('fields.email')}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder={t('fields.emailPlaceholder')}
                  value={email}
                  onChange={(e) => type(setEmail)(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  aria-invalid={!!errors.email}
                  aria-describedby={emailError}
                  className={stageInput}
                />
                {errors.email && (
                  <p id={emailError} className="mt-1.5 text-[13px] text-rose-300">
                    {errors.email}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <label htmlFor="password" className="text-[13px] text-quiet">
                    {t('fields.password')}
                  </label>
                  {!signingUp ? (
                    forgot === 'sent' ? (
                      <span className="truncate text-[13px] text-quiet" role="status">
                        {t('forgot.sent', { email: email.trim() })}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={onForgot}
                        disabled={forgot === 'sending'}
                        className="console-focusable rounded text-[13px] text-quiet transition-colors hover:text-white"
                      >
                        {forgot === 'sending' ? t('forgot.sending') : t('forgot.link')}
                      </button>
                    )
                  ) : (
                    !errors.password && (
                      <span id={passwordNote} className="text-[13px] text-faint">
                        {t('fields.passwordHint')}
                      </span>
                    )
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={signingUp ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => type(setPassword)(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    aria-invalid={!!errors.password}
                    aria-describedby={errors.password || signingUp ? passwordNote : undefined}
                    className={cn(stageInput, 'pr-12')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? t('fields.hidePassword') : t('fields.showPassword')}
                    aria-pressed={showPassword}
                    className="console-focusable absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-white/50 transition-colors hover:text-white"
                  >
                    {showPassword ? <EyeOff aria-hidden className="h-[18px] w-[18px]" /> : <Eye aria-hidden className="h-[18px] w-[18px]" />}
                  </button>
                </div>
                {errors.password && (
                  <p id={passwordNote} className="mt-1.5 text-[13px] text-rose-300">
                    {errors.password}
                  </p>
                )}
              </div>

              <AnimatePresence initial={false}>
                {signingUp && (
                  <motion.div
                    key="consent"
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <label className="flex cursor-pointer items-start gap-3 pt-1">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => {
                          setConsent(e.target.checked);
                          if (e.target.checked) setErrors((x) => ({ ...x, consent: undefined }));
                        }}
                        aria-invalid={!!errors.consent}
                        className="mt-[3px] h-4 w-4 shrink-0 rounded accent-white"
                      />
                      <span className="text-[13px] leading-relaxed text-quiet">
                        {t('consent.prefix')}
                        <a
                          href={PublicRoutes.DATENSCHUTZ}
                          target="_blank"
                          rel="noreferrer"
                          className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white"
                        >
                          {t('consent.link')}
                        </a>
                        {t('consent.suffix')}
                      </span>
                    </label>
                    {errors.consent && <p className="mt-1.5 text-[13px] text-rose-300">{errors.consent}</p>}
                  </motion.div>
                )}
              </AnimatePresence>

              <button type="submit" disabled={busy} className={cn(whitePill, 'mt-2 w-full')}>
                {busy ? t('submit.busy') : signingUp ? t('submit.signUp') : t('submit.signIn')}
              </button>

              {errors.form && (
                <p role="alert" className="text-center text-[13.5px] text-rose-300">
                  {errors.form}
                </p>
              )}
            </form>

            <p className="mt-8 text-center text-[13.5px] text-quiet">
              {signingUp ? t('switch.toSignIn.prefix') : t('switch.toSignUp.prefix')}{' '}
              <button
                type="button"
                onClick={() => setMode(signingUp ? 'signin' : 'signup')}
                className="console-focusable rounded font-medium text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
              >
                {signingUp ? t('switch.toSignIn.action') : t('switch.toSignUp.action')}
              </button>
            </p>
          </motion.section>
        )}
      </AnimatePresence>
    </StagePage>
  );
}

/** The funnel's sign-in event. Never blocks or fails the sign-in itself. */
async function logSignIn() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await logLearningEvent(user.id, 'login', { timestamp: new Date().toISOString(), method: 'email_password' });
    void recordOnboardingSecondSession();
  } catch (err) {
    console.error('Failed to log login event:', err);
  }
}

/** The funnel's account-created pair, timed from when the form was sent. */
async function logAccountCreated() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const startedAt = sessionStorage.getItem('ascend:account-creation-started');
    await logLearningEvent(user.id, 'account_creation_started', { method: 'email_password', role: 'student', started_at: startedAt });
    await logLearningEvent(user.id, 'account_created', { method: 'email_password', role: 'student' });
    sessionStorage.removeItem('ascend:account-creation-started');
  } catch (err) {
    console.error('Failed to log account creation events:', err);
  }
}
