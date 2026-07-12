import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, CheckCircle, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Panel } from "./atoms";

type LiveEvent = {
  id: string;
  userId: string;
  type: "achievement" | "exam_attempt";
  title: string;
  timestamp: Date;
};

export function LiveActivityFeed() {
  const { user } = useAuth();
  const [events, setEvents] = useState<LiveEvent[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('live-activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'achievements' },
        (payload) => {
          if (payload.new.user_id !== user.id) {
            setEvents((prev) => [
              {
                id: payload.new.id,
                userId: payload.new.user_id,
                type: "achievement",
                title: payload.new.badge_name || "a new badge",
                timestamp: new Date(),
              },
              ...prev,
            ].slice(0, 5));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'exam_attempts' },
        (payload) => {
          if (payload.new.user_id !== user.id) {
            setEvents((prev) => [
              {
                id: payload.new.id,
                userId: payload.new.user_id,
                type: "exam_attempt",
                title: "completed an exam",
                timestamp: new Date(),
              },
              ...prev,
            ].slice(0, 5));
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  if (events.length === 0) {
    return (
      <Panel className="flex flex-col items-center justify-center gap-2 py-6 text-center text-muted-foreground border-dashed">
        <Activity className="h-6 w-6 text-white/20" />
        <span className="text-sm">Waiting for live activity...</span>
      </Panel>
    );
  }

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="bg-white/5 px-4 py-3 border-b border-white/5 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <h3 className="text-sm font-bold text-foreground">Live Activity</h3>
      </div>
      <div className="flex flex-col">
        <AnimatePresence initial={false}>
          {events.map((ev) => (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="px-4 py-3 border-b border-white/5 flex items-center gap-3 bg-white/[0.02]"
            >
              {ev.type === "achievement" ? (
                <div className="h-8 w-8 rounded-full bg-amber-400/20 flex items-center justify-center flex-shrink-0">
                  <Trophy className="h-4 w-4 text-amber-400" />
                </div>
              ) : (
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className="text-sm">
                <span className="font-bold text-foreground">A friend</span>{" "}
                <span className="text-muted-foreground">
                  {ev.type === "achievement" ? "earned" : ""} {ev.title}
                </span>
              </div>
              <span className="ml-auto text-xs text-muted-foreground">Just now</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
