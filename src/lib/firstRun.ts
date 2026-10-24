/**
 * Where a signed-in person belongs, and whether they still owe first run.
 *
 * Pure on purpose: the route guards in App.tsx are thin wrappers around these,
 * so the whole matrix (role × onboarded × v4) is tested without a router.
 */
import { AdminRoutes, ProfessorRoutes, StudentRoutes, V4Routes } from '@/lib/routes';

type Role = 'student' | 'professor' | 'admin' | null;
type FirstRunProfile = { has_completed_activation_onboarding: boolean } | null;

/**
 * Only a student is ever sent to first run. `/onboarding` is student-only, so
 * sending an admin, or someone whose role lookup failed, would bounce them to
 * `/dashboard` and back forever. A student whose role read timed out sees the
 * dashboard until the next load — the fail-safe direction.
 */
export function needsFirstRun(role: Role, profile: FirstRunProfile): boolean {
  return role === 'student' && !!profile && !profile.has_completed_activation_onboarding;
}

export function postAuthDestination({
  role,
  profile,
  v4First,
}: {
  role: Role;
  profile: FirstRunProfile;
  v4First: boolean;
}): string {
  if (role === 'professor') return ProfessorRoutes.DASHBOARD;
  if (role === 'admin') return AdminRoutes.DASHBOARD;
  if (needsFirstRun(role, profile)) return StudentRoutes.ONBOARDING;
  if (v4First && role === 'student' && profile) return V4Routes.HOME;
  return StudentRoutes.HOME;
}

/**
 * Where first run hands over. In v4 it ends in Home, already lit in the light
 * you picked. Without v4 the legacy study-path step follows, and that step is
 * what marks onboarding complete.
 */
export function firstRunExit(v4First: boolean): string {
  return v4First ? V4Routes.HOME : StudentRoutes.ONBOARDING_START;
}
