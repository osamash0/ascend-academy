/**
 * LS-032: a classic study tool opens only when its backend is on.
 *
 * The backend mounts /review, /exams, /materials and the study guide behind
 * FEATURE_* flags, and the prod build copies each into a VITE_FEATURE_* flag.
 * The pages ignored their flag, so with the backend off a learner opened a
 * tool whose every request was a 404. Off, the address is a 404 page; on, the
 * tool. My Materials is retired for v4 students: the v4 Library brings files in.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Suspense, type ReactNode } from 'react';

const useAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});
vi.mock('@/pages/NotFound', () => ({ default: () => <div>console-404</div> }));
vi.mock('@/components/console', () => ({
  ConsoleLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function persona(role: string) {
  useAuthMock.mockReturnValue({
    user: { id: 'u1', email: 'a@b.c' },
    session: {},
    profile: { has_completed_activation_onboarding: true, full_name: 'Alice' },
    role,
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

async function mountAt(path: string) {
  const { ClassicTool, StudentV4Redirect } = await import('@/App');
  const tool = (label: string) => <div>{label}</div>;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/review" element={<ClassicTool feature="reviewEngine">{tool('review-tool')}</ClassicTool>} />
          <Route path="/exam/:courseId" element={<ClassicTool feature="examMode">{tool('exam-tool')}</ClassicTool>} />
          <Route
            path="/course/:courseId/study-guide"
            element={<ClassicTool feature="studyGuide">{tool('study-guide-tool')}</ClassicTool>}
          />
          <Route
            path="/materials"
            element={
              <StudentV4Redirect to="/v4/library">
                <ClassicTool feature="studentUploads">{tool('materials-tool')}</ClassicTool>
              </StudentV4Redirect>
            }
          />
          <Route path="/v4/library" element={<div>v4-library</div>} />
          <Route path="/v4/not-found" element={<div>v4-404</div>} />
        </Routes>
      </Suspense>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

describe('LS-032: a classic tool with its backend off is a 404, not a broken page', () => {
  it.each([
    ['/review', 'review-tool'],
    ['/exam/c1', 'exam-tool'],
    ['/course/c1/study-guide', 'study-guide-tool'],
    ['/materials', 'materials-tool'],
  ])('%s with its flag off shows the 404', async (path, label) => {
    persona('student');
    await mountAt(path);
    expect(await screen.findByText('console-404')).toBeInTheDocument();
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  });

  it.each([
    ['/review', 'VITE_FEATURE_REVIEW_ENGINE', 'review-tool'],
    ['/exam/c1', 'VITE_FEATURE_EXAM_MODE', 'exam-tool'],
    ['/course/c1/study-guide', 'VITE_FEATURE_STUDY_GUIDE', 'study-guide-tool'],
    ['/materials', 'VITE_FEATURE_STUDENT_UPLOADS', 'materials-tool'],
  ])('%s with %s on opens the tool', async (path, flag, label) => {
    vi.stubEnv(flag, '1');
    persona('student');
    await mountAt(path);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('a professor with the study guide off gets the 404 too', async () => {
    persona('professor');
    await mountAt('/course/c1/study-guide');
    expect(await screen.findByText('console-404')).toBeInTheDocument();
  });

  it('with v4 live, a student whose tool is off gets the v4 404', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    vi.stubEnv('VITE_FEATURE_V4', '1');
    persona('student');
    await mountAt('/review');
    expect(await screen.findByText('v4-404')).toBeInTheDocument();
  });
});

describe('My Materials is retired for v4 students', () => {
  it('with v4 live, /materials opens the v4 Library even with uploads on', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    vi.stubEnv('VITE_FEATURE_V4', '1');
    vi.stubEnv('VITE_FEATURE_STUDENT_UPLOADS', '1');
    persona('student');
    await mountAt('/materials');
    expect(await screen.findByText('v4-library')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/v4/library');
  });
});
