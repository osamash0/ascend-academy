import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DashboardLayout } from "@/components/DashboardLayout";

// Pages
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import StudentDashboard from "./pages/StudentDashboard";
import LectureView from "./pages/LectureView";
import Achievements from "./pages/Achievements";
import ProfessorDashboard from "./pages/ProfessorDashboard";
import ProfessorAnalytics from "./pages/ProfessorAnalytics";
import LectureUpload from "./pages/LectureUpload";
import LectureEdit from "./pages/LectureEdit";
import NotFound from "./pages/NotFound";

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
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
      <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />

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
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
