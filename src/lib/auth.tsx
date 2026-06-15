import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AUTH_INIT_TIMEOUT_MS, AUTH_PROFILE_TIMEOUT_MS } from '@/lib/constants';
import { toast } from '@/hooks/use-toast';

type UserRole = 'student' | 'professor' | 'admin' | null;

// Result of a profile fetch. We distinguish a MISSING profile (the account
// row is gone → sign out) from a transient ERROR (network/RLS/timeout →
// recoverable, keep the session but surface it). 'ok' means loaded.
type ProfileFetchResult = 'ok' | 'missing' | 'error';

export interface Profile {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  total_xp: number;
  current_level: number;
  current_streak: number;
  best_streak: number;
  preferred_language?: 'en' | 'de' | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: UserRole;
  loading: boolean;
  signUp: (email: string, password: string, role: UserRole) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const hasFetchedProfile = useRef(false);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  // Two-phase loading. The auth context is only "ready" once BOTH the
  // session check and (when a user is present) the role lookup have settled
  // — success, failure, or timeout. Route guards key off the unified
  // `loading` below so they never see `user` set but `role` still null,
  // which is the race that causes student→/professor lockups and the
  // professor login flash on the student dashboard.
  const [sessionLoading, setSessionLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const loading = sessionLoading || roleLoading;

  const fetchProfile = async (userId: string): Promise<ProfileFetchResult> => {
    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, display_name, avatar_url, total_xp, current_level, current_streak, best_streak, preferred_language')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No row for this user — the account/profile is gone.
        setProfile(null);
        return 'missing';
      }
      console.error("fetchProfile error:", error);
      // Transient failure (network/RLS/server). Recoverable — keep the
      // session, but the caller surfaces it instead of failing silently.
      return 'error';
    }

    if (!profileData) {
      setProfile(null);
      return 'missing';
    }

    setProfile(profileData as Profile);
    return 'ok';
  };

  const fetchRole = async (userId: string) => {
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (roleData) {
      setRole(roleData.role as UserRole);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const withTimeout = <T,>(promise: Promise<T>, ms: number = AUTH_INIT_TIMEOUT_MS): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Supabase deadlock timeout')), ms))
    ]);
  };

  useEffect(() => {
    console.log("[DEBUG AUTH] useEffect running. localStorage keys:", Object.keys(localStorage));
    supabase.auth.getSession().then(({ data, error }) => {
      console.log("[DEBUG AUTH] getSession returned:", !!data.session, "error:", error?.message);
    }).catch(err => {
      console.error("[DEBUG AUTH] getSession rejected:", err);
    });

    // Listen for auth changes (handles initial session automatically in Supabase v2)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("[DEBUG AUTH] onAuthStateChange fired:", event, "session user:", session?.user?.id);
        try {
          setSession(session);
          setUser(session?.user ?? null);

          if (session?.user) {
            // Race-safe: only fetch profile/role once per session. INITIAL_SESSION
            // and SIGNED_IN often fire back-to-back on cold start, and we don't
            // want two parallel fetches both racing to set state.
            const isLoginEvent = event === 'INITIAL_SESSION' || event === 'SIGNED_IN';
            if (isLoginEvent && !hasFetchedProfile.current) {
              hasFetchedProfile.current = true;
              setRoleLoading(true);
              // Defer fetching profile and role to avoid deadlocking with Supabase auth client lock.
              // Awaiting database queries directly inside the synchronous event callback triggers
              // getSession calls that deadlocks if the SDK holds an internal initialization lock.
              setTimeout(async () => {
                try {
                  const profilePromise = withTimeout(fetchProfile(session.user.id), AUTH_PROFILE_TIMEOUT_MS)
                    .catch((): ProfileFetchResult => 'error');
                  const rolePromise = withTimeout(fetchRole(session.user.id), AUTH_PROFILE_TIMEOUT_MS).catch(() => {});
                  const profileResult = await profilePromise;
                  if (profileResult === 'missing') {
                    console.warn("User has session but no profile. Signing out.");
                    await signOut().catch(() => {});
                  } else {
                    if (profileResult === 'error') {
                      // Loud-but-contained: a transient profile read (or its
                      // timeout) used to leave the user "logged in" with no
                      // profile data and no signal. Keep the session — this is
                      // recoverable, unlike a missing profile — but tell the
                      // user instead of failing silently into a half-state.
                      toast({
                        variant: 'destructive',
                        title: 'Could not load your profile',
                        description: 'Something went wrong loading your account. Please refresh — if it keeps happening, contact support.',
                      });
                    }
                    // Wait for role too. On timeout/error the catch above
                    // resolves the promise; we then leave `role` as whatever
                    // fetchRole managed to set (null if nothing), but mark the
                    // lookup as resolved so guards stop spinning.
                    await rolePromise;
                  }
                } catch (err) {
                  console.error("Deferred profile/role fetch error:", err);
                } finally {
                  setRoleLoading(false);
                }
              }, 0);
            }
          } else {
            // Reset on sign-out so the next session re-fetches cleanly
            hasFetchedProfile.current = false;
            setProfile(null);
            setRole(null);
            setRoleLoading(false);
          }
        } catch (error: unknown) {
          console.error("Auth state change error:", error);
          // Defensive: don't pin the UI on the spinner if the handler itself
          // throws before reaching the role-loading finally above.
          setRoleLoading(false);
        } finally {
          setSessionLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Subscribe to real-time changes to user's profile row (XP, levels, streaking, preferred_language)
    const channel = supabase
      .channel(`realtime-profile-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setProfile(payload.new as Profile);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);


  const signUp = async (email: string, password: string, selectedRole: UserRole) => {
    const redirectUrl = `${window.location.origin}/`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          role: selectedRole,
        },
      },
    });

    if (error) {
      return { error };
    }

    // Role is stored in user_metadata.role and propagated to user_roles
    // by the on_auth_user_created database trigger. We deliberately do
    // NOT upsert into user_roles from the client — that would let any
    // user grant themselves the 'professor' role and bypass server-side
    // role checks. If signups are succeeding but no role is assigned,
    // verify the trigger exists in Supabase.
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { error };

    // After successful auth, check if profile exists
    if (data.user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', data.user.id)
        .single();
      
      if (!profileData) {
        await supabase.auth.signOut();
        return { error: new Error('Your account appears to have been deleted. Please contact support if this is an error.') };
      }
    }

    return { error: null };
  };

  const signOut = async () => {
    try {
      // Coordinate with backend cache invalidation before wiping local credentials
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        await fetch(`${apiBase}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
      }
    } catch (err) {
      console.warn("Backend session cache invalidation failed (non-blocking):", err);
    } finally {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      setProfile(null);
      setRole(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        role,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
