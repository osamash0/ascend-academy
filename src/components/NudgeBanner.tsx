import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

interface NudgeNotification {
    id: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    created_at: string;
    priority: number | null;
    deep_link: string | null;
}

const NUDGE_TYPES = new Set(['streak', 'assignment', 'review']);

// Fallback used only when an old notification row has no deep_link (the
// nudge engine always writes one, but other producers might not).
const FALLBACK_DEEP_LINK_BY_TYPE: Record<string, string> = {
    streak: '/dashboard',
    assignment: '/assignments',
    review: '/insights',
};

/**
 * Single dismissible banner that surfaces the highest-priority active nudge
 * (i.e. an unread notification of a nudge-engine type). Selection is by
 * priority desc, with created_at desc as tiebreaker, so the engine's
 * computed priority — not insert order — decides what the user sees.
 *
 * On dismiss we POST to the API so the rule's quiet-period kicks in and
 * the same nudge does not reappear tomorrow.
 */
export function NudgeBanner() {
    const { user, session } = useAuth();
    const navigate = useNavigate();
    const [nudges, setNudges] = useState<NudgeNotification[]>([]);
    const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('notifications')
                .select('id, title, message, type, read, created_at, priority, deep_link')
                .eq('user_id', user.id)
                .eq('read', false)
                .in('type', ['streak', 'assignment', 'review'])
                .order('priority', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(10);
            if (!cancelled && data) {
                setNudges(data as NudgeNotification[]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user]);

    const top = useMemo(() => {
        const candidates = nudges.filter(
            n => NUDGE_TYPES.has(n.type) && !hiddenIds.has(n.id),
        );
        // Defensive client-side sort in case the backing store didn't sort
        // (e.g. older notifications with NULL priority should fall to the
        // bottom rather than the top).
        candidates.sort((a, b) => {
            const pa = a.priority ?? -1;
            const pb = b.priority ?? -1;
            if (pa !== pb) return pb - pa;
            return (b.created_at || '').localeCompare(a.created_at || '');
        });
        return candidates[0];
    }, [nudges, hiddenIds]);

    if (!user || !top) return null;

    const dismiss = async () => {
        setHiddenIds(prev => new Set(prev).add(top.id));
        try {
            await fetch(`/api/v1/nudges/${top.id}/dismiss`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session?.access_token ?? ''}`,
                    'Content-Type': 'application/json',
                },
            });
        } catch (e) {
            console.error('Failed to dismiss nudge', e);
        }
    };

    const open = () => {
        const link = top.deep_link || FALLBACK_DEEP_LINK_BY_TYPE[top.type] || '/dashboard';
        navigate(link);
    };

    return (
        <AnimatePresence>
            <motion.div
                key={top.id}
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="rounded-2xl overflow-hidden"
                data-testid="nudge-banner"
            >
                <div className="glass-panel-strong border border-primary/30 px-5 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{top.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{top.message}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            onClick={open}
                            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                            aria-label="Open nudge"
                            data-testid="nudge-open"
                        >
                            Open <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                            onClick={dismiss}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Dismiss nudge"
                            data-testid="nudge-dismiss"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
