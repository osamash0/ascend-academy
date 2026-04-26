import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GraduationCap, BookOpen, User, Mail, Lock, ArrowRight, Sparkles, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const authSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type UserRole = 'student' | 'professor';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('student');
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [privacyConsent, setPrivacyConsent] = useState(false);

  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

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

    // Require privacy consent for signup
    if (!isLogin && !privacyConsent) {
      toast({ title: 'Privacy consent required', description: 'Please agree to the Datenschutzerklärung.', variant: 'destructive' });
      setLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: 'Login failed',
            description: error.message === 'Invalid login credentials'
              ? 'Invalid email or password. Please try again.'
              : error.message,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Welcome back!',
            description: 'Successfully logged in.',
          });
          navigate('/dashboard');
        }
      } else {
        const { error } = await signUp(email, password, selectedRole);
        if (error) {
          toast({
            title: 'Sign up failed',
            description: error.message.includes('already registered')
              ? 'This email is already registered. Please log in instead.'
              : error.message,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Account created!',
            description: 'Welcome to Ascend Academy. Let\'s start learning!',
          });
          navigate('/dashboard');
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setErrors({ email: 'Please enter your email address first.' });
      return;
    }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({
        title: 'Password reset email sent!',
        description: 'Check your inbox for a link to reset your password.',
      });
    } catch (error: any) {
      toast({
        title: 'Failed to send reset email',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex relative overflow-hidden">
      {/* Animated Background for Auth */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/5 blur-[120px] animate-pulse delay-700" />
      </div>

      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-5/12 p-12 flex-col justify-between relative z-10">
        <div className="glass-panel h-full w-full rounded-[48px] border-white/5 p-16 flex flex-col justify-between overflow-hidden relative group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-50" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-16 cursor-pointer" onClick={() => navigate('/')}>
              <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-glow-primary">
                <GraduationCap className="w-7 h-7 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-foreground">Ascend</span>
                <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] leading-none">v2.0 Orbital</span>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="text-5xl lg:text-6xl font-bold text-foreground mb-8 leading-[1.1] tracking-tight">
                Cognitive<br />
                Mastery Starts<br />
                <span className="text-primary">Here.</span>
              </h1>

              <p className="text-xl text-muted-foreground max-w-md font-medium leading-relaxed">
                Initiate your orbital mission. Synchronize with AI-driven summaries and climb the global leaderboard.
              </p>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="relative z-10"
          >
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: '🧠', label: 'Neural Sync', color: 'primary' },
                { icon: '⚡', label: 'XP Protocol', color: 'xp' },
              ].map((feature, i) => (
                <div
                  key={feature.label}
                  className="glass-panel-strong border-white/10 rounded-[24px] p-6 flex flex-col items-center text-center group hover:border-primary/50 transition-all duration-300"
                >
                  <span className="text-3xl mb-3 block group-hover:scale-110 transition-transform">{feature.icon}</span>
                  <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                    {feature.label}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right side - Auth form */}
      <div className="w-full lg:w-7/12 flex items-center justify-center p-6 lg:p-24 relative z-10">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-4 mb-12 justify-center" onClick={() => navigate('/')}>
            <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-glow-primary">
              <GraduationCap className="w-7 h-7 text-white" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xl font-bold text-foreground">Ascend Academy</span>
              <span className="text-[8px] font-bold text-primary uppercase tracking-widest">v2.0 Orbital</span>
            </div>
          </div>

          <div className="space-y-2 mb-10">
            <h2 className="text-4xl font-bold text-foreground tracking-tight">
              {isLogin ? 'Initiate Session' : 'Enlist Operator'}
            </h2>
            <p className="text-muted-foreground font-medium">
              {isLogin
                ? 'Synchronize credentials to access your terminal'
                : 'Join the next generation of cognitive explorers'}
            </p>
          </div>

          {/* Role selector (signup only) */}
          {!isLogin && (
            <div className="mb-8">
              <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4 block">Designation</Label>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { role: 'student' as UserRole, icon: BookOpen, label: 'Student' },
                  { role: 'professor' as UserRole, icon: User, label: 'Professor' },
                ].map(({ role, icon: Icon, label }) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSelectedRole(role)}
                    className={`p-6 rounded-2xl border transition-all duration-300 flex flex-col items-center gap-3 ${selectedRole === role
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
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Email Identity</Label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="email"
                  type="email"
                  placeholder="operator@orbital.network"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={`h-14 pl-12 text-black bg-white border-white/5 focus:border-primary/50 rounded-2xl transition-all ${errors.email ? 'border-destructive' : ''}`}
                />
              </div>
              {errors.email && (
                <p className="text-xs font-bold text-destructive uppercase tracking-widest mt-1">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Access Key</Label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={forgotLoading}
                    className="text-[10px] font-bold text-muted-foreground hover:text-primary transition-colors uppercase tracking-widest"
                  >
                    {forgotLoading ? 'Resetting...' : 'Lost Access?'}
                  </button>
                )}
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  className={`h-14 pl-12 pr-12 text-black bg-white border-white/5 focus:border-primary/50 rounded-2xl transition-all ${errors.password ? 'border-destructive' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
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
                  Synchronizing...
                </span>
              ) : (
                <>
                  {isLogin ? 'Initiate Session' : 'Authorize Enlistment'}
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
                  I acknowledge the <a href="/datenschutz" target="_blank" className="text-primary font-bold hover:underline">Orbital Privacy Protocol</a> and consent to data synchronization.
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
                  New to the Academy? <span className="text-primary group-hover:underline">Join the Mission</span>
                </>
              ) : (
                <>
                  Existing Operator? <span className="text-primary group-hover:underline">Initiate Session</span>
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
              {isLogin
                ? 'Your cognitive profile is ready for synchronization.'
                : 'Enlistment grants access to neural metrics and global status.'}
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
