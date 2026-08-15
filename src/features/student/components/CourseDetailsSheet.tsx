import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Star,
  User,
  CheckCircle2,
  Play,
  CalendarDays,
  MapPin,
  Clock,
  Repeat,
  FileText,
  ClipboardList,
  Pencil,
  Loader2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  updateCourse,
  updateLectureTitle,
  unassignLectureFromCourse,
} from '@/services/coursesService';
import type { Lecture } from '@/types/domain';
import type { ScheduleEntry } from '@/features/student/courseSchedules';
import { SharedRoutes, StudentRoutes } from '@/lib/routes';

export interface CourseDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  title: string;
  description: string | null;
  whatYouWillLearn?: string[];
  averageRating?: number;
  ratingCount?: number;
  instructorName?: string;
  lectures: { lecture: Lecture; cleanTitle: string; progress: number; status: string }[];
  onStartLecture: (lectureId: string) => void;
  onAddMaterial?: () => void;
  schedule?: ScheduleEntry[];
  /**
   * True when the viewer owns this course, which for a student means they built
   * it from their own uploads. Turns the header and syllabus into edit
   * surfaces; every mutation is still ownership-checked server-side.
   */
  canEdit?: boolean;
  /** Refetch the library after a rename or a removal lands. */
  onCourseChanged?: () => void;
}

export function CourseDetailsSheet({
  isOpen,
  onClose,
  courseId,
  title,
  description,
  whatYouWillLearn = [],
  averageRating,
  ratingCount = 0,
  instructorName = 'Instructor',
  lectures,
  onStartLecture,
  onAddMaterial,
  schedule = [],
  canEdit = false,
  onCourseChanged,
}: CourseDetailsProps) {
  const { t } = useTranslation(['common']);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isEditingCourse, setIsEditingCourse] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDescription, setDraftDescription] = useState(description ?? '');
  const [savingCourse, setSavingCourse] = useState(false);
  const [renamingLectureId, setRenamingLectureId] = useState<string | null>(null);
  const [draftLectureTitle, setDraftLectureTitle] = useState('');
  const [busyLectureId, setBusyLectureId] = useState<string | null>(null);

  // The sheet stays mounted between courses, so reset the drafts whenever it
  // reopens or the focused course changes — otherwise an abandoned edit leaks
  // into the next course's form.
  useEffect(() => {
    setIsEditingCourse(false);
    setDraftTitle(title);
    setDraftDescription(description ?? '');
    setRenamingLectureId(null);
  }, [courseId, isOpen, title, description]);

  const saveCourse = async () => {
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      toast({ title: 'A course needs a name', variant: 'destructive' });
      return;
    }
    setSavingCourse(true);
    try {
      // Send the trimmed description even when empty. `undefined` would be
      // omitted from the JSON body, and the endpoint only writes fields present
      // in it — so a student clearing the box would silently keep the old text.
      await updateCourse(courseId, { title: nextTitle, description: draftDescription.trim() });
      setIsEditingCourse(false);
      onCourseChanged?.();
      toast({ title: 'Course updated' });
    } catch (error) {
      console.error('Could not update course', error);
      toast({ title: 'Could not save those changes', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setSavingCourse(false);
    }
  };

  const saveLectureTitle = async (lectureId: string) => {
    const nextTitle = draftLectureTitle.trim();
    if (!nextTitle) {
      toast({ title: 'A lecture needs a name', variant: 'destructive' });
      return;
    }
    setBusyLectureId(lectureId);
    try {
      await updateLectureTitle(lectureId, nextTitle);
      setRenamingLectureId(null);
      onCourseChanged?.();
    } catch (error) {
      console.error('Could not rename lecture', error);
      toast({ title: 'Could not rename this lecture', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setBusyLectureId(null);
    }
  };

  // Unassign rather than delete: the lecture and its slides survive, so this is
  // recoverable and the material is never destroyed by a misclick.
  const removeLecture = async (lectureId: string, lectureTitle: string) => {
    if (!confirm(`Remove "${lectureTitle}" from this course? The material itself is kept.`)) return;
    setBusyLectureId(lectureId);
    try {
      await unassignLectureFromCourse(courseId, lectureId);
      onCourseChanged?.();
      toast({ title: 'Removed from this course' });
    } catch (error) {
      console.error('Could not remove lecture from course', error);
      toast({ title: 'Could not remove this lecture', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setBusyLectureId(null);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg lg:max-w-xl p-0 flex flex-col bg-background/95 backdrop-blur-xl border-l-white/10">
        <SheetHeader className="p-6 border-b border-white/10 flex-shrink-0 text-left">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">
              Course Details
            </span>
          </div>
          {isEditingCourse ? (
            <div className="space-y-3">
              <SheetTitle className="sr-only">Edit {title}</SheetTitle>
              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                aria-label="Course name"
                className="h-12 text-xl font-bold"
                maxLength={200}
              />
              <Textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                aria-label="Course description"
                placeholder="What is this course about?"
                className="min-h-20 resize-y"
                maxLength={4000}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void saveCourse()} disabled={savingCourse}>
                  {savingCourse ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Save changes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditingCourse(false)} disabled={savingCourse}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <SheetTitle className="text-3xl font-black tracking-tight leading-tight">
                {title}
              </SheetTitle>
              <SheetDescription className="text-muted-foreground mt-3 line-clamp-3 leading-relaxed">
                {description || 'Explore the contents of this course.'}
              </SheetDescription>
            </>
          )}

          <div className="flex items-center gap-4 mt-6">
            {/* Only show a rating when the course actually has ratings —
                never fabricate a star score. */}
            {ratingCount > 0 && averageRating != null && (
              <>
                <div className="flex items-center gap-1.5 text-amber-400">
                  <Star className="w-4 h-4 fill-current" />
                  <span className="font-bold text-sm">{averageRating}</span>
                  <span className="text-muted-foreground text-xs font-medium ml-1">({ratingCount} ratings)</span>
                </div>
                <div className="w-1 h-1 rounded-full bg-white/20" />
              </>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="w-4 h-4" />
              <span className="font-medium text-foreground/80">{instructorName}</span>
            </div>
          </div>
          {(onAddMaterial || canEdit) && !isEditingCourse ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {onAddMaterial ? <Button variant="secondary" size="sm" onClick={onAddMaterial}>Add material</Button> : null}
              {canEdit ? (
                <Button variant="outline" size="sm" onClick={() => setIsEditingCourse(true)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit details
                </Button>
              ) : null}
            </div>
          ) : null}
        </SheetHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="py-8 space-y-10">
            
            {whatYouWillLearn && whatYouWillLearn.length > 0 && (
              <section className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-primary" />
                  What you'll learn
                </h3>
                <div className="grid gap-3">
                  {whatYouWillLearn.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                      <span className="text-sm text-muted-foreground leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {schedule.length > 0 && (
              <>
                <Separator className="bg-white/5" />
                <section className="space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-primary" />
                    {t('common:courseSchedule.title')}
                  </h3>
                  <div className="space-y-3">
                    {schedule.map((entry, idx) => {
                      const eventName = t(`common:courseSchedule.events.${entry.type}`);
                      const label = entry.seq ? `${eventName} ${entry.seq}` : eventName;
                      return (
                        <div
                          key={`${entry.type}-${entry.seq ?? idx}`}
                          className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-bold text-foreground/90">{label}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-primary/80 shrink-0">
                              {t(`common:courseSchedule.days.${entry.day}`)} ·{' '}
                              {t(`common:courseSchedule.rhythm.${entry.rhythm}`)}
                            </span>
                          </div>
                          <div className="grid gap-2 text-xs text-muted-foreground">
                            <div className="flex items-start gap-2">
                              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground/60" />
                              <span className="leading-relaxed">{entry.location}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                              <span className="font-medium text-foreground/80">{entry.time}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Repeat className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                              <span>
                                {entry.start === entry.end
                                  ? entry.start
                                  : `${entry.start} – ${entry.end}`}
                              </span>
                            </div>
                            {entry.instructor && (
                              <div className="flex items-center gap-2">
                                <User className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                                <span className="font-medium text-foreground/80">{entry.instructor}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}

            <Separator className="bg-white/5" />
            <section className="space-y-3">
              <h3 className="text-lg font-bold">Study tools</h3>
              <p className="text-sm text-muted-foreground">Use the material in this course to review, test yourself, or prepare for an exam.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate(StudentRoutes.STUDY_GUIDE(courseId))}>
                  <FileText className="mr-1.5 h-4 w-4" /> Study guide
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lectures.length === 0}
                  onClick={() => lectures[0] && navigate(`${SharedRoutes.LECTURE(lectures[0].lecture.id)}#worksheets`)}
                >
                  <BookOpen className="mr-1.5 h-4 w-4" /> Worksheets
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate(StudentRoutes.EXAM(courseId))}>
                  <ClipboardList className="mr-1.5 h-4 w-4" /> Mock exam
                </Button>
              </div>
            </section>

            <Separator className="bg-white/5" />

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Course Syllabus</h3>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {lectures.length} Lectures
                </span>
              </div>
              
              <div className="space-y-3">
                {lectures.map((item, index) => {
                  const isDone = item.status === 'done';
                  const inProgress = item.status === 'progress';
                  const isRenaming = renamingLectureId === item.lecture.id;
                  const isBusy = busyLectureId === item.lecture.id;

                  return (
                    <div
                      key={item.lecture.id}
                      className={cn(
                        "rounded-2xl border transition-all",
                        isDone ? "border-emerald-500/20 bg-emerald-500/5" :
                        inProgress ? "border-primary/20 bg-primary/5" : "border-white/5 bg-white/[0.02]"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onStartLecture(item.lecture.id)}
                        disabled={isRenaming}
                        className={cn(
                          "group flex w-full flex-col gap-4 rounded-2xl p-4 text-left transition-all sm:flex-row sm:items-center",
                          "hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          isRenaming && "cursor-default hover:bg-transparent",
                        )}
                      >
                        <div className="flex-1 min-w-0 flex items-start gap-4">
                          <div className="shrink-0 mt-1 sm:mt-0">
                            {isDone ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            ) : inProgress ? (
                              <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                                <span className="text-[9px] font-black text-muted-foreground/50">{index + 1}</span>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <h4 className={cn("text-sm font-bold line-clamp-1", isDone ? "text-foreground" : "text-foreground/90")}>
                              {item.cleanTitle}
                            </h4>
                            {item.lecture.description && (
                              <p className="text-xs text-muted-foreground line-clamp-1">{item.lecture.description}</p>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-3 self-end sm:self-auto mt-2 sm:mt-0">
                          {item.progress > 0 && !isDone && (
                            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{item.progress}%</span>
                          )}
                          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                            <Play className="w-3.5 h-3.5 ml-0.5" />
                          </span>
                        </div>
                      </button>

                      {canEdit ? (
                        <div className="border-t border-white/5 px-4 py-2.5">
                          {isRenaming ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={draftLectureTitle}
                                onChange={(event) => setDraftLectureTitle(event.target.value)}
                                aria-label={`Rename ${item.cleanTitle}`}
                                className="h-8 text-sm"
                                maxLength={500}
                                autoFocus
                              />
                              <Button size="sm" className="h-8" onClick={() => void saveLectureTitle(item.lecture.id)} disabled={isBusy}>
                                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setRenamingLectureId(null)} disabled={isBusy} aria-label="Cancel rename">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  setDraftLectureTitle(item.lecture.title);
                                  setRenamingLectureId(item.lecture.id);
                                }}
                              >
                                <Pencil className="mr-1.5 h-3 w-3" /> Rename
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                disabled={isBusy}
                                onClick={() => void removeLecture(item.lecture.id, item.cleanTitle)}
                              >
                                {isBusy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <X className="mr-1.5 h-3 w-3" />}
                                Remove
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                
                {lectures.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground rounded-2xl border border-dashed border-white/10">
                    No lectures available in this course yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
