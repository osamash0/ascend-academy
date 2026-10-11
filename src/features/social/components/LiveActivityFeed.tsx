import { useCallback } from "react";
import { UserAvatar } from "@/features/avatar/UserAvatar";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, CheckCircle, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFriendActivity } from "../hooks";
import { badgeLabel } from "@/lib/gamification/badgeLabel";
import type { FriendActivityItem } from "../data";
import { Panel } from "./atoms";

function useTimeAgo() {
  const { t } = useTranslation(["common"]);
  return useCallback(
    (dateStr: string): string => {
      const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
      if (seconds < 60) return t("common:notifications.justNow");
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return t("common:notifications.minutesAgo", { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t("common:notifications.hoursAgo", { count: hours });
      const days = Math.floor(hours / 24);
      return t("common:notifications.daysAgo", { count: days });
    },
    [t],
  );
}

function eventKey(item: FriendActivityItem) {
  return `${item.eventType}-${item.userId}-${item.createdAt}`;
}

export function LiveActivityFeed() {
  const { t } = useTranslation(["common"]);
  const { data: events = [], isLoading } = useFriendActivity(10);
  const timeAgo = useTimeAgo();

  if (!isLoading && events.length === 0) {
    return (
      <Panel className="flex flex-col items-center justify-center gap-2 py-6 text-center text-muted-foreground border-dashed">
        <Activity className="h-6 w-6 text-white/20" />
        <span className="text-sm">Nothing from your friends yet.</span>
      </Panel>
    );
  }

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="bg-white/5 px-4 py-3 border-b border-white/5 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <h3 className="text-sm font-bold text-foreground">Friend Activity</h3>
      </div>
      <div className="flex flex-col">
        <AnimatePresence initial={false}>
          {events.map((ev) => {
            const label =
              ev.eventType === "badge"
                ? badgeLabel(t, {
                    key: ev.badgeKey ?? "",
                    name: ev.badgeDisplayName ?? ev.badgeKey ?? "a badge",
                    description: "",
                  }).name
                : ev.courseTitle ?? "a course";

            return (
              <motion.div
                key={eventKey(ev)}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="px-4 py-3 border-b border-white/5 flex items-center gap-3 bg-white/[0.02]"
              >
                {/* The friend's face first; what they did rides on it as a small badge. */}
                <div className="relative flex-shrink-0">
                  <UserAvatar userId={ev.userId} name={ev.displayName} avatarUrl={ev.avatarUrl} size={32} />
                  <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-black ring-1 ring-white/15">
                    {ev.eventType === "badge" ? (
                      <Trophy className="h-2.5 w-2.5 text-amber-400" aria-hidden />
                    ) : (
                      <CheckCircle className="h-2.5 w-2.5 text-white/80" aria-hidden />
                    )}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="font-bold text-foreground">{ev.displayName}</span>{" "}
                  <span className="text-muted-foreground">
                    {ev.eventType === "badge" ? `earned ${label}` : `completed an exam in ${label}`}
                  </span>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">{timeAgo(ev.createdAt)}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
