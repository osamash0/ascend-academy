import { useCallback, useState } from 'react';

export interface EvidenceRequest {
  kind: string;
  slideId?: string;
  studentId?: string;
}

/**
 * View state machine for the garden: garden → expanded(insightId) → evidence(kind, target).
 * A single back gesture collapses drawer → card → garden.
 */
export function useGardenState() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);

  const expand = useCallback((id: string) => setExpandedId(id), []);
  const collapse = useCallback(() => {
    setExpandedId(null);
    setEvidence(null);
  }, []);
  const toggleShowAll = useCallback(() => setShowAll((v) => !v), []);
  const openEvidence = useCallback((request: EvidenceRequest) => setEvidence(request), []);
  const closeEvidence = useCallback(() => setEvidence(null), []);

  return { expandedId, expand, collapse, showAll, toggleShowAll, evidence, openEvidence, closeEvidence };
}
