import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
const LunaAstronaut = lazy(() => import('../../learnstation-luna').then(m => ({ default: m.LunaAstronaut })));
import { GraduationCap, BookOpen, User, Mail, Lock, ArrowRight, ArrowLeft, Sparkles, Eye, EyeOff, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { logLearningEvent } from '@/services/studentService';
import { LanguageToggle } from '@/components/LanguageToggle';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type UserRole = 'student' | 'professor';

export default function Auth() {
  const { t } = useTranslation(['auth']);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>('student');
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [privacyConsent, setPrivacyConsent] = useState(false);

  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const authSchema = z.object({
    email: z.string().email(t('auth:validation.invalidEmail')),
    password: z.string().min(6, t('auth:validation.passwordMin')),
  });

  const getLunaMessage = () => {
    if (focusedField === 'email') {
      return "Use your university email for a special student badge!";
    }
    if (focusedField === 'password') {
      return "Make it strong! 8+ characters to keep your notes safe.";
    }
    if (email.length > 0 && password.length >= 6) {
      return `All set! Let's start, click ${isLogin ? 'Sign In' : 'Get Started'}.`;
    }
    return isLogin ? t('auth:branding.lunaIntro') : t('auth:branding.lunaSignupIntro');
  };

  const validateForm = () => {
    try {
      authSchema.parse({ email, password });
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: { email?: string; password?: string } = {};
        error.errors.forEach((err) => {
          if (err.path[0] === 'email') fieldErrors.email = err.message;
          if (err.path[0] === 'password') fieldErrors.password = err.message;
        });
        setErrors(fieldErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setLoading(true);

    if (!isLogin && !privacyConsent) {
      toast({
        title: t('auth:toasts.consentRequiredTitle'),
        description: t('auth:toasts.consentRequiredDescription'),
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: t('auth:toasts.loginFailed'),
            description: error.message === 'Invalid login credentials'
              ? t('auth:toasts.loginInvalid')
              : error.message,
            variant: 'destructive',
          });
        } else {
          toast({
            title: t('auth:toasts.welcomeBack'),
            description: t('auth:toasts.loginSuccess'),
          });

          try {
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (authUser) {
              await logLearningEvent(authUser.id, 'login', {
                timestamp: new Date().toISOString(),
                method: 'email_password',
              });
            }
          } catch (loginEventErr) {
            console.error('Failed to log login event:', loginEventErr);
          }

          // Don't navigate by hand here. PublicRoute (which wraps /auth)
          // redirects by role once the auth context resolves: professor →
          // /professor/dashboard, everyone else → /dashboard. Navigating to a
          // hardcoded '/dashboard' made professors bounce
          // /dashboard → /professor/dashboard through the SAME ConsoleLayout
          // instance, whose AnimatePresence(mode="wait") then wedged on the
          // intermediate <Navigate> child and left the professor dashboard
          // blank until a manual reload.
        }
      } else {
        const { error } = await signUp(email, password, selectedRole);
        if (error) {
          toast({
            title: t('auth:toasts.signupFailed'),
            description: error.message.includes('already registered')
              ? t('auth:toasts.alreadyRegistered')
              : error.message,
            variant: 'destructive',
          });
        } else {
          toast({
            title: t('auth:toasts.accountCreated'),
            description: t('auth:toasts.welcomeMessage'),
          });
          if (selectedRole === 'student') {
            navigate('/onboarding');
          } else {
            navigate('/dashboard');
          }
        }
      }
    } catch {
      toast({
        title: t('auth:toasts.loginFailed'),
        description: t('auth:toasts.genericError'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setErrors({ email: t('auth:validation.missingEmailForReset') });
      return;
    }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({
        title: t('auth:toasts.resetEmailSent'),
        description: t('auth:toasts.resetEmailDescription'),
      });
    } catch (error: unknown) {
      toast({
        title: t('auth:toasts.resetFailed'),
        description: error instanceof Error ? error.message : t('auth:toasts.genericError'),
        variant: 'destructive',
      });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen console-bg flex relative overflow-hidden">
      {/* Top-left Back button */}
      <div className="absolute top-6 left-6 z-20">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="text-muted-foreground hover:text-foreground gap-2 hover:bg-white/5 rounded-xl transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t('auth:backToHome')}</span>
        </Button>
      </div>

      {/* Top-right language toggle */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-4">
        <LanguageToggle variant="icon-dark" />
      </div>

      {/* Animated Background for Auth */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[100px] opacity-40" style={{ transform: 'translateZ(0)' }} />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[100px] opacity-30" style={{ transform: 'translateZ(0)' }} />
      </div>

      {/* Left side: Luna branding (hidden on mobile, visible on lg screens) */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center border-r border-white/5 bg-[#060a14] overflow-hidden z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-violet-500/10 blur-[100px]" />
        
        <div className="relative z-10 flex flex-col items-center">
          <Suspense fallback={<div className="w-64 h-64 animate-pulse rounded-full bg-white/5" />}>
            <LunaAstronaut phase="full" size="xl" animated={true} />
          </Suspense>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-8 text-center max-w-md px-6 w-full flex flex-col items-center"
          >
            {/* Luna's Interactive Chat */}
            <div className="min-h-[120px] w-full flex items-start justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={getLunaMessage()}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.3 }}
                >
                  <p className="text-2xl font-bold text-white leading-relaxed">
                    {getLunaMessage().split('').map((char, i) => (
                      <motion.span
                        key={`${char}-${i}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.05, delay: i * 0.02 }}
                      >
                        {char}
                      </motion.span>
                    ))}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right side: Center Auth form on mobile, Right side on lg */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-24 relative z-10">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md"
        >
          {/* Brand Logo */}
          <div className="flex items-center gap-4 mb-12 justify-center cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-glow-primary">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xl font-bold text-foreground">Learnstation</span>
            </div>
          </div>

          <div className="space-y-2 mb-10">
            <h2 className="text-4xl font-bold text-foreground tracking-tight">
              {isLogin ? t('auth:signIn') : t('auth:signUp')}
            </h2>
            <p className="text-muted-foreground font-medium">
              {isLogin ? t('auth:signInSubtitle') : t('auth:signUpSubtitle')}
            </p>
          </div>

          {/* Role selector (signup only) */}
          {!isLogin && (
            <div className="mb-8">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 block">{t('auth:designation')}</Label>
              <RadioGroup value={selectedRole} onValueChange={(v) => setSelectedRole(v as UserRole)} className="grid grid-cols-2 gap-4">
                {[
                  { role: 'student' as UserRole, icon: BookOpen, label: t('auth:roles.student') },
                  { role: 'professor' as UserRole, icon: User, label: t('auth:roles.professor') },
                ].map(({ role, icon: Icon, label }) => (
                  <div key={role} className="relative">
                    <RadioGroupItem value={role} id={`role-${role}`} className="sr-only" />
                    <Label
                      htmlFor={`role-${role}`}
                      className={`cursor-pointer p-6 rounded-2xl border transition-all duration-300 flex flex-col items-center gap-3 focus-within:ring-2 focus-within:ring-primary focus-within:outline-none ${selectedRole === role
                        ? 'border-primary bg-primary/5 shadow-glow-primary/10'
                        : 'border-white/5 bg-white/2 hover:border-white/10'
                        }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedRole === role ? 'bg-primary text-white' : 'bg-white/5 text-muted-foreground'}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className={`text-xs font-bold uppercase tracking-widest ${selectedRole === role ? 'text-primary' : 'text-muted-foreground'}`}>
                        {label}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('auth:fields.emailLabel')}</Label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder={t('auth:fields.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  autoComplete="username"
                  className={`h-14 pl-12 text-white bg-white/5 placeholder:text-muted-foreground border-white/10 focus:border-primary/50 rounded-2xl transition-all ${errors.email ? 'border-destructive' : ''}`}
                />
              </div>
              {errors.email && (
                <p className="text-xs font-bold text-destructive uppercase tracking-widest mt-1">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('auth:fields.passwordLabel')}</Label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={forgotLoading}
                    className="text-[10px] font-bold text-muted-foreground hover:text-primary transition-colors uppercase tracking-widest"
                  >
                    {forgotLoading ? t('auth:resetting') : t('auth:forgotPassword')}
                  </button>
                )}
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('auth:fields.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  className={`h-14 pl-12 pr-12 text-white bg-white/5 placeholder:text-muted-foreground border-white/10 focus:border-primary/50 rounded-2xl transition-all ${errors.password ? 'border-destructive' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? t('auth:fields.hidePasswordText', { defaultValue: 'Hide input text' }) : t('auth:fields.showPasswordText', { defaultValue: 'Show input text' })}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs font-bold text-destructive uppercase tracking-widest mt-1">{errors.password}</p>
              )}
            </div>

            <Button
              type="submit"
              size="xl"
              className="w-full h-16 bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl shadow-glow-primary border-none text-lg transition-all active:scale-95"
              disabled={loading || (!isLogin && !privacyConsent)}
            >
              {loading ? (
                <span className="flex items-center gap-3">
                  <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('auth:submit.loading')}
                </span>
              ) : (
                <>
                  {isLogin ? t('auth:submit.signIn') : t('auth:submit.signUp')}
                  <ArrowRight className="w-5 h-5 ml-3" />
                </>
              )}
            </Button>

            {!isLogin && (
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={privacyConsent}
                  onChange={(e) => setPrivacyConsent(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/10 bg-white/2 accent-primary transition-all"
                />
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors leading-relaxed">
                  {t('auth:consent.prefix')}
                  <a href="/datenschutz" target="_blank" rel="noreferrer" className="text-primary font-bold hover:underline">
                    {t('auth:consent.linkText')}
                  </a>
                  {t('auth:consent.suffix')}
                </span>
              </label>
            )}
          </form>

          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrors({});
              }}
              className="text-sm font-bold text-muted-foreground hover:text-foreground transition-colors group"
            >
              {isLogin ? (
                <>
                  {t('auth:switch.toSignUpPrefix')}
                  <span className="text-primary group-hover:underline">{t('auth:switch.toSignUpAction')}</span>
                </>
              ) : (
                <>
                  {t('auth:switch.toSignInPrefix')}
                  <span className="text-primary group-hover:underline">{t('auth:switch.toSignInAction')}</span>
                </>
              )}
            </button>
          </div>

          {/* Performance Hint */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-12 p-6 glass-panel border-white/5 rounded-2xl flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-xp/10 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-xp" />
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
              {isLogin ? t('auth:performanceHint.signIn') : t('auth:performanceHint.signUp')}
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
