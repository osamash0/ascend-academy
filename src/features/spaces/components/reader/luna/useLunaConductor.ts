import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LunaMove } from '../../../data/lunaSession';

/**
 * The one place Luna touches the reader. A move in this Lesson goes through
 * the reader's own page turn and Spotlight; a move into another Lesson opens
 * it at that page with the session column open (`luna=1`).
 */
export function useLunaConductor({
  lessonId, spaceId, goToPage, setSpot, navigate,
}: {
  lessonId: string;
  spaceId: string;
  goToPage: (page: number) => void;
  setSpot: (words: string | null) => void;
  navigate: (to: string) => void;
}) {
  const { t } = useTranslation('v4Luna');
  const [announce, setAnnounce] = useState('');
  const onMove = useCallback(
    (m: LunaMove) => {
      if (m.lecture_id !== lessonId) {
        const spot = m.spot ? `&spot=${encodeURIComponent(m.spot)}` : '';
        navigate(`/v4/space/${spaceId}/lesson/${m.lecture_id}/faces?page=${m.page}${spot}&luna=1`);
        return;
      }
      goToPage(m.page);
      setSpot(m.spot ?? null);
      setAnnounce(t('move.announce', { page: m.page }));
    },
    [lessonId, spaceId, goToPage, setSpot, navigate, t],
  );
  return { onMove, announce };
}
