import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Sparkles, AlertCircle, ChevronRight, BookOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { fetchStudentMastery, fetchRelatedLectures } from '@/services/conceptsService';
import type { ConceptMasteryItem, RelatedLecture } from '@/services/conceptsService';

interface Props {
  userId: string;
}

export function KnowledgeMapCard({ userId }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [mastered, setMastered] = useState<ConceptMasteryItem[]>([]);
  const [weak, setWeak] = useState<ConceptMasteryItem[]>([]);
  const [openConceptId, setOpenConceptId] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedLecture[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await fetchStudentMastery(userId);
        if (cancelled) return;
        setMastered(data.mastered);
        setWeak(data.weak);
      } catch (e) {
        console.warn('Knowledge map load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const toggleConcept = async (conceptId: string) => {
    if (openConceptId === conceptId) {
      setOpenConceptId(null);
      setRelated([]);
      return;
    }
    setOpenConceptId(conceptId);
    setRelated([]);
    setRelatedLoading(true);
    try {
      const rows = await fetchRelatedLectures(conceptId, 5);
      setRelated(rows);
    } catch (e) {
      console.warn('Failed to load related lectures:', e);
    } finally {
      setRelatedLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-5 w-44 bg-surface-2 rounded mb-4" />
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-4 w-full bg-surface-2 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (mastered.length === 0 && weak.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-5 h-5 text-primary" />
          <h3 className="text-heading-md text-foreground">Your knowledge map</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Take a few quizzes to build your cross-course concept mastery view.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass-card p-6"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <h3 className="text-heading-md text-foreground">Your knowledge map</h3>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-primary font-bold">
          Across all courses
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Mastered column */}
        <div>
          <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold uppercase tracking-wider text-success">
            <Sparkles className="w-3.5 h-3.5" />
            Top mastered
          </div>
          {mastered.length === 0 ? (
            <p className="text-xs text-muted-foreground">No mastered concepts yet — keep going!</p>
          ) : (
            <ul className="space-y-1.5">
              {mastered.map(c => (
                <ConceptRow
                  key={c.concept_id}
                  concept={c}
                  open={openConceptId === c.concept_id}
                  onToggle={() => toggleConcept(c.concept_id)}
                  variant="mastered"
                  related={openConceptId === c.concept_id ? related : []}
                  relatedLoading={openConceptId === c.concept_id ? relatedLoading : false}
                  onPickLecture={(id) => navigate(`/lecture/${id}`)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Weak column */}
        <div>
          <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold uppercase tracking-wider text-warning">
            <AlertCircle className="w-3.5 h-3.5" />
            Needs review
          </div>
          {weak.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing flagged for review.</p>
          ) : (
            <ul className="space-y-1.5">
              {weak.map(c => (
                <ConceptRow
                  key={c.concept_id}
                  concept={c}
                  open={openConceptId === c.concept_id}
                  onToggle={() => toggleConcept(c.concept_id)}
                  variant="weak"
                  related={openConceptId === c.concept_id ? related : []}
                  relatedLoading={openConceptId === c.concept_id ? relatedLoading : false}
                  onPickLecture={(id) => navigate(`/lecture/${id}`)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}

interface RowProps {
  concept: ConceptMasteryItem;
  open: boolean;
  onToggle: () => void;
  variant: 'mastered' | 'weak';
  related: RelatedLecture[];
  relatedLoading: boolean;
  onPickLecture: (id: string) => void;
}

function ConceptRow({ concept, open, onToggle, variant, related, relatedLoading, onPickLecture }: RowProps) {
  const pct = Math.round(concept.mastery_score * 100);
  const tone = variant === 'mastered' ? 'text-success' : 'text-warning';
  return (
    <li className="rounded-lg border border-white/5 hover:border-primary/30 transition-colors">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="truncate text-sm text-foreground">{concept.name}</span>
        <span className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-bold ${tone}`}>{pct}%</span>
          <ChevronRight
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5">
          {relatedLoading ? (
            <p className="text-xs text-muted-foreground">Loading related lectures…</p>
          ) : related.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other lectures cover this concept yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {related.map(r => (
                <li key={r.lecture_id}>
                  <button
                    onClick={() => onPickLecture(r.lecture_id)}
                    className="w-full flex items-center gap-2 text-xs text-foreground hover:text-primary transition-colors text-left"
                  >
                    <BookOpen className="w-3 h-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{r.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
