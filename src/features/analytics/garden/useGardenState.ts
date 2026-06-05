import { useCallback, useState } from 'react';

/**
 * View state machine for the garden: garden → expanded(insightId).
 * (The Layer-3 evidence drawer is a later phase; expansion is Layer 2.)
 */
export function useGardenState() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const expand = useCallback((id: string) => setExpandedId(id), []);
  const collapse = useCallback(() => setExpandedId(null), []);
  const toggleShowAll = useCallback(() => setShowAll((v) => !v), []);

  return { expandedId, expand, collapse, showAll, toggleShowAll };
}
