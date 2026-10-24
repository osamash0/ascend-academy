import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { LiveAccountData } from '../LiveAccountData';
import { SessionActionsContext } from '../../data/session';

/*
 * v4 Settings, live: "Your data" does what it says — the GDPR export and the
 * server-side erasure the old Settings page already uses — instead of a toast
 * saying it is not built.
 */

const exportAccount = vi.fn();
const deleteAccount = vi.fn();
vi.mock('../../data/liveRepository', () => ({
  loadLiveRepository: async () => ({ exportAccount, deleteAccount }),
}));

const signOut = vi.fn(async () => {});

const toast = vi.fn();
vi.mock('sonner', () => ({
  toast: Object.assign((...a: unknown[]) => toast(...a), {
    error: (...a: unknown[]) => toast(...a),
  }),
}));

function mount() {
  return render(
    <SessionActionsContext.Provider value={{ signOut }}>
      <MemoryRouter initialEntries={['/v4/settings']}>
        <Routes>
          <Route path="/v4/settings" element={<LiveAccountData />} />
          <Route path="/" element={<div>landing</div>} />
        </Routes>
      </MemoryRouter>
    </SessionActionsContext.Provider>,
  );
}

beforeEach(async () => {
  exportAccount.mockReset();
  deleteAccount.mockReset();
  signOut.mockClear();
  toast.mockReset();
  await i18n.changeLanguage('en');
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('live account data', () => {
  it('export downloads the complete server-side record as JSON', async () => {
    exportAccount.mockResolvedValue({ profiles: [{ id: 'u1' }] });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(exportAccount).toHaveBeenCalled());
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith('Data exported!', expect.anything());
    click.mockRestore();
  });

  it('a failed export says so', async () => {
    exportAccount.mockRejectedValue(new Error('500'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("We couldn't export your data", expect.anything()));
  });

  it('delete asks first, and nothing happens on Cancel', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Are you sure? All data will be permanently deleted.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('a confirmed delete erases server-side, signs out and leaves', async () => {
    deleteAccount.mockResolvedValue({});
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, Delete Everything' }));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalled());
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(await screen.findByText('landing')).toBeInTheDocument();
  });

  it('a failed delete says so and keeps you signed in', async () => {
    deleteAccount.mockRejectedValue(new Error('erasure failed'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, Delete Everything' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("We couldn't delete your account", expect.anything()));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByText('landing')).not.toBeInTheDocument();
  });

  it('says what deletion really removes: everything', () => {
    mount();
    expect(screen.getByText(/Permanently delete your account and all associated data/)).toBeInTheDocument();
  });
});
