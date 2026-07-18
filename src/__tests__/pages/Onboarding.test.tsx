/**
 * Tests for Onboarding page.
 *
 * Tests the 5-step wizard. I/O boundaries include:
 * - Academic services (mocked via vi.mock)
 * - Courses services (mocked via vi.mock)
 * - Supabase profile update / upload
 * - Gamification evaluation
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const evaluateMock = vi.fn();
vi.mock('@/lib/gamification/GamificationProvider', () => ({
  useGamification: () => ({ evaluate: evaluateMock }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'test@uni.edu' }, profile: { full_name: '', avatar_url: '' } }),
}));

const getUniversitiesMock = vi.fn().mockResolvedValue([{ id: 'uni1', name: 'Test Uni', emailDomains: ['uni.edu'], hasCatalog: true }]);
const getFacultiesMock = vi.fn().mockResolvedValue([{ id: 'fac1', name: 'Science' }]);
const getDegreeProgramsMock = vi.fn().mockResolvedValue([{ id: 'prog1', name: 'CS', totalSemesters: 6 }]);
const getSuggestedCoursesMock = vi.fn().mockResolvedValue([{ id: 'cat1', title: 'Intro CS', suggestedStatus: 'planned', preChecked: true }]);
const setAcademicProfileMock = vi.fn().mockResolvedValue(undefined);
const confirmCatalogCoursesMock = vi.fn().mockResolvedValue(undefined);
const verifyMyInstitutionMock = vi.fn().mockResolvedValue(undefined);
const getMyVerificationMock = vi.fn().mockResolvedValue(null);

vi.mock('@/services/academicService', () => ({
  getUniversities: (...args: any[]) => getUniversitiesMock(...args),
  getFaculties: (...args: any[]) => getFacultiesMock(...args),
  getDegreePrograms: (...args: any[]) => getDegreeProgramsMock(...args),
  getSuggestedCourses: (...args: any[]) => getSuggestedCoursesMock(...args),
  setAcademicProfile: (...args: any[]) => setAcademicProfileMock(...args),
  confirmCatalogCourses: (...args: any[]) => confirmCatalogCoursesMock(...args),
  verifyMyInstitution: (...args: any[]) => verifyMyInstitutionMock(...args),
  getMyVerification: (...args: any[]) => getMyVerificationMock(...args),
}));

const browseCoursesMock = vi.fn().mockResolvedValue([
  { id: 'c1', title: 'Datenbanksysteme', description: 'Desc' },
  { id: 'c2', title: 'Platform Course', description: 'Other' },
]);
const enrollInCourseMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/coursesService', () => ({
  browseCourses: (...args: any[]) => browseCoursesMock(...args),
  enrollInCourse: (...args: any[]) => enrollInCourseMock(...args),
}));

const setMySocialProfileMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/social/api', () => ({
  setMySocialProfile: (...args: any[]) => setMySocialProfileMock(...args),
}));

import Onboarding from '@/pages/Onboarding';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <Onboarding />
      </BrowserRouter>
    </I18nextProvider>
  );
}

beforeEach(() => {
  supabaseMock.reset();
  vi.clearAllMocks();
});

describe('Onboarding', () => {
  it('completes the full 5-step flow for a user with catalog', async () => {
    const user = userEvent.setup();
    renderPage();

    // Welcome screen
    await waitFor(() => expect(screen.getByText(/Welcome to Learnstation/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Click to continue/i }));

    // Step 1: Name
    await waitFor(() => expect(screen.getByText(/What should we call you/i)).toBeInTheDocument());
    const nameInput = screen.getByPlaceholderText(/Enter your name/i);
    await user.type(nameInput, 'Alice');
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2: Avatar (Luna customizer — "Suit Finish" is the first control)
    await waitFor(() => expect(screen.getByText(/Suit Finish/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3: Academic setup. University auto-matches from the email domain
    // (uni.edu → Test Uni), then the single-option faculty and program cascade
    // in and auto-select — no manual dropdown interaction. Waiting for the
    // program name ("CS") in its Select trigger confirms the full cascade ran.
    await waitFor(() => expect(screen.getByText(/Tell us where you study/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Test Uni')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('CS')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4: Catalog courses confirmation
    await waitFor(() => expect(screen.getByText(/We set up your Semester/i)).toBeInTheDocument());
    expect(getSuggestedCoursesMock).toHaveBeenCalledWith('prog1', 1);
    expect(screen.getByText('Intro CS')).toBeInTheDocument();
    // Step 4 renders both a desktop and a mobile CTA (both call Next); happy-dom
    // keeps both in the DOM since it doesn't resolve the responsive CSS.
    await user.click(screen.getAllByRole('button', { name: /Next/i }).at(-1)!);

    // Step 5: Platform courses (only the ready "Datenbanksysteme" course is
    // surfaced, displayed with its English label "Database Systems").
    await waitFor(() => expect(screen.getByText(/Add extra topics/i)).toBeInTheDocument());
    expect(screen.getByText('Database Systems')).toBeInTheDocument();
    expect(screen.queryByText('Platform Course')).not.toBeInTheDocument();
    await user.click(screen.getByText('Database Systems'));
    
    // Original from mock: .eq('user_id', user.id) is used in update profile
    const originalFrom = supabaseMock.from;
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    vi.spyOn(supabaseMock, 'from').mockImplementation((table) => {
      if (table === 'profiles') return { update: updateSpy } as any;
      return originalFrom.call(supabaseMock, table);
    });

    // Finish (responsive desktop + mobile CTAs, like step 4)
    await user.click(screen.getAllByRole('button', { name: /Start Learning/i }).at(-1)!);

    await waitFor(() => {
      // objectContaining: the profile update also persists cosmetic Luna
      // customization fields (luna_suit_color/visor_tint/patch); we only assert
      // the identity fields the onboarding is responsible for.
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Alice', display_name: 'Alice', avatar_url: expect.any(String) }),
      );
      expect(setAcademicProfileMock).toHaveBeenCalledWith({ universityId: 'uni1', facultyId: 'fac1', programId: 'prog1', currentSemester: 1 });
      expect(confirmCatalogCoursesMock).toHaveBeenCalledWith([{ catalogCourseId: 'cat1', status: 'planned' }]);
      expect(enrollInCourseMock).toHaveBeenCalledWith('c1');
    });
    // Badge evaluation is deliberately NOT run here — it's deferred to the
    // Dashboard's on-mount effect so its popup doesn't obscure the reveal
    // montage (which now replaces the old "Setup Complete!" toast). See
    // handleFinish in Onboarding.tsx.
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it('skips step 4 if university has no catalog', async () => {
    // Give the no-catalog uni a matching email domain so it auto-selects on
    // step 3 (the university picker is now a searchable Popover/Command, not a
    // native <select> that selectOptions can drive).
    getUniversitiesMock.mockResolvedValueOnce([{ id: 'uni2', name: 'No Cat Uni', emailDomains: ['uni.edu'], hasCatalog: false }]);
    const user = userEvent.setup();
    renderPage();

    // Welcome screen
    await waitFor(() => expect(screen.getByText(/Welcome to Learnstation/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Click to continue/i }));

    // Skip to step 3 manually by typing in 1 and 2
    await waitFor(() => screen.getByPlaceholderText(/Enter your name/i));
    await user.type(screen.getByPlaceholderText(/Enter your name/i), 'Bob');
    await user.click(screen.getByRole('button', { name: /Next/i }));
    
    await waitFor(() => screen.getByText(/Suit Finish/i));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3 — uni2 auto-matches from the email domain; because it has no
    // catalog, the free-institution notice replaces the faculty/program cascade.
    await waitFor(() => screen.getByText(/Tell us where you study/i));
    await waitFor(() => expect(screen.getByText(/We don't have No Cat Uni's course catalog yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Should jump to Step 5 (Add extra topics), skipping step 4. Step 5 only
    // ever surfaces the ready "Datenbanksysteme" course (others are filtered out).
    await waitFor(() => expect(screen.getByText(/Add extra topics/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Database Systems')).toBeInTheDocument());
  });
});
