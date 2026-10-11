import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LibraryScreen from '../../screens/LibraryScreen';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import * as shelf from '../../mocks/shelf';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

/** One Library §5.6: the outcome is said before you press it. */

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );

const share = (id: string) => shelf.getItems().find((i) => i.id === id)!.share;
const open = async (name: string | RegExp = 'Share') => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name }, { timeout: 3000 }));
  return user;
};

let into: typeof Element.prototype.scrollIntoView;
beforeEach(() => {
  shelf.__reset();
  resetNotes();
  resetReanchors();
  into = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  shelf.__reset();
  localStorage.clear();
  Element.prototype.scrollIntoView = into;
});

describe('the Share sheet', () => {
  it('member in a guided Space: says Contribution before, ends shared with contribution', async () => {
    at('/v4/library/m/m-design-notes');
    const trigger = await screen.findByRole('button', { name: 'Share' }, { timeout: 3000 });
    const user = userEvent.setup();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Share Design process — my notes.pdf' });
    const confirm = within(dialog).getByRole('button', { name: 'Share' });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('radiogroup')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Database Systems · Guided · you’re a member' }));
    expect(dialog.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'It arrives as your Contribution, with your name on it. The owner can endorse it into the path.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Share to Database Systems' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(share('m-design-notes')).toMatchObject({ kind: 'shared', spaceId: 's-dbs', as: 'contribution' });
    expect(screen.getByRole('button', { name: 'Shared' })).toBeInTheDocument();
  });

  it('owner in an open Space: a draft Lesson first, then Publish; and it can be taken back', async () => {
    at('/v4/library/m/m-design-notes');
    const user = await open();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Intro to Linear Algebra · Open · you own it' }));
    expect(dialog.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'It becomes a draft Lesson in Intro to Linear Algebra. Only you and editors see it until you publish.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Share to Intro to Linear Algebra' }));
    await waitFor(() => expect(share('m-design-notes').kind).toBe('draft'));

    await user.click(await screen.findByRole('button', { name: 'Draft in Intro to Linear Algebra' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Publish to Intro to Linear Algebra' }));
    expect(share('m-design-notes').kind).toBe('shared');

    await user.click(await screen.findByRole('button', { name: 'Shared' }));
    expect(await screen.findByRole('menuitem', { name: 'Open in Intro to Linear Algebra' })).toHaveAttribute(
      'href',
      '/v4/space/s-linalg',
    );
    await user.click(screen.getByRole('menuitem', { name: 'Take back to only you' }));
    await user.click(await screen.findByRole('button', { name: 'Take it back' }));
    expect(share('m-design-notes')).toEqual({ kind: 'private' });
    expect(await screen.findByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('focus moves into the dialog and returns to the trigger on close', async () => {
    at('/v4/library/m/m-design-notes');
    const trigger = await screen.findByRole('button', { name: 'Share' }, { timeout: 3000 });
    const user = userEvent.setup();
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('is reachable from a cover’s menu on the shelf', async () => {
    at('/v4/library');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'More for Design process — my notes.pdf' }, { timeout: 3000 }));
    await user.click(await screen.findByRole('menuitem', { name: 'Share' }));
    expect(await screen.findByRole('dialog', { name: 'Share Design process — my notes.pdf' })).toBeInTheDocument();
  });
});
