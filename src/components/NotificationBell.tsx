import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Trophy, Zap, Flame, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

interface Notification {
    id: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    created_at: string;
}

const typeIcons = {
    achievement: Trophy,
    level_up: Zap,
    streak: Flame,
} as const;

const typeColors: Record<string, string> = {
    achievement: 'text-xp bg-xp/10',
    level_up: 'text-primary bg-primary/10',
    streak: 'text-orange-500 bg-orange-500/10',
};

function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function NotificationBell() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    const unreadCount = notifications.filter(n => !n.read).length;

    // Fetch notifications with cleanup
    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        const fetchNotifications = async () => {
            try {
                const { data } = await supabase
                    .from('notifications')
                    .select('id, title, message, type, read, created_at')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(20);

                if (!cancelled && data) {
                    setNotifications(data as Notification[]);
                }
            } catch (err) {
                console.error('Failed to fetch notifications:', err);
            }
        };

        fetchNotifications();

        // Real-time subscription with proper cleanup
        const channel = supabase
            .channel(`notifications-${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    setNotifications(prev => [payload.new as Notification, ...prev]);
                }
            )
            .subscribe();

        channelRef.current = channel;

        return () => {
            cancelled = true;
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [user]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };

        if (open) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [open]);

    const markAllRead = useCallback(async () => {
        if (!user) return;

        try {
            await supabase
                .from('notifications')
                .update({ read: true })
                .eq('user_id', user.id)
                .eq('read', false);

            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        } catch (err) {
            console.error('Failed to mark notifications as read:', err);
        }
    }, [user]);

    const markAsRead = useCallback(async (id: string) => {
        try {
            await supabase
                .from('notifications')
                .update({ read: true })
                .eq('id', id);

            setNotifications(prev => prev.map(n => 
                n.id === id ? { ...n, read: true } : n
            ));
        } catch (err) {
            console.error('Failed to mark notification as read:', err);
        }
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen(!open)}
                className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
                aria-expanded={open}
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <motion.span 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-destructive rounded-full"
                    >
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </motion.span>
                )}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <h3 className="font-semibold text-foreground text-sm">Notifications</h3>
                            <div className="flex items-center gap-2">
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllRead}
                                        className="text-xs text-primary hover:underline"
                                    >
                                        Mark all read
                                    </button>
                                )}
                                <button 
                                    onClick={() => setOpen(false)} 
                                    className="text-muted-foreground hover:text-foreground"
                                    aria-label="Close notifications"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Notification List */}
                        <div className="max-h-80 overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                                    <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                    No notifications yet
                                </div>
                            ) : (
                                notifications.map((notif) => {
                                    const Icon = typeIcons[notif.type as keyof typeof typeIcons] || Bell;
                                    const colorClass = typeColors[notif.type] || 'text-muted-foreground bg-muted';

                                    return (
                                        <motion.div
                                            key={notif.id}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 transition-colors cursor-pointer ${
                                                !notif.read ? 'bg-primary/5' : ''
                                            }`}
                                            onClick={() => markAsRead(notif.id)}
                                        >
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm ${!notif.read ? 'font-semibold text-foreground' : 'text-foreground'}`}>
                                                    {notif.title}
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                                                <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(notif.created_at)}</p>
                                            </div>
                                            {!notif.read && (
                                                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                                            )}
                                        </motion.div>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
