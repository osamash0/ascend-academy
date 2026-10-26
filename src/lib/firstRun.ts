/**
 * Where a signed-in person belongs, and whether they still owe first run.
 *
 * Pure on purpose: the route guards in App.tsx are thin wrappers around these,
 * so the whole matrix (role × onboarded × v4) is tested without a router.
 */
import { StudentRoutes, V4Routes, homeForRole } from '@/lib/routes';

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

/**
 * First run, carrying the link that brought them (LS-047).
 *
 * Someone invited by a shared link is the likeliest new person. First run
 * comes before anything, but it must not swallow the reason they came: the
 * link rides along as `?next=` and first run ends there instead of Home.
 * In the URL rather than storage, so it also survives the confirmation email
 * opening in a new tab. `next` must already have passed `safeNextPath`.
 */
export function firstRunPath(next?: string | null): string {
  return next ? `${StudentRoutes.ONBOARDING}?next=${encodeURIComponent(next)}` : StudentRoutes.ONBOARDING;
}

export function postAuthDestination({
  role,
  profile,
  v4First,
  next,
}: {
  role: Role;
  profile: FirstRunProfile;
  v4First: boolean;
  /** A path inside the app that sign-in interrupted, already checked with `safeNextPath`. */
  next?: string | null;
}): string {
  // First run before anything else, even before a shared link, which it
  // carries and ends on.
  if (needsFirstRun(role, profile)) return firstRunPath(next);
  if (next) return next;
  if (v4First && role === 'student' && profile) return V4Routes.HOME;
  return homeForRole(role);
}

/**
 * Where first run hands over. In v4 it ends where a shared link was heading,
 * else in Home, already lit in the light you picked. Without v4 the legacy
 * study-path step follows, and that step is what marks onboarding complete.
 */
export function firstRunExit(v4First: boolean, next?: string | null): string {
  if (!v4First) return StudentRoutes.ONBOARDING_START;
  return next ?? V4Routes.HOME;
}
