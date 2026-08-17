import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();
const useMyMaterialsMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/features/materials/useMyMaterials', () => ({
  useMyMaterials: () => useMyMaterialsMock(),
}));

import MyMaterialsPage from '@/features/materials/MyMaterialsPage';
import { renderWithProviders } from '@/test/renderWithProviders';

const readyMaterial = {
  run_id: 'run-ready',
  lecture_id: 'lecture-ready',
  status: 'completed' as const,
  error: null,
  filename: 'week-1.pdf',
  title: 'Week 1 notes',
  total_slides: 12,
  quiz_count: 4,
  created_at: '2026-07-20T12:00:00Z',
};

const processingMaterial = {
  ...readyMaterial,
  run_id: 'run-processing',
  lecture_id: null,
  status: 'analyzing' as const,
  filename: 'draft.pdf',
  title: 'draft.pdf',
};

const failedMaterial = {
  ...readyMaterial,
  run_id: 'run-failed',
  lecture_id: 'lecture-failed',
  status: 'failed' as const,
  error: 'The PDF is password-protected.',
  filename: 'locked.pdf',
  title: 'locked.pdf',
};

function mockMaterials(overrides: Record<string, unknown> = {}) {
  useMyMaterialsMock.mockReturnValue({
    materials: [],
    isLoading: false,
    quota: { uploads_used: 0, quota_limit: 10, remaining: 10 },
    upload: vi.fn(),
    isUploading: false,
    remove: vi.fn().mockResolvedValue({ deleted: true }),
    ...overrides,
  });
}

describe('MyMaterialsPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useMyMaterialsMock.mockReset();
  });

  it('makes the private workspace and its empty state clear', () => {
    mockMaterials();

    renderWithProviders(<MyMaterialsPage />, { initialEntries: ['/materials'] });

    expect(screen.getByRole('heading', { name: 'My Materials' })).toBeInTheDocument();
    expect(screen.getByText(/course materials stay in library/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add a PDF' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your files' })).toBeInTheDocument();
    expect(screen.getByText(/no private materials yet/i)).toBeInTheDocument();
  });

  it('opens ready material, keeps processing material non-openable, and confirms deletion', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue({ deleted: true });
    mockMaterials({ materials: [readyMaterial, processingMaterial, failedMaterial], remove });

    renderWithProviders(<MyMaterialsPage />, { initialEntries: ['/materials'] });

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(navigateMock).toHaveBeenCalledWith('/lecture/lecture-ready');
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(1);
    expect(screen.getByText('The PDF is password-protected.')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Delete material' })[0]);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete this material?');

    await user.click(within(dialog).getByRole('button', { name: 'Delete material' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('lecture-ready'));
  });

  it('hides the upload control when the monthly quota is exhausted', () => {
    mockMaterials({
      quota: { uploads_used: 10, quota_limit: 10, remaining: 0 },
    });

    renderWithProviders(<MyMaterialsPage />, { initialEntries: ['/materials'] });

    expect(screen.getByText(/used all 10 uploads/i)).toBeInTheDocument();
    expect(screen.queryByTestId('multi-file-dropzone')).not.toBeInTheDocument();
  });
});
