import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, User, Sparkles, BookOpen, Check, Loader2, Camera } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { browseCourses, enrollInCourse, type Course } from '@/services/coursesService';
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

export default function Onboarding() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || PRESET_AVATARS[0].url);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // If profile is already complete and no step forced, maybe we shouldn't be here,
    // but we let the user proceed if they manually navigated.
    if (profile?.full_name && profile?.avatar_url && step === 1) {
      setFullName(profile.full_name);
      setAvatarUrl(profile.avatar_url);
    }
  }, [profile, step]);

  useEffect(() => {
    async function loadCourses() {
      try {
        const data = await browseCourses();
        setCourses(data);
      } catch (err) {
        console.error("Failed to load courses", err);
      } finally {
        setLoadingCourses(false);
      }
    }
    loadCourses();
  }, []);

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const toggleCourse = (id: string) => {
    setSelectedCourses(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length || !user) return;
    
    const file = event.target.files[0];
    
    // Safety check: only allow images and max 2MB
    if (!file.type.startsWith('image/')) {
      toast({ title: "Invalid file", description: "Please upload an image.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Image must be under 2MB.", variant: "destructive" });
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      setAvatarUrl(publicUrl);
      toast({
        title: "Avatar Uploaded",
        description: "Your custom avatar is looking good!",
      });
    } catch (error: unknown) {
      toast({
        title: "Upload Error",
        description: error instanceof Error ? error.message : "Failed to upload avatar",
        variant: "destructive"
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
      // 1. Update Profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          avatar_url: avatarUrl,
        })
        .eq('user_id', user.id);

      if (profileError) throw profileError;

      // 2. Enroll in selected courses
      for (const courseId of selectedCourses) {
        try {
          await enrollInCourse(courseId);
        } catch (e) {
          console.error(`Failed to enroll in course ${courseId}`, e);
          // Continue with others even if one fails
        }
      }

      toast({
        title: "Setup Complete!",
        description: "Welcome to your learning journey.",
      });

      // Force a tiny delay for smooth animation before redirecting
      setTimeout(() => {
        navigate('/dashboard');
        // Force reload to clear React Query cache since we don't have queryClient here easily,
        // or we can just window.location.href to guarantee a fresh state.
        window.location.href = '/dashboard';
      }, 800);
      
    } catch (error: unknown) {
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Could not complete onboarding.",
        variant: "destructive"
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen console-bg flex relative overflow-hidden items-center justify-center">
      {/* Animated Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[120px] animate-pulse delay-700" />
      </div>

      <div className="relative z-10 w-full max-w-2xl p-6">
        {/* Progress Dots */}
        <div className="flex items-center justify-center gap-3 mb-12">
          {[1, 2, 3].map((i) => (
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
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col"
              >
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
                  <Button
                    size="xl"
                    onClick={handleNext}
                    disabled={!fullName.trim()}
                    className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold"
                  >
                    Next <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col"
              >
                <div className="mb-8 text-center">
                  <div className="w-24 h-24 bg-secondary/20 rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-glow-secondary overflow-hidden border-2 border-secondary/50">
                    <img src={avatarUrl} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-3">Choose Your Avatar</h1>
                  <p className="text-muted-foreground text-lg">Pick an icon that represents you, or upload your own.</p>
                </div>

                <div className="flex-1 flex flex-col items-center max-w-md mx-auto w-full">
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                  />

                  <Button
                    variant="outline"
                    className="w-full mb-6 h-14 rounded-2xl border-white/10 hover:bg-white/5 transition-all text-base"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin text-secondary" />
                    ) : (
                      <Camera className="w-5 h-5 mr-2 text-secondary" />
                    )}
                    {isUploading ? "Uploading..." : "Upload Custom Avatar"}
                  </Button>

                  <div className="grid grid-cols-3 gap-4 place-content-center w-full">
                  {PRESET_AVATARS.map((preset) => (
                    <button
                      key={preset.url}
                      onClick={() => setAvatarUrl(preset.url)}
                      className={`aspect-square rounded-2xl flex items-center justify-center p-3 border-2 transition-all duration-300 hover:scale-105 ${
                        avatarUrl === preset.url
                          ? 'border-primary bg-primary/20 scale-105 shadow-glow-primary'
                          : 'border-white/5 bg-white/5 hover:border-white/20'
                      }`}
                    >
                      <img src={preset.url} alt={preset.label} className="w-full h-full object-contain" />
                    </button>
                  ))}
                </div>
                </div>

                <div className="mt-10 flex justify-between">
                  <Button
                    variant="ghost"
                    size="xl"
                    onClick={handleBack}
                    className="h-14 px-8 rounded-2xl hover:bg-white/5"
                  >
                    Back
                  </Button>
                  <Button
                    size="xl"
                    onClick={handleNext}
                    className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold"
                  >
                    Next <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col max-h-[70vh]"
              >
                <div className="mb-6 text-center">
                  <div className="w-16 h-16 bg-xp/20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-glow-primary">
                    <BookOpen className="w-8 h-8 text-xp" />
                  </div>
                  <h1 className="text-4xl font-bold text-foreground mb-3">Select Your Courses</h1>
                  <p className="text-muted-foreground text-lg">Choose the subjects you want to explore.</p>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                  {loadingCourses ? (
                    <div className="flex items-center justify-center h-40">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    </div>
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
                          className={`w-full p-4 rounded-2xl border-2 text-left transition-all flex items-center gap-4 ${
                            isSelected
                              ? 'border-primary bg-primary/10 shadow-glow-primary/20'
                              : 'border-white/5 bg-white/5 hover:border-white/20'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                            isSelected ? 'bg-primary border-primary text-white' : 'border-white/20'
                          }`}>
                            {isSelected && <Check className="w-4 h-4" />}
                          </div>
                          <div>
                            <h3 className="font-bold text-foreground text-lg leading-tight">{course.title}</h3>
                            {course.description && (
                              <p className="text-sm text-muted-foreground line-clamp-1 mt-1">{course.description}</p>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center shrink-0">
                  <Button
                    variant="ghost"
                    size="xl"
                    onClick={handleBack}
                    className="h-14 px-8 rounded-2xl hover:bg-white/5"
                    disabled={loading}
                  >
                    Back
                  </Button>
                  <Button
                    size="xl"
                    onClick={handleFinish}
                    disabled={loading}
                    className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold min-w-[140px]"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      <>Start Learning <Sparkles className="w-5 h-5 ml-2" /></>
                    )}
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
