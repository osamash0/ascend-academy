import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Inbox, Loader2, Send, Users, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StudentRoutes } from "@/lib/routes";
import { useFriendActions, useFriendRequests } from "../hooks";
import { Avatar, InstitutionBadge, Panel } from "../components/atoms";

type Tab = "incoming" | "outgoing";

export default function FriendRequests() {
  const { data: requests = [], isLoading } = useFriendRequests();
  const { accept, decline, cancel } = useFriendActions();
  const [tab, setTab] = useState<Tab>("incoming");

  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");
  const list = tab === "incoming" ? incoming : outgoing;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-0 lg:py-8">
      <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-5 font-display text-[22px] font-bold text-foreground">
        Friend requests
      </motion.h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="incoming"><Inbox className="mr-1.5 h-4 w-4" /> Incoming ({incoming.length})</TabsTrigger>
          <TabsTrigger value="outgoing"><Send className="mr-1.5 h-4 w-4" /> Outgoing ({outgoing.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : list.length === 0 ? (
        <Panel className="text-sm text-muted-foreground">
          {tab === "incoming" ? "No incoming requests right now." : "You haven’t sent any requests."}
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((u, i) => (
            <motion.div key={u.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
              <Panel className="!p-4">
                <div className="flex items-center gap-3">
                  <Link to={StudentRoutes.PROFILE_USER(u.id)}><Avatar user={u} size="lg" showDot /></Link>
                  <div className="min-w-0 flex-1">
                    <Link to={StudentRoutes.PROFILE_USER(u.id)} className="text-[15px] font-bold text-foreground hover:text-primary">
                      {u.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <InstitutionBadge institution={u.institution} />
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {u.mutualFriends ?? 0} mutual</span>
                      <span>· {u.mutualCourses ?? 0} mutual courses</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {tab === "incoming" ? (
                      <>
                        <Button size="sm" onClick={() => accept.mutate(u.id)} disabled={accept.isPending}>
                          <Check className="h-4 w-4" /> Accept
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => decline.mutate(u.id)} disabled={decline.isPending}>
                          <X className="h-4 w-4" /> Decline
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => cancel.mutate(u.id)} disabled={cancel.isPending}>
                        <X className="h-4 w-4" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </Panel>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
