import { useCallback, useState } from 'react';
import { setShowInSpaces, showInSpacesNow } from './social';

/**
 * The viewer's "Show me to the people in my Spaces" switch (LS-036): moves at
 * once, then saves; if the save fails it goes back and says so (`false`).
 */
export function useShowInSpaces() {
  const [on, setOn] = useState(showInSpacesNow);
  const [saving, setSaving] = useState(false);
  const change = useCallback(
    async (next: boolean): Promise<boolean> => {
      const before = on;
      setOn(next);
      setSaving(true);
      try {
        setOn(await setShowInSpaces(next));
        return true;
      } catch {
        setOn(before);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [on],
  );
  return { on, saving, change };
}
