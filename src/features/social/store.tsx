/**
 * Social UI state. The friends graph now lives in Supabase (see hooks.ts);
 * this context only holds the leaderboard role filter shared across screens
 * (e.g. set when a role badge is clicked on a profile).
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Role } from "./data";

interface SocialUiState {
  roleFilter: Role | null;
  setRoleFilter: (role: Role | null) => void;
}

const SocialContext = createContext<SocialUiState | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const value = useMemo(() => ({ roleFilter, setRoleFilter }), [roleFilter]);
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial(): SocialUiState {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error("useSocial must be used within a SocialProvider");
  return ctx;
}
