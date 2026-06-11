/**
 * Academic profile editor — lets a student set/update their university,
 * faculty, degree program, current semester, and confirm catalog courses
 * AFTER onboarding (from Settings). This is what activates academic friend
 * suggestions, course recommendations, and leaderboard cohort filters for users
 * who registered before the feature existed. Reuses the same RPCs as onboarding.
 */
import { useEffect, useState } from 'react';
import { GraduationCap, Loader2, Save, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import {
  getUniversities, getFaculties, getDegreePrograms, getSuggestedCourses,
  getMyAcademicProfile, getMyCatalogCourses, setAcademicProfile, confirmCatalogCourses,
} from '@/services/academicService';
import type {
  University, Faculty, DegreeProgram, SuggestedCourse, StudentCatalogStatus,
} from '@/types/academic';

const STATUS_LABELS: Record<StudentCatalogStatus, string> = {
  completed: 'Completed',
  in_progress: 'Taking now',
  planned: 'Planned',
};
const STATUS_ORDER: StudentCatalogStatus[] = ['completed', 'in_progress', 'planned'];
const selectClass = 'h-11 w-full rounded-xl border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-50';

export function AcademicProfileEditor({ className }: { className?: string }) {
  const { toast } = useToast();
  const gamification = useGamification();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [universities, setUniversities] = useState<University[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [programs, setPrograms] = useState<DegreeProgram[]>([]);
  const [uniId, setUniId] = useState('');
  const [facId, setFacId] = useState('');
  const [progId, setProgId] = useState('');
  const [semester, setSemester] = useState(1);
  const [suggested, setSuggested] = useState<SuggestedCourse[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, StudentCatalogStatus>>({});
  const [loadingCourses, setLoadingCourses] = useState(false);

  const selectedUni = universities.find((u) => u.id === uniId);
  const noCatalog = !!selectedUni && !selectedUni.hasCatalog;

  // Initial load: universities + current profile + already-confirmed courses.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [unis, prof, mine] = await Promise.all([
          getUniversities(),
          getMyAcademicProfile(),
          getMyCatalogCourses().catch(() => []),
        ]);
        if (!alive) return;
        setUniversities(unis);
        const seeded: Record<string, StudentCatalogStatus> = {};
        mine.forEach((c) => { seeded[c.catalogCourseId] = c.status; });
        setStatusMap(seeded);
        if (prof.universityId) {
          setUniId(prof.universityId);
          const f = await getFaculties(prof.universityId);
          if (!alive) return;
          setFaculties(f);
        }
        if (prof.facultyId) {
          setFacId(prof.facultyId);
          const p = await getDegreePrograms(prof.facultyId);
          if (!alive) return;
          setPrograms(p);
        }
        if (prof.currentSemester) setSemester(prof.currentSemester);
        if (prof.degreeProgramId) {
          setProgId(prof.degreeProgramId);
          await loadSuggested(prof.degreeProgramId, prof.currentSemester ?? 1, seeded);
        }
      } catch (err) {
        console.error('Failed to load academic profile', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSuggested = async (program: string, sem: number, baseMap?: Record<string, StudentCatalogStatus>) => {
    setLoadingCourses(true);
    try {
      const items = await getSuggestedCourses(program, sem);
      setSuggested(items);
      setStatusMap((prev) => {
        const next = { ...(baseMap ?? prev) };
        items.forEach((c) => {
          if (c.preChecked && !next[c.id]) next[c.id] = c.suggestedStatus;
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to load suggested courses', err);
      setSuggested([]);
    } finally {
      setLoadingCourses(false);
    }
  };

  const onUni = async (id: string) => {
    setUniId(id); setFacId(''); setProgId(''); setPrograms([]); setSuggested([]);
    setFaculties([]);
    if (!id) return;
    const f = await getFaculties(id);
    setFaculties(f);
    if (f.length === 1) onFac(f[0].id);
  };
  const onFac = async (id: string) => {
    setFacId(id); setProgId(''); setSuggested([]); setPrograms([]);
    if (!id) return;
    const p = await getDegreePrograms(id);
    setPrograms(p);
    if (p.length === 1) onProg(p[0].id);
  };
  const onProg = (id: string) => {
    setProgId(id);
    if (id) loadSuggested(id, semester);
  };
  const onSemester = (n: number) => {
    setSemester(n);
    if (progId) loadSuggested(progId, n);
  };

  const toggle = (id: string, fallback: StudentCatalogStatus) =>
    setStatusMap((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = fallback;
      return next;
    });
  const setStatus = (id: string, s: StudentCatalogStatus) =>
    setStatusMap((prev) => ({ ...prev, [id]: s }));

  const save = async () => {
    if (!uniId || saving) return;
    setSaving(true);
    try {
      await setAcademicProfile({
        universityId: uniId,
        facultyId: facId || null,
        programId: progId || null,
        currentSemester: semester,
      });
      const items = Object.entries(statusMap).map(([catalogCourseId, status]) => ({ catalogCourseId, status }));
      if (items.length) await confirmCatalogCourses(items);
      gamification.evaluate();
      toast({ title: 'Academic profile saved', description: 'Your suggestions and recommendations will use it now.' });
    } catch (err) {
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const includedCount = Object.keys(statusMap).length;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">University</label>
          <select className={selectClass} value={uniId} onChange={(e) => onUni(e.target.value)}>
            <option value="">Select…</option>
            {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {!noCatalog && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Faculty</label>
              <select className={selectClass} value={facId} onChange={(e) => onFac(e.target.value)} disabled={!uniId || faculties.length === 0}>
                <option value="">Select…</option>
                {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Degree program</label>
              <select className={selectClass} value={progId} onChange={(e) => onProg(e.target.value)} disabled={!facId || programs.length === 0}>
                <option value="">Select…</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Current semester</label>
              <select className={selectClass} value={semester} onChange={(e) => onSemester(Number(e.target.value))} disabled={!progId}>
                {Array.from({ length: programs.find((p) => p.id === progId)?.totalSemesters || 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>Semester {n}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {noCatalog && (
        <p className="text-sm text-muted-foreground">
          We don’t have {selectedUni?.name}’s course catalog yet — your university is saved, but there are no courses to confirm.
        </p>
      )}

      {progId && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GraduationCap className="h-4 w-4 text-primary" /> Your courses
            <span className="text-xs font-normal text-muted-foreground">({includedCount} selected)</span>
          </div>
          {loadingCourses ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {suggested.map((c) => {
                const included = !!statusMap[c.id];
                const status = statusMap[c.id] ?? c.suggestedStatus;
                return (
                  <div key={c.id} className={cn('rounded-xl border p-3 transition-colors', included ? 'border-primary/40 bg-primary/5' : 'border-border')}>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggle(c.id, c.suggestedStatus)}
                        className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border', included ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}
                      >
                        {included && <Check className="h-3.5 w-3.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.courseCode ? `${c.courseCode} · ` : ''}{c.typicalSemester ? `Semester ${c.typicalSemester}` : 'Elective'}
                        </div>
                      </div>
                      {included && (
                        <div className="flex shrink-0 gap-1">
                          {STATUS_ORDER.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setStatus(c.id, s)}
                              className={cn('rounded-md px-2 py-1 text-xs font-medium transition-colors', status === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70')}
                            >
                              {STATUS_LABELS[s]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Button onClick={save} disabled={saving || !uniId}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save academic profile
      </Button>
    </div>
  );
}
