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
            description: 'Welcome to Learnstation. Let\'s start learning!',
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
    <div className="min-h-screen bg-background flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-hero p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-20 w-64 h-64 bg-primary-foreground/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-primary-foreground/10 rounded-full blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="relative z-10"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-primary-foreground/20 rounded-xl flex items-center justify-center">
              <GraduationCap className="w-7 h-7 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold text-primary-foreground">Learnstation</span>
          </div>

          <h1 className="text-4xl lg:text-5xl font-bold text-primary-foreground mb-6 leading-tight">
            Learn smarter,<br />
            not harder.
          </h1>

          <p className="text-xl text-primary-foreground/80 max-w-md">
            Transform your lectures into interactive quizzes. Track progress, earn XP, and level up your learning.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="relative z-10"
        >
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: '📚', label: 'Smart Slides' },
              { icon: '🎯', label: 'Auto Quizzes' },
              { icon: '🏆', label: 'Gamification' },
            ].map((feature, i) => (
              <div
                key={feature.label}
                className="bg-primary-foreground/10 backdrop-blur-sm rounded-xl p-4 text-center"
              >
                <span className="text-3xl mb-2 block">{feature.icon}</span>
                <span className="text-sm text-primary-foreground/90 font-medium">
                  {feature.label}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right side - Auth form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">Learnstation</span>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {isLogin ? 'Welcome back' : 'Create an account'}
            </h2>
            <p className="text-muted-foreground">
              {isLogin
                ? 'Enter your credentials to access your dashboard'
                : 'Join thousands of learners on Learnstation'}
            </p>
          </div>

          {/* Role selector (signup only) */}
          {!isLogin && (
            <div className="mb-6">
              <Label className="text-sm font-medium mb-3 block">I am a...</Label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { role: 'student' as UserRole, icon: BookOpen, label: 'Student' },
                  { role: 'professor' as UserRole, icon: User, label: 'Professor' },
                ].map(({ role, icon: Icon, label }) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSelectedRole(role)}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 ${selectedRole === role
                        ? 'border-primary bg-secondary'
                        : 'border-border hover:border-primary/50'
                      }`}
                  >
                    <Icon className={`w-6 h-6 mx-auto mb-2 ${selectedRole === role ? 'text-primary' : 'text-muted-foreground'
                      }`} />
                    <span className={`text-sm font-medium ${selectedRole === role ? 'text-foreground' : 'text-muted-foreground'
                      }`}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={`pl-10 ${errors.email ? 'border-destructive' : ''}`}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={forgotLoading}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    {forgotLoading ? 'Sending...' : 'Forgot password?'}
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  className={`pl-10 pr-10 ${errors.password ? 'border-destructive' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
            </div>

            <Button
              type="submit"
              variant="hero"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {isLogin ? 'Logging in...' : 'Creating account...'}
                </span>
              ) : (
                <>
                  {isLogin ? 'Log in' : 'Create account'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrors({});
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isLogin ? (
                <>
                  Don't have an account?{' '}
                  <span className="text-primary font-medium">Sign up</span>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <span className="text-primary font-medium">Log in</span>
                </>
              )}
            </button>
          </div>

          {/* Features hint */}
          <div className="mt-8 p-4 bg-secondary/50 rounded-xl border border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="w-4 h-4 text-xp" />
              <span>
                {isLogin
                  ? 'Continue your learning streak today!'
                  : 'Earn XP, unlock badges, and level up!'}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
