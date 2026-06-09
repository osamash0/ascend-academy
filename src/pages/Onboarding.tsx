import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, User, Sparkles, BookOpen, Check, Loader2, Camera,
  GraduationCap, Building2, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { browseCourses, enrollInCourse, type Course } from '@/services/coursesService';
import {
  getUniversities, getFaculties, getDegreePrograms, getSuggestedCourses,
  setAcademicProfile, confirmCatalogCourses, verifyMyInstitution,
} from '@/services/academicService';
import { setMySocialProfile } from '@/features/social/api';
import type {
  University, Faculty, DegreeProgram, SuggestedCourse, StudentCatalogStatus,
} from '@/types/academic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

const PRESET_AVATARS = [
  { url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4', label: 'Robot' },
  { url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Max&backgroundColor=ffdfbf', label: 'Adventurer' },
  { url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=Joy&backgroundColor=c0aede', label: 'Joy' },
  { url: 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=ffdfbf', label: 'Micah' },
  { url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam&backgroundColor=b6e3f4', label: 'Sam' },
  { url: 'https://api.dicebear.com/7.x/personas/svg?seed=Riley&backgroundColor=ffdfbf', label: 'Riley' },
];

const TOTAL_STEPS = 5;

const STATUS_LABELS: Record<StudentCatalogStatus, string> = {
  completed: 'Completed',
  in_progress: 'Taking now',
  planned: 'Planned',
};
const STATUS_ORDER: StudentCatalogStatus[] = ['completed', 'in_progress', 'planned'];

const selectClass =
  'w-full h-14 px-4 rounded-2xl bg-white/5 border-2 border-white/10 text-foreground ' +
  'focus:border-primary/50 focus:outline-none transition-all disabled:opacity-40 ' +
  'disabled:cursor-not-allowed appearance-none';

export default function Onboarding() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || PRESET_AVATARS[0].url);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Step 4 — confirm pre-populated courses
  const [suggested, setSuggested] = useState<SuggestedCourse[]>([]);
  // courseId -> status (present = included). Absent = excluded.
  const [statusMap, setStatusMap] = useState<Record<string, StudentCatalogStatus>>({});
  const [loadingSuggested, setLoadingSuggested] = useState(false);

  const selectedUni = universities.find((u) => u.id === uniId);
  // No usable catalog if a university is chosen but has no faculties/program.
  const noCatalog = !!selectedUni && !selectedUni.hasCatalog;

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
          if (match) setUniId(match.id);
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
    if (step === 5 && (noCatalog || !progId)) {
      setStep(3);
      return;
    }
    if (step > 1) setStep(step - 1);
  };

  const toggleCourse = (id: string) =>
    setSelectedCourses((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const toggleSuggested = (id: string, fallback: StudentCatalogStatus) =>
    setStatusMap((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = fallback;
      return next;
    });

  const setSuggestedStatus = (id: string, status: StudentCatalogStatus) =>
    setStatusMap((prev) => ({ ...prev, [id]: status }));

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
        .update({ full_name: fullName.trim() || null, avatar_url: avatarUrl })
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

      toast({ title: 'Setup Complete!', description: 'Welcome to your learning journey.' });
      setTimeout(() => {
        navigate('/dashboard');
        window.location.href = '/dashboard';
      }, 800);
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

  return (
    <div className="min-h-screen console-bg flex relative overflow-hidden items-center justify-center">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[120px] animate-pulse delay-700" />
      </div>

      <div className="relative z-10 w-full max-w-2xl p-6">
        {/* Progress Dots */}
        <div className="flex items-center justify-center gap-3 mb-12">
          {Array.from({ length: TOTAL_STEPS }, (_, idx) => idx + 1).map((i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-500 ${
                i === step ? 'w-12 bg-primary' : i < step ? 'w-4 bg-primary/50' : 'w-4 bg-white/10'
              }`}
            />
          ))}
        </div>

        <div className="glass-panel rounded-[32px] border-white/10 p-8 md:p-12 shadow-2xl relative overflow-hidden min-h-[500px] flex flex-col">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col">
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
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col">
                <div className="mb-8 text-center">
                  <div className="w-24 h-24 bg-secondary/20 rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-glow-secondary overflow-hidden border-2 border-secondary/50">
                    <img src={avatarUrl} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-3">Choose Your Avatar</h1>
                  <p className="text-muted-foreground text-lg">Pick an icon that represents you, or upload your own.</p>
                </div>
                <div className="flex-1 flex flex-col items-center max-w-md mx-auto w-full">
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} disabled={isUploading} />
                  <Button variant="outline" className="w-full mb-6 h-14 rounded-2xl border-white/10 hover:bg-white/5 transition-all text-base" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                    {isUploading ? <Loader2 className="w-5 h-5 mr-2 animate-spin text-secondary" /> : <Camera className="w-5 h-5 mr-2 text-secondary" />}
                    {isUploading ? 'Uploading...' : 'Upload Custom Avatar'}
                  </Button>
                  <div className="grid grid-cols-3 gap-4 place-content-center w-full">
                    {PRESET_AVATARS.map((preset) => (
                      <button
                        key={preset.url}
                        onClick={() => setAvatarUrl(preset.url)}
                        className={`aspect-square rounded-2xl flex items-center justify-center p-3 border-2 transition-all duration-300 hover:scale-105 ${
                          avatarUrl === preset.url ? 'border-primary bg-primary/20 scale-105 shadow-glow-primary' : 'border-white/5 bg-white/5 hover:border-white/20'
                        }`}
                      >
                        <img src={preset.url} alt={preset.label} className="w-full h-full object-contain" />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-10 flex justify-between">
                  <Button variant="ghost" size="xl" onClick={handleBack} className="h-14 px-8 rounded-2xl hover:bg-white/5">Back</Button>
                  <Button size="xl" onClick={handleNext} className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold">Next <ArrowRight className="w-5 h-5 ml-2" /></Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col">
                <div className="mb-8 text-center">
                  <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow-primary">
                    <GraduationCap className="w-8 h-8 text-primary" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-3">Your studies</h1>
                  <p className="text-muted-foreground text-lg">Tell us where you study so we can set things up for you.</p>
                </div>

                <div className="flex-1 space-y-4 max-w-md mx-auto w-full">
                  <select className={selectClass} value={uniId} onChange={(e) => setUniId(e.target.value)}>
                    <option value="">Select your university…</option>
                    {universities.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}{u.city ? ` — ${u.city}` : ''}</option>
                    ))}
                  </select>

                  {noCatalog ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 p-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-muted-foreground">
                        <Building2 className="w-5 h-5 shrink-0 text-secondary mt-0.5" />
                        <span>We don't have {selectedUni?.name}'s course catalog yet. You can still tell us your institution — we'll personalize once it's available.</span>
                      </div>
                      <Input
                        value={freeInstitution || selectedUni?.name || ''}
                        onChange={(e) => setFreeInstitution(e.target.value)}
                        placeholder="Your institution"
                        className="h-14 bg-white/5 border-white/10 focus:border-primary/50 rounded-2xl"
                      />
                    </div>
                  ) : (
                    <>
                      <select className={selectClass} value={facId} onChange={(e) => setFacId(e.target.value)} disabled={!uniId || faculties.length === 0}>
                        <option value="">{uniId ? 'Select your faculty…' : 'Pick a university first'}</option>
                        {faculties.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>

                      <select className={selectClass} value={progId} onChange={(e) => setProgId(e.target.value)} disabled={!facId || programs.length === 0}>
                        <option value="">{facId ? 'Select your degree program…' : 'Pick a faculty first'}</option>
                        {programs.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>

                      <div>
                        <label className="block text-sm text-muted-foreground mb-2 ml-1">Current semester</label>
                        <select className={selectClass} value={semester} onChange={(e) => setSemester(Number(e.target.value))} disabled={!progId}>
                          {Array.from(
                            { length: programs.find((p) => p.id === progId)?.totalSemesters || 12 },
                            (_, i) => i + 1,
                          ).map((n) => (
                            <option key={n} value={n}>Semester {n}</option>
                          ))}
                        </select>
                      </div>
                    </>
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
              <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col max-h-[70vh]">
                <div className="mb-6 text-center">
                  <div className="w-16 h-16 bg-secondary/20 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow-secondary">
                    <ShieldCheck className="w-8 h-8 text-secondary" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-2">Confirm your courses</h1>
                  <p className="text-muted-foreground text-base">
                    Based on semester {semester}, here's what you've likely done and what you're taking. Adjust anything that's off.
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
                    suggested.map((c) => {
                      const included = !!statusMap[c.id];
                      const status = statusMap[c.id] ?? c.suggestedStatus;
                      return (
                        <div key={c.id} className={`p-3 rounded-2xl border-2 transition-all ${included ? 'border-primary/40 bg-primary/5' : 'border-white/5 bg-white/5'}`}>
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
                        </div>
                      );
                    })
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
              <motion.div key="step5" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col max-h-[70vh]">
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
                    courses.map((course) => {
                      const isSelected = selectedCourses.includes(course.id);
                      return (
                        <button
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
                        </button>
                      );
                    })
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
