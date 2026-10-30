import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SpacesTopBar } from '../SpacesTopBar';
import { viewer } from '../../mocks/people';

/*
 * LS-048: closing search dropped keyboard focus on <body>, so the next Tab
 * started again from the top of the page. It goes back to the Search button,
 * the way the notifications panel hands focus back to its bell.
 */
describe('closing search hands focus back', () => {
  it('to the Search button that opened it, on Escape', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/v4/home']}>
        <SpacesTopBar active="home" viewer={viewer} />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: 'Search' });
    button.focus();
    await user.keyboard('{Enter}');
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());
  });
});
