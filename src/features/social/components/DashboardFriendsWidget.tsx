/**
 * Calm friends glance for the dashboard's first screen (top-right). Shows a few
 * online friends + a quiet request indicator, linking to the Friends hub.
 * Intentionally low-key — it never competes with the hero. When the student has
 * no friends yet, it falls back to academic friend SUGGESTIONS so the first
 * screen is never an empty social graph.
 */
import { motion } from "framer-motion";
import { Sparkles, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StudentRoutes } from "@/lib/routes";
import { Avatar } from "./atoms";
import { useFriendRequests, useFriends, useFriendSuggestions } from "../hooks";
import { useSocial } from "../store";

export function DashboardFriendsWidget() {
  const navigate = useNavigate();
  const { data: friends = [] } = useFriends();
  const { data: requests = [] } = useFriendRequests();
  const { onlineUserIds } = useSocial();

  const incoming = requests.filter((r) => r.direction === "incoming").length;
  const online = friends.filter((f) => onlineUserIds.has(f.id) || f.online);
  const show = online.length ? online : friends;
  const stack = show.slice(0, 3);
  const hasAny = friends.length > 0 || incoming > 0;

  // Only fetch suggestions when there's nothing else to show.
  const { data: suggestions = [] } = useFriendSuggestions(3, !hasAny);
  const suggestStack = suggestions.slice(0, 3);
  const showSuggest = !hasAny && suggestStack.length > 0;

  return (
    <motion.button
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      onClick={() => navigate(StudentRoutes.FRIENDS)}
      className="group flex items-center gap-3 rounded-full border border-white/10 bg-black/30 px-3 py-2 backdrop-blur-md transition-colors hover:bg-white/5"
      aria-label="Open friends"
    >
      {hasAny && stack.length > 0 ? (
        <div className="flex -space-x-2">
          {stack.map((f) => (
            <div key={f.id} className="rounded-[12px] ring-2 ring-[#0E1320]">
              <Avatar user={f} size="sm" />
            </div>
          ))}
        </div>
      ) : showSuggest ? (
        <div className="flex -space-x-2">
          {suggestStack.map((s) => (
            <div key={s.id} className="rounded-[12px] ring-2 ring-[#0E1320]">
              <Avatar user={s} size="sm" />
            </div>
          ))}
        </div>
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5">
          <Users className="h-4 w-4 text-muted-foreground" />
        </span>
      )}

      <span className="text-left leading-tight">
        <span className="block text-xs font-bold text-foreground">
          {online.length > 0
            ? `${online.length} friend${online.length === 1 ? "" : "s"} online`
            : friends.length > 0
              ? `${friends.length} friend${friends.length === 1 ? "" : "s"}`
              : showSuggest
                ? `${suggestions.length} ${suggestions.length === 1 ? "person" : "people"} to meet`
                : "Find friends"}
        </span>
        {incoming > 0 ? (
          <span className="block text-[11px] font-medium text-primary">
            {incoming} new request{incoming === 1 ? "" : "s"}
          </span>
        ) : showSuggest ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
            <Sparkles className="h-3 w-3" /> Suggested for you
          </span>
        ) : (
          <span className="block text-[11px] text-muted-foreground">Study circle</span>
        )}
      </span>

      {incoming > 0 && <span className="h-2 w-2 rounded-full bg-primary shadow-glow-primary" />}
    </motion.button>
  );
}
