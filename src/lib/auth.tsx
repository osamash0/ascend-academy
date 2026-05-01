import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AUTH_INIT_TIMEOUT_MS, AUTH_PROFILE_TIMEOUT_MS } from '@/lib/constants';

type UserRole = 'student' | 'professor' | null;

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
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string): Promise<boolean> => {
    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, display_name, avatar_url, total_xp, current_level, current_streak, best_streak')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        setProfile(null);
        return false;
      }
      console.error("fetchProfile error:", error);
      // Keep session alive for transient errors
      return true;
    }

    if (!profileData) {
      setProfile(null);
      return false;
    }

    setProfile(profileData as Profile);
    return true;
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
    // Listen for auth changes (handles initial session automatically in Supabase v2)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        try {
          setSession(session);
          setUser(session?.user ?? null);

          if (session?.user) {
            if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || !hasFetchedProfile.current) {
                hasFetchedProfile.current = true;
                const profilePromise = withTimeout(fetchProfile(session.user.id), AUTH_PROFILE_TIMEOUT_MS).catch(() => true);
                const rolePromise = withTimeout(fetchRole(session.user.id), AUTH_PROFILE_TIMEOUT_MS).catch(() => {});
                const hasProfile = await profilePromise;
                if (!hasProfile) {
                  console.warn("User has session but no profile. Signing out.");
                  await signOut().catch(() => {});
                } else {
                  await rolePromise;
                }
            }
          } else {
            setProfile(null);
            setRole(null);
          }
        } catch (error: unknown) {
          console.error("Auth state change error:", error);
        } finally {
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

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

    // Role is now stored in user_metadata.role
    // A Supabase database trigger (on_auth_user_created) should read
    // raw_user_meta_data->>'role' and insert into user_roles.
    // Fallback: insert from client if trigger is not yet set up.
    if (data.user && selectedRole) {
      await supabase
        .from('user_roles')
        .upsert({ user_id: data.user.id, role: selectedRole }, { onConflict: 'user_id,role' });
    }

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
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
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
