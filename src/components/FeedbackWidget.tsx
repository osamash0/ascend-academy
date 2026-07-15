import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus, X, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { apiClient } from '@/lib/apiClient';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import { useToast } from '@/hooks/use-toast';

/**
 * Floating per-feature feedback widget.
 *
 * Renders a small badge in the bottom-right corner. Clicking it opens a
 * dialog where the signed-in user can describe what they were doing and
 * leave free-text feedback. The current route is auto-attached so triage
 * can find the surface without playing detective.
 *
 * Hidden on auth/landing routes — those users have no JWT to authorize the
 * POST and we don't want anonymous spam.
 */
interface RouteInfo {
  pageName: string;
  features: string[];
}

const getRouteInfo = (pathname: string): RouteInfo => {
  if (pathname.includes('/study-guide')) {
    return {
      pageName: 'Study Guide Page',
      features: ['Study Guide Content', 'Concepts List', 'Vocabulary & Dictionary Search', 'PDF Study Guide Download']
    };
  }
  if (pathname.includes('/library')) {
    return {
      pageName: 'Course Library',
      features: ['Slide Deck Grid', 'Interactive Quizzes', 'Search Lecture Material']
    };
  }
  if (pathname.startsWith('/courses/')) {
    return {
      pageName: 'Course Main View',
      features: ['Syllabus Information View', 'Lecture Index List', 'Course Chatbot Sidebar']
    };
  }
  if (pathname.startsWith('/lecture/')) {
    return {
      pageName: 'Lecture Viewer',
      features: ['Slide Content Navigation', 'AI Tutor Sidebar', 'Quiz Generator Widget', 'Concept Mind Map View']
    };
  }
  if (pathname.startsWith('/exams/take/')) {
    return {
      pageName: 'Taking Mock Exam',
      features: ['Question Cards', 'Exam Timer Bar', 'Finish Exam Button']
    };
  }
  if (pathname.startsWith('/exams/config/')) {
    return {
      pageName: 'Mock Exam Configuration',
      features: ['Select Question Count', 'Topics Selection Checkbox', 'Generate Exam Button']
    };
  }
  if (pathname.startsWith('/exams/report/')) {
    return {
      pageName: 'Mock Exam Report',
      features: ['Performance Score Chart', 'Questions Review List', 'Detailed Explanation Modal']
    };
  }
  if (pathname.startsWith('/friends/profile/')) {
    return {
      pageName: 'Learner Profile Page',
      features: ['User Activity Stream', 'Shared Courses List', 'Mutual Friends Grid', 'Friend Actions Menu']
    };
  }

  const routesMap: Record<string, RouteInfo> = {
    '/dashboard': {
      pageName: 'Student Dashboard',
      features: ['Activity Feed', 'Course Progress Overview', 'Quick Review Card', 'Daily Streak Tracker']
    },
    '/review': {
      pageName: 'Review Session (Daily Ascent)',
      features: ['Flashcards Deck Carousel', 'Self-Assessment Toggle', 'Finish Session Summary']
    },
    '/materials': {
      pageName: 'My Materials',
      features: ['Private PDF Document Upload', 'Document Index List', 'Private Search Input']
    },
    '/leaderboard': {
      pageName: 'Leaderboard',
      features: ['Global Learner Rankings Table', 'Earned Badges Showcase', 'XP Logs Chart']
    },
    '/settings': {
      pageName: 'Account Settings',
      features: ['Profile Details Form', 'Language Selection Dropdown', 'API Integrations Panel']
    },
    '/professor/dashboard': {
      pageName: 'Professor Dashboard',
      features: ['Manage Courses List', 'Upload Lectures Indicator', 'Lecture Overview List']
    },
    '/professor/analytics': {
      pageName: 'Professor Analytics',
      features: ['Student Performance Analytics', 'Lecture Engagement Chart', 'Advanced Metrics Grid']
    },
    '/professor/analytics/advanced': {
      pageName: 'Advanced Analytics',
      features: ['Per-Metric AI Explanation', 'Detailed Cohort Stats Grid']
    },
    '/professor/upload': {
      pageName: 'Professor Lecture Upload',
      features: ['PDF File Drag & Drop Area', 'AI Parsing Settings Options', 'Slides Splitter Interface']
    },
    '/admin/dashboard': {
      pageName: 'Admin Dashboard',
      features: ['System Resource Logs', 'Database Collections Overview', 'Analytics KPI Tracking']
    }
  };

  return routesMap[pathname] || {
    pageName: pathname,
    features: []
  };
};

const CATEGORIES = [
  { id: 'Idea', label: 'Idea' },
  { id: 'Bug', label: 'Bug' },
  { id: 'Question', label: 'Question' },
  { id: 'Other', label: 'Other' },
];

export function FeedbackWidget() {
  const { user } = useAuth();
  const location = useLocation();
  const { toast } = useToast();
  const gamification = useGamification();

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('Idea');
  const [feature, setFeature] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [justSent, setJustSent] = useState(false);

  // Hide for unauthenticated users and on auth/landing surfaces.
  const path = location.pathname;
  const hidden =
    !user ||
    path === '/' ||
    path === '/auth' ||
    path.startsWith('/impressum') ||
    path.startsWith('/datenschutz');

  const reset = useCallback(() => {
    setMessage('');
    setFeature('');
    setCategory('Idea');
    setJustSent(false);
  }, []);

  const routeInfo = getRouteInfo(path);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    let finalFeature = feature.trim() || `General Page: ${routeInfo.pageName}`;

    if (finalFeature.length > 120) {
      finalFeature = finalFeature.substring(0, 117) + '...';
    }

    setSubmitting(true);
    try {
      await apiClient.post('/api/feedback', {
        feature: finalFeature,
        category: category,
        message: trimmed,
        route: path,
      });
      setJustSent(true);
      // Reward the contribution (idempotent: only the first feedback earns it).
      gamification.awardBadge('Voice Heard');
      toast({ title: 'Thanks for the feedback', description: 'Your note was recorded.' });
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 1200);
    } catch (err: unknown) {
      toast({
        title: 'Could not send feedback',
        description: (err instanceof Error ? err.message : '') || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }, [message, feature, category, routeInfo.pageName, path, toast, reset, gamification]);

  if (hidden) return null;

  return (
    <>
      {/* Floating launcher */}
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        data-testid="feedback-launcher"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-glow-primary px-4 py-3 text-sm font-bold border border-primary/40 hover:opacity-90 transition-opacity"
      >
        <MessageSquarePlus className="w-4 h-4" />
        Feedback
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !submitting && setOpen(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Send feedback"
            >
              <div className="flex items-start justify-between p-5 border-b border-border">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Send feedback</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tell us what worked, what didn't, or what's missing on this screen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !submitting && setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Category Selector Chips */}
                <div className="space-y-1.5 text-left">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Feedback Type</span>
                  <div className="grid grid-cols-4 gap-2 mt-1.5">
                    {CATEGORIES.map((cat) => {
                      const active = category === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategory(cat.id)}
                          disabled={submitting || justSent}
                          className={`py-2 px-1 text-xs font-bold rounded-xl border text-center transition-all ${
                            active
                              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                              : 'bg-muted/50 hover:bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Active Location Display */}
                <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 flex flex-col gap-1 text-left">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active Location</span>
                  <span className="text-sm font-semibold text-foreground">{routeInfo.pageName}</span>
                </div>

                {/* Combobox style input using HTML5 Datalist */}
                <div className="space-y-1.5 text-left">
                  <Label htmlFor="feedback-feature" className="text-xs uppercase tracking-widest text-muted-foreground">
                    Feature / Component (optional)
                  </Label>
                  <Input
                    id="feedback-feature"
                    list="feedback-features-list"
                    value={feature}
                    onChange={(e) => setFeature(e.target.value)}
                    placeholder={routeInfo.features.length > 0 ? "Type or select a component..." : "Type feature name..."}
                    maxLength={120}
                    disabled={submitting || justSent}
                    className="mt-1.5 text-foreground bg-background"
                    autoComplete="off"
                  />
                  {routeInfo.features.length > 0 && (
                    <datalist id="feedback-features-list">
                      {routeInfo.features.map((feat) => (
                        <option key={feat} value={feat} />
                      ))}
                    </datalist>
                  )}
                </div>

                <div className="space-y-1.5 text-left">
                  <Label htmlFor="feedback-message" className="text-xs uppercase tracking-widest text-muted-foreground">
                    Your feedback
                  </Label>
                  <Textarea
                    id="feedback-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What's on your mind?"
                    rows={5}
                    maxLength={4000}
                    disabled={submitting || justSent}
                    className="mt-1.5 resize-none"
                    data-testid="feedback-message"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 text-right">
                    {message.length}/4000
                  </p>
                </div>

                <p className="text-[10px] text-muted-foreground text-left">
                  We attach the page you're on ({path}) so we can find the right surface.
                </p>
              </div>

              <div className="px-5 py-4 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => !submitting && setOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || justSent || message.trim().length === 0}
                  data-testid="feedback-submit"
                >
                  {justSent ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2" /> Sent</>
                  ) : submitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Send</>
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
