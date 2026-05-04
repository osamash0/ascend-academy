import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

/**
 * Route guards used by App.tsx. Extracted so they can be unit-tested in
 * isolation without spinning up the entire route tree.
 *
 * Race-safety contract:
 *   `useAuth().loading` stays true while EITHER the session check OR the
 *   role lookup is still in flight. Both guards therefore keep showing the
 *   spinner while `loading === true` so they never render or redirect on a
 *   half-resolved auth state (user set but role still null).
 */

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div
      className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"
      data-testid="route-guard-spinner"
    />
  </div>
);

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: string[];
}) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  // If allowedRoles is set but role is unknown (timed out), don't grant
  // access to a role-restricted route — bounce to the role-neutral
  // dashboard, which will route the user appropriately once the role is
  // known.
  if (allowedRoles && !role) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  if (user) {
    if (role === 'professor') {
      return <Navigate to="/professor/dashboard" replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
