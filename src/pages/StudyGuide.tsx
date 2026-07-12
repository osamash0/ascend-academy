import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  BookOpen, ChevronLeft, RefreshCw, Loader2,
  NotebookText, Brain, CalendarDays, GraduationCap,
  User, Printer, Lightbulb, FileText,
} from 'lucide-react';
import { fetchStudyGuide } from '@/services/coursesService';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────
interface StudyGuideLecture { lecture_id: string; title: string; synopsis: string; }
interface StudyGuideConcept { name: string; definition: string; }
interface StudyGuide {
  lectures: StudyGuideLecture[];
  concepts: StudyGuideConcept[];
  course_facts: { instructor: string | null; exam_dates: { label: string; date: string }[]; grading_scheme: string | null };
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/8 bg-white/4 p-5 animate-pulse ${className}`}>
      <div className="h-4 bg-white/10 rounded-full w-2/3 mb-3" />
      <div className="space-y-2">
        <div className="h-3 bg-white/6 rounded-full w-full" />
        <div className="h-3 bg-white/6 rounded-full w-5/6" />
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, label, count }: { icon: React.ElementType; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 rounded-xl bg-[hsl(258,35%,18%)] border border-[hsl(258,35%,28%)] flex items-center justify-center">
        <Icon className="w-4 h-4 text-[hsl(258,60%,75%)]" aria-hidden="true" />
      </div>
      <h2 className="text-[15px] font-bold text-white/90 tracking-tight">{label}</h2>
      {count !== undefined && (
        <span className="ml-auto text-xs font-semibold text-white/30 tabular-nums">{count}</span>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function StudyGuide() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isProfessor = profile?.role === 'professor';

  const [regenerating, setRegenerating] = useState(false);

  const { data: guide, isLoading, isError } = useQuery<StudyGuide>({
    queryKey: ['study-guide', courseId],
    queryFn: () => fetchStudyGuide(courseId!),
    enabled: !!courseId,
    staleTime: 1000 * 60 * 10,
  });

  const handleRegenerate = async () => {
    if (!courseId) return;
    setRegenerating(true);
    try {
      const fresh = await fetchStudyGuide(courseId, { regenerate: true });
      queryClient.setQueryData(['study-guide', courseId], fresh);
      toast.success('Study guide regenerated!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to regenerate study guide.');
    } finally {
      setRegenerating(false);
    }
  };

  const hasCourseData = guide && (
    guide.course_facts.instructor ||
    guide.course_facts.grading_scheme ||
    (guide.course_facts.exam_dates?.length ?? 0) > 0
  );

  return (
    <div className="relative min-h-screen bg-[hsl(258,20%,8%)]">
      {/* Ambient background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, hsl(258 40% 20% / 0.55), transparent)',
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24">

        {/* ── Top bar ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-10 gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm font-semibold text-white/50 hover:text-white/80 transition-colors group"
            id="study-guide-back-btn"
          >
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" aria-hidden="true" />
            Back
          </button>

          <div className="flex items-center gap-2">
            {isProfessor && (
              <button
                onClick={handleRegenerate}
                disabled={regenerating || isLoading}
                id="study-guide-regenerate-btn"
                className="flex items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-4 py-2 text-xs font-bold text-white/70 hover:bg-white/10 hover:text-white transition-all disabled:opacity-40"
              >
                {regenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                Regenerate
              </button>
            )}
            <button
              onClick={() => window.print()}
              id="study-guide-print-btn"
              className="flex items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-4 py-2 text-xs font-bold text-white/70 hover:bg-white/10 hover:text-white transition-all print:hidden"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              Export PDF
            </button>
          </div>
        </div>

        {/* ── Page title ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-2">
            <NotebookText className="w-6 h-6 text-[hsl(258,60%,70%)]" aria-hidden="true" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[hsl(258,60%,70%)]">Study Guide</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight">
            Your Course Summary
          </h1>
          <p className="mt-2 text-sm text-white/40 max-w-lg">
            AI-generated overview combining every lecture synopsis, key concepts with definitions, and course facts.
          </p>
        </motion.div>

        {/* ── Loading state ──────────────────────────────────────── */}
        {isLoading && (
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
            </div>
            <SkeletonCard className="h-48" />
          </div>
        )}

        {/* ── Error state ────────────────────────────────────────── */}
        {isError && !isLoading && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-10 text-center">
            <FileText className="w-10 h-10 text-red-400/60 mx-auto mb-3" aria-hidden="true" />
            <p className="font-semibold text-white/70">Couldn't load the study guide.</p>
            <p className="text-sm text-white/40 mt-1">The feature may not be enabled for this course yet.</p>
          </div>
        )}

        {/* ── Content ────────────────────────────────────────────── */}
        {guide && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="space-y-12"
          >

            {/* ── 1. Lectures ──────────────────────────────────── */}
            {guide.lectures.length > 0 && (
              <section id="study-guide-lectures" aria-label="Lectures">
                <SectionHeader icon={BookOpen} label="Lectures" count={guide.lectures.length} />
                <div className="grid sm:grid-cols-2 gap-4">
                  {guide.lectures.map((lec, i) => (
                    <motion.div
                      key={lec.lecture_id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="group rounded-2xl border border-white/8 bg-white/[0.03] p-5 hover:bg-white/[0.06] hover:border-[hsl(258,35%,35%)]/50 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-[hsl(258,40%,20%)] border border-[hsl(258,35%,30%)] flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-[10px] font-black text-[hsl(258,60%,70%)]">{i + 1}</span>
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-white/90 text-sm leading-snug mb-1.5 truncate">{lec.title}</h3>
                          {lec.synopsis ? (
                            <p className="text-xs text-white/45 leading-relaxed line-clamp-3">{lec.synopsis}</p>
                          ) : (
                            <p className="text-xs text-white/25 italic">No synopsis available.</p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* ── 2. Key Concepts ──────────────────────────────── */}
            {guide.concepts.length > 0 && (
              <section id="study-guide-concepts" aria-label="Key Concepts">
                <SectionHeader icon={Brain} label="Key Concepts" count={guide.concepts.length} />
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] overflow-hidden divide-y divide-white/6">
                  {guide.concepts.map((concept, i) => (
                    <motion.div
                      key={concept.name}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className="flex gap-4 px-5 py-4 hover:bg-white/[0.04] transition-colors"
                    >
                      <Lightbulb className="w-4 h-4 text-[hsl(258,60%,65%)] flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="min-w-0">
                        <span className="font-bold text-sm text-white/85">{concept.name}</span>
                        {concept.definition ? (
                          <p className="text-xs text-white/45 leading-relaxed mt-0.5">{concept.definition}</p>
                        ) : (
                          <p className="text-xs text-white/25 italic mt-0.5">No definition available.</p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* ── 3. Course Facts ──────────────────────────────── */}
            {hasCourseData && (
              <section id="study-guide-course-facts" aria-label="Course Facts">
                <SectionHeader icon={GraduationCap} label="Course Facts" />
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-6 space-y-4">
                  {guide.course_facts.instructor && (
                    <div className="flex items-center gap-3">
                      <User className="w-4 h-4 text-white/35 flex-shrink-0" aria-hidden="true" />
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/30">Instructor</span>
                        <p className="text-sm font-semibold text-white/80 mt-0.5">{guide.course_facts.instructor}</p>
                      </div>
                    </div>
                  )}
                  {guide.course_facts.grading_scheme && (
                    <div className="flex items-start gap-3">
                      <NotebookText className="w-4 h-4 text-white/35 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/30">Grading</span>
                        <p className="text-sm text-white/70 mt-0.5 leading-relaxed">{guide.course_facts.grading_scheme}</p>
                      </div>
                    </div>
                  )}
                  {(guide.course_facts.exam_dates?.length ?? 0) > 0 && (
                    <div className="flex items-start gap-3">
                      <CalendarDays className="w-4 h-4 text-white/35 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/30">Exam Dates</span>
                        <div className="mt-1 space-y-1">
                          {guide.course_facts.exam_dates.map((d, i) => (
                            <p key={i} className="text-sm text-white/70">
                              <span className="font-semibold text-white/85">{d.label}:</span> {d.date}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ── Empty state ──────────────────────────────────── */}
            {guide.lectures.length === 0 && guide.concepts.length === 0 && !hasCourseData && (
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-16 text-center">
                <BookOpen className="w-12 h-12 text-white/20 mx-auto mb-4" aria-hidden="true" />
                <p className="font-bold text-white/50">No content yet.</p>
                <p className="text-sm text-white/30 mt-1">Add lectures to this course to generate a study guide.</p>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
