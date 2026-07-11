import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Loader2, Plus, FileText, X, ExternalLink, Upload,
  GraduationCap, Pencil, Save, Trash2, NotebookText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  getCourse,
  unassignLectureFromCourse,
  assignLectureToCourse,
  fetchCourseContext,
  updateCourseContext,
  type CourseWithLectures,
  type CourseContext,
  type ExamDate,
} from '@/services/coursesService';
import { fetchProfessorLectures, archiveLecture } from '@/services/lectureService';
import { useAuth } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Lecture } from '@/types/domain';
import { StudentRoutes } from '@/lib/routes';

import { useCurriculumTranslation } from '@/hooks/useCurriculumTranslation';

interface CourseFactsFormState {
  instructor: string;
  grading_scheme: string;
  exam_dates: ExamDate[];
}

function emptyFormState(): CourseFactsFormState {
  return { instructor: '', grading_scheme: '', exam_dates: [] };
}

function contextToForm(ctx: CourseContext | null): CourseFactsFormState {
  if (!ctx) return emptyFormState();
  return {
    instructor: ctx.instructor ?? '',
    grading_scheme: ctx.grading_scheme ?? '',
    exam_dates: ctx.exam_dates ?? [],
  };
}

function CourseFactsCard({ courseId }: { courseId: string }) {
  const { toast } = useToast();
  const [context, setContext] = useState<CourseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CourseFactsFormState>(emptyFormState());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContext(await fetchCourseContext(courseId));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { void load(); }, [load]);

  const startEditing = () => {
    setForm(contextToForm(context));
    setEditing(true);
  };

  const cancelEditing = () => setEditing(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateCourseContext(courseId, {
        instructor: form.instructor.trim() || null,
        grading_scheme: form.grading_scheme.trim() || null,
        exam_dates: form.exam_dates.filter((d) => d.label.trim() || d.date.trim()),
      });
      setContext(updated);
      setEditing(false);
      toast({ title: 'Course facts saved' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to save course facts', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const addExamDate = () => setForm((f) => ({ ...f, exam_dates: [...f.exam_dates, { label: '', date: '' }] }));
  const removeExamDate = (i: number) => setForm((f) => ({ ...f, exam_dates: f.exam_dates.filter((_, idx) => idx !== i) }));
  const updateExamDate = (i: number, patch: Partial<ExamDate>) =>
    setForm((f) => ({ ...f, exam_dates: f.exam_dates.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) }));

  if (loading) {
    return (
      <div className="glass-card p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasFacts = !!context && (context.instructor || context.grading_scheme || context.exam_dates.length > 0);

  return (
    <div className="glass-card p-6 space-y-4" data-testid="course-facts-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-foreground">Course facts</h2>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={startEditing} data-testid="course-facts-edit">
            <Pencil className="w-3.5 h-3.5" /> {hasFacts ? 'Edit' : 'Add facts'}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cf-instructor">Instructor</Label>
            <Input
              id="cf-instructor"
              value={form.instructor}
              onChange={(e) => setForm((f) => ({ ...f, instructor: e.target.value }))}
              placeholder="e.g. Prof. Ada Lovelace"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cf-grading">Grading scheme</Label>
            <Textarea
              id="cf-grading"
              value={form.grading_scheme}
              onChange={(e) => setForm((f) => ({ ...f, grading_scheme: e.target.value }))}
              placeholder="e.g. 50% final exam, 30% homework, 20% participation"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Exam dates</Label>
            {form.exam_dates.map((d, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  value={d.label}
                  onChange={(e) => updateExamDate(i, { label: e.target.value })}
                  placeholder="Label (e.g. Midterm)"
                  className="flex-1"
                />
                <Input
                  value={d.date}
                  onChange={(e) => updateExamDate(i, { date: e.target.value })}
                  placeholder="Date"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeExamDate(i)}
                  className="text-muted-foreground hover:text-destructive p-1.5"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={addExamDate}>
              <Plus className="w-3.5 h-3.5" /> Add date
            </Button>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" className="gap-1.5" onClick={save} disabled={saving} data-testid="course-facts-save">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : hasFacts ? (
        <div className="space-y-2 text-sm">
          {context!.instructor && (
            <p><span className="text-muted-foreground">Instructor:</span> {context!.instructor}</p>
          )}
          {context!.grading_scheme && (
            <p><span className="text-muted-foreground">Grading:</span> {context!.grading_scheme}</p>
          )}
          {context!.exam_dates.length > 0 && (
            <div>
              <span className="text-muted-foreground">Exam dates:</span>
              <ul className="mt-1 space-y-0.5">
                {context!.exam_dates.map((d, i) => (
                  <li key={i} className="text-foreground">{d.label}: {d.date}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No course facts yet. They're extracted automatically from syllabus/administrative slides, or you can add them manually.
        </p>
      )}
    </div>
  );
}

/**
 * StudyGuideCard — entry point to the full study guide page (Roadmap Phase
 * 4.4, `/course/{id}/study-guide`, `src/pages/StudyGuide.tsx`). Kept
 * deliberately thin here: the dedicated page owns generation/regeneration/
 * printing, so this card only needs to get the professor there.
 */
function StudyGuideCard({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  return (
    <div className="glass-card p-6 flex items-center justify-between gap-3" data-testid="study-guide-card">
      <div className="flex items-center gap-2">
        <NotebookText className="w-5 h-5 text-primary" />
        <div>
          <h2 className="font-bold text-foreground">Study Guide</h2>
          <p className="text-xs text-muted-foreground">Per-lecture synopses, key concepts, and exam facts in one place.</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 shrink-0"
        onClick={() => navigate(StudentRoutes.STUDY_GUIDE(courseId))}
        data-testid="study-guide-open"
      >
        <NotebookText className="w-3.5 h-3.5" />
        Open Study Guide
      </Button>
    </div>
  );
}

export default function ProfessorCourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const translateCurriculum = useCurriculumTranslation();
  const [course, setCourse] = useState<CourseWithLectures | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allLectures, setAllLectures] = useState<Lecture[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      setCourse(await getCourse(courseId));
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to load course', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [courseId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openPicker = async () => {
    if (!user) return;
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const all = await fetchProfessorLectures(user.id);
      setAllLectures(all);
    } finally {
      setPickerLoading(false);
    }
  };

  const handleAssign = async (lectureId: string) => {
    if (!courseId) return;
    try {
      await assignLectureToCourse(courseId, lectureId);
      toast({ title: 'Lecture added to course' });
      setPickerOpen(false);
      await refresh();
    } catch (e) {
      toast({ title: 'Assign failed', description: String(e), variant: 'destructive' });
    }
  };

  const handleUnassign = async (lectureId: string) => {
    if (!courseId) return;
    if (!confirm('Remove this lecture from the course? It will also be archived.')) return;
    try {
      await unassignLectureFromCourse(courseId, lectureId);
      await archiveLecture(lectureId);
      toast({ title: 'Lecture removed and archived' });
      await refresh();
    } catch (e) {
      toast({ title: 'Remove failed', variant: 'destructive' });
    }
  };

  if (loading || !course) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const assignedIds = new Set(course.lectures.map((l) => l.id));
  const unassignable = allLectures.filter((l) => !assignedIds.has(l.id));

  return (
    <div className="relative min-h-screen p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <Button variant="ghost" onClick={() => navigate('/professor/courses')} className="gap-2">
        <ArrowLeft className="w-4 h-4" /> All courses
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: course.color || '#6366f1' }}
          >
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{translateCurriculum(course.title)}</h1>
            {course.description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{course.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {course.lectures.length} lecture{course.lectures.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={openPicker} variant="outline" className="gap-2">
            <Plus className="w-4 h-4" /> Add lecture
          </Button>
          <Button onClick={() => navigate(`/professor/upload?courseId=${courseId}`)} className="gap-2">
            <Upload className="w-4 h-4" /> Upload new
          </Button>
        </div>
      </div>

      {courseId && <CourseFactsCard courseId={courseId} />}
      {courseId && <StudyGuideCard courseId={courseId} />}

      {course.lectures.length === 0 ? (
        <div className="glass-card p-10 text-center space-y-3">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="font-semibold">No lectures in this course yet</p>
          <p className="text-sm text-muted-foreground">Add an existing lecture, or upload a new one.</p>
          <div className="flex justify-center gap-2">
            <Button onClick={openPicker} variant="outline" className="gap-2"><Plus className="w-4 h-4" /> Add existing</Button>
            <Button onClick={() => navigate(`/professor/upload?courseId=${courseId}`)} className="gap-2"><Plus className="w-4 h-4" /> Upload new</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {course.lectures.map((l) => (
            <div key={l.id} className="glass-card p-5 space-y-3 group">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-foreground line-clamp-2">{translateCurriculum(l.title)}</h3>
                <button
                  onClick={() => handleUnassign(l.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded-md"
                  title="Remove from course"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {l.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">{l.description}</p>
              )}
              <p className="text-xs text-muted-foreground">{l.total_slides} slides</p>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() => navigate(`/professor/lecture/${l.id}`)}
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() => navigate(`/professor/lecture/${l.id}#worksheets`)}
                  title="Upload or manage worksheets"
                >
                  <Upload className="w-3.5 h-3.5" /> Worksheets
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add lecture to course</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto -mx-2">
            {pickerLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : unassignable.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                All your lectures are already in this course.
              </p>
            ) : (
              <ul className="space-y-1">
                {unassignable.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => handleAssign(l.id)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground line-clamp-1">{translateCurriculum(l.title)}</p>
                        <p className="text-xs text-muted-foreground">{l.total_slides} slides</p>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
