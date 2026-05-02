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
export function FeedbackWidget() {
  const { user } = useAuth();
  const location = useLocation();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
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
    setJustSent(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await apiClient.post('/api/feedback', {
        feature: feature.trim() || `route:${path}`,
        message: trimmed,
        route: path,
      });
      setJustSent(true);
      toast({ title: 'Thanks for the feedback', description: 'Your note was recorded.' });
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 1200);
    } catch (err: any) {
      toast({
        title: 'Could not send feedback',
        description: err?.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }, [message, feature, path, toast, reset]);

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
                <div>
                  <Label htmlFor="feedback-feature" className="text-xs uppercase tracking-widest text-muted-foreground">
                    Feature (optional)
                  </Label>
                  <Input
                    id="feedback-feature"
                    value={feature}
                    onChange={(e) => setFeature(e.target.value)}
                    placeholder="e.g. quiz, mind map, lecture upload"
                    maxLength={120}
                    disabled={submitting || justSent}
                    className="mt-1.5"
                  />
                </div>

                <div>
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

                <p className="text-[10px] text-muted-foreground">
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
