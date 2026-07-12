/**
 * Social UI state. The friends graph now lives in Supabase (see hooks.ts);
 * this context holds the leaderboard role filter and real-time presence/nudges.
 */
import { createContext, useContext, useMemo, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Role } from "./data";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface SocialUiState {
  roleFilter: Role | null;
  setRoleFilter: (role: Role | null) => void;
  onlineUserIds: Set<string>;
  sendNudge: (userId: string, userName: string) => void;
}

const SocialContext = createContext<SocialUiState | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    // Create a global presence channel
    const chan = supabase.channel('global:presence', {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    chan
      .on('presence', { event: 'sync' }, () => {
        const state = chan.presenceState();
        const online = new Set<string>();
        for (const key in state) {
          online.add(key);
        }
        setOnlineUserIds(online);
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        setOnlineUserIds((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setOnlineUserIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      })
      // Listen for broadcast nudges
      .on('broadcast', { event: 'nudge' }, (payload) => {
        if (payload.payload.to === user.id) {
          toast({
            title: "👋 Nudge!",
            description: `${payload.payload.fromName} nudged you to study.`,
            variant: "default",
          });
          // Note: Here we hook into playSound('nudge') when we build sounds
          if (typeof window !== 'undefined') {
             window.dispatchEvent(new CustomEvent('play-sound', { detail: 'nudge' }));
          }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await chan.track({ 
            online_at: new Date().toISOString(),
          });
        }
      });

    setChannel(chan);

    return () => {
      void supabase.removeChannel(chan);
    };
  }, [user?.id, toast]);

  const sendNudge = useCallback((userId: string, toName: string) => {
    if (!channel || !user?.id) return;
    
    // Optimistic toast
    toast({
      title: "Nudge sent!",
      description: `You nudged ${toName}.`,
    });

    // Fire sound optimistically
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('play-sound', { detail: 'sendNudge' }));
    }

    void channel.send({
      type: 'broadcast',
      event: 'nudge',
      payload: {
        to: userId,
        fromName: profile?.display_name || "A friend"
      }
    });
  }, [channel, user?.id, profile?.display_name, toast]);

  const value = useMemo(() => ({ 
    roleFilter, 
    setRoleFilter, 
    onlineUserIds, 
    sendNudge 
  }), [roleFilter, onlineUserIds, sendNudge]);

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial(): SocialUiState {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error("useSocial must be used within a SocialProvider");
  return ctx;
}
