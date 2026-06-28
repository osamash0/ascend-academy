import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { LanguageToggle } from '@/components/LanguageToggle';

type Status = 'verifying' | 'ready' | 'invalid' | 'done';

/**
 * Password reset landing page. Supabase's recovery email links here
 * (resetPasswordForEmail redirectTo = origin/reset-password). The client has
 * detectSessionInUrl enabled (default), so the recovery token in the URL hash
 * establishes a short-lived session and fires a PASSWORD_RECOVERY event; only
 * then can updateUser({ password }) succeed. This route is intentionally NOT
 * wrapped in PublicRoute — that guard would bounce the recovery session to the
 * dashboard before the user can set a new password.
 */
export default function ResetPassword() {
  const { t } = useTranslation(['auth']);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [status, setStatus] = useState<Status>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wait for the recovery session: subscribe to PASSWORD_RECOVERY and also poll
  // getSession() in case the URL hash was processed before this mounted. If no
  // session materializes shortly, treat the link as invalid/expired.
  useEffect(() => {
    let settled = false;
    const markReady = () => {
      if (!settled) {
        settled = true;
        setStatus('ready');
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) markReady();
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });

    const timer = setTimeout(() => {
      if (!settled) setStatus('invalid');
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const validate = (): string | null => {
    if (password.length < 6) {
      return t('resetPassword.errorTooShort', { defaultValue: 'Password must be at least 6 characters.' });
    }
    if (password !== confirm) {
      return t('resetPassword.errorMismatch', { defaultValue: 'Passwords do not match.' });
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        toast({
          variant: 'destructive',
          title: t('resetPassword.failedTitle', { defaultValue: 'Could not reset password' }),
          description: updateError.message,
        });
        return;
      }
      setStatus('done');
      // End the recovery session so the user logs in fresh with the new password.
      await supabase.auth.signOut();
      toast({
        title: t('resetPassword.successTitle', { defaultValue: 'Password updated' }),
        description: t('resetPassword.successDesc', { defaultValue: 'You can now sign in with your new password.' }),
      });
      setTimeout(() => navigate('/auth'), 1500);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t('resetPassword.failedTitle', { defaultValue: 'Could not reset password' }),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4">
        <LanguageToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md depth-card p-8 space-y-6"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold">
            {t('resetPassword.title', { defaultValue: 'Set a new password' })}
          </h1>
        </div>

        {status === 'verifying' && (
          <p className="text-sm text-muted-foreground">
            {t('resetPassword.verifying', { defaultValue: 'Verifying your reset link…' })}
          </p>
        )}

        {status === 'invalid' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <p>
                {t('resetPassword.invalid', {
                  defaultValue:
                    'This reset link is invalid or has expired. Request a new password reset email from the sign-in page.',
                })}
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => navigate('/auth')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('resetPassword.backToSignIn', { defaultValue: 'Back to sign in' })}
            </Button>
          </div>
        )}

        {status === 'done' && (
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <p>{t('resetPassword.successDesc', { defaultValue: 'Password updated. Redirecting to sign in…' })}</p>
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">
                {t('resetPassword.newPassword', { defaultValue: 'New password' })}
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">
                {t('resetPassword.confirmPassword', { defaultValue: 'Confirm new password' })}
              </Label>
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting || !password || !confirm}>
              {submitting
                ? t('resetPassword.updating', { defaultValue: 'Updating…' })
                : t('resetPassword.submit', { defaultValue: 'Update password' })}
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
