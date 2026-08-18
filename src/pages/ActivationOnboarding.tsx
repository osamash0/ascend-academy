import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, CheckCircle2, Loader2, PlayCircle, Sparkles, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { browseCourses, enrollInCourse } from '@/services/coursesService';
import { StudentRoutes } from '@/lib/routes';
import { completeActivationOnboarding, saveOnboardingProgress, recordOnboardingEvent, type StudyGoal } from '@/services/onboardingService';
import { useToast } from '@/hooks/use-toast';
import { getLandingAttribution } from '@/services/onboardingAttribution';

const STUDY_GOALS: Array<{ id: StudyGoal; title: string; description: string }> = [
  { id: 'weekly_study', title: 'Keep up each week', description: 'Start with the next lecture.' },
  { id: 'exam', title: 'Prepare for an exam', description: 'Begin with a quick diagnostic.' },
  { id: 'assignment', title: 'Finish an assignment', description: 'Find the relevant material first.' },
  { id: 'understanding', title: 'Understand the subject', description: 'Build a strong foundation.' },
];

export default function ActivationOnboarding() {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [goal, setGoal] = useState<StudyGoal>('weekly_study');
  const [showGoals, setShowGoals] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [exampleUnavailable, setExampleUnavailable] = useState(false);
  const hasLoggedStart = useRef(false);
  const firstName = useMemo(() => profile?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there', [profile?.full_name, user?.email]);

  useEffect(() => {
    if (!user || hasLoggedStart.current) return;
    hasLoggedStart.current = true;
    const attribution = getLandingAttribution();
    if (attribution) {
      void saveOnboardingProgress(user.id, { acquisition_source: attribution.source });
    }
    // A direct visit is still a landing view. Keep attribution optional so the
    // funnel's denominator is not limited to campaign-tagged visits.
    void recordOnboardingEvent(user.id, 'landing_viewed', attribution ? {
      acquisition_source: attribution.source,
      acquisition_medium: attribution.medium,
      acquisition_campaign: attribution.campaign,
      landing_path: attribution.landingPath,
    } : { landing_path: window.location.pathname });
    void recordOnboardingEvent(user.id, 'onboarding_started', attribution ? { acquisition_source: attribution.source } : {});
  }, [user]);

  const chooseMaterial = useCallback(async () => {
    if (!user) return;
    try {
      await completeActivationOnboarding('material', goal);
      // Analytics must never prevent a new student from getting to the upload
      // flow. Completion above is the durable, user-facing operation; these
      // events are supplemental funnel telemetry.
      void Promise.all([
        recordOnboardingEvent(user.id, 'start_path_selected', { path: 'material', study_goal: goal }),
        recordOnboardingEvent(user.id, 'study_goal_selected', { study_goal: goal }),
      ]).catch((error) => {
        console.warn('Unable to record material onboarding events', error);
      });
      try {
        await refreshProfile();
      } catch (error) {
        // The upload route only needs an authenticated student. A failed
        // profile refresh should recover on the next auth-context refresh,
        // rather than stranding a completed onboarding journey here.
        console.warn('Unable to refresh profile after onboarding', error);
      }
      navigate(StudentRoutes.ONBOARDING_UPLOAD, { state: { studyGoal: goal } });
    } catch (error) {
      console.error('Unable to start upload journey', error);
      toast({ variant: 'destructive', title: 'We could not start your course setup', description: 'Please try again.' });
    }
  }, [goal, navigate, refreshProfile, toast, user]);

  const chooseExample = useCallback(async () => {
    if (!user) return;
    setLoadingExample(true);
    try {
      const courses = await browseCourses();
      const example = courses.find((course) => course.demo_slug === 'database-systems');
      if (!example) {
        setExampleUnavailable(true);
        return;
      }
      await enrollInCourse(example.id);
      await Promise.all([
        completeActivationOnboarding('example'),
        saveOnboardingProgress(user.id, { demo_mission_step: 1 }),
        recordOnboardingEvent(user.id, 'start_path_selected', { path: 'example' }),
        recordOnboardingEvent(user.id, 'example_course_opened', { course_id: example.id }),
      ]);
      await refreshProfile();
      navigate(StudentRoutes.COURSE_V3(example.id), { state: { demoMission: true } });
    } catch (error) {
      console.error('Unable to open example course', error);
      setExampleUnavailable(true);
    } finally {
      setLoadingExample(false);
    }
  }, [navigate, refreshProfile, user]);

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-background px-6 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,hsl(var(--primary)/0.16),transparent_30%),radial-gradient(circle_at_84%_80%,hsl(var(--primary)/0.1),transparent_28%)]" />
      <section className="relative mx-auto flex min-h-[calc(100dvh-5rem)] max-w-6xl flex-col justify-center">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" /> {t('activation.badge')}
          </div>
          <h1 className="max-w-xl text-balance text-4xl font-black tracking-[-0.04em] sm:text-6xl">What would you like to study today, {firstName}?</h1>
          <p className="mt-5 max-w-xl text-pretty text-lg leading-8 text-muted-foreground">Turn your own lecture files into an interactive course, or take a short study session in a working example.</p>
        </motion.div>

        <div className="mt-10 grid max-w-5xl gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <motion.article initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="flex min-h-80 flex-col rounded-[2rem] border border-primary/25 bg-primary/[0.08] p-7 shadow-[0_24px_70px_-38px_hsl(var(--primary)/0.9)]">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Upload className="h-6 w-6" /></div>
            <div className="mt-8">
              <h2 className="text-2xl font-bold tracking-tight">Build a course from my material</h2>
              <p className="mt-2 max-w-md leading-7 text-muted-foreground">Upload one lecture or an entire course. Luna will suggest the structure, then you can create a course and start studying.</p>
            </div>
            {!showGoals ? (
              <Button onClick={() => setShowGoals(true)} size="lg" className="mt-auto w-fit gap-2 rounded-xl"><BookOpen className="h-4 w-4" /> Build my course</Button>
            ) : (
              <div className="mt-6 space-y-3">
                <p className="text-sm font-semibold">What are you preparing for?</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STUDY_GOALS.map((item) => (
                    <button key={item.id} type="button" onClick={() => setGoal(item.id)} className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${goal === item.id ? 'border-primary bg-primary/15' : 'border-white/10 bg-black/10 hover:border-white/25'}`}>
                      <span className="block text-sm font-semibold">{item.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                    </button>
                  ))}
                </div>
                <Button onClick={chooseMaterial} size="lg" className="w-fit gap-2 rounded-xl">Continue with this goal <CheckCircle2 className="h-4 w-4" /></Button>
              </div>
            )}
          </motion.article>

          <motion.aside initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="flex min-h-80 flex-col justify-end rounded-[2rem] border border-white/10 bg-white/[0.025] p-7">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><PlayCircle className="h-5 w-5" /></div>
            <div className="mt-5"><p className="text-sm font-semibold text-foreground">Not ready to upload?</p><p className="mt-2 leading-7 text-sm text-muted-foreground">Explore a short example to see grounded AI, a quiz, and progress tracking first.</p></div>
            {exampleUnavailable ? (
              <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                The example course is not available right now. You can still build a course from your own material.
              </div>
            ) : (
              <button onClick={chooseExample} disabled={loadingExample} className="mt-5 inline-flex w-fit items-center gap-2 text-sm font-semibold text-emerald-300 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50">
                {loadingExample ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Try the example course
              </button>
            )}
          </motion.aside>
        </div>
      </section>
    </main>
  );
}
