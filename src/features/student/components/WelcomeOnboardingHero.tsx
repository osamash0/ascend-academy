import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Upload, PlayCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { ProfessorRoutes, StudentRoutes } from '@/lib/routes';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import { browseCourses, enrollInCourse } from '@/services/coursesService';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export function WelcomeOnboardingHero() {
  const { t } = useTranslation(['dashboard']);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { data: dashboardData, refetch } = useStudentDashboard();
  const [isEnrolling, setIsEnrolling] = useState(false);

  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  // Once a path is chosen, retire the Luna spotlight tour's auto-trigger —
  // the Hero Decision is the sole first-run experience, so the two overlays
  // should never both fire for the same student. Fire-and-forget: this is a
  // one-way persisted flag, not something the UI needs to await.
  const retireSpotlightTour = () => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .update({ has_seen_dashboard_tour: true })
      .eq('user_id', user.id)
      .then(({ error }) => {
        if (error) console.error('Failed to retire dashboard tour:', error);
      });
  };

  const handleUploadJourney = () => {
    // Path 1: Upload Journey - Route directly to the wizard
    retireSpotlightTour();
    navigate(StudentRoutes.ONBOARDING_UPLOAD);
  };

  const handleGuidedTour = async () => {
    // Path 2: Guided Tour into Database Systems
    retireSpotlightTour();
    const targetCourseTitle = 'Datenbanksysteme';
    const targetEnTitle = 'Database Systems';
    
    // Check if the user is already enrolled
    const isEnrolled = dashboardData?.courses?.some(
      (c) => c.title.toLowerCase() === targetCourseTitle.toLowerCase() || 
             c.title.toLowerCase() === targetEnTitle.toLowerCase()
    );

    if (isEnrolled) {
      navigate(StudentRoutes.LIBRARY, { state: { onboardTarget: targetEnTitle } });
      return;
    }

    setIsEnrolling(true);
    try {
      const allCourses = await browseCourses();
      const dbCourse = allCourses.find(
        (c) => c.title.toLowerCase() === targetCourseTitle.toLowerCase() || 
               c.title.toLowerCase() === targetEnTitle.toLowerCase()
      );

      if (dbCourse) {
        await enrollInCourse(dbCourse.id);
        await refetch();
        navigate(StudentRoutes.LIBRARY, { state: { onboardTarget: targetEnTitle } });
      } else {
        // Fallback if course not found in catalog, just navigate
        navigate(StudentRoutes.LIBRARY);
      }
    } catch (err) {
      console.error('Failed to enroll in Database Systems', err);
      toast({
        title: 'Error',
        description: 'Failed to start the guided tour. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto px-6 py-12 md:py-20 lg:py-24 z-10 flex flex-col items-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 mb-12 lg:mb-16"
      >
        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-bold tracking-widest uppercase">
          <Sparkles className="w-4 h-4" /> Welcome to Ascend
        </span>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-foreground leading-tight">
          Ready to learn, {firstName}?
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Choose your path to begin. You can turn your own materials into an interactive course, or jump straight into a guided example.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-6 w-full">
        {/* Path 1 */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleUploadJourney}
          className="group relative flex flex-col items-center justify-center p-8 md:p-12 rounded-3xl bg-white/5 border border-white/10 hover:border-primary/50 text-center overflow-hidden transition-all duration-500"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative z-10 flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors duration-500 shadow-glow-primary">
              <Upload className="w-10 h-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-foreground">Bring Your Own Material</h2>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mx-auto">
                Upload a PDF to let Luna create a personalized course with AI slides and quizzes.
              </p>
            </div>
          </div>
        </motion.button>

        {/* Path 2 */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleGuidedTour}
          disabled={isEnrolling}
          className="group relative flex flex-col items-center justify-center p-8 md:p-12 rounded-3xl bg-white/5 border border-white/10 hover:border-emerald-500/50 text-center overflow-hidden transition-all duration-500"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative z-10 flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors duration-500 shadow-glow-emerald">
              {isEnrolling ? (
                <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
              ) : (
                <PlayCircle className="w-10 h-10 text-emerald-400" />
              )}
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-foreground">Dive Right In</h2>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mx-auto">
                Explore our sample Database Systems course to see the interactive learning loop in action.
              </p>
            </div>
          </div>
        </motion.button>
      </div>
    </div>
  );
}
