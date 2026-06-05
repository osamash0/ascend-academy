import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Compass, BookOpen, Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { browseCourses, enrollInCourse } from '@/services/coursesService';
import { cn } from '@/lib/utils';
import { topicIcon } from '@/lib/topicIcon';

interface CourseCatalogSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pass the set of currently enrolled course IDs to disable enrolling twice */
  enrolledCourseIds: Set<string>;
}

export function CourseCatalogSheet({ isOpen, onClose, enrolledCourseIds }: CourseCatalogSheetProps) {
  const queryClient = useQueryClient();
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  const { data: courses, isLoading, error } = useQuery({
    queryKey: ['browse-courses'],
    queryFn: browseCourses,
    enabled: isOpen,
  });

  const enrollMutation = useMutation({
    mutationFn: enrollInCourse,
    onMutate: (courseId) => {
      setEnrollingId(courseId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
      toast.success('Successfully enrolled in course!');
      // We keep the sheet open intentionally so they can enroll in multiple courses if they want.
    },
    onError: () => {
      toast.error('Failed to enroll in course. Please try again.');
    },
    onSettled: () => {
      setEnrollingId(null);
    },
  });

  const handleEnroll = (courseId: string) => {
    enrollMutation.mutate(courseId);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-xl p-0 flex flex-col bg-background/95 backdrop-blur-xl border-l-white/10">
        <SheetHeader className="p-6 border-b border-white/10 flex-shrink-0 text-left">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Compass className="w-5 h-5 text-primary" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">
              Course Catalog
            </span>
          </div>
          <SheetTitle className="text-3xl font-black tracking-tight leading-tight">
            Discover Courses
          </SheetTitle>
          <SheetDescription className="text-muted-foreground mt-3 leading-relaxed">
            Browse our complete library and find your next learning journey.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="py-8 space-y-4">
            {isLoading && (
              <div className="flex flex-col gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 rounded-2xl bg-white/5 animate-pulse" />
                ))}
              </div>
            )}
            
            {error && !isLoading && (
              <div className="text-center p-8 border border-destructive/20 bg-destructive/10 rounded-2xl text-destructive">
                Failed to load courses. Please try again later.
              </div>
            )}

            {!isLoading && !error && courses?.length === 0 && (
              <div className="text-center p-8 border border-white/10 bg-white/5 rounded-2xl">
                <BookOpen className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
                <h3 className="font-bold">No courses available</h3>
                <p className="text-sm text-muted-foreground mt-1">Check back later for new content.</p>
              </div>
            )}

            {!isLoading && courses?.map((course) => {
              const isEnrolled = enrolledCourseIds.has(course.id);
              const isEnrolling = enrollingId === course.id;
              const CourseIcon = topicIcon(course.title, course.id);

              return (
                <div 
                  key={course.id}
                  className="group flex flex-col gap-4 p-5 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/5 transition-colors relative overflow-hidden"
                >
                  <div className="absolute -right-6 -top-6 text-white/5 pointer-events-none transition-transform group-hover:scale-110 group-hover:text-white/10">
                    <CourseIcon className="w-32 h-32" />
                  </div>
                  
                  <div className="relative z-10 flex gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                      <CourseIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-lg leading-tight mb-1 text-foreground">
                        {course.title}
                      </h3>
                      {course.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {course.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        <span className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5" />
                          {course.lecture_count} Lectures
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 pt-2 flex justify-end">
                    <Button 
                      variant={isEnrolled ? "secondary" : "default"}
                      disabled={isEnrolled || isEnrolling}
                      onClick={() => handleEnroll(course.id)}
                      className={cn(
                        "rounded-full font-bold",
                        isEnrolled && "opacity-50"
                      )}
                    >
                      {isEnrolling ? (
                        <>
                          <div className="w-4 h-4 mr-2 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          Enrolling...
                        </>
                      ) : isEnrolled ? (
                        'Enrolled'
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-1.5" /> Enroll
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
