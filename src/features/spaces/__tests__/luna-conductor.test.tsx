// src/features/spaces/__tests__/luna-conductor.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import '@/i18n';
import { useLunaConductor } from '../components/reader/luna/useLunaConductor';
import { markOffered, shouldOffer } from '../components/reader/luna/lunaOffer';

afterEach(() => localStorage.clear());

describe('useLunaConductor', () => {
  it('a move in this Lesson turns the page and lights the words, and is announced', () => {
    const goToPage = vi.fn();
    const setSpot = vi.fn();
    const navigate = vi.fn();
    const { result } = renderHook(() => useLunaConductor({ lessonId: 'l1', spaceId: 's1', goToPage, setSpot, navigate }));
    act(() => result.current.onMove({ lecture_id: 'l1', page: 12, spot: 'agree on X' }));
    expect(goToPage).toHaveBeenCalledWith(12);
    expect(setSpot).toHaveBeenCalledWith('agree on X');
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.announce).toBe('Luna moved to page 12');
  });

  it('a move into another Lesson opens it at that page', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useLunaConductor({ lessonId: 'l1', spaceId: 's1', goToPage: vi.fn(), setSpot: vi.fn(), navigate }),
    );
    act(() => result.current.onMove({ lecture_id: 'l2', page: 3, spot: 'join' }));
    expect(navigate).toHaveBeenCalledWith('/v4/space/s1/lesson/l2/faces?page=3&spot=join&luna=1');
  });

  it('a move without words clears the light here, and carries no spot into another Lesson', () => {
    const setSpot = vi.fn();
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useLunaConductor({ lessonId: 'l1', spaceId: 's1', goToPage: vi.fn(), setSpot, navigate }),
    );
    act(() => result.current.onMove({ lecture_id: 'l1', page: 4 }));
    expect(setSpot).toHaveBeenCalledWith(null);
    act(() => result.current.onMove({ lecture_id: 'l2', page: 7 }));
    expect(navigate).toHaveBeenCalledWith('/v4/space/s1/lesson/l2/faces?page=7&luna=1');
  });
});

describe('the gentle offer', () => {
  it('comes once per Lesson per day', () => {
    const day = new Date('2026-10-24T10:00:00');
    expect(shouldOffer('l1', day)).toBe(true);
    markOffered('l1', day);
    expect(shouldOffer('l1', new Date('2026-10-24T18:00:00'))).toBe(false);
    expect(shouldOffer('l2', day)).toBe(true);
    expect(shouldOffer('l1', new Date('2026-10-25T09:00:00'))).toBe(true);
  });
});
