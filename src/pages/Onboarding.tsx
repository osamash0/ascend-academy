import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, User, Sparkles, BookOpen, Check, Loader2, Camera,
  GraduationCap, Building2, ShieldCheck, Rocket, Volume2, VolumeX,
  Users, Trophy, MapPin,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { browseCourses, enrollInCourse, type Course } from '@/services/coursesService';
import {
  getUniversities, getFaculties, getDegreePrograms, getSuggestedCourses,
  setAcademicProfile, confirmCatalogCourses, verifyMyInstitution,
  getRecommendedCourses,
} from '@/services/academicService';
import { setMySocialProfile, fetchFriendSuggestions } from '@/features/social/api';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import { RankRing } from '@/components/RankRing';
import { rankForXp, rankProgress } from '@/lib/rank';
import { useSound } from '@/lib/useSound';
import { OnboardingJourneyMap } from '@/features/onboarding/pixi/OnboardingJourneyMap';
import type {
  University, Faculty, DegreeProgram, SuggestedCourse, StudentCatalogStatus,
} from '@/types/academic';
import { LanguageToggle } from '@/components/LanguageToggle';
import { LunaAstronaut } from '../../learnstation-luna';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UniversityEmailLink } from '@/components/UniversityEmailLink';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PRESET_AVATARS = [
  { url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4', label: 'Robot' },
  { url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Max&backgroundColor=ffdfbf', label: 'Adventurer' },
  { url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=Joy&backgroundColor=c0aede', label: 'Joy' },
  { url: 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=ffdfbf', label: 'Micah' },
  { url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam&backgroundColor=b6e3f4', label: 'Sam' },
  { url: 'https://api.dicebear.com/7.x/personas/svg?seed=Riley&backgroundColor=ffdfbf', label: 'Riley' },
];

const TOTAL_STEPS = 5;
const JOURNEY_LABELS = ['You', 'Avatar', 'Studies', 'Courses', 'Explore'];

type Stage = 'intro' | 'form' | 'reveal';

interface RevealData {
  classmates: number;
  recommendations: number;
  courses: number;
}

const STATUS_LABELS: Record<StudentCatalogStatus, string> = {
  completed: 'Completed',
  in_progress: 'Taking now',
  planned: 'Planned',
};
const STATUS_ORDER: StudentCatalogStatus[] = ['completed', 'in_progress', 'planned'];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

/** Forward = slide left, back = slide right — so steps feel like a space you move through. */
function stepVariants(dir: number) {
  return {
    initial: { opacity: 0, x: 30 * dir },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -30 * dir },
  };
}

function SoundToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={enabled ? 'Mute sound' : 'Unmute sound'}
      title={enabled ? 'Sound on' : 'Sound off'}
      className="fixed top-5 right-5 z-30 w-10 h-10 rounded-full bg-white/5 border border-white/10 backdrop-blur flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
    >
      {enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
    </button>
  );
}

function OnboardingInner() {
  const { user, profile } = useAuth();
  const gamification = useGamification();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { play, enabled: soundOn, toggle: toggleSound } = useSound();
  const reduceMotion = useReducedMotion() ?? false;

  const [stage, setStage] = useState<Stage>('intro');
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1); // 1 forward, -1 back (transition direction)
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || PRESET_AVATARS[0].url);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [revealData, setRevealData] = useState<RevealData>({ classmates: 0, recommendations: 0, courses: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — Luna always selected, customization only
  const LUNA_AVATAR_KEY = '__luna__';
  const [lunaSuit, setLunaSuit] = useState('#FFF8E7');
  const [lunaVisor, setLunaVisor] = useState('#88B0B5');
  const [lunaPatch, setLunaPatch] = useState('');

  // Step 5 — platform content courses (existing behaviour)
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);

  // Step 3 — academic context
  const [universities, setUniversities] = useState<University[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [programs, setPrograms] = useState<DegreeProgram[]>([]);
  const [uniId, setUniId] = useState('');
  const [facId, setFacId] = useState('');
  const [progId, setProgId] = useState('');
  const [semester, setSemester] = useState(1);
  const [freeInstitution, setFreeInstitution] = useState('');
  const [autoMatched, setAutoMatched] = useState(false); // uni pre-filled from email domain

  // Step 4 — confirm pre-populated courses
  const [suggested, setSuggested] = useState<SuggestedCourse[]>([]);
  // courseId -> status (present = included). Absent = excluded.
  const [statusMap, setStatusMap] = useState<Record<string, StudentCatalogStatus>>({});
  const [loadingSuggested, setLoadingSuggested] = useState(false);

  const selectedUni = universities.find((u) => u.id === uniId);
  // No usable catalog if a university is chosen but has no faculties/program.
  const noCatalog = !!selectedUni && !selectedUni.hasCatalog;

  const firstName =
    fullName.trim().split(' ')[0] || profile?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const tier = rankForXp(profile?.total_xp);
  const rankProg = rankProgress(profile?.total_xp);

  // Cold-open auto-advances after a beat (a safety net if the user doesn't click).
  useEffect(() => {
    if (stage !== 'intro') return;
    const t = setTimeout(() => beginJourney(), 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const beginJourney = () => {
    if (stage !== 'intro') return;
    play('advance');
    setDir(1);
    setStage('form');
  };

  useEffect(() => {
    if (profile?.full_name && profile?.avatar_url && step === 1) {
      setFullName(profile.full_name);
      setAvatarUrl(profile.avatar_url);
    }
  }, [profile, step]);

  // Load platform courses (step 5) + universities (step 3) up-front.
  useEffect(() => {
    (async () => {
      try {
        const data = await browseCourses();
        setCourses(data);
      } catch (err) {
        console.error('Failed to load courses', err);
      } finally {
        setLoadingCourses(false);
      }
    })();
    (async () => {
      try {
        const unis = await getUniversities();
        setUniversities(unis);
        // Smart default: pre-select the university matching the user's email domain.
        const domain = (user?.email?.split('@')[1] || '').toLowerCase();
        if (domain) {
          const match = unis.find((u) => u.emailDomains.includes(domain));
          if (match) {
            setUniId(match.id);
            setAutoMatched(true);
          }
        }
      } catch (err) {
        console.error('Failed to load universities', err);
      }
    })();
  }, [user?.email]);

  // Cascade: university -> faculties
  useEffect(() => {
    setFacId('');
    setProgId('');
    setFaculties([]);
    setPrograms([]);
    if (!uniId) return;
    (async () => {
      try {
        const f = await getFaculties(uniId);
        setFaculties(f);
        if (f.length === 1) setFacId(f[0].id);
      } catch (err) {
        console.error('Failed to load faculties', err);
      }
    })();
  }, [uniId]);

  // Cascade: faculty -> programs
  useEffect(() => {
    setProgId('');
    setPrograms([]);
    if (!facId) return;
    (async () => {
      try {
        const p = await getDegreePrograms(facId);
        setPrograms(p);
        if (p.length === 1) setProgId(p[0].id);
      } catch (err) {
        console.error('Failed to load programs', err);
      }
    })();
  }, [facId]);

  const loadSuggestions = async () => {
    if (!progId) return;
    setLoadingSuggested(true);
    try {
      const items = await getSuggestedCourses(progId, semester);
      setSuggested(items);
      const initial: Record<string, StudentCatalogStatus> = {};
      items.forEach((c) => {
        if (c.preChecked) initial[c.id] = c.suggestedStatus;
      });
      setStatusMap(initial);
    } catch (err) {
      console.error('Failed to load suggested courses', err);
      setSuggested([]);
    } finally {
      setLoadingSuggested(false);
    }
  };

  const handleNext = async () => {
    play('advance');
    setDir(1);
    if (step === 3) {
      // Skip the confirm step when there is no usable catalog.
      if (noCatalog || !progId) {
        setStep(5);
      } else {
        await loadSuggestions();
        setStep(4);
      }
      return;
    }
    if (step < TOTAL_STEPS) setStep(step + 1);
  };

  const handleBack = () => {
    play('back');
    setDir(-1);
    if (step === 5 && (noCatalog || !progId)) {
      setStep(3);
      return;
    }
    if (step > 1) setStep(step - 1);
  };

  const toggleCourse = (id: string) => {
    play('select');
    setSelectedCourses((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const toggleSuggested = (id: string, fallback: StudentCatalogStatus) => {
    play('select');
    setStatusMap((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = fallback;
      return next;
    });
  };

  const setSuggestedStatus = (id: string, status: StudentCatalogStatus) =>
    setStatusMap((prev) => ({ ...prev, [id]: status }));

  const selectAvatar = (url: string) => {
    play('avatar');
    setAvatarUrl(url);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length || !user) return;
    const file = event.target.files[0];
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please upload an image.', variant: 'destructive' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Image must be under 2MB.', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
      setAvatarUrl(publicUrl);
      play('avatar');
      toast({ title: 'Avatar Uploaded', description: 'Your custom avatar is looking good!' });
    } catch (error: unknown) {
      toast({
        title: 'Upload Error',
        description: error instanceof Error ? error.message : 'Failed to upload avatar',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFinish = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 1. Core profile (name + avatar)
      const { error: profileError } = await supabase
        .from('profiles')
        // Set display_name too so the student is discoverable in Friends /
        // leaderboard (the social layer keys off display_name).
        .update({
          full_name: fullName.trim() || null,
          display_name: fullName.trim() || null,
          avatar_url: avatarUrl,
        })
        .eq('user_id', user.id);
      if (profileError) throw profileError;

      // 2. Academic profile — structured when a catalog university is chosen,
      //    otherwise free-text fallback.
      if (uniId && !noCatalog) {
        await setAcademicProfile({
          universityId: uniId,
          facultyId: facId || null,
          programId: progId || null,
          currentSemester: semester,
        });
      } else if (freeInstitution.trim() || (selectedUni && noCatalog)) {
        await setMySocialProfile(freeInstitution.trim() || selectedUni?.name || '', []);
      }

      // 3. Confirm catalog courses (bulk upsert)
      const items = Object.entries(statusMap).map(([catalogCourseId, status]) => ({
        catalogCourseId,
        status,
      }));
      if (items.length) await confirmCatalogCourses(items);

      // 4. Platform content enrollments (existing behaviour)
      for (const courseId of selectedCourses) {
        try {
          await enrollInCourse(courseId);
        } catch (e) {
          console.error(`Failed to enroll in course ${courseId}`, e);
        }
      }

      // 5. Institution verification (best-effort; gated on confirmed email)
      try {
        await verifyMyInstitution();
      } catch (e) {
        console.error('Institution verification failed', e);
      }

      // 6. Pull the personalization we just unlocked so the reveal can show it off.
      let classmates = 0;
      let recommendations = 0;
      try { classmates = (await fetchFriendSuggestions(3)).length; } catch { /* dormant for new cohorts */ }
      try { recommendations = (await getRecommendedCourses(3)).length; } catch { /* none yet */ }
      setRevealData({
        classmates,
        recommendations,
        courses: Object.keys(statusMap).length + selectedCourses.length,
      });

      // Name + photo are set → award "Identity Set" (and "Verified Scholar" if the
      // institution was just verified). We intentionally DO NOT call evaluate()
      // here because it would spawn a popup that obscures the 5-second cinematic.
      // Instead, we let the Dashboard's on-mount useEffect trigger the evaluation.

      // The reveal montage — the payoff for setting everything up.
      setStep(TOTAL_STEPS);
      setStage('reveal');
      play('boot');
      setTimeout(() => play('complete'), 3600);

      setTimeout(() => {
        // Hard navigate so the dashboard mounts with a freshly-refreshed profile
        // (name, avatar, rank ring) instead of stale onboarding-time state.
        window.location.href = '/dashboard';
      }, 5400);
    } catch (error: unknown) {
      toast({
        title: 'Something went wrong',
        description: error instanceof Error ? error.message : 'Could not complete onboarding.',
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  const includedCount = Object.keys(statusMap).length;

  /* ----------------------------- Cold open ------------------------------- */
  if (stage === 'intro') {
    return (
      <div
        className="min-h-screen console-bg flex relative overflow-hidden items-center justify-center cursor-pointer"
        onClick={beginJourney}
      >
        <SoundToggle enabled={soundOn} onToggle={toggleSound} />
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-primary/15 blur-[130px] animate-pulse" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-secondary/15 blur-[130px] animate-pulse delay-700" />
        </div>

        <motion.div
          className="relative z-10 text-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <motion.div
            initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.2 }}
            className="w-40 h-40 mx-auto mb-8 flex items-center justify-center"
          >
            <LunaAstronaut phase="full" size="xl" animated />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-5xl md:text-6xl font-bold text-foreground mb-4"
          >
            Welcome to Learnstation
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="text-muted-foreground text-xl mb-12"
          >
            Hey {firstName}, let's set up your journey.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.6 }}
          >
            <Button
              size="xl"
              onClick={(e) => { e.stopPropagation(); beginJourney(); }}
              className="h-16 px-12 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold text-lg shadow-glow-primary"
            >
              Press to begin <ArrowRight className="w-6 h-6 ml-2" />
            </Button>
            <p className="text-xs text-muted-foreground/60 mt-6 tracking-widest uppercase">Tap anywhere to continue</p>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  /* ------------------------------ Reveal --------------------------------- */
  if (stage === 'reveal') {
    const teases = [
      { show: revealData.courses > 0, icon: BookOpen, label: `Semester ${semester} set up`, value: `${revealData.courses} course${revealData.courses === 1 ? '' : 's'}` },
      { show: revealData.classmates > 0, icon: Users, label: 'Classmates to meet', value: `${revealData.classmates} waiting` },
      { show: revealData.recommendations > 0, icon: Sparkles, label: 'Picked for you', value: `${revealData.recommendations} course${revealData.recommendations === 1 ? '' : 's'}` },
    ].filter((t) => t.show);

    return (
      <div className="min-h-screen console-bg flex relative overflow-hidden items-center justify-center">
        <SoundToggle enabled={soundOn} onToggle={toggleSound} />
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-primary/15 blur-[130px] animate-pulse" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-secondary/15 blur-[130px] animate-pulse delay-700" />
        </div>

        <div className="relative z-10 w-full max-w-xl px-6 text-center">
          {/* Avatar + rank ring draw on */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
            className="mx-auto mb-6 flex justify-center"
          >
            <LunaAstronaut phase="full" size="xl" animated />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-3xl font-bold text-foreground"
          >
            You're all set, {firstName}
          </motion.h2>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Trophy className="w-4 h-4 text-xp" />
            <span>Rank: <span className="text-foreground font-semibold">{tier.name}</span></span>
            {rankProg.next && (
              <span className="opacity-70">· {rankProg.toNext} XP to {rankProg.next.name}</span>
            )}
          </motion.div>

          {/* Badge chip */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 1.6 }}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-xp/15 border border-xp/30 text-xp font-semibold text-sm"
          >
            <Sparkles className="w-4 h-4" /> Badge unlocked · Identity Set
          </motion.div>

          {/* Personalization teases */}
          {teases.length > 0 && (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="show"
              transition={{ delayChildren: 2.4 }}
              className="mt-8 grid gap-3"
              style={{ gridTemplateColumns: `repeat(${Math.min(teases.length, 3)}, minmax(0, 1fr))` }}
            >
              {teases.map((t) => (
                <motion.div
                  key={t.label}
                  variants={itemVariants}
                  className="p-4 rounded-2xl bg-white/5 border border-white/10 text-center"
                >
                  <t.icon className="w-5 h-5 text-primary mx-auto mb-2" />
                  <div className="text-foreground font-bold text-sm">{t.value}</div>
                  <div className="text-muted-foreground text-xs mt-0.5">{t.label}</div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Boot bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 3.4 }}
            className="mt-10"
          >
            <p className="text-sm text-muted-foreground font-mono mb-3">&gt; Booting Learnstation OS…</p>
            <div className="h-2 w-full max-w-xs mx-auto rounded-full bg-white/5 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-secondary"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ delay: 3.4, duration: 1.8, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  /* ------------------------------- Form ---------------------------------- */
  const v = stepVariants(dir);

  return (
    <div className="min-h-screen console-bg flex relative overflow-hidden items-center justify-center">
      <SoundToggle enabled={soundOn} onToggle={toggleSound} />
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[120px] animate-pulse delay-700" />
      </div>

      <div className="relative z-10 w-full max-w-2xl p-6">
        {/* Animated journey map (replaces plain progress dots) */}
        <div className="mb-6">
          <OnboardingJourneyMap current={step} total={TOTAL_STEPS} labels={JOURNEY_LABELS} height={120} reduceMotion={reduceMotion} />
        </div>

        <div className="glass-panel rounded-[32px] border-white/10 p-8 md:p-12 shadow-2xl ring-1 ring-inset ring-white/5 relative overflow-hidden min-h-[500px] flex flex-col">
          <AnimatePresence mode="wait" custom={dir}>
            {step === 1 && (
              <motion.div key="step1" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col">
                <div className="mb-10 text-center">
                  <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow-primary">
                    <User className="w-8 h-8 text-primary" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-3">Welcome!</h1>
                  <p className="text-muted-foreground text-lg">What should we call you on your journey?</p>
                </div>
                <div className="flex-1 flex items-center justify-center max-w-sm mx-auto w-full">
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && fullName.trim()) handleNext(); }}
                    placeholder="Enter your name..."
                    className="h-16 text-center text-xl bg-white/5 border-white/10 focus:border-primary/50 rounded-2xl transition-all"
                    autoFocus
                  />
                </div>
                <div className="mt-10 flex justify-end">
                  <Button size="xl" onClick={handleNext} disabled={!fullName.trim()} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">
                    Next <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col items-center justify-center gap-6">

                {/* ── Luna character card ── */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full max-w-[280px] mx-auto rounded-3xl overflow-hidden"
                  style={{
                    background: 'linear-gradient(160deg, hsl(235 40% 18%) 0%, hsl(250 35% 14%) 100%)',
                    boxShadow: '0 0 0 1px hsl(235 40% 25% / 0.6), 0 24px 48px -8px hsl(235 85% 65% / 0.15)',
                  }}
                >
                  {/* Starfield dots */}
                  {[[14,18],[48,12],[72,22],[90,10],[18,44],[80,38],[30,60]].map(([x,y], i) => (
                    <span key={i} className="absolute w-0.5 h-0.5 rounded-full bg-white/30" style={{ left: `${x}%`, top: `${y}%` }} />
                  ))}

                  <div className="flex flex-col items-center px-8 pt-10 pb-8 gap-4 relative z-10">
                    {/* Luna preview */}
                    <motion.div
                      key={`${lunaSuit}-${lunaVisor}-${lunaPatch}`}
                      initial={{ scale: 0.9 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      <LunaAstronaut size="lg" phase="full" animated suitColor={lunaSuit} visorTint={lunaVisor} patchEmoji={lunaPatch || undefined} />
                    </motion.div>

                    {/* Name & description */}
                    <div className="text-center space-y-1">
                      <p className="text-2xl font-black text-foreground tracking-tight">luna</p>
                      <p className="text-sm text-muted-foreground leading-snug">your study companion &middot; night mode guardian</p>
                    </div>

                    {/* Personality tags */}
                    <div className="flex gap-2">
                      {['curious', 'focused', 'always there'].map((tag) => (
                        <span key={tag} className="text-[11px] font-semibold px-3 py-1 rounded-full bg-white/8 text-muted-foreground border border-white/10">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.div>

                {/* ── Customizer ── */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18, duration: 0.4 }}
                  className="w-full max-w-[280px] mx-auto space-y-4"
                >
                  {/* Suit colour */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">Suit</p>
                    <div className="flex gap-2.5">
                      {[
                        { hex: '#FFF8E7', label: 'Classic' },
                        { hex: '#C8E6FA', label: 'Arctic' },
                        { hex: '#F9D5E5', label: 'Rose' },
                        { hex: '#D5F5E3', label: 'Sage' },
                        { hex: '#EAD9FF', label: 'Nebula' },
                      ].map(({ hex, label }) => (
                        <button
                          key={hex}
                          onClick={() => setLunaSuit(hex)}
                          title={label}
                          className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                            lunaSuit === hex ? 'border-primary scale-110 ring-2 ring-primary/30' : 'border-white/20'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Visor tint */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">Visor</p>
                    <div className="flex gap-2.5">
                      {[
                        { hex: '#88B0B5', label: 'Teal' },
                        { hex: '#8B5CF6', label: 'Violet' },
                        { hex: '#F59E0B', label: 'Amber' },
                        { hex: '#EC4899', label: 'Pink' },
                        { hex: '#34D399', label: 'Emerald' },
                      ].map(({ hex, label }) => (
                        <button
                          key={hex}
                          onClick={() => setLunaVisor(hex)}
                          title={label}
                          className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                            lunaVisor === hex ? 'border-primary scale-110 ring-2 ring-primary/30' : 'border-white/20'
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Patch emoji */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground">Patch</p>
                    <div className="flex gap-2">
                      {['', '🚀', '⭐', '🌙', '🔥', '💎'].map((emoji) => (
                        <button
                          key={emoji || 'default'}
                          onClick={() => setLunaPatch(emoji)}
                          className={`w-8 h-8 rounded-xl text-sm flex items-center justify-center border-2 transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                            lunaPatch === emoji ? 'border-primary bg-primary/20 scale-110' : 'border-white/10 bg-white/5'
                          }`}
                        >
                          {emoji || '★'}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>

                <div className="w-full max-w-[280px] mx-auto flex justify-between mt-2">
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5">Back</Button>
                  <Button size="xl" onClick={handleNext} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">Next <ArrowRight className="w-5 h-5 ml-2" /></Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col">
                <div className="mb-8 text-center">
                  <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow-primary">
                    <GraduationCap className="w-8 h-8 text-primary" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-3">Your studies</h1>
                  <p className="text-muted-foreground text-lg">Tell us where you study so we can set things up for you.</p>
                </div>

                <div className="flex-1 space-y-4 max-w-md mx-auto w-full">
                  <div>
                    <Select value={uniId} onValueChange={(val) => { play('select'); setAutoMatched(false); setUniId(val); }}>
                      <SelectTrigger className="w-full h-14 px-4 rounded-2xl bg-white/5 border-2 border-white/10 text-foreground focus:border-primary/50 transition-all text-base">
                        <SelectValue placeholder="Select your university…" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-white/10">
                        {universities.map((u) => (
                          <SelectItem key={u.id} value={u.id} className="rounded-lg cursor-pointer">
                            {u.name}{u.city ? `, ${u.city}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <AnimatePresence>
                      {autoMatched && selectedUni && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center gap-2 mt-2 ml-1 text-sm text-primary"
                        >
                          <MapPin className="w-4 h-4" />
                          <span>Looks like you're at {selectedUni.name}. Pre-filled from your email.</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {noCatalog ? (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                      <div className="flex items-start gap-3 p-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-muted-foreground">
                        <Building2 className="w-5 h-5 shrink-0 text-secondary mt-0.5" />
                        <span>We don't have {selectedUni?.name}'s course catalog yet. You can still tell us your institution, and we'll personalize once it's available.</span>
                      </div>
                      <Input
                        value={freeInstitution || selectedUni?.name || ''}
                        onChange={(e) => setFreeInstitution(e.target.value)}
                        placeholder="Your institution"
                        className="h-14 bg-white/5 border-white/10 focus:border-primary/50 rounded-2xl"
                      />
                    </motion.div>
                  ) : (
                    <>
                      <AnimatePresence>
                        {uniId && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                            <Select value={facId} onValueChange={(val) => { play('select'); setFacId(val); }} disabled={!uniId || faculties.length === 0}>
                              <SelectTrigger className="w-full h-14 px-4 rounded-2xl bg-white/5 border-2 border-white/10 text-foreground focus:border-primary/50 transition-all text-base">
                                <SelectValue placeholder={uniId ? 'Select your faculty…' : 'Pick a university first'} />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-white/10">
                                {faculties.map((f) => (
                                  <SelectItem key={f.id} value={f.id} className="rounded-lg cursor-pointer">
                                    {f.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <AnimatePresence>
                        {facId && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                            <Select value={progId} onValueChange={(val) => { play('select'); setProgId(val); }} disabled={!facId || programs.length === 0}>
                              <SelectTrigger className="w-full h-14 px-4 rounded-2xl bg-white/5 border-2 border-white/10 text-foreground focus:border-primary/50 transition-all text-base">
                                <SelectValue placeholder={facId ? 'Select your degree program…' : 'Pick a faculty first'} />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-white/10">
                                {programs.map((p) => (
                                  <SelectItem key={p.id} value={p.id} className="rounded-lg cursor-pointer">
                                    {p.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <AnimatePresence>
                        {progId && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                            <label className="block text-sm text-muted-foreground mb-2 ml-1">Current semester</label>
                            <Select value={semester.toString()} onValueChange={(val) => { play('select'); setSemester(Number(val)); }} disabled={!progId}>
                              <SelectTrigger className="w-full h-14 px-4 rounded-2xl bg-white/5 border-2 border-white/10 text-foreground focus:border-primary/50 transition-all text-base">
                                <SelectValue placeholder="Semester" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-white/10 max-h-[300px]">
                                {Array.from(
                                  { length: programs.find((p) => p.id === progId)?.totalSemesters || 12 },
                                  (_, i) => i + 1,
                                ).map((n) => (
                                  <SelectItem key={n} value={n.toString()} className="rounded-lg cursor-pointer">
                                    Semester {n}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}

                  {uniId && (
                    <div className="pt-2">
                      <UniversityEmailLink />
                    </div>
                  )}
                </div>

                <div className="mt-10 flex justify-between">
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5">Back</Button>
                  <Button size="xl" onClick={handleNext} disabled={!uniId} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">
                    Next <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="step4" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col max-h-[70vh]">
                <div className="mb-6 text-center">
                  <div className="w-16 h-16 bg-secondary/20 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow-secondary">
                    <ShieldCheck className="w-8 h-8 text-secondary" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-2">We set up your Semester {semester}</h1>
                  <p className="text-muted-foreground text-base">
                    Here's what you've likely done and what you're taking now. Adjust anything that's off.
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                  {loadingSuggested ? (
                    <div className="flex items-center justify-center h-40"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
                  ) : suggested.length === 0 ? (
                    <div className="text-center p-8 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-muted-foreground">No catalog courses found for this program.</p>
                    </div>
                  ) : (
                    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-2">
                      {suggested.map((c) => {
                        const included = !!statusMap[c.id];
                        const status = statusMap[c.id] ?? c.suggestedStatus;
                        return (
                          <motion.div variants={itemVariants} key={c.id} className={`p-3 rounded-2xl border-2 transition-all ${included ? 'border-primary/40 bg-primary/5' : 'border-white/5 bg-white/5'}`}>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleSuggested(c.id, c.suggestedStatus)}
                              className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition-colors ${included ? 'bg-primary border-primary text-white' : 'border-white/20'}`}
                            >
                              {included && <Check className="w-4 h-4" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-foreground leading-tight truncate">{c.title}</h3>
                              <p className="text-xs text-muted-foreground">
                                {c.courseCode ? `${c.courseCode} · ` : ''}{c.typicalSemester ? `Semester ${c.typicalSemester}` : 'Elective'}
                              </p>
                            </div>
                            {included && (
                              <div className="flex gap-1 shrink-0">
                                {STATUS_ORDER.map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => setSuggestedStatus(c.id, s)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${status === s ? 'bg-primary text-white' : 'bg-white/5 text-muted-foreground hover:bg-white/10'}`}
                                  >
                                    {STATUS_LABELS[s]}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                    </motion.div>
                  )}
                </div>

                <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center shrink-0">
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5">Back</Button>
                  <Button size="xl" onClick={handleNext} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">
                    {includedCount} selected · Next <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 5 && (
              <motion.div key="step5" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col max-h-[70vh]">
                <div className="mb-6 text-center">
                  <div className="w-16 h-16 bg-xp/20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow-primary">
                    <BookOpen className="w-8 h-8 text-xp" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-3">Add extra topics</h1>
                  <p className="text-muted-foreground text-lg">Optionally explore courses on Learnstation beyond your curriculum.</p>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                  {loadingCourses ? (
                    <div className="flex items-center justify-center h-40"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
                  ) : courses.length === 0 ? (
                    <div className="text-center p-8 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-muted-foreground">No public courses available right now.</p>
                    </div>
                  ) : (
                    <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
                      {courses.map((course) => {
                        const isSelected = selectedCourses.includes(course.id);
                        return (
                          <motion.button
                            variants={itemVariants}
                            key={course.id}
                            onClick={() => toggleCourse(course.id)}
                            className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-4 ${isSelected ? 'border-primary bg-primary/10 shadow-glow-primary/20' : 'border-white/5 bg-white/5 hover:border-white/20'}`}
                          >
                          <div className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-primary border-primary text-white' : 'border-white/20'}`}>
                            {isSelected && <Check className="w-4 h-4" />}
                          </div>
                          <div>
                            <h3 className="font-bold text-foreground text-lg leading-tight">{course.title}</h3>
                            {course.description && <p className="text-sm text-muted-foreground line-clamp-1 mt-1">{course.description}</p>}
                          </div>
                        </motion.button>
                      );
                    })}
                    </motion.div>
                  )}
                </div>

                <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center shrink-0">
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5" disabled={loading}>Back</Button>
                  <Button size="xl" onClick={handleFinish} disabled={loading} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold min-w-[140px]">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : <>Start Learning <Sparkles className="w-5 h-5 ml-2" /></>}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  // `reducedMotion="user"` makes every Motion animation in the tree honor
  // prefers-reduced-motion automatically (skill §6.B). The PIXI journey map is
  // calmed separately via its own reduceMotion prop.
  return (
    <MotionConfig reducedMotion="user">
      <OnboardingInner />
    </MotionConfig>
  );
}
