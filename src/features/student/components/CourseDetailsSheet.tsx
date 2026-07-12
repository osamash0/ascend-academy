import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Star,
  User,
  X,
  CheckCircle2,
  ChevronRight,
  Play,
  CalendarDays,
  MapPin,
  Clock,
  Repeat,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Lecture } from '@/types/domain';
import type { ScheduleEntry } from '@/features/student/courseSchedules';

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
  schedule?: ScheduleEntry[];
}

export function CourseDetailsSheet({
  isOpen,
  onClose,
  title,
  description,
  whatYouWillLearn = [],
  averageRating,
  ratingCount = 0,
  instructorName = 'Instructor',
  lectures,
  onStartLecture,
  schedule = [],
}: CourseDetailsProps) {
  const { t } = useTranslation(['common']);
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg lg:max-w-xl p-0 flex flex-col bg-background/95 backdrop-blur-xl border-l-white/10">
        <SheetHeader className="p-6 border-b border-white/10 flex-shrink-0 text-left">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">
              Course Details
            </span>
          </div>
          <SheetTitle className="text-3xl font-black tracking-tight leading-tight">
            {title}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground mt-3 line-clamp-3 leading-relaxed">
            {description || 'Explore the contents of this course.'}
          </SheetDescription>
          
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
                  
                  return (
                    <div 
                      key={item.lecture.id}
                      onClick={() => onStartLecture(item.lecture.id)}
                      className={cn(
                        "group flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer",
                        "hover:bg-white/5 hover:border-white/10",
                        isDone ? "border-emerald-500/20 bg-emerald-500/5" : 
                        inProgress ? "border-primary/20 bg-primary/5" : "border-white/5 bg-white/[0.02]"
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
                        <div className="space-y-1">
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
                        <button className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          <Play className="w-3.5 h-3.5 ml-0.5" />
                        </button>
                      </div>
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
