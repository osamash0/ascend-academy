import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import '@/i18n';
import { useLunaSession } from '../data/useLunaSession';
import { lunaApi, type LunaSessionRow } from '../data/lunaSession';

vi.mock('../data/lunaSession', async (orig) => ({
  ...(await orig<typeof import('../data/lunaSession')>()),
  lunaApi: { sessions: vi.fn(), get: vi.fn(), start: vi.fn(), turn: vi.fn(), wrap: vi.fn() },
}));

const row = (over: Partial<LunaSessionRow> = {}): LunaSessionRow => ({
  id: 's1', space_id: 'sp', lecture_id: 'L1', goal: '', plan: [], status: 'active', wrap: null, kept: false,
  turn_count: 1, updated_at: '', ...over,
});

const hook = (over: Partial<Parameters<typeof useLunaSession>[0]> = {}) =>
  renderHook((props: Parameters<typeof useLunaSession>[0]) => useLunaSession(props), {
    initialProps: { spaceId: 'sp', lessonId: 'L1', onMove: vi.fn(), readingAt: () => 7, active: true, ...over },
  });

beforeEach(() => {
  vi.mocked(lunaApi.sessions).mockReset();
  vi.mocked(lunaApi.get).mockReset();
  vi.mocked(lunaApi.turn).mockReset();
  vi.mocked(lunaApi.wrap).mockReset();
});

describe('useLunaSession', () => {
  it('opening the column picks up the active session for this Lesson instead of starting anew', async () => {
    vi.mocked(lunaApi.sessions).mockResolvedValue({ sessions: [row()] });
    vi.mocked(lunaApi.get).mockResolvedValue({
      session: row(),
      turns: [{ id: 't1', role: 'luna', content: { say: 'Welcome back.' }, created_at: '' }],
    });
    const { result } = hook();
    await waitFor(() => expect(result.current.state.sessionId).toBe('s1'));
    expect(lunaApi.sessions).toHaveBeenCalledWith('sp');
    expect(lunaApi.get).toHaveBeenCalledWith('s1');
    expect(result.current.state.thread[0]).toMatchObject({ kind: 'luna', md: 'Welcome back.' });
    expect(lunaApi.start).not.toHaveBeenCalled();
  });

  it('leaves a session for another Lesson, or one that has ended, alone', async () => {
    vi.mocked(lunaApi.sessions).mockResolvedValue({ sessions: [row({ lecture_id: 'L2' })] });
    const { result, unmount } = hook();
    await waitFor(() => expect(lunaApi.sessions).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(lunaApi.get).not.toHaveBeenCalled();
    expect(result.current.state.sessionId).toBeNull();
    unmount();
    vi.mocked(lunaApi.sessions).mockResolvedValue({ sessions: [row({ status: 'wrapped' })] });
    hook();
    await waitFor(() => expect(lunaApi.sessions).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(lunaApi.get).not.toHaveBeenCalled();
  });

  it('fetches nothing while the column is closed', async () => {
    const { rerender } = hook({ active: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(lunaApi.sessions).not.toHaveBeenCalled();
    vi.mocked(lunaApi.sessions).mockResolvedValue({ sessions: [] });
    rerender({ spaceId: 'sp', lessonId: 'L1', onMove: vi.fn(), readingAt: () => 7, active: true });
    await waitFor(() => expect(lunaApi.sessions).toHaveBeenCalledTimes(1));
  });

  it('sends reading_at only while the reader is in the session\'s Lesson', async () => {
    vi.mocked(lunaApi.sessions).mockResolvedValue({ sessions: [row()] });
    vi.mocked(lunaApi.get).mockResolvedValue({ session: row(), turns: [] });
    vi.mocked(lunaApi.turn).mockImplementation(async (_sid, _body, onEvent) => {
      onEvent({ type: 'end', data: { turn_count: 1, offer_wrap: false } });
    });
    const onMove = vi.fn();
    const readingAt = () => 7;
    const { result, rerender } = hook({ onMove, readingAt });
    await waitFor(() => expect(result.current.state.sessionId).toBe('s1'));
    await act(() => result.current.send('here?'));
    expect(vi.mocked(lunaApi.turn).mock.calls[0][1]).toMatchObject({ text: 'here?', reading_at: 7 });
    rerender({ spaceId: 'sp', lessonId: 'L2', onMove, readingAt, active: true });
    await act(() => result.current.send('and now?'));
    expect(vi.mocked(lunaApi.turn).mock.calls[1][1]).not.toHaveProperty('reading_at');
  });
});
