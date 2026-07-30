import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Upload,
  CheckCircle2,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Wand2,
  AlertCircle,
  BookOpen,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { MultiFileDropzone } from '@/components/upload/MultiFileDropzone';
import { UploadQueuePanel } from '@/components/upload/UploadQueuePanel';
import { useBatchUpload } from '@/hooks/useBatchUpload';
import { fetchBatchSummary } from '@/services/uploadBatchService';
import { generateCourseTitleSuggestion, type Course } from '@/services/coursesService';
import { StudentRoutes } from '@/lib/routes';
import { supabase } from '@/integrations/supabase/client';
import { useAiModel } from '@/hooks/use-ai-model';
import { useAuth } from '@/lib/auth';
import type { BatchSummaryRow } from '@/types/upload';
import { cn } from '@/lib/utils';
import { recordOnboardingEvent, saveOnboardingProgress, type StudyGoal } from '@/services/onboardingService';
import {
  createCourseFromBlueprint,
  fetchCourseBlueprint,
  splitCourseBlueprintItem,
  updateCourseBlueprint,
  updateCourseBlueprintItem,
  type CourseBlueprint,
  type CourseBlueprintItem,
  type MaterialClassification,
} from '@/services/courseBlueprintService';

export default function StudentUploadWizard() {
  const [step, setStep] = useState(1);
  const [courseTitle, setCourseTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const journeyState = (location.state as { studyGoal?: StudyGoal; existingCourseId?: string; existingCourseTitle?: string } | null);
  const studyGoal = journeyState?.studyGoal ?? 'weekly_study';
  const existingCourseId = journeyState?.existingCourseId ?? null;
  const existingCourseTitle = journeyState?.existingCourseTitle ?? null;
  const isAddingToExistingCourse = Boolean(existingCourseId);
  
  // Step 1 state
  const { aiModel } = useAiModel();
  const batchUpload = useBatchUpload({ courseId: existingCourseId, parsingMode: 'ai', aiModel });
  const { batchId, resumeBatch } = batchUpload;
  
  // Step 2 & 3 state
  const [batchSummary, setBatchSummary] = useState<BatchSummaryRow[]>([]);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [createdCourse, setCreatedCourse] = useState<Course | null>(null);
  const [blueprint, setBlueprint] = useState<CourseBlueprint | null>(null);
  const [draggedBlueprintItemId, setDraggedBlueprintItemId] = useState<string | null>(null);
  const hasLoggedBlueprintView = useRef(false);
  const hasLoggedProcessingComplete = useRef(false);
  const isPollingBatch = useRef(false);
  const resumedBatchId = searchParams.get('batch') ?? ((location.state as { batchId?: string } | null)?.batchId) ?? null;
  const hasResumedBatch = useRef(false);

  useEffect(() => {
    if (!resumedBatchId || hasResumedBatch.current || batchId) return;
    hasResumedBatch.current = true;
    resumeBatch(resumedBatchId);
    setStep(2);
  }, [batchId, resumeBatch, resumedBatchId]);

  // Keep the course proposal in sync while parsing continues. A student can
  // create a useful course as soon as one grounded lecture is ready; the
  // remaining files stay visibly in progress rather than blocking activation.
  useEffect(() => {
    if ((step === 2 || step === 3) && batchUpload.batchId) {
      const poll = async () => {
        if (isPollingBatch.current) return;
        isPollingBatch.current = true;
        try {
          const summary = await fetchBatchSummary(batchUpload.batchId!);
          setBatchSummary(summary);
          const hasReadyMaterial = summary.some((item) => item.status === 'completed' && item.lecture_id);
          const allDone = summary.length > 0 && summary.every(l => l.status === 'completed' || l.status === 'failed');
          if (hasReadyMaterial || allDone) {
            const nextBlueprint = await fetchCourseBlueprint(batchUpload.batchId!);
            setBlueprint(nextBlueprint);
            setCourseTitle((current) => current || nextBlueprint.title);
            if (step === 2) setStep(3);
            if (user?.id && !hasLoggedBlueprintView.current) {
              hasLoggedBlueprintView.current = true;
              void recordOnboardingEvent(user.id, 'course_blueprint_viewed', {
                blueprint_id: nextBlueprint.id,
                batch_id: batchUpload.batchId,
                item_count: nextBlueprint.items.length,
              });
            }
          }
          if (allDone && user?.id && !hasLoggedProcessingComplete.current) {
            hasLoggedProcessingComplete.current = true;
              void recordOnboardingEvent(user.id, 'file_processing_completed', {
                batch_id: batchUpload.batchId,
                completed_files: summary.filter((item) => item.status === 'completed').length,
                failed_files: summary.filter((item) => item.status === 'failed').length,
              });
          }
        } catch (e) {
          console.error(e);
        } finally {
          isPollingBatch.current = false;
        }
      };
      void poll();
      const interval = window.setInterval(() => void poll(), 2500);
      return () => clearInterval(interval);
    }
  }, [step, batchUpload.batchId, user?.id]);

  const handleGenerateTitle = async (lectures?: string[]) => {
    setIsGeneratingTitle(true);
    try {
      const titlesToUse = lectures || blueprint?.items.filter((item) => item.include_in_course).map((item) => item.title) || [];
      const suggestion = await generateCourseTitleSuggestion(titlesToUse);
      if (suggestion) {
        setCourseTitle(suggestion);
        if (blueprint) setBlueprint(await updateCourseBlueprint(blueprint.id, { title: suggestion }));
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to suggest title', variant: 'destructive' });
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const handleFinalSave = async () => {
    if (!courseTitle.trim()) {
      toast({ title: 'Please enter a course title', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      if (!blueprint) throw new Error('Course blueprint is not ready yet.');
      if (blueprint.items.every((item) => !item.include_in_course || !item.lecture_id)) {
        throw new Error('Choose at least one processed material before creating your course.');
      }
      await updateCourseBlueprint(blueprint.id, { title: courseTitle.trim(), study_goal: studyGoal });
      // One backend transaction owns course creation and material assignment.
      const course = await createCourseFromBlueprint(blueprint.id);
      const includedCount = blueprint.items.filter((item) => item.include_in_course && item.lecture_id).length;

      // 3. Retire the first-run guard so the Luna spotlight tour never fires
      // after onboarding — the Hero Decision replaces it as the sole
      // first-run experience.
      if (user?.id) {
        await supabase.from('profiles').update({ has_seen_dashboard_tour: true }).eq('user_id', user.id);
        await refreshProfile();
      }

      // 4. Creating a course is setup, not the activation. Invalidate the
      // library and take the student to a deliberate "start learning" state.
      queryClient.invalidateQueries({ queryKey: ['student-courses'] });
      queryClient.invalidateQueries({ queryKey: ['student-lectures'] });
      queryClient.invalidateQueries({ queryKey: ['student-progress', user?.id] });
      if (user?.id) {
        void saveOnboardingProgress(user.id, { active_batch_id: null });
        void recordOnboardingEvent(user.id, 'course_created', {
          course_id: course.id,
          study_goal: studyGoal,
          lecture_count: includedCount,
        });
      }
      setCreatedCourse(course);
      setStep(5);

    } catch (err) {
      console.error(err);
      toast({ title: 'Error saving course', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const persistItem = async (item: CourseBlueprintItem, patch: Partial<Pick<CourseBlueprintItem, 'title' | 'position' | 'classification' | 'include_in_course' | 'lecture_group_id'>>) => {
    if (!blueprint) return;
    try {
      setBlueprint(await updateCourseBlueprintItem(blueprint.id, item.id, patch));
      if (user?.id) {
        void recordOnboardingEvent(user.id, 'course_blueprint_edited', {
          blueprint_id: blueprint.id,
          item_id: item.id,
          fields: Object.keys(patch),
        });
      }
    } catch (error) {
      console.error('Could not update course blueprint item', error);
      toast({ title: 'Could not save that change', description: 'Please try again.', variant: 'destructive' });
    }
  };

  const persistBlueprint = async (patch: Partial<Pick<CourseBlueprint, 'title' | 'description' | 'study_goal'>>) => {
    if (!blueprint) return;
    try {
      const nextBlueprint = await updateCourseBlueprint(blueprint.id, patch);
      setBlueprint(nextBlueprint);
      if (user?.id) {
        void recordOnboardingEvent(user.id, 'course_blueprint_edited', {
          blueprint_id: blueprint.id,
          fields: Object.keys(patch),
        });
      }
    } catch (error) {
      console.error('Could not update course blueprint', error);
      toast({ title: 'Could not save that change', description: 'Please try again.', variant: 'destructive' });
    }
  };

  const splitItem = async (item: CourseBlueprintItem) => {
    if (!blueprint) return;
    try {
      setBlueprint(await splitCourseBlueprintItem(blueprint.id, item.id));
      if (user?.id) {
        void recordOnboardingEvent(user.id, 'course_blueprint_edited', {
          blueprint_id: blueprint.id,
          item_id: item.id,
          fields: ['split'],
        });
      }
    } catch (error) {
      console.error('Could not split course blueprint item', error);
      toast({ title: 'Could not split this material', description: error instanceof Error ? error.message : 'Try again once the file is ready.', variant: 'destructive' });
    }
  };

  const updateItemDraft = (itemId: string, patch: Partial<CourseBlueprintItem>) => {
    setBlueprint((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
    } : current);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col pt-12 px-6 pb-24">
      <div className="max-w-3xl mx-auto w-full">
        
        {/* Header & Progress */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-indigo-400 mb-4 flex items-center justify-center gap-2">
            <Wand2 className="w-8 h-8 text-violet-500" />
            AI Course Kitchen
          </h1>
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
            <span className={cn("px-2", step >= 1 ? "text-primary" : "")}>Materials</span>
            <ChevronRight className="w-4 h-4 opacity-30" />
            <span className={cn("px-2", step >= 2 ? "text-primary" : "")}>Process</span>
            <ChevronRight className="w-4 h-4 opacity-30" />
            <span className={cn("px-2", step >= 3 ? "text-primary" : "")}>Structure</span>
            <ChevronRight className="w-4 h-4 opacity-30" />
            <span className={cn("px-2", step >= 5 ? "text-primary" : "")}>Start</span>
          </div>
        </div>

        {/* STEP 1: UPLOAD */}
        {step === 1 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="bg-card/50 border rounded-2xl p-6 text-center shadow-sm">
              <h2 className="text-xl font-bold mb-2">{isAddingToExistingCourse ? `Add material to ${existingCourseTitle || 'your course'}` : 'Add the material you want to study'}</h2>
              <p className="text-muted-foreground mb-2">{isAddingToExistingCourse ? 'Upload PDFs or slides and Luna will place them as new lectures in this course.' : 'Upload one lecture or an entire course. Luna will suggest the names, order, and structure.'}</p>
              <p className="text-xs text-primary mb-6">Your focus: {studyGoal === 'exam' ? 'exam preparation' : studyGoal === 'assignment' ? 'a specific assignment' : studyGoal === 'understanding' ? 'general understanding' : 'weekly study'}.</p>
              
              <MultiFileDropzone
                onFilesSelected={batchUpload.addFiles}
                maxFiles={batchUpload.maxBatchFiles}
                currentCount={batchUpload.files.length}
              />
              
              {batchUpload.files.length > 0 && (
                <div className="mt-6 text-left">
                  <UploadQueuePanel
                    files={batchUpload.files}
                    onRemove={batchUpload.removeFile}
                    onReorder={batchUpload.reorderFiles}
                    onRetry={batchUpload.retryFile}
                    submitted={!!batchUpload.batchId}
                  />
                  <div className="mt-6 flex justify-end">
                    <Button 
                      size="lg" 
                      className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25"
                      onClick={async () => {
                        const res = await batchUpload.submitBatch();
                        if (res?.batchId) {
                          if (user?.id) {
                            void saveOnboardingProgress(user.id, { active_batch_id: res.batchId });
                            void recordOnboardingEvent(user.id, 'upload_started', { batch_id: res.batchId, file_count: batchUpload.files.length, study_goal: studyGoal });
                            void recordOnboardingEvent(user.id, 'upload_completed', { batch_id: res.batchId, file_count: batchUpload.files.length });
                            void recordOnboardingEvent(user.id, 'file_processing_started', { batch_id: res.batchId, file_count: batchUpload.files.length });
                          }
                          setStep(2);
                        }
                      }}
                      disabled={batchUpload.isSubmitting}
                    >
                      {batchUpload.isSubmitting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Wand2 className="w-5 h-5 mr-2" />}
                      {isAddingToExistingCourse ? 'Add this material' : 'Organize my material'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* STEP 2: PROCESSING */}
        {step === 2 && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-violet-500/20 animate-pulse">
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Luna is reading your materials...</h2>
            <p className="text-muted-foreground max-w-md">Luna is reading files, finding lecture information, checking the order, and preparing grounded AI access. You can leave while this runs; your materials will be ready to review when processing finishes.</p>
            
            {batchSummary.length > 0 && (
              <div className="mt-8 w-full max-w-md bg-card border rounded-xl p-4 text-left">
                {batchSummary.map((l, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                    <span className="truncate pr-4 flex-1">{l.filename}</span>
                    {l.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : l.status === 'failed' ? (
                      <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => navigate(StudentRoutes.LIBRARY)}
              className="mt-7 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Continue to my courses — we’ll let you know when this is ready
            </button>
          </motion.div>
        )}

        {/* STEP 3: REVIEW MATERIAL */}
        {step === 3 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
            <div className="bg-card/50 border rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-bold mb-2">{isAddingToExistingCourse ? `New material for ${existingCourseTitle || 'your course'} is ready` : 'Your course structure is ready'}</h2>
              <p className="text-muted-foreground mb-6">{isAddingToExistingCourse ? 'We suggested the lecture names and order. Fine-tune anything you want, then add it to your course.' : 'We suggested a simple structure from your materials. Fine-tune anything you want, then create your course.'}</p>
              {blueprint?.description ? <p className="mb-5 rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{blueprint.description}</p> : null}
              
              <div className="space-y-4">
                {blueprint?.items.map((item, index) => {
                  const ready = Boolean(item.lecture_id);
                  const sourceState = item.material_source?.processing_state ?? (ready ? 'ready' : 'processing');
                  const isProcessing = sourceState === 'queued' || sourceState === 'processing';
                  const isFailed = sourceState === 'failed' || sourceState === 'needs_attention';
                  const parseError = item.material_source?.extracted_metadata?.parse_error;
                  const matchingSummary = batchSummary.find((row) => (
                    (item.lecture_id !== null && row.lecture_id === item.lecture_id)
                    || row.filename === item.material_source?.original_filename
                  ));
                  const matchingUpload = batchUpload.files.find((file) => file.runId === matchingSummary?.run_id);
                  const sourceRange = item.source_range && typeof item.source_range === 'object'
                    && 'start_slide' in item.source_range && 'end_slide' in item.source_range
                    ? `Slides ${String(item.source_range.start_slide)}–${String(item.source_range.end_slide)}`
                    : null;
                  return (
                    <div
                      key={item.id}
                      draggable={!isProcessing}
                      onDragStart={() => setDraggedBlueprintItemId(item.id)}
                      onDragEnd={() => setDraggedBlueprintItemId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        const moving = blueprint?.items.find((candidate) => candidate.id === draggedBlueprintItemId);
                        if (moving && moving.id !== item.id) void persistItem(moving, { position: item.position });
                        setDraggedBlueprintItemId(null);
                      }}
                      className={cn(
                        'rounded-xl border p-4 transition-colors',
                        isFailed ? 'border-destructive/30 bg-destructive/5' : 'bg-card',
                        draggedBlueprintItemId === item.id && 'opacity-50',
                      )}
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          {ready ? <BookOpen className="h-5 w-5 text-primary" /> : isFailed ? <AlertCircle className="h-5 w-5 text-destructive" /> : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-6">{item.title}</p>
                          <p className="truncate text-xs text-muted-foreground" title={item.material_source?.original_filename}>{item.material_source?.original_filename ?? 'Uploaded material'}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="rounded-md bg-muted px-2 py-1 capitalize">{item.classification === 'exam' ? 'Past exam' : item.classification}</span>
                            {sourceRange ? <span className="rounded-md bg-muted px-2 py-1">{sourceRange}</span> : null}
                            {ready ? <span className="rounded-md bg-muted px-2 py-1">{item.confidence >= 0.8 ? 'Ready to use' : 'Review suggested'}</span> : null}
                            {isProcessing ? <span className="text-primary">Luna is still preparing this file</span> : null}
                            {isFailed ? <span className="text-destructive">Could not process this file</span> : null}
                          </div>
                          {isFailed ? <p className="mt-2 text-xs text-destructive/80">{typeof parseError === 'string' ? parseError : 'This file may be password-protected or unreadable. Upload an unlocked copy or continue without it.'}</p> : null}
                        </div>
                      </div>
                      <details className="mt-3 border-t border-border/60 pt-3">
                        <summary className="flex w-fit cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><GripVertical className="h-3.5 w-3.5" /> Adjust this material or drag to reorder</summary>
                        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                          <div className="space-y-2">
                            <Label htmlFor={`blueprint-title-${item.id}`} className="text-xs">Lecture name</Label>
                            <Input id={`blueprint-title-${item.id}`} value={item.title} onChange={(event) => updateItemDraft(item.id, { title: event.target.value })} onBlur={() => void persistItem(item, { title: item.title })} className="h-9" disabled={isProcessing} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`blueprint-type-${item.id}`} className="text-xs">Type</Label>
                            <select id={`blueprint-type-${item.id}`} value={item.classification} disabled={isProcessing} onChange={(event) => {
                              const classification = event.target.value as MaterialClassification;
                              updateItemDraft(item.id, { classification });
                              void persistItem(item, { classification });
                            }} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                              <option value="lecture">Lecture</option><option value="reading">Reading</option><option value="assignment">Assignment</option><option value="worksheet">Worksheet</option><option value="exam">Past exam</option><option value="supporting">Supplement</option>
                            </select>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Move ${item.title} up`}
                          disabled={index === 0 || isProcessing}
                          onClick={() => void persistItem(item, { position: item.position - 1 })}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Move ${item.title} down`}
                          disabled={index === (blueprint?.items.length ?? 0) - 1 || isProcessing}
                          onClick={() => void persistItem(item, { position: item.position + 1 })}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant={item.include_in_course ? 'secondary' : 'outline'}
                          size="sm"
                          disabled={!ready}
                          onClick={() => {
                            const include_in_course = !item.include_in_course;
                            updateItemDraft(item.id, { include_in_course });
                            void persistItem(item, { include_in_course });
                          }}
                        >
                          {item.include_in_course ? 'Included' : 'Exclude'}
                        </Button>
                        {index > 0 && item.lecture_group_id !== blueprint?.items[index - 1]?.lecture_group_id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isProcessing}
                            onClick={() => {
                              const lecture_group_id = blueprint!.items[index - 1].lecture_group_id;
                              updateItemDraft(item.id, { lecture_group_id });
                              void persistItem(item, { lecture_group_id });
                            }}
                          >
                            Merge above
                          </Button>
                        ) : null}
                        {index > 0 && item.lecture_group_id === blueprint?.items[index - 1]?.lecture_group_id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isProcessing}
                            onClick={() => {
                              const lecture_group_id = crypto.randomUUID();
                              updateItemDraft(item.id, { lecture_group_id });
                              void persistItem(item, { lecture_group_id });
                            }}
                          >
                            Keep separate
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!ready || isProcessing}
                          onClick={() => void splitItem(item)}
                        >
                          Split lecture
                        </Button>
                        {isFailed && matchingUpload?.fileId ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void batchUpload.retryFile(matchingUpload.fileId)}
                          >
                            Retry
                          </Button>
                        ) : null}
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
              {batchUpload.files.some((file) => file.status === 'duplicate') ? (
                <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">We skipped an exact duplicate and kept the original file in this course.</p>
              ) : null}

              {!isAddingToExistingCourse ? <>
              <div className="mt-8 border-t border-border pt-6">
                <Label className="flex items-center gap-2">
                  Course name
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-violet-500 hover:text-violet-600 hover:bg-violet-500/10"
                    onClick={() => handleGenerateTitle()}
                    disabled={isGeneratingTitle}
                  >
                    {isGeneratingTitle ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}
                    Suggest again
                  </Button>
                </Label>
                <Input
                  placeholder="e.g. Database Systems"
                  value={courseTitle}
                  onChange={(event) => setCourseTitle(event.target.value)}
                  onBlur={() => void persistBlueprint({ title: courseTitle.trim() })}
                  className="mt-2 h-12 text-lg"
                  disabled={isGeneratingTitle}
                />
                <p className="mt-2 text-xs text-muted-foreground">{isGeneratingTitle ? 'Luna is suggesting a course name.' : 'You can change this later.'}</p>
              </div>

              <details className="mt-4 rounded-xl border border-border/70 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">Edit course description</summary>
                <Textarea
                  value={blueprint?.description ?? ''}
                  onChange={(event) => setBlueprint((current) => current ? { ...current, description: event.target.value } : current)}
                  onBlur={() => void persistBlueprint({ description: blueprint?.description ?? '' })}
                  className="mt-3 min-h-20 resize-y"
                  maxLength={4000}
                  aria-label="Course description"
                />
              </details>
              </> : null}

              <div className="sticky bottom-4 mt-8 flex justify-end rounded-2xl border border-primary/20 bg-background/95 p-3 shadow-xl backdrop-blur">
                <Button 
                  size="lg" 
                  onClick={handleFinalSave}
                  disabled={isSaving || !courseTitle.trim() || !blueprint?.items.some((item) => item.include_in_course && item.lecture_id)}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {isAddingToExistingCourse ? 'Add material to course' : 'Create my course'} <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* STEP 5: FINISH LINE */}
        {step === 5 && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-24 h-24 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center mb-6 shadow-2xl shadow-emerald-500/30">
              <BookOpen className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-3xl font-bold mb-3">{isAddingToExistingCourse ? `${existingCourseTitle || courseTitle} has new material` : `${courseTitle} is ready`}</h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-md">{isAddingToExistingCourse ? 'Your new lecture is ready to study.' : 'Start learning now. You can add or reorganize material at any time.'}</p>
            <Button size="lg" className="gap-2" onClick={() => createdCourse && navigate(StudentRoutes.COURSE_V3(createdCourse.id), {
              state: {
                onboardingStart: true,
                studyGoal,
                initialActivity: studyGoal === 'exam' ? 'quiz' : studyGoal === 'assignment' ? 'grounded_ai' : 'lecture',
              },
            })} disabled={!createdCourse}>
              {studyGoal === 'exam' ? 'Take a diagnostic quiz' : studyGoal === 'assignment' ? 'Ask Luna about my assignment' : 'Start Lecture 1'} <ChevronRight className="h-4 w-4" />
            </Button>
          </motion.div>
        )}

      </div>
    </div>
  );
}
