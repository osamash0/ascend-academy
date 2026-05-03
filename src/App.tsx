import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ProtectedRoute, PublicRoute } from "@/lib/routeGuards";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useLanguagePreference } from "@/hooks/useLanguagePreference";

import { lazy, Suspense, Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

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
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const LectureView = lazy(() => import("./pages/LectureView"));
const Achievements = lazy(() => import("./pages/Achievements"));
const ProfessorDashboard = lazy(() => import("./pages/ProfessorDashboard"));
const ProfessorAnalytics = lazy(() => import("./pages/ProfessorAnalytics"));
const LectureUpload = lazy(() => import("./pages/LectureUpload"));
const LectureEdit = lazy(() => import("./pages/LectureEdit"));
const ProfessorCourses = lazy(() => import("./pages/ProfessorCourses"));
const ProfessorCourseDetail = lazy(() => import("./pages/ProfessorCourseDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const Impressum = lazy(() => import("./pages/Impressum"));
const Datenschutz = lazy(() => import("./pages/Datenschutz"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Insights = lazy(() => import("./pages/Insights"));
const NotFound = lazy(() => import("./pages/NotFound"));

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

function DashboardRouter() {
  const { role, loading } = useAuth();

  // Defensive: even though ProtectedRoute also checks `loading`, repeat the
  // guard here so we never render the student dashboard while the role is
  // still being resolved (which caused the post-login flash for professors).
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (role === 'professor') {
    return <Navigate to="/professor/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      <StudentDashboard />
    </DashboardLayout>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
        <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
        <Route path="/impressum" element={<Impressum />} />
        <Route path="/datenschutz" element={<Datenschutz />} />

        {/* Student routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardRouter />
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
          path="/achievements"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <DashboardLayout>
                <Achievements />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/leaderboard"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <DashboardLayout>
                <Leaderboard />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Settings />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/insights"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <DashboardLayout>
                <Insights />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Professor routes */}
        <Route
          path="/professor/dashboard"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <DashboardLayout>
                <ProfessorDashboard />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/analytics"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <DashboardLayout>
                <ProfessorAnalytics />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/analytics/:lectureId"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <DashboardLayout>
                <ProfessorAnalytics />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/upload"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <DashboardLayout>
                <LectureUpload />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/courses"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <DashboardLayout>
                <ProfessorCourses />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/courses/:courseId"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <DashboardLayout>
                <ProfessorCourseDetail />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/lecture/:lectureId"
          element={
            <ProtectedRoute allowedRoles={['professor']}>
              <DashboardLayout>
                <LectureEdit />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
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
                <AppRoutes />
              </LanguagePreferenceBootstrap>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
