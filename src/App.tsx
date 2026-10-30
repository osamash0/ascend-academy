import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/ThemeProvider";

import { ConsoleLayout } from "@/components/console";
import { useLanguagePreference } from "@/hooks/useLanguagePreference";

import { lazy, Suspense, Component, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import { PublicRoutes, StudentRoutes, ProfessorRoutes, SharedRoutes, V4Routes, homeForRole, safeNextPath } from "@/lib/routes";
import { firstRunPath, needsFirstRun, postAuthDestination } from "@/lib/firstRun";
import { SocialProvider } from "@/features/social/store";
import { ConfettiCanvas } from "@/components/ConfettiCanvas";
import { GamificationProvider } from "@/lib/gamification/GamificationProvider";
import { FEATURES } from "@/lib/featureFlags";
import { GearUnlockWatcher } from "@/features/avatar/GearUnlockWatcher";
import { ViewerLoadoutBridge } from "@/features/avatar/ViewerLoadoutBridge";
import { MotionRoot } from "@/features/spaces/components/MotionRoot";
import { SessionActionsContext } from "@/features/spaces/data/session";
import { CanvasRedirect as LibraryCanvasRedirect, To as LibraryTo } from "@/features/spaces/studio/LibraryRedirects";

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
// Two-part first run: the cinematic sets up identity (name, Luna, university,
// courses), then the activation screen picks the first study path.
const FirstRun = lazy(() => import("./pages/FirstRun"));
const ActivationOnboarding = lazy(() => import("./pages/ActivationOnboarding"));
const StudentUploadWizard = lazy(() => import("./features/student/components/StudentUploadWizard"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const StudentCourseView = lazy(() => import("./pages/StudentCourseView"));
const StudentCourseLibrary = lazy(() => import("./pages/StudentCourseLibrary"));
const ReviewSession = lazy(() => import("./features/review/ReviewSession"));
const MyMaterialsPage = lazy(() => import("./features/materials/MyMaterialsPage"));
const MockExamTake = lazy(() => import("./pages/MockExam").then(m => ({ default: m.MockExamTake })));
const MockExamConfig = lazy(() => import("./pages/MockExam").then(m => ({ default: m.MockExamConfig })));
const MockExamReport = lazy(() => import("./pages/MockExamReport").then(m => ({ default: m.MockExamReport })));
const StudyGuide = lazy(() => import("./pages/StudyGuide"));
const LectureView = lazy(() => import("./pages/LectureView"));
const Ascent = lazy(() => import("./pages/Ascent"));
const ProfessorDashboard = lazy(() => import("./pages/ProfessorDashboard"));
const ProfessorAnalytics = lazy(() => import("./pages/ProfessorAnalytics"));
const AdvancedAnalytics = lazy(() => import("./pages/AdvancedAnalytics"));
const LectureUpload = lazy(() => import("./pages/LectureUpload"));
const BatchReviewPage = lazy(() => import("./pages/BatchReviewPage"));
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
const AvatarLab = lazy(() => import("./pages/AvatarLab"));
const AvatarStudio = lazy(() => import("./pages/AvatarStudio"));
const AskLunaLab = lazy(() => import("./pages/AskLunaLab"));
const LandingLab = lazy(() => import("./pages/LandingLab"));
const AskLunaPage = lazy(() => import("./pages/AskLunaPage"));
// v4 design rebuild. Mock data only, no backend, dev-only route — the old
// product is untouched and the two coexist. See docs/design-v4/.
const SpacesScreen = lazy(() => import("./features/spaces/screens/SpacesScreen"));
const V4SpacesHub = lazy(() => import("./features/spaces/screens/SpacesHubScreen"));
const SpaceRoute = lazy(() => import("./features/spaces/screens/SpaceRoute"));
const SpaceMemberGate = lazy(() => import("./features/spaces/screens/SpaceMemberGate"));
const V4Library = lazy(() => import("./features/spaces/screens/LibraryScreen"));
const V4Home = lazy(() => import("./features/spaces/screens/HomeScreen"));
const V4Lesson = lazy(() => import("./features/spaces/screens/LessonScreen"));
const V4Concept = lazy(() => import("./features/spaces/screens/ConceptScreen"));
const V4LessonLink = lazy(() => import("./features/spaces/screens/LessonLinkRoute"));
const V4NotFound = lazy(() => import("./features/spaces/screens/NotFoundScreen"));
const V4SpaceManage = lazy(() => import("./features/spaces/screens/SpaceManageScreen"));
const V4StudioCanvas = lazy(() => import("./features/spaces/screens/StudioCanvasScreen"));
const V4Social = lazy(() => import("./features/spaces/screens/SocialScreen"));
const V4Profile = lazy(() => import("./features/spaces/screens/ProfileScreen"));
const V4Rank = lazy(() => import("@/features/spaces/screens/RankScreen"));
const V4History = lazy(() => import("@/features/spaces/screens/HistoryScreen"));
const V4Moments = lazy(() => import("@/features/spaces/screens/MomentsScreen"));
const V4Practice = lazy(() => import("./features/spaces/screens/PracticeScreen"));
const V4Settings = lazy(() => import("./features/spaces/screens/SettingsScreen"));
const V4Person = lazy(() => import("./features/spaces/screens/PersonScreen"));
const V4Reader = lazy(() => import("./features/spaces/screens/ReaderScreen"));
const V4LessonFaces = lazy(() => import("./features/spaces/screens/LessonFacesScreen"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const LaunchControl = lazy(() => import("./pages/LaunchControl"));
const FriendsHub = lazy(() => import("./features/social/pages/FriendsHub"));
const SocialProfile = lazy(() => import("./features/social/pages/SocialProfile"));
const FriendProfile = lazy(() => import("./features/social/pages/FriendProfile"));
const FriendRequests = lazy(() => import("./features/social/pages/FriendRequests"));
const FindFriends = lazy(() => import("./features/social/pages/FindFriends"));

// Loading Component
const PageLoader = () => {
  const { t } = useTranslation(['common']);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black gap-4">
      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary animate-pulse">{t('common:loader.loading')}</p>
    </div>
  );
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Avoid refetch storms on tab focus/remount; feature hooks can override
      // with a shorter/longer staleTime where they need fresher data.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/*
 * Where v4 exists.
 *
 * Dev: always, on fixtures by default and public, so the design can be
 * reviewed without a session. Production: only when VITE_FEATURE_V4 is set
 * AND the data mode is live — a production build must never serve the
 * fixture world to real users — and then always behind sign-in.
 */
const V4_LIVE = import.meta.env.VITE_V4_DATA_MODE === 'live';
const V4_ENABLED =
  import.meta.env.DEV || (['1', 'true'].includes(import.meta.env.VITE_FEATURE_V4 ?? '') && V4_LIVE);
/**
 * v4 is the product a signed-in student lands in: first run ends in v4 Home,
 * and sign-in goes there. Only with live data — the dev fixture world is a
 * design review, never somewhere to send a real account.
 */
const V4_FIRST = V4_ENABLED && V4_LIVE;

/**
 * Where a signed-in person's app begins. With v4 the product, a student's is
 * v4 Home: the classic student app is retired for them (LS-050), so no
 * redirect may land them in it. Everyone else keeps their console home.
 */
const appHome = (role: string | null | undefined): string =>
  V4_FIRST && role === 'student' ? V4Routes.HOME : homeForRole(role);

/**
 * A classic student room, retired for v4 students (LS-050): it sends them to
 * the v4 room that replaced it, so old links, bookmarks and redirects never
 * open a second app with its own settings, tour and progress numbers.
 * Professors and admins, and everyone when v4 is off, get the page itself.
 * My Materials goes to the v4 Library, which brings files in. Classic tools
 * with no v4 room yet (review, exams, study guide) are not wrapped and stay
 * reachable by URL, while their backend is on (ClassicTool, LS-032).
 */
export function StudentV4Redirect({
  to,
  children,
}: {
  to: string | ((params: Readonly<Record<string, string | undefined>>) => string);
  children: React.ReactNode;
}) {
  const { role } = useAuth();
  const params = useParams();
  const { search } = useLocation();
  if (V4_FIRST && role === 'student') {
    const target = typeof to === 'string' ? to : to(params);
    return <Navigate to={`${target}${search}`} replace />;
  }
  return <>{children}</>;
}

/**
 * Signed in, but the role lookup settled without a role (a timeout, or more
 * than one user_roles row). No page can be chosen honestly, and student
 * onboarding would refuse the account and send it straight back here — the
 * redirect loop this replaces. Say what happened and offer the two ways out.
 */
function AccountUnavailable() {
  const { t } = useTranslation('common');
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-bold text-foreground">{t('accountUnavailable.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('accountUnavailable.body')}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {t('accountUnavailable.retry')}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground"
          >
            {t('accountUnavailable.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    // Remember where they were going: a shared course or exam link should
    // still be where they land once they have signed in.
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  // R7 fix: fail closed. `loading` (sessionLoading || roleLoading) is false
  // here, meaning the role lookup has already SETTLED — success, failure, or
  // timeout (see src/lib/auth.tsx fetchRole / roleLoading). So a falsy role
  // at this point is not "still loading", it is "resolved to unknown/failed".
  // Treat that the same as an explicitly wrong role: deny access with the
  // same redirect used for any other unauthorized role, rather than skipping
  // the check and letting the route render for an unknown role.
  if (allowedRoles && !allowedRoles.includes(role ?? '')) {
    return <Navigate to={appHome(role)} replace />;
  }

  return <>{children}</>;
}

export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, role, profile, loading } = useAuth();
  const [params] = useSearchParams();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) {
    // First run for a new student; then where sign-in interrupted them, if it
    // is a path inside the app; then v4 Home or their role's own home.
    return (
      <Navigate
        to={postAuthDestination({ role, profile, v4First: V4_FIRST, next: safeNextPath(params.get("next")) })}
        replace
      />
    );
  }

  return <>{children}</>;
}

/**
 * A student who has not been through first run is sent there before anything
 * else. Nobody else ever is: `/onboarding` is student-only, and sending an
 * admin or an unknown role there looped them back here forever.
 *
 * A deep link they opened rides along and first run ends on it (LS-047) —
 * except Home's own address, which is no destination to come back to.
 */
export function FirstRunGate({ children }: { children: React.ReactNode }) {
  const { role, profile } = useAuth();
  const location = useLocation();
  if (needsFirstRun(role, profile)) {
    const home = location.pathname === StudentRoutes.HOME || location.pathname === V4Routes.HOME;
    const next = home ? null : safeNextPath(location.pathname + location.search);
    return <Navigate to={firstRunPath(next)} replace />;
  }
  return <>{children}</>;
}

export function OnboardingRoute() {
  const { role, profile } = useAuth();
  const [params] = useSearchParams();

  // Answered on arrival, not on every render: first run refreshes the profile
  // (now complete) just before it navigates to where it hands over, and a live
  // check would yank the page away before that navigation happens.
  const alreadyDone = useRef(Boolean(profile?.has_completed_activation_onboarding));

  if (alreadyDone.current) {
    return (
      <Navigate
        to={postAuthDestination({ role, profile, v4First: V4_FIRST, next: safeNextPath(params.get("next")) })}
        replace
      />
    );
  }

  return <FirstRun v4First={V4_FIRST} />;
}

export function StudentDashboardRoute() {
  const { role } = useAuth();

  if (!role) return <AccountUnavailable />;

  if (role !== 'student') {
    return <Navigate to={appHome(role)} replace />;
  }
  // With v4 the product, a student's home is v4 Home (LS-050); its own gate
  // still sends them through first run first.
  if (V4_FIRST) return <Navigate to={V4Routes.HOME} replace />;

  return (
    <FirstRunGate>
      <StudentDashboard />
    </FirstRunGate>
  );
}

function SettingsWrapper() {
  // Settings is identical for every role — render inside the console shell.
  return (
    <ConsoleLayout>
      <Settings />
    </ConsoleLayout>
  );
}

/**
 * A classic study tool, open only while its backend is on (LS-032).
 *
 * The backend mounts each tool's routes behind a FEATURE_* flag and the prod
 * build copies it into the matching VITE_FEATURE_* flag. Without this gate the
 * page opened with its backend off and every request behind it was a 404, so
 * the address now answers as an unknown one does.
 */
export function ClassicTool({
  feature,
  children,
}: {
  feature: 'reviewEngine' | 'examMode' | 'studyGuide' | 'studentUploads';
  children: React.ReactNode;
}) {
  if (!FEATURES[feature]) return <ProtectedNotFound />;
  return <>{children}</>;
}

export function ProtectedNotFound() {
  const { user, role } = useAuth();

  // Unauthenticated: bare 404. Authenticated (any role): 404 inside the shell.
  if (!user) {
    return <NotFound />;
  }

  // A v4 student's 404 is on the v4 stage, whose menu leads back into v4 —
  // not the console's, which led into the retired classic app (LS-050).
  if (V4_FIRST && role === 'student') {
    return <Navigate to="/v4/not-found" replace />;
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
        {/* Experimental PixiJS playground — dev-only; never reachable in a production build. */}
        {import.meta.env.DEV && <Route path="/pixi-lab" element={<PixiLab />} />}
        {import.meta.env.DEV && <Route path="/avatar-lab" element={<AvatarLab />} />}
        {import.meta.env.DEV && <Route path="/ask-luna-lab" element={<AskLunaLab />} />}
        {import.meta.env.DEV && <Route path="/landing-lab" element={<LandingLab />} />}
        {/* v4. In dev on fixtures it is public, so the design can be reviewed
            without a session (append ?mock=empty|loading|error for the other
            states). Live — and therefore in production — it is signed-in only.
            See V4_ENABLED above. */}
        {/*
          One layout route for the whole v4 namespace, carrying the single
          MotionConfig. `Scene` and `StudioShell` each mounted their own, which
          is two places to change a default and two chances to disagree.

          The DEV guard moves here too. It was repeated on all twenty-one
          routes, and one of them forgetting it would have shipped a design
          study into production with nothing failing.
        */}
        {V4_ENABLED && (
          <Route
            element={
              V4_LIVE ? (
                <ProtectedRoute>
                  {/* A deep link into v4 must not skip first run. */}
                  <FirstRunGate>
                    <MotionRoot />
                  </FirstRunGate>
                </ProtectedRoute>
              ) : (
                <MotionRoot />
              )
            }
          >
            {/* The hub. Replaces the Mine/Discover tabs, which the handoff
                deletes — membership is a badge, never a section split. */}
            <Route path="/v4/spaces" element={<V4SpacesHub />} />
            {/* The tabbed screen, parked so the two can be compared. */}
            <Route path="/v4/spaces-legacy" element={<SpacesScreen />} />
            <Route path="/v4/space/:spaceId" element={<SpaceRoute />} />
            {/* Studio screen — declared before :tab so it is not swallowed as one. */}
            <Route path="/v4/space/:spaceId/manage" element={<V4SpaceManage />} />
            {/* Tabs are URL segments so every one is shareable and deep-linkable. */}
            <Route path="/v4/space/:spaceId/:tab" element={<SpaceRoute />} />
            <Route path="/v4/library" element={<V4Library />} />
            {/* Your page: the canvas, opened from a cover (One Library spec §4). */}
            <Route path="/v4/library/m/:materialId" element={<V4StudioCanvas />} />
            {/* The old Studio and list-view paths still land somewhere real. */}
            <Route path="/v4/library/studio" element={<LibraryTo to="/v4/library" />} />
            <Route path="/v4/library/studio/c/:canvasId" element={<LibraryCanvasRedirect />} />
            <Route path="/v4/library/uploads" element={<LibraryTo to="/v4/library?f=reading" />} />
            <Route path="/v4/library/drafts" element={<LibraryTo to="/v4/library?f=shared" />} />
            <Route path="/v4/library/impact" element={<LibraryTo to="/v4/library?f=shared" />} />
            <Route path="/v4/home" element={<V4Home />} />
            <Route path="/v4/social" element={<V4Social />} />
            <Route path="/v4/profile" element={<V4Profile />} />
            {/* Why your rank is what it is — the XP ledger and the gate. */}
            <Route path="/v4/profile/rank" element={<V4Rank />} />
            {/* Which days you studied. A record, not a streak system. */}
            <Route path="/v4/profile/history" element={<V4History />} />
            {/* The firsts. Replaced a badge wall — see mocks/moments.ts. */}
            <Route path="/v4/profile/moments" element={<V4Moments />} />
            {/* Settings hangs off Profile — a Studio screen, like Library's three. */}
            <Route path="/v4/settings" element={<V4Settings />} />
            {/* Someone else's public profile — a Social destination, per Doc 2. */}
            <Route path="/v4/person/:personId" element={<V4Person />} />
            {/* Practice before the bare lesson route, so it is not read as a tab. */}
            <Route path="/v4/space/:spaceId/lesson/:lessonId/practice" element={<SpaceMemberGate><V4Practice /></SpaceMemberGate>} />
            {/* The reader — a focus surface, like practice. */}
            <Route path="/v4/space/:spaceId/lesson/:lessonId/read" element={<SpaceMemberGate><V4Reader /></SpaceMemberGate>} />
            {/* The same Lesson with two faces — beside the reader so the two can be compared. */}
            <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<SpaceMemberGate><V4LessonFaces /></SpaceMemberGate>} />
            <Route path="/v4/space/:spaceId/lesson/:lessonId" element={<SpaceMemberGate><V4Lesson /></SpaceMemberGate>} />
            <Route path="/v4/space/:spaceId/concept/:conceptId" element={<SpaceMemberGate><V4Concept /></SpaceMemberGate>} />
            {/* A Lesson by id alone — where old /lecture/:id links land (LS-050). */}
            <Route path="/v4/lesson/:lessonId" element={<V4LessonLink />} />
            {/* Any other v4 address: the 404 on the stage, not in the old console. */}
            <Route path="/v4" element={<Navigate to="/v4/home" replace />} />
            <Route path="/v4/*" element={<V4NotFound />} />
          </Route>
        )}

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
              <OnboardingRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.ONBOARDING_START}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ActivationOnboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.ONBOARDING_UPLOAD}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ConsoleLayout>
                <StudentUploadWizard />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/course/:courseId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to={(p) => `/v4/space/${p.courseId}`}>
                <ConsoleLayout>
                  <StudentCourseView />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.REVIEW}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ClassicTool feature="reviewEngine">
                <ConsoleLayout>
                  <ReviewSession />
                </ConsoleLayout>
              </ClassicTool>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.MY_MATERIALS}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to="/v4/library">
                <ClassicTool feature="studentUploads">
                  <ConsoleLayout>
                    <MyMaterialsPage />
                  </ConsoleLayout>
                </ClassicTool>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path="/exam/report/:examId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ClassicTool feature="examMode">
                <ConsoleLayout>
                  <MockExamReport />
                </ConsoleLayout>
              </ClassicTool>
            </ProtectedRoute>
          }
        />
        <Route
          path="/exam/take/:examId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ClassicTool feature="examMode">
                <ConsoleLayout>
                  <MockExamTake />
                </ConsoleLayout>
              </ClassicTool>
            </ProtectedRoute>
          }
        />
        <Route
          path="/exam/:courseId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <ClassicTool feature="examMode">
                <ConsoleLayout>
                  <MockExamConfig />
                </ConsoleLayout>
              </ClassicTool>
            </ProtectedRoute>
          }
        />
        <Route
          path="/course/:courseId/study-guide"
          element={
            <ProtectedRoute allowedRoles={['student', 'professor']}>
              <ClassicTool feature="studyGuide">
                <ConsoleLayout>
                  <StudyGuide />
                </ConsoleLayout>
              </ClassicTool>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.LIBRARY}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to="/v4/library">
                <ConsoleLayout>
                  <StudentCourseLibrary />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        {/* PlayStation-style lecture library — a screen within the console OS shell. */}
        <Route
          path="/course-v3/:courseId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to={(p) => `/v4/space/${p.courseId}`}>
                <ConsoleLayout>
                  <StudentCourseLibrary />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lecture/:lectureId"
          element={
            <ProtectedRoute>
              <StudentV4Redirect to={(p) => `/v4/lesson/${p.lectureId}`}>
                <LectureView />
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.ASCENT}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to="/v4/profile/rank">
                <ConsoleLayout>
                  <Ascent />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.AVATAR}
          element={
            // Every signed-in role has a face; Settings links here for professors too.
            <ProtectedRoute>
              <ConsoleLayout>
                <AvatarStudio />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        {FEATURES.askLuna && (
          <Route
            path={StudentRoutes.ASK_LUNA}
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <ConsoleLayout>
                  <AskLunaPage />
                </ConsoleLayout>
              </ProtectedRoute>
            }
          />
        )}
        {/* Legacy redirects */}
        <Route path={StudentRoutes.ACHIEVEMENTS} element={<Navigate to={StudentRoutes.ASCENT} replace />} />
        <Route path={StudentRoutes.INSIGHTS} element={<Navigate to={StudentRoutes.ASCENT} replace />} />
        <Route
          path={StudentRoutes.LEADERBOARD}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to="/v4/social">
                <ConsoleLayout>
                  <Leaderboard />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path={SharedRoutes.SETTINGS}
          element={
            <ProtectedRoute>
              <StudentV4Redirect to="/v4/settings">
                <SettingsWrapper />
              </StudentV4Redirect>
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
            <ProtectedRoute allowedRoles={['professor', 'student']}>
              <ConsoleLayout>
                <LectureUpload />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/upload/batch/:batchId/review"
          element={
            <ProtectedRoute allowedRoles={['professor', 'student']}>
              <ConsoleLayout>
                <BatchReviewPage />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        {/* Fast Upload was retired — redirect old links to the main upload page. */}
        <Route path={ProfessorRoutes.FAST_UPLOAD} element={<Navigate to={ProfessorRoutes.UPLOAD} replace />} />
        <Route
          path={ProfessorRoutes.COURSES}
          element={
            <ProtectedRoute allowedRoles={['professor', 'student']}>
              <ConsoleLayout>
                <ProfessorCourses />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/professor/courses/:courseId"
          element={
            <ProtectedRoute allowedRoles={['professor', 'student']}>
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
            <ProtectedRoute allowedRoles={['professor', 'student']}>
              <ConsoleLayout>
                <LectureUpload />
              </ConsoleLayout>
            </ProtectedRoute>
          }
        />

        {/* Internal pipeline test lab — dev-only; excluded from production builds. */}
        {import.meta.env.DEV && (
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
        )}

        {/* Admin routes */}
        <Route
          path="/admin/launch"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <LaunchControl />
            </ProtectedRoute>
          }
        />
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
              <StudentV4Redirect to="/v4/social">
                <ConsoleLayout>
                  <FriendsHub />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.FRIENDS_REQUESTS}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to="/v4/social">
                <ConsoleLayout>
                  <FriendRequests />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.FRIENDS_FIND}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to="/v4/social">
                <ConsoleLayout>
                  <FindFriends />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path={StudentRoutes.PROFILE}
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to="/v4/profile">
                <ConsoleLayout>
                  <SocialProfile />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile/:userId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentV4Redirect to={(p) => `/v4/person/${p.userId}`}>
                <ConsoleLayout>
                  <FriendProfile />
                </ConsoleLayout>
              </StudentV4Redirect>
            </ProtectedRoute>
          }
        />

        {/* 404 */}
        <Route path="*" element={<ProtectedNotFound />} />
      </Routes>
    </Suspense>
  );
}

/**
 * Gives the sealed v4 namespace the one session action it needs (signing out)
 * without letting it import auth. Only while someone is signed in: no session,
 * nothing to end, and v4 says so.
 */
function SessionActionsBridge({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const value = useMemo(() => (user ? { signOut } : null), [user, signOut]);
  return <SessionActionsContext.Provider value={value}>{children}</SessionActionsContext.Provider>;
}

const App = () => {

  return (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <LanguagePreferenceBootstrap>
                <SocialProvider>
                  <ConfettiCanvas />
                  <GamificationProvider>
                    {/* Lives beside the provider (needs the router; the provider doesn't). */}
                    <GearUnlockWatcher />
                    <ViewerLoadoutBridge>
                      <SessionActionsBridge>
                        <AppRoutes />
                      </SessionActionsBridge>
                    </ViewerLoadoutBridge>
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
};

export default App;
