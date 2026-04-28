import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DashboardLayout } from "@/components/DashboardLayout";

import { lazy, Suspense } from "react";

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
const Settings = lazy(() => import("./pages/Settings"));
const Impressum = lazy(() => import("./pages/Impressum"));
const Datenschutz = lazy(() => import("./pages/Datenschutz"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Loading Component
const PageLoader = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary animate-pulse">Neural Edge Syncing...</p>
  </div>
);

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
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function DashboardRouter() {
  const { role } = useAuth();

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
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
