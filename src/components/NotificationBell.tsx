import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Trophy, Zap, Flame, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

interface Notification {
    id: string;
    title: string;
    message: string;
    type: string;
    read: boolean;
    created_at: string;
}

const typeIcons: Record<string, typeof Trophy> = {
    achievement: Trophy,
    level_up: Zap,
    streak: Flame,
};

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

    const unreadCount = notifications.filter(n => !n.read).length;

    // Fetch notifications
    useEffect(() => {
        if (!user) return;

        const fetchNotifications = async () => {
            const { data } = await (supabase as any)
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(20);
            if (data) setNotifications(data as Notification[]);
        };

        fetchNotifications();

        // Real-time subscription
        const channel = supabase
            .channel('notifications')
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

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        if (open) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    const markAllRead = async () => {
        if (!user) return;
        await (supabase as any)
            .from('notifications')
            .update({ read: true })
            .eq('user_id', user.id)
            .eq('read', false);
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen(!open)}
                className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Notifications"
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-destructive rounded-full">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
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
                                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
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
                                    const Icon = typeIcons[notif.type] || Bell;
                                    const colorClass = typeColors[notif.type] || 'text-muted-foreground bg-muted';

                                    return (
                                        <div
                                            key={notif.id}
                                            className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 transition-colors ${!notif.read ? 'bg-primary/5' : ''
                                                }`}
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
                                        </div>
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
