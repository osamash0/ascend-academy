/**
 * Who goes where after signing in, and who is sent to first run.
 *
 * The one rule that matters: only a student is ever sent to `/onboarding`.
 * `/onboarding` is student-only, so sending anyone else there bounced them
 * straight back to `/dashboard`, which sent them to `/onboarding` again —
 * the infinite redirect the 2026-10-24 audit found for admins and for
 * accounts whose role lookup failed (role = null).
 */
import { describe, expect, it } from 'vitest';
import { firstRunExit, needsFirstRun, postAuthDestination } from '@/lib/firstRun';

const fresh = { has_completed_activation_onboarding: false };
const done = { has_completed_activation_onboarding: true };

describe('needsFirstRun', () => {
  it.each([
    ['student', fresh, true],
    ['student', done, false],
    ['student', null, false],
    ['admin', fresh, false],
    ['professor', fresh, false],
    [null, fresh, false],
  ] as const)('role %s, profile %o → %s', (role, profile, expected) => {
    expect(needsFirstRun(role, profile)).toBe(expected);
  });
});

describe('postAuthDestination', () => {
  it.each([
    ['professor', fresh, true, '/professor/dashboard'],
    ['professor', done, false, '/professor/dashboard'],
    ['admin', fresh, true, '/admin/dashboard'],
    ['admin', fresh, false, '/admin/dashboard'],
    ['student', fresh, true, '/onboarding'],
    ['student', fresh, false, '/onboarding'],
    ['student', done, true, '/v4/home'],
    ['student', done, false, '/dashboard'],
    [null, fresh, true, '/dashboard'],
    [null, fresh, false, '/dashboard'],
    ['student', null, true, '/dashboard'],
  ] as const)('role %s, profile %o, v4First %s → %s', (role, profile, v4First, expected) => {
    expect(postAuthDestination({ role, profile, v4First })).toBe(expected);
  });

  it('goes where a shared link was heading once first run is behind them', () => {
    expect(postAuthDestination({ role: 'student', profile: done, v4First: true, next: '/course/abc' })).toBe('/course/abc');
    expect(postAuthDestination({ role: 'professor', profile: done, v4First: false, next: '/course/abc' })).toBe('/course/abc');
  });

  it('still sends a new student to first run first, even with a shared link', () => {
    expect(postAuthDestination({ role: 'student', profile: fresh, v4First: true, next: '/course/abc' })).toBe('/onboarding');
  });
});

describe('firstRunExit', () => {
  it('ends inside v4 when v4 is the product', () => {
    expect(firstRunExit(true)).toBe('/v4/home');
  });

  it('hands over to the study-path step otherwise, which completes the flag', () => {
    expect(firstRunExit(false)).toBe('/onboarding/start');
  });
});
