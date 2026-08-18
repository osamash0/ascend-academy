import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
const refreshProfileMock = vi.fn().mockResolvedValue(undefined);
const saveProgressMock = vi.fn().mockResolvedValue(undefined);
const recordEventMock = vi.fn().mockResolvedValue(undefined);
const completeOnboardingMock = vi.fn().mockResolvedValue({ completed: true, path: 'material', study_goal: null, onboarding_version: 2 });
const browseCoursesMock = vi.fn().mockResolvedValue([]);
const enrollInCourseMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'student-1', email: 'student@example.edu' },
    profile: { full_name: 'Ada Lovelace' },
    refreshProfile: refreshProfileMock,
  }),
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock('@/services/onboardingService', () => ({
  saveOnboardingProgress: (...args: unknown[]) => saveProgressMock(...args),
  recordOnboardingEvent: (...args: unknown[]) => recordEventMock(...args),
  completeActivationOnboarding: (...args: unknown[]) => completeOnboardingMock(...args),
}));

vi.mock('@/services/coursesService', () => ({
  browseCourses: (...args: unknown[]) => browseCoursesMock(...args),
  enrollInCourse: (...args: unknown[]) => enrollInCourseMock(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import ActivationOnboarding from '@/pages/ActivationOnboarding';

function renderPage() {
  return render(<BrowserRouter><ActivationOnboarding /></BrowserRouter>);
}

describe('ActivationOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browseCoursesMock.mockResolvedValue([]);
    recordEventMock.mockResolvedValue(undefined);
    completeOnboardingMock.mockResolvedValue({ completed: true, path: 'material', study_goal: null, onboarding_version: 2 });
    refreshProfileMock.mockResolvedValue(undefined);
  });

  it('keeps building a course as the one prominent initial action', () => {
    renderPage();

    expect(screen.getByRole('button', { name: /build my course/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try the example course/i })).toBeInTheDocument();
    expect(screen.getByText(/what would you like to study today, ada/i)).toBeInTheDocument();
    expect(recordEventMock).toHaveBeenCalledWith('student-1', 'landing_viewed', { landing_path: '/' });
  });

  // M32: the eyebrow badge used to hardcode the retired "Ascend Academy" name
  // in English only, so it never translated to German. It should now show
  // the current product name, sourced from the i18n `onboarding` namespace.
  it('shows the current product name in the eyebrow badge, not the retired one', () => {
    renderPage();

    expect(screen.getByText('Learnstation')).toBeInTheDocument();
    expect(screen.queryByText('Ascend Academy')).not.toBeInTheDocument();
  });

  it('records the selected goal and continues to the material journey', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /build my course/i }));
    await user.click(screen.getByRole('button', { name: /prepare for an exam/i }));
    await user.click(screen.getByRole('button', { name: /continue with this goal/i }));

    expect(completeOnboardingMock).toHaveBeenCalledWith('material', 'exam');
    expect(recordEventMock).toHaveBeenCalledWith('student-1', 'study_goal_selected', { study_goal: 'exam' });
    expect(navigateMock).toHaveBeenCalledWith('/onboarding/upload', { state: { studyGoal: 'exam' } });
  });

  it('continues to upload when optional onboarding analytics fails', async () => {
    const user = userEvent.setup();
    renderPage();
    recordEventMock.mockClear();
    recordEventMock.mockRejectedValueOnce(new Error('analytics unavailable'));

    await user.click(screen.getByRole('button', { name: /build my course/i }));
    await user.click(screen.getByRole('button', { name: /continue with this goal/i }));

    expect(completeOnboardingMock).toHaveBeenCalledWith('material', 'weekly_study');
    expect(navigateMock).toHaveBeenCalledWith('/onboarding/upload', { state: { studyGoal: 'weekly_study' } });
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      title: 'We could not start your course setup',
    }));
  });

  it('enrolls in the Database Systems example and starts its guided mission', async () => {
    const user = userEvent.setup();
    browseCoursesMock.mockResolvedValue([{ id: 'database-course', title: 'Any localized title', demo_slug: 'database-systems' }]);
    renderPage();

    await user.click(screen.getByRole('button', { name: /try the example course/i }));

    expect(enrollInCourseMock).toHaveBeenCalledWith('database-course');
    expect(navigateMock).toHaveBeenCalledWith('/course-v3/database-course', { state: { demoMission: true } });
    expect(recordEventMock).toHaveBeenCalledWith('student-1', 'example_course_opened', { course_id: 'database-course' });
    expect(completeOnboardingMock).toHaveBeenCalledWith('example');
  });

  it('shows a material-first fallback when no stable demo course is seeded', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /try the example course/i }));

    expect(await screen.findByText(/example course is not available right now/i)).toBeInTheDocument();
    expect(enrollInCourseMock).not.toHaveBeenCalled();
  });
});
