import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../MyIdCard', () => ({ MyIdCard: () => <div data-testid="my-id-card" /> }));

import { IdCardDialog } from '../IdCardDialog';

describe('IdCardDialog', () => {
  it('opens from its trigger and links to the Suit Locker', async () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route
            path="/profile"
            element={
              <IdCardDialog>
                <button type="button">open id</button>
              </IdCardDialog>
            }
          />
          <Route path="/avatar" element={<p>suit locker</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('my-id-card')).toBeNull();
    fireEvent.click(screen.getByText('open id'));
    expect(await screen.findByTestId('my-id-card')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /suit locker|anzugspind/i }));
    expect(await screen.findByText('suit locker')).toBeTruthy();
  });
});
