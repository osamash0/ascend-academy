import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Network, BookOpen } from 'lucide-react';
import {
  fetchLectureConcepts,
  fetchRelatedLectures,
  type LectureConcept,
  type RelatedLecture,
} from '@/services/conceptsService';

interface Props {
  lectureId: string;
  /** Max related lectures to surface per concept (1 or 2). */
  perConcept?: number;
}

interface ConceptWithRelated {
  concept: LectureConcept;
  related: RelatedLecture[];
}

export function RelatedAcrossCoursesPanel({
  lectureId,
  perConcept = 2,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConceptWithRelated[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const concepts = await fetchLectureConcepts(lectureId);
        const results = await Promise.all(
          concepts.map(async (c) => {
            try {
              const related = await fetchRelatedLectures(c.concept_id, perConcept, lectureId);
              return { concept: c, related };
            } catch {
              return { concept: c, related: [] as RelatedLecture[] };
            }
          }),
        );
        if (!cancelled) {
          // Drop concepts with no other lectures so the panel only shows
          // actionable cross-course links.
          setRows(results.filter((r) => r.related.length > 0));
        }
      } catch (e) {
        console.warn('Failed to load related-across-courses panel:', e);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lectureId, perConcept]);

  if (loading) {
    return (
      <div className="bg-card/40 rounded-2xl border border-border p-5 animate-pulse">
        <div className="h-5 w-56 bg-surface-2 rounded mb-3" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-4 w-full bg-surface-2 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card/40 rounded-2xl border border-border p-5"
      data-testid="related-across-courses"
    >
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">
            Related across your courses
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-primary font-bold">
          Concept overlap
        </span>
      </header>

      <ul className="space-y-3">
        {rows.map(({ concept, related }) => (
          <li key={concept.concept_id}>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              {concept.name}
            </div>
            <ul className="space-y-1">
              {related.map((r) => (
                <li key={r.lecture_id}>
                  <button
                    onClick={() => navigate(`/lecture/${r.lecture_id}`)}
                    className="w-full flex items-center gap-2 text-xs text-foreground hover:text-primary transition-colors text-left rounded-md px-2 py-1.5 hover:bg-white/5"
                  >
                    <BookOpen className="w-3 h-3 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{r.title}</span>
                    {r.slide_indices.length > 0 && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {r.slide_indices.length} slide{r.slide_indices.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
