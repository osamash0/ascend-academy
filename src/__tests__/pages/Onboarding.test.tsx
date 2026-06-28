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

const browseCoursesMock = vi.fn().mockResolvedValue([{ id: 'c1', title: 'Platform Course', description: 'Desc' }]);
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

    // Step 1: Name
    await waitFor(() => expect(screen.getByText(/What should we call you on your journey/i)).toBeInTheDocument());
    const nameInput = screen.getByPlaceholderText(/Enter your name/i);
    await user.type(nameInput, 'Alice');
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2: Avatar
    await waitFor(() => expect(screen.getByText(/Choose Your Avatar/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3: Academic setup
    await waitFor(() => expect(screen.getByText(/Tell us where you study/i)).toBeInTheDocument());
    // Auto-selected by email domain match 'uni.edu' -> uni1
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('uni1');
    // Wait for cascading faculty to load and auto-select
    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      expect(selects[1]).toHaveValue('fac1'); // Faculty
      expect(selects[2]).toHaveValue('prog1'); // Program
    });
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4: Catalog courses confirmation
    await waitFor(() => expect(screen.getByText(/Confirm your courses/i)).toBeInTheDocument());
    expect(getSuggestedCoursesMock).toHaveBeenCalledWith('prog1', 1);
    expect(screen.getByText('Intro CS')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 5: Platform courses
    await waitFor(() => expect(screen.getByText(/Add extra topics/i)).toBeInTheDocument());
    expect(screen.getByText('Platform Course')).toBeInTheDocument();
    await user.click(screen.getByText('Platform Course'));
    
    // Original from mock: .eq('user_id', user.id) is used in update profile
    const originalFrom = supabaseMock.from;
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    vi.spyOn(supabaseMock, 'from').mockImplementation((table) => {
      if (table === 'profiles') return { update: updateSpy } as any;
      return originalFrom.call(supabaseMock, table);
    });

    // Finish
    await user.click(screen.getByRole('button', { name: /Start Learning/i }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ full_name: 'Alice', display_name: 'Alice', avatar_url: expect.any(String) });
      expect(setAcademicProfileMock).toHaveBeenCalledWith({ universityId: 'uni1', facultyId: 'fac1', programId: 'prog1', currentSemester: 1 });
      expect(confirmCatalogCoursesMock).toHaveBeenCalledWith([{ catalogCourseId: 'cat1', status: 'planned' }]);
      expect(enrollInCourseMock).toHaveBeenCalledWith('c1');
      expect(evaluateMock).toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Setup Complete!' }));
    });
  });

  it('skips step 4 if university has no catalog', async () => {
    getUniversitiesMock.mockResolvedValueOnce([{ id: 'uni2', name: 'No Cat Uni', emailDomains: [], hasCatalog: false }]);
    const user = userEvent.setup();
    renderPage();

    // Skip to step 3 manually by typing in 1 and 2
    await waitFor(() => screen.getByPlaceholderText(/Enter your name/i));
    await user.type(screen.getByPlaceholderText(/Enter your name/i), 'Bob');
    await user.click(screen.getByRole('button', { name: /Next/i }));
    
    await waitFor(() => screen.getByText(/Choose Your Avatar/i));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3
    await waitFor(() => screen.getByText(/Tell us where you study/i));
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'uni2');

    await waitFor(() => expect(screen.getByText(/We don't have No Cat Uni's course catalog yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Should jump to Step 5 (Add extra topics), skipping step 4
    await waitFor(() => expect(screen.getByText(/Add extra topics/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Platform Course')).toBeInTheDocument());
  });
});
