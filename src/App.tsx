import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/ThemeProvider";

import { ConsoleLayout } from "@/components/console";
import { useLanguagePreference } from "@/hooks/useLanguagePreference";

import { lazy, Suspense, Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import { PublicRoutes, StudentRoutes, ProfessorRoutes, SharedRoutes, AdminRoutes } from "@/lib/routes";
import { SocialProvider } from "@/features/social/store";
import { GamificationProvider } from "@/lib/gamification/GamificationProvider";

function LanguagePreferenceBootstrap({ children }: { children: ReactNode }) {
  useLanguagePreference();
  return <>{children}</>;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[AppErrorBoundary] Caught render error:', error);
    console.error('[AppErrorBoundary] Component stack:', info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      // ErrorBoundary cannot use hooks; read translations from the i18n
      // singleton directly. Falls back to English if i18n not yet ready.
      const t = i18n.t.bind(i18n);
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 p-8 text-center">
          <p className="text-lg font-bold text-foreground">{t('common:errorBoundary.title')}</p>
          <p className="text-sm text-muted-foreground">{t('common:errorBoundary.description')}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold"
          >
            {t('common:errorBoundary.refresh')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lazy Pages
const Landing = lazy(() => import("./pages/Landing"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const StudentCourseView = lazy(() => import("./pages/StudentCourseView"));
const StudentCourseLibrary = lazy(() => import("./pages/StudentCourseLibrary"));
const LectureView = lazy(() => import("./pages/LectureView"));
const Ascent = lazy(() => import("./pages/Ascent"));
const ProfessorDashboard = lazy(() => import("./pages/ProfessorDashboard"));
const ProfessorAnalytics = lazy(() => import("./pages/ProfessorAnalytics"));
const AdvancedAnalytics = lazy(() => import("./pages/AdvancedAnalytics"));
const LectureUpload = lazy(() => import("./pages/LectureUpload"));
const FastUpload = lazy(() => import("./pages/FastUpload"));
const LectureEdit = lazy(() => import("./pages/LectureEdit"));
const ProfessorCourses = lazy(() => import("./pages/ProfessorCourses"));
const ProfessorCourseDetail = lazy(() => import("./pages/ProfessorCourseDetail"));
const ProfessorArchive = lazy(() => import("./pages/ProfessorArchive"));
const Settings = lazy(() => import("./pages/Settings"));
const Impressum = lazy(() => import("./pages/Impressum"));
const Datenschutz = lazy(() => import("./pages/Datenschutz"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PipelineTestPage = lazy(() => import("./pages/PipelineTestPage"));
const PixiLab = lazy(() => import("./pages/PixiLab"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const FriendsHub = lazy(() => import("./features/social/pages/FriendsHub"));
const SocialProfile = lazy(() => import("./features/social/pages/SocialProfile"));
const FriendProfile = lazy(() => import("./features/social/pages/FriendProfile"));
const FriendRequests = lazy(() => import("./features/social/pages/FriendRequests"));
const FindFriends = lazy(() => import("./features/social/pages/FindFriends"));

// Loading Component
const PageLoader = () => {
  const { t } = useTranslation(['common']);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary animate-pulse">{t('common:loader.syncing')}</p>
    </div>
  );
};

const queryClient = new QueryClient();

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    // Redirect based on role
    if (role === 'professor') {
      return <Navigate to="/professor/dashboard" replace />;
    }
    if (role === 'admin') {
      return <Navigate to="/admin/dashboard" replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function StudentDashboardRoute() {
  const { role } = useAuth();

  if (role === 'professor') {
    return <Navigate to={ProfessorRoutes.DASHBOARD} replace />;
  }

  return <StudentDashboard />;
}

function SettingsWrapper() {
  // Settings is identical for every role — render inside the console shell.
  return (
    <ConsoleLayout>
      <Settings />
    </ConsoleLayout>
  );
}

function ProtectedNotFound() {
  const { user } = useAuth();

  // Unauthenticated: bare 404. Authenticated (any role): 404 inside the shell.
  if (!user) {
    return <NotFound />;
  }

  return (
    <ConsoleLayout>
      <NotFound />
    </ConsoleLayout>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route path={PublicRoutes.LANDING} element={<PublicRoute><Landing /></PublicRoute>} />
        <Route path={PublicRoutes.AUTH} element={<PublicRoute><Auth /></PublicRoute>} />
        {/* Bare route (no PublicRoute): the recovery session is "authenticated",
            so PublicRoute would bounce it to the dashboard before reset. */}
        <Route path={PublicRoutes.RESET_PASSWORD} element={<ResetPassword />} />
        <Route path={PublicRoutes.IMPRESSUM} element={<Impressum />} />
        <Route path={PublicRoutes.DATENSCHUTZ} element={<Datenschutz />} />
        {/* Experimental PixiJS playground (dev-only, unlinked) — branch feature/building-scene */}
        <Route path="/pixi-lab" element={<PixiLab />} />

        {/* Student routes */}
        <Route
          path={StudentRoutes.HOME}
          element={
            <ProtectedRoute>
              <ConsoleLayout>
                <StudentDashboardRoute />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.ONBOARDING}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <Onboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path="/course/:courseId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <StudentCourseView />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.LIBRARY}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <StudentCourseLibrary />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        {/* PlayStation-style lecture library — a screen within the console OS shell. */}
        <Route
          path="/course-v3/:courseId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <StudentCourseLibrary />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lecture/:lectureId"
          element={
            <ProtectedRoute>
              <LectureView />
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.ASCENT}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <Ascent />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        {/* Legacy redirects */}
        <Route path={StudentRoutes.ACHIEVEMENTS} element={<Navigate to={StudentRoutes.ASCENT} replace />} />
        <Route path={StudentRoutes.INSIGHTS} element={<Navigate to={StudentRoutes.ASCENT} replace />} />
        <Route
          path={StudentRoutes.LEADERBOARD}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <Leaderboard />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={SharedRoutes.SETTINGS}
          element={
            <ProtectedRoute>
              <SettingsWrapper />
            </ProtectedRoute>
          }
        />
        {/* Professor routes */}
        <Route
          path={ProfessorRoutes.DASHBOARD}
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <ProfessorDashboard />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={ProfessorRoutes.ANALYTICS}
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <ProfessorAnalytics />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/analytics/:lectureId"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <ProfessorAnalytics />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/analytics/:lectureId/advanced"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <AdvancedAnalytics />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={ProfessorRoutes.UPLOAD}
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <LectureUpload />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={ProfessorRoutes.FAST_UPLOAD}
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <FastUpload />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={ProfessorRoutes.COURSES}
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <ProfessorCourses />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/courses/:courseId"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <ProfessorCourseDetail />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={ProfessorRoutes.ARCHIVE}
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <ProfessorArchive />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/lecture/:lectureId"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <LectureEdit />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path={ProfessorRoutes.PIPELINE_TEST}
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <ConsoleLayout>
                <PipelineTestPage />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />

        {/* Admin routes */}
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <ConsoleLayout>
                <AdminDashboard />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />

        {/* Social Gamification — friends, profiles, requests. Lives inside the
            console shell, behind student auth. Leaderboard is upgraded in-place
            (see the StudentRoutes.LEADERBOARD route above). */}
        <Route
          path={StudentRoutes.FRIENDS}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <FriendsHub />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.FRIENDS_REQUESTS}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <FriendRequests />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.FRIENDS_FIND}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <FindFriends />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.PROFILE}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <SocialProfile />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/:userId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <FriendProfile />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />

        {/* 404 */}
        <Route path="*" element={<ProtectedNotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <LanguagePreferenceBootstrap>
                <SocialProvider>
                  <GamificationProvider>
                    <AppRoutes />
                  </GamificationProvider>
                </SocialProvider>
              </LanguagePreferenceBootstrap>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
