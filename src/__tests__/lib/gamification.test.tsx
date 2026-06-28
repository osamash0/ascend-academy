/**
 * Tests for GamificationProvider and related utilities.
 *
 * GamificationProvider:
 *   - Exposes evaluate / awardBadge / grantXp via context
 *   - Queues a BadgeEarnedModal when a badge is awarded
 *   - Queues a LevelUpModal when current_level increases
 *   - Calls refreshProfile and invalidates TanStack queries after XP
 *   - Does NOT fire a level-up modal on the very first profile observation
 *
 * badgeLabel / categoryLabel:
 *   - Returns i18n override when a translation key exists
 *   - Falls back to DB text when no translation exists
 *   - categoryLabel capitalises the id on fallback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  GamificationProvider,
  useGamification,
} from '@/lib/gamification/GamificationProvider';
import { badgeLabel, categoryLabel } from '@/lib/gamification/badgeLabel';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

// gamificationService is the I/O boundary — mock the whole module
const grantXpRpcMock = vi.fn().mockResolvedValue(undefined);
const awardBadgeRpcMock = vi.fn().mockResolvedValue(null);
const evaluateBadgesMock = vi.fn().mockResolvedValue([]);

vi.mock('@/services/gamificationService', () => ({
  grantXp: (...args: unknown[]) => grantXpRpcMock(...args),
  awardBadge: (...args: unknown[]) => awardBadgeRpcMock(...args),
  evaluateBadges: () => evaluateBadgesMock(),
}));

// Modal components — spy on render without worrying about full UI
vi.mock('@/components/BadgeEarnedModal', () => ({
  BadgeEarnedModal: ({ isOpen, badgeName }: { isOpen: boolean; badgeName: string }) =>
    isOpen ? <div data-testid="badge-modal">{badgeName}</div> : null,
}));
vi.mock('@/components/LevelUpModal', () => ({
  LevelUpModal: ({ isOpen, newLevel }: { isOpen: boolean; newLevel: number }) =>
    isOpen ? <div data-testid="level-modal">Level {newLevel}</div> : null,
}));

// Override the global useAuth mock to expose what GamificationProvider needs
const refreshProfileMock = vi.fn().mockResolvedValue(undefined);
let profileOverride: { user_id: string; current_level: number } | null = {
  user_id: 'user-1',
  current_level: 1,
};

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'test@example.com' },
    session: { access_token: 'test-token' },
    profile: profileOverride,
    refreshProfile: refreshProfileMock,
  }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <GamificationProvider>{children}</GamificationProvider>
    </QueryClientProvider>
  );
}

/** Tiny probe component that captures and exposes the gamification context. */
function ContextProbe({
  onContext,
}: {
  onContext: (ctx: ReturnType<typeof useGamification>) => void;
}) {
  const ctx = useGamification();
  onContext(ctx);
  return <div data-testid="probe">ok</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  profileOverride = { user_id: 'user-1', current_level: 1 };
  grantXpRpcMock.mockResolvedValue(undefined);
  awardBadgeRpcMock.mockResolvedValue(null);
  evaluateBadgesMock.mockResolvedValue([]);
});

// ─── GamificationProvider — context surface ───────────────────────────────────

describe('GamificationProvider', () => {
  it('provides evaluate, awardBadge, grantXp via context', () => {
    const client = makeClient();
    let ctx: ReturnType<typeof useGamification> | null = null;
    render(
      <Wrapper client={client}>
        <ContextProbe onContext={(c) => { ctx = c; }} />
      </Wrapper>,
    );
    expect(ctx).not.toBeNull();
    expect(typeof ctx!.evaluate).toBe('function');
    expect(typeof ctx!.awardBadge).toBe('function');
    expect(typeof ctx!.grantXp).toBe('function');
  });

  it('throws when useGamification is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<ContextProbe onContext={() => {}} />),
    ).toThrow('useGamification must be used within a GamificationProvider');
    spy.mockRestore();
  });

  it('calls grantXpRpc + refreshProfile + invalidates queries on grantXp', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    let ctx: ReturnType<typeof useGamification> | null = null;

    render(
      <Wrapper client={client}>
        <ContextProbe onContext={(c) => { ctx = c; }} />
      </Wrapper>,
    );

    await act(async () => {
      await ctx!.grantXp(100, 'quiz_complete', 'lecture:abc');
    });

    expect(grantXpRpcMock).toHaveBeenCalledWith(100, 'quiz_complete', 'lecture:abc');
    expect(refreshProfileMock).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('shows a BadgeEarnedModal when awardBadge returns a definition', async () => {
    const BADGE = {
      key: 'on_fire',
      name: 'On Fire',
      description: '5-day streak!',
      icon: '🔥',
      category: 'engagement',
      xp_reward: 100,
      metric: null,
      threshold: null,
      sort_order: 1,
      is_secret: false,
    };
    awardBadgeRpcMock.mockResolvedValue(BADGE);
    const client = makeClient();
    let ctx: ReturnType<typeof useGamification> | null = null;

    render(
      <Wrapper client={client}>
        <ContextProbe onContext={(c) => { ctx = c; }} />
      </Wrapper>,
    );

    await act(async () => {
      await ctx!.awardBadge('on_fire');
    });

    await waitFor(() => {
      expect(screen.getByTestId('badge-modal')).toBeInTheDocument();
    });
  });

  it('does NOT show a BadgeEarnedModal when awardBadge returns null (already awarded)', async () => {
    awardBadgeRpcMock.mockResolvedValue(null);
    const client = makeClient();
    let ctx: ReturnType<typeof useGamification> | null = null;

    render(
      <Wrapper client={client}>
        <ContextProbe onContext={(c) => { ctx = c; }} />
      </Wrapper>,
    );

    await act(async () => {
      await ctx!.awardBadge('on_fire');
    });

    expect(screen.queryByTestId('badge-modal')).not.toBeInTheDocument();
  });

  it('does NOT fire a level-up popup on the first profile observation (baseline)', async () => {
    // On first mount the provider just records the baseline level; no popup
    const client = makeClient();
    render(
      <Wrapper client={client}>
        <ContextProbe onContext={() => {}} />
      </Wrapper>,
    );
    // Give effects time to settle
    await act(async () => {});
    expect(screen.queryByTestId('level-modal')).not.toBeInTheDocument();
  });
});

// ─── badgeLabel ───────────────────────────────────────────────────────────────

describe('badgeLabel', () => {
  // i18n is initialised globally in setup.ts. For badges not in the EN
  // translation file, the i18next `t()` function returns the defaultValue.
  it('returns defaultValue (DB text) when no translation key exists', () => {
    // Create a minimal TFunction stub that always returns the default value
    const t = (key: string, opts: { defaultValue?: string } = {}) =>
      opts.defaultValue ?? key;
    const def = { key: 'no_such_badge', name: 'DB Name', description: 'DB Desc' };
    const result = badgeLabel(t as any, def);
    expect(result.name).toBe('DB Name');
    expect(result.description).toBe('DB Desc');
  });

  it('returns the i18n override when the key is present in the translation', () => {
    // Simulate a TFunction that returns a known override for a given key
    const overrides: Record<string, string> = {
      'common:achievements.badgeDefs.first_lecture.name': 'Erster Vortrag',
      'common:achievements.badgeDefs.first_lecture.description': 'Ersten Vortrag abgeschlossen',
    };
    const t = (key: string, opts: { defaultValue?: string } = {}) =>
      overrides[key] ?? opts.defaultValue ?? key;
    const def = { key: 'first_lecture', name: 'First Lecture', description: 'Completed first lecture' };
    const result = badgeLabel(t as any, def);
    expect(result.name).toBe('Erster Vortrag');
    expect(result.description).toBe('Ersten Vortrag abgeschlossen');
  });
});

// ─── categoryLabel ────────────────────────────────────────────────────────────

describe('categoryLabel', () => {
  it('returns the i18n override when a translation exists', () => {
    const t = (key: string, opts: { defaultValue?: string } = {}) =>
      key === 'common:achievements.categories.learning' ? 'Lernen' : opts.defaultValue ?? key;
    expect(categoryLabel(t as any, 'learning')).toBe('Lernen');
  });

  it('falls back to capitalised category id when no translation exists', () => {
    const t = (_key: string, opts: { defaultValue?: string } = {}) => opts.defaultValue ?? _key;
    expect(categoryLabel(t as any, 'engagement')).toBe('Engagement');
    expect(categoryLabel(t as any, 'achievement')).toBe('Achievement');
  });

  it('handles single-character categories', () => {
    const t = (_key: string, opts: { defaultValue?: string } = {}) => opts.defaultValue ?? _key;
    expect(categoryLabel(t as any, 'x')).toBe('X');
  });
});
