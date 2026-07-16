import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, Sparkles, BookOpen, Check, Loader2,
  Building2, Volume2, VolumeX,
  Users, Trophy, MapPin, ChevronsUpDown,
  Calculator, FlaskConical, Landmark, Palette, Code, Briefcase, Globe, HeartPulse, Brain
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
import { rankForXp, rankProgress } from '@/lib/rank';
import { useSound } from '@/lib/useSound';
import { OnboardingJourneyMap } from '@/features/onboarding/pixi/OnboardingJourneyMap';
import type {
  University, Faculty, DegreeProgram, SuggestedCourse, StudentCatalogStatus,
} from '@/types/academic';
import { LunaAstronaut } from '../../learnstation-luna';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UniversityEmailLink } from '@/components/UniversityEmailLink';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

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

const STATUS_ORDER: StudentCatalogStatus[] = ['completed', 'in_progress', 'planned'];

const COURSE_COLOR_PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#ef4444', '#14b8a6', '#6366f1'];

// Platform courses are authored once (in German) without localized titles yet;
// translate the known ones here until the backend stores per-locale titles.
const PLATFORM_COURSE_TITLE_EN: Record<string, string> = {
  'Datenbanksysteme': 'Database Systems',
};

function localizeCourseTitle(title: string, language: string) {
  if (!language.startsWith('en')) return title;
  return PLATFORM_COURSE_TITLE_EN[title] ?? title;
}

function getCourseIcon(title: string) {
  const titleLower = title.toLowerCase();
  if (titleLower.includes('math') || titleLower.includes('calculus') || titleLower.includes('algebra')) return Calculator;
  if (titleLower.includes('science') || titleLower.includes('physics') || titleLower.includes('chemistry')) return FlaskConical;
  if (titleLower.includes('history') || titleLower.includes('law')) return Landmark;
  if (titleLower.includes('art') || titleLower.includes('design')) return Palette;
  if (titleLower.includes('code') || titleLower.includes('computer') || titleLower.includes('program')) return Code;
  if (titleLower.includes('business') || titleLower.includes('econ') || titleLower.includes('finance')) return Briefcase;
  if (titleLower.includes('language') || titleLower.includes('english') || titleLower.includes('world')) return Globe;
  if (titleLower.includes('health') || titleLower.includes('medicine') || titleLower.includes('bio')) return HeartPulse;
  if (titleLower.includes('psychology') || titleLower.includes('mind')) return Brain;
  return BookOpen;
}

function getCourseColor(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COURSE_COLOR_PALETTE[Math.abs(hash) % COURSE_COLOR_PALETTE.length];
}

/** Groups suggested courses by their typical semester (electives last), so students can browse and pick courses outside their current semester. */
function groupSuggestedBySemester<T extends { typicalSemester: number | null }>(courses: T[]) {
  const groups = new Map<number | 'elective', T[]>();
  courses.forEach((c) => {
    const key = c.typicalSemester ?? 'elective';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === 'elective') return 1;
    if (b === 'elective') return -1;
    return a - b;
  });
}

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
  const { t } = useTranslation('onboarding');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={enabled ? t('sound.muteAria') : t('sound.unmuteAria')}
      title={enabled ? t('sound.onTitle') : t('sound.offTitle')}
      className="fixed top-5 right-5 z-30 w-10 h-10 rounded-full bg-white/5 border border-white/10 backdrop-blur flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
    >
      {enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
    </button>
  );
}

function OnboardingInner() {
  const { t, i18n } = useTranslation('onboarding');
  const { user, profile } = useAuth();
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
  const [lunaSuit, setLunaSuit] = useState(profile?.luna_suit_color || '#FFF8E7');
  const [lunaVisor, setLunaVisor] = useState(profile?.luna_visor_tint || '#88B0B5');
  // Preserved to prevent overwriting legacy insignia data on save
  const [lunaPatch] = useState(profile?.luna_patch || '');

  // Step 5 — platform content courses (existing behaviour)
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);

  // Step 3 — academic context
  const [universities, setUniversities] = useState<University[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [programs, setPrograms] = useState<DegreeProgram[]>([]);
  const [uniId, setUniId] = useState('');
  const [uniDropdownOpen, setUniDropdownOpen] = useState(false);
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

  // Waiting for explicit user interaction instead of auto-advance

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
        // Extra-topics onboarding step only surfaces courses that are ready today.
        setCourses(data.filter((c) => c.title.trim().toLowerCase() === 'datenbanksysteme'));
      } catch (err) {
        console.error('Failed to load courses', err);
      } finally {
        setLoadingCourses(false);
      }
    })();
    (async () => {
      try {
        const unis = await getUniversities();
        // Marburg has the fullest course catalog today, so surface it first in the list.
        const sorted = [...unis].sort((a, b) => (a.name === 'University of Marburg' ? -1 : b.name === 'University of Marburg' ? 1 : 0));
        setUniversities(sorted);
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
    if (step === 1) {
      setStage('intro');
      setStep(0);
      return;
    }
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
      toast({ title: t('toasts.invalidFileTitle'), description: t('toasts.invalidFileDescription'), variant: 'destructive' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: t('toasts.fileTooLargeTitle'), description: t('toasts.fileTooLargeDescription'), variant: 'destructive' });
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
      toast({ title: t('toasts.avatarUploadedTitle'), description: t('toasts.avatarUploadedDescription') });
    } catch (error: unknown) {
      toast({
        title: t('toasts.uploadErrorTitle'),
        description: error instanceof Error ? error.message : t('toasts.uploadErrorFallback'),
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
          luna_suit_color: lunaSuit,
          luna_visor_tint: lunaVisor,
          luna_patch: lunaPatch || null,
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
        title: t('toasts.finishErrorTitle'),
        description: error instanceof Error ? error.message : t('toasts.finishErrorFallback'),
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  const includedCount = Object.keys(statusMap).length;

  /* ----------------------------- Cold open ------------------------------- */
  if (stage === 'intro') {
    return (
      <div className="min-h-screen console-bg flex relative overflow-hidden items-center justify-center">
        <SoundToggle enabled={soundOn} onToggle={toggleSound} />
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-primary/15 blur-[130px] animate-pulse" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-secondary/15 blur-[130px] animate-pulse delay-700" />
        </div>

        <motion.div
          className="relative z-10 px-6 max-w-6xl w-full flex flex-col md:flex-row items-center justify-center gap-12 lg:gap-24"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          {/* Left Side: Big Luna Head */}
          <motion.div
            initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.2 }}
            className="w-64 h-64 md:w-80 md:h-80 lg:w-[400px] lg:h-[400px] flex items-center justify-center shrink-0"
          >
            <LunaAstronaut variant="head" phase="full" size="xxl" animated showShadow={false} />
          </motion.div>

          {/* Right Side: Text & Button */}
          <div className="text-center md:text-left flex flex-col items-center md:items-start max-w-xl">
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground mb-6"
            >
              {t('intro.title')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="text-muted-foreground text-xl md:text-2xl mb-12 leading-relaxed"
            >
              {t('intro.subtitle')}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.6 }}
            >
              <Button
                size="xl"
                onClick={(e) => { e.stopPropagation(); beginJourney(); }}
                className="h-16 px-12 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold text-lg shadow-glow-primary transition-all active:scale-95"
              >
                {t('actions.clickToContinue')} <ArrowRight className="w-6 h-6 ml-2" />
              </Button>
            </motion.div>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ------------------------------ Reveal --------------------------------- */
  if (stage === 'reveal') {
    const teases = [
      { show: revealData.courses > 0, icon: BookOpen, label: t('reveal.semesterSetUp', { semester }), value: t('reveal.courseCount', { count: revealData.courses }) },
      { show: revealData.classmates > 0, icon: Users, label: t('reveal.classmatesToMeet'), value: t('reveal.classmatesWaiting', { count: revealData.classmates }) },
      { show: revealData.recommendations > 0, icon: Sparkles, label: t('reveal.pickedForYou'), value: t('reveal.courseCount', { count: revealData.recommendations }) },
    ].filter((tease) => tease.show);

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
            {t('reveal.allSet', { name: firstName })}
          </motion.h2>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Trophy className="w-4 h-4 text-xp" />
            <span>{t('reveal.rank', { rank: tier.name })}</span>
            {rankProg.next && (
              <span className="opacity-70">· {t('reveal.xpToNext', { xp: rankProg.toNext, rank: rankProg.next.name })}</span>
            )}
          </motion.div>

          {/* Badge chip */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 1.6 }}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-xp/15 border border-xp/30 text-xp font-semibold text-sm"
          >
            <Sparkles className="w-4 h-4" /> {t('reveal.badgeUnlocked')}
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
              {teases.map((tease) => (
                <motion.div
                  key={tease.label}
                  variants={itemVariants}
                  className="p-4 rounded-2xl bg-white/5 border border-white/10 text-center"
                >
                  <tease.icon className="w-5 h-5 text-primary mx-auto mb-2" />
                  <div className="text-foreground font-bold text-sm">{tease.value}</div>
                  <div className="text-muted-foreground text-xs mt-0.5">{tease.label}</div>
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
            <p className="text-sm text-muted-foreground font-mono mb-3">{t('reveal.booting')}</p>
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

      <div className="relative z-10 px-6 max-w-7xl w-full flex flex-col lg:flex-row items-center justify-center gap-12 lg:gap-24">
        
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="hidden lg:flex w-[400px] h-[400px] shrink-0 items-center justify-center"
        >
          <LunaAstronaut 
            variant={step >= 2 ? "full" : "head"} 
            costume={step >= 3 ? "university" : "default"}
            phase="full" 
            size="xxl" 
            animated 
            showShadow={step >= 2} 
            suitColor={lunaSuit}
            visorTint={lunaVisor}
            patchImage={lunaPatch || undefined}
          />
        </motion.div>

        {/* Right Side: Onboarding Form */}
        <div className={`w-full transition-[max-width] duration-300 ${step === 4 || step === 5 ? 'max-w-3xl' : 'max-w-2xl'}`}>
          {/* Animated journey map (replaces plain progress dots) */}
          <div className="mb-6">
            <OnboardingJourneyMap current={step} total={TOTAL_STEPS} labels={JOURNEY_LABELS} height={120} reduceMotion={reduceMotion} />
          </div>

          <div className="relative w-full min-h-[500px] flex flex-col py-4 md:py-8">
          <AnimatePresence mode="wait" custom={dir}>
            {step === 1 && (
              <motion.div key="step1" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col">
                <div className="mb-10 max-w-lg mx-auto w-full">
                  <div className="mx-auto mb-6 flex justify-center lg:hidden">
                    <LunaAstronaut variant="head" phase="full" size="sm" animated showShadow={false} />
                  </div>
                  <div className="glass-panel p-6 md:p-8 rounded-[2rem] rounded-tl-sm border-white/10 shadow-xl relative text-left">
                    <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">{t('steps.name.title')}</h1>
                    <p className="text-muted-foreground text-lg">{t('steps.name.subtitle')}</p>
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-center max-w-sm mx-auto w-full">
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && fullName.trim()) handleNext(); }}
                    placeholder={t('steps.name.placeholder')}
                    className="h-16 text-center text-xl bg-white/5 border-white/10 focus:border-primary/50 rounded-2xl transition-all"
                    autoFocus
                  />
                </div>
                <div className="mt-10 flex justify-between max-w-md mx-auto w-full">
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5">{t('actions.back')}</Button>
                  <Button size="xl" onClick={handleNext} disabled={!fullName.trim()} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">
                    {t('actions.next')} <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col items-center justify-center gap-6">

                {/* ── Luna character card (Hidden on desktop since she is huge on the left) ── */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="relative w-full max-w-[280px] mx-auto rounded-3xl overflow-hidden lg:hidden"
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
                      <LunaAstronaut size="lg" phase="full" animated suitColor={lunaSuit} visorTint={lunaVisor} patchImage={lunaPatch || undefined} />
                    </motion.div>

                    {/* Name & description */}
                    <div className="text-center space-y-1">
                      <p className="text-2xl font-black text-foreground tracking-tight">{t('steps.avatar.companionName')}</p>
                      <p className="text-sm text-muted-foreground leading-snug">{t('steps.avatar.companionTagline')}</p>
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

                {/* ── Premium Customizer ── */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18, duration: 0.4 }}
                  className="w-full max-w-md mx-auto space-y-8 mt-4"
                >
                  {/* Suit Finish */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('steps.avatar.suitFinish')}</p>
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        { hex: '#111111', label: 'Obsidian' },
                        { hex: '#FAFAFA', label: 'Titanium' },
                        { hex: '#1C2A3A', label: 'Deep Space' },
                        { hex: '#3B1C1C', label: 'Crimson' },
                        { hex: '#FFF8E7', label: 'Classic' },
                      ].map(({ hex, label }) => (
                        <button
                          key={hex}
                          onClick={() => setLunaSuit(hex)}
                          title={label}
                          className={`group flex flex-col items-center gap-2 focus-visible:outline-none`}
                        >
                          <div 
                            className={`w-full aspect-square rounded-2xl border-2 transition-all duration-300 ${lunaSuit === hex ? 'border-primary ring-4 ring-primary/20 scale-105' : 'border-white/10 hover:border-white/30 hover:scale-105'}`}
                            style={{ backgroundColor: hex }}
                          />
                          <span className={`text-[10px] font-medium transition-colors ${lunaSuit === hex ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Visor Tint */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">{t('steps.avatar.visorTint')}</p>
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        { hex: '#00F0FF', label: 'Cyan' },
                        { hex: '#FF003C', label: 'Cyber' },
                        { hex: '#FFD700', label: 'Solar' },
                        { hex: '#8B5CF6', label: 'Void' },
                        { hex: '#88B0B5', label: 'Classic' },
                      ].map(({ hex, label }) => (
                        <button
                          key={hex}
                          onClick={() => setLunaVisor(hex)}
                          title={label}
                          className={`group flex flex-col items-center gap-2 focus-visible:outline-none`}
                        >
                          <div 
                            className={`w-full aspect-square rounded-2xl border-2 transition-all duration-300 ${lunaVisor === hex ? 'border-primary ring-4 ring-primary/20 scale-105 shadow-glow-primary' : 'border-white/10 hover:border-white/30 hover:scale-105'}`}
                            style={{ backgroundColor: hex }}
                          />
                          <span className={`text-[10px] font-medium transition-colors ${lunaVisor === hex ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>


                </motion.div>

                <div className="w-full max-w-md mx-auto flex justify-between mt-8">
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5">{t('actions.back')}</Button>
                  <Button size="xl" onClick={handleNext} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">{t('actions.next')} <ArrowRight className="w-5 h-5 ml-2" /></Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col">
                <div className="mb-8 max-w-lg mx-auto w-full">
                  <div className="mx-auto mb-6 flex justify-center lg:hidden">
                    <LunaAstronaut variant="full" costume="university" phase="full" size="sm" animated showShadow={false} suitColor={lunaSuit} visorTint={lunaVisor} patchImage={lunaPatch || undefined} />
                  </div>
                  <div className="glass-panel p-6 md:p-8 rounded-[2rem] rounded-tl-sm border-white/10 shadow-xl relative text-left">
                    <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">{t('steps.university.title')}</h1>
                    <p className="text-muted-foreground text-lg">{t('steps.university.subtitle')}</p>
                  </div>
                </div>

                <div className="flex-1 space-y-4 max-w-md mx-auto w-full">
                  <div>
                    <Popover open={uniDropdownOpen} onOpenChange={setUniDropdownOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={uniDropdownOpen}
                          className="w-full h-14 px-4 rounded-2xl bg-white/5 border-2 border-white/10 text-foreground hover:bg-white/5 hover:text-foreground hover:border-primary/50 transition-all text-base justify-between font-normal"
                        >
                          {uniId
                            ? universities.find((u) => u.id === uniId)?.name
                            : t('steps.university.universityPlaceholder')}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 rounded-xl border-white/10 bg-background/95 backdrop-blur-xl">
                        <Command className="bg-transparent">
                          <CommandInput placeholder={t('steps.university.universityPlaceholder')} className="h-12 border-none focus:ring-0 text-base" />
                          <CommandList>
                            <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">No university found.</CommandEmpty>
                            <CommandGroup>
                              {universities.map((u) => (
                                <CommandItem
                                  key={u.id}
                                  value={`${u.name} ${u.city || ''} ${u.id}`}
                                  onSelect={() => {
                                    play('select');
                                    setAutoMatched(false);
                                    setUniId(u.id);
                                    setUniDropdownOpen(false);
                                  }}
                                  className="rounded-lg cursor-pointer my-1 text-sm aria-selected:bg-white/10"
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 text-primary ${uniId === u.id ? 'opacity-100' : 'opacity-0'}`}
                                  />
                                  {u.name}{u.city ? `, ${u.city}` : ''}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <AnimatePresence>
                      {autoMatched && selectedUni && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center gap-2 mt-2 ml-1 text-sm text-primary"
                        >
                          <MapPin className="w-4 h-4" />
                          <span>{t('steps.university.autoMatched', { university: selectedUni.name })}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {noCatalog ? (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                      <div className="flex items-start gap-3 p-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-muted-foreground">
                        <Building2 className="w-5 h-5 shrink-0 text-secondary mt-0.5" />
                        <span>{t('steps.university.noCatalog', { university: selectedUni?.name })}</span>
                      </div>
                      <Input
                        value={freeInstitution || selectedUni?.name || ''}
                        onChange={(e) => setFreeInstitution(e.target.value)}
                        placeholder={t('steps.university.institutionPlaceholder')}
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
                                <SelectValue placeholder={uniId ? t('steps.university.facultyPlaceholder') : t('steps.university.facultyPlaceholderLocked')} />
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
                                <SelectValue placeholder={facId ? t('steps.university.programPlaceholder') : t('steps.university.programPlaceholderLocked')} />
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
                            <label className="block text-sm text-muted-foreground mb-2 ml-1">{t('steps.university.semesterLabel')}</label>
                            <Select value={semester.toString()} onValueChange={(val) => { play('select'); setSemester(Number(val)); }} disabled={!progId}>
                              <SelectTrigger className="w-full h-14 px-4 rounded-2xl bg-white/5 border-2 border-white/10 text-foreground focus:border-primary/50 transition-all text-base">
                                <SelectValue placeholder={t('steps.university.semesterPlaceholder')} />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-white/10 max-h-[300px]">
                                {Array.from(
                                  { length: programs.find((p) => p.id === progId)?.totalSemesters || 12 },
                                  (_, i) => i + 1,
                                ).map((n) => (
                                  <SelectItem key={n} value={n.toString()} className="rounded-lg cursor-pointer">
                                    {t('steps.university.semesterOption', { n })}
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
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5">{t('actions.back')}</Button>
                  <Button size="xl" onClick={handleNext} disabled={!uniId} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">
                    {t('actions.next')} <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="step4" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col md:flex-row gap-8 max-h-[80vh] md:max-h-[75vh]">
                
                {/* Left Side: Header & Sticky CTA */}
                <div className="w-full md:w-[35%] flex flex-col shrink-0 relative z-10">
                  <div className="md:sticky md:top-0 space-y-6">
                    <div className="mx-auto flex justify-center lg:hidden mb-4">
                      <LunaAstronaut variant="full" costume="university" phase="full" size="sm" animated showShadow={false} suitColor={lunaSuit} visorTint={lunaVisor} patchImage={lunaPatch || undefined} />
                    </div>
                    <div className="text-left">
                      <h1 className="text-4xl md:text-5xl font-extrabold text-foreground mb-3 leading-tight tracking-tight">{t('steps.confirmCourses.title', { semester })}</h1>
                      <p className="text-muted-foreground text-lg md:text-xl font-medium">
                        {t('steps.confirmCourses.subtitle')}
                      </p>
                    </div>
                    
                    {/* Sticky Footer CTA on Desktop */}
                    <div className="hidden md:flex flex-col gap-4 mt-8 pt-8 border-t border-white/10">
                      <Button size="xl" onClick={handleNext} className="h-16 w-full rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold text-lg shadow-xl shadow-primary/20">
                        {t('steps.confirmCourses.selectedCount', { count: includedCount })} · {t('actions.next')} <ArrowRight className="w-5 h-5 ml-2" />
                      </Button>
                      <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 w-full rounded-2xl hover:bg-white/5">{t('actions.back')}</Button>
                    </div>
                  </div>
                </div>

                {/* Right Side: Scrollable Grid */}
                <div className="flex-1 overflow-y-auto custom-scrollbar pb-24 md:pb-2 px-1">
                  {loadingSuggested ? (
                    <div className="flex items-center justify-center h-40"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
                  ) : suggested.length === 0 ? (
                    <div className="text-center p-8 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-muted-foreground">{t('steps.confirmCourses.empty')}</p>
                    </div>
                  ) : (
                    <motion.div variants={containerVariants} initial="hidden" animate="show">
                      {groupSuggestedBySemester(suggested).map(([semesterKey, items]) => {
                        const isCurrent = semesterKey === semester;
                        const groupLabel = semesterKey === 'elective'
                          ? t('steps.confirmCourses.electiveGroup')
                          : isCurrent
                            ? t('steps.confirmCourses.currentSemesterTag', { n: semesterKey })
                            : t('steps.confirmCourses.semesterTag', { n: semesterKey });

                        return (
                          <div key={semesterKey} className="mb-5 last:mb-0">
                            <div className={`flex items-center gap-2.5 mb-2 px-1 ${isCurrent ? 'text-primary' : 'text-muted-foreground/60'}`}>
                              <span className="text-[11px] font-extrabold uppercase tracking-wider whitespace-nowrap">{groupLabel}</span>
                              <span className="h-px flex-1 bg-white/10" />
                            </div>
                            <div className="space-y-2 sm:space-y-2.5">
                              {items.map((c) => {
                                const included = !!statusMap[c.id];
                                const status = statusMap[c.id] ?? c.suggestedStatus;
                                const CourseIcon = getCourseIcon(c.title);
                                const color = getCourseColor(c.title);

                                return (
                                  <motion.div
                                    variants={itemVariants}
                                    key={c.id}
                                    className={`rounded-2xl border transition-colors ${included ? 'border-primary/40 bg-primary/5' : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'}`}
                                  >
                                    <button
                                      onClick={() => toggleSuggested(c.id, c.suggestedStatus)}
                                      aria-label={included ? t('steps.confirmCourses.remove', { title: c.title }) : t('steps.confirmCourses.add', { title: c.title })}
                                      className="w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 text-left rounded-2xl transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                                    >
                                      <span
                                        className="relative shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center"
                                        style={{ background: `linear-gradient(145deg, ${color} 0%, #0a0a0a 130%)` }}
                                      >
                                        <CourseIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                                        <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-background transition-all ${included ? 'bg-primary text-white scale-100 opacity-100' : 'bg-white/10 text-transparent scale-75 opacity-0'}`}>
                                          <Check className="w-3 h-3" strokeWidth={3} />
                                        </span>
                                      </span>

                                      <span className="flex-1 min-w-0">
                                        <span className="block text-[10px] sm:text-[11px] uppercase tracking-wider font-bold text-muted-foreground/70 mb-0.5 truncate">
                                          {c.courseCode ? `${c.courseCode} · ` : ''}{c.typicalSemester ? t('steps.confirmCourses.semesterTag', { n: c.typicalSemester }) : t('steps.confirmCourses.elective')}
                                        </span>
                                        <span className="block font-semibold text-foreground leading-snug text-sm sm:text-base break-words">{c.title}</span>
                                      </span>
                                    </button>

                                    {/* Status picker for selected courses */}
                                    {included && (
                                      <div className="flex gap-1.5 px-3 sm:px-4 pb-3 sm:pb-4">
                                        {STATUS_ORDER.map((s) => (
                                          <button
                                            key={s}
                                            onClick={() => setSuggestedStatus(c.id, s)}
                                            className={`flex-1 py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold leading-tight text-center transition-all ${status === s ? 'bg-primary text-white shadow-glow-primary/20' : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'}`}
                                          >
                                            {t(`steps.confirmCourses.status.${s}`)}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </motion.div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </div>

                {/* Mobile Sticky Footer */}
                <div className="md:hidden absolute -bottom-8 -inset-x-8 p-4 pt-8 bg-gradient-to-t from-background via-background/95 to-transparent flex gap-3 z-50">
                  <Button variant="ghost" size="lg" onClick={handleBack} className="h-14 px-4 rounded-2xl hover:bg-white/5 bg-black/50 backdrop-blur-md">
                    {t('actions.back')}
                  </Button>
                  <Button size="lg" onClick={handleNext} className="flex-1 h-14 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold shadow-glow-primary/20">
                    {t('steps.confirmCourses.selectedCount', { count: includedCount })} · {t('actions.next')} <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>

              </motion.div>
            )}

            {step === 5 && (
              <motion.div key="step5" initial={v.initial} animate={v.animate} exit={v.exit} className="flex-1 flex flex-col md:flex-row gap-8 max-h-[80vh] md:max-h-[75vh]">
                
                {/* Left Side: Header & Sticky CTA */}
                <div className="w-full md:w-[35%] flex flex-col shrink-0 relative z-10">
                  <div className="md:sticky md:top-0 space-y-6">
                    <div className="mx-auto flex justify-center lg:hidden mb-4">
                      <LunaAstronaut variant="full" costume="university" phase="full" size="sm" animated showShadow={false} suitColor={lunaSuit} visorTint={lunaVisor} patchImage={lunaPatch || undefined} />
                    </div>
                    <div className="text-left">
                      <h1 className="text-4xl md:text-5xl font-extrabold text-foreground mb-3 leading-tight tracking-tight">{t('steps.extraTopics.title')}</h1>
                      <p className="text-muted-foreground text-lg md:text-xl font-medium">{t('steps.extraTopics.subtitle')}</p>
                    </div>
                    
                    {/* Sticky Footer CTA on Desktop */}
                    <div className="hidden md:flex flex-col gap-4 mt-8 pt-8 border-t border-white/10">
                      <Button size="xl" onClick={handleFinish} disabled={loading} className="h-16 w-full rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold text-lg shadow-xl shadow-primary/20">
                        {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : <>{t('actions.startLearning')} <Sparkles className="w-5 h-5 ml-2" /></>}
                      </Button>
                      <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 w-full rounded-2xl hover:bg-white/5" disabled={loading}>{t('actions.back')}</Button>
                    </div>
                  </div>
                </div>

                {/* Right Side: Scrollable Grid */}
                <div className="flex-1 overflow-y-auto custom-scrollbar pb-24 md:pb-2 px-1">
                  {loadingCourses ? (
                    <div className="flex items-center justify-center h-40"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
                  ) : courses.length === 0 ? (
                    <div className="text-center p-8 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-muted-foreground">{t('steps.extraTopics.empty')}</p>
                    </div>
                  ) : (
                    <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-2.5">
                      {courses.map((course) => {
                        const isSelected = selectedCourses.includes(course.id);
                        const CourseIcon = getCourseIcon(course.title);
                        const color = course.color || getCourseColor(course.title);
                        const displayTitle = localizeCourseTitle(course.title, i18n.language);

                        return (
                          <motion.button
                            variants={itemVariants}
                            key={course.id}
                            onClick={() => toggleCourse(course.id)}
                            whileTap={{ scale: 0.98 }}
                            className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl border text-left transition-colors ${isSelected ? 'border-primary bg-primary/10 shadow-glow-primary/10' : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'}`}
                          >
                            <div
                              className="relative shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center"
                              style={{ background: `linear-gradient(145deg, ${color} 0%, #0a0a0a 130%)` }}
                            >
                              <CourseIcon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                              <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-background transition-all ${isSelected ? 'bg-primary text-white scale-100 opacity-100' : 'bg-white/10 text-transparent scale-75 opacity-0'}`}>
                                <Check className="w-3 h-3" strokeWidth={3} />
                              </span>
                            </div>

                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-foreground leading-snug text-sm sm:text-base break-words">{displayTitle}</h3>
                              {course.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{course.description}</p>}
                            </div>
                          </motion.button>
                        );
                      })}
                    </motion.div>
                  )}
                </div>

                {/* Mobile Sticky Footer */}
                <div className="md:hidden absolute -bottom-8 -inset-x-8 p-4 pt-8 bg-gradient-to-t from-background via-background/95 to-transparent flex gap-3 z-50">
                  <Button variant="ghost" size="lg" onClick={handleBack} className="h-14 px-4 rounded-2xl hover:bg-white/5 bg-black/50 backdrop-blur-md" disabled={loading}>
                    {t('actions.back')}
                  </Button>
                  <Button size="lg" onClick={handleFinish} disabled={loading} className="flex-1 h-14 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold shadow-glow-primary/20">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : <>{t('actions.startLearning')} <Sparkles className="w-5 h-5 ml-2" /></>}
                  </Button>
                </div>

              </motion.div>
            )}
          </AnimatePresence>
          </div>
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
