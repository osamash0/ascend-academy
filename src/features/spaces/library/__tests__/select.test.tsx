import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import LibraryScreen from '../../screens/LibraryScreen';
import * as shelf from '../../mocks/shelf';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

/** One Library §5.8: Select is the one dense moment, and it lives on the shelf. */

const Probe = () => {
  const l = useLocation();
  return <p data-testid="loc">{l.pathname + l.search}</p>;
};

const at = (path = '/v4/library?select=1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
      </Routes>
      <Probe />
      <Toaster />
    </MemoryRouter>,
  );

const ids = () => shelf.getItems().map((i) => i.id);
const share = (id: string) => shelf.getItems().find((i) => i.id === id)!.share;
const box = (name: RegExp) => screen.findByRole('checkbox', { name }, { timeout: 3000 });
const bar = () => screen.getByRole('group', { name: 'Selection' });

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

describe('Select', () => {
  it('?select=1 turns covers into checkboxes and brings the bar', async () => {
    at();
    await box(/Normalization\.pdf/);
    expect(screen.getAllByRole('checkbox').length).toBe(shelf.getItems().length);
    expect(bar()).toHaveTextContent('0 selected');
    // The cover's link is inert while selecting: it is out of the tab order and goes nowhere.
    const list = screen.getByRole('list', { name: 'Your shelf' });
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
  });

  it('is entered from the Select… pill beside the filters', async () => {
    at('/v4/library');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select…' }, { timeout: 3000 }));
    expect(screen.getByTestId('loc')).toHaveTextContent('select=1');
    expect(bar()).toBeInTheDocument();
  });

  it('removes two with a confirm, and Undo puts both back in place', async () => {
    const before = ids();
    at();
    const user = userEvent.setup();
    await user.click(await box(/Design process/));
    await user.click(await box(/Axioms cheat sheet/));
    expect(bar()).toHaveTextContent('2 selected');
    expect(screen.getByRole('status', { name: 'Selection count' })).toHaveTextContent('2 selected');

    await user.click(within(bar()).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove 2 from your Library?' });
    // Nothing is gone until you confirm.
    expect(ids()).toEqual(before);
    await user.click(within(dialog).getByRole('button', { name: 'Remove 2' }));

    await waitFor(() => expect(ids()).not.toContain('m-design-notes'));
    expect(ids()).not.toContain('m-axioms');
    expect(screen.queryByRole('checkbox', { name: /Design process/ })).toBeNull();
    expect(bar()).toHaveTextContent('0 selected');

    expect(await screen.findByText('Removed 2')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(ids()).toEqual(before));
  });

  it('Publish drafts is enabled only with a draft selected, and flips m-axioms to shared', async () => {
    at();
    const user = userEvent.setup();
    await user.click(await box(/Normalization\.pdf/));
    const publish = within(bar()).getByRole('button', { name: 'Publish drafts' });
    expect(publish).toBeDisabled();
    await user.click(await box(/Axioms cheat sheet/));
    expect(publish).toBeEnabled();
    await user.click(publish);
    expect(share('m-axioms')).toMatchObject({ kind: 'shared', spaceId: 's-linalg', as: 'lesson' });
    // What was already shared is left exactly as it was.
    expect(share('m-norm')).toMatchObject({ kind: 'shared', likes: 3 });
  });

  it('Share to… shares the private ones, skips the rest, and says so', async () => {
    at();
    const user = userEvent.setup();
    await user.click(await box(/Design process/));
    await user.click(await box(/Normalization\.pdf/));
    await user.click(within(bar()).getByRole('button', { name: 'Share to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share 2 files' });
    expect(dialog).toHaveTextContent('Left as they are: 1 already in a Space.');
    await user.click(within(dialog).getByRole('radio', { name: 'Database Systems · Guided · you’re a member' }));
    await user.click(within(dialog).getByRole('button', { name: 'Share to Database Systems' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(share('m-design-notes')).toMatchObject({ kind: 'shared', spaceId: 's-dbs', as: 'contribution' });
    expect(share('m-norm')).toMatchObject({ kind: 'shared', likes: 3 });
    expect(await screen.findByText('1 shared · 1 already in a Space')).toBeInTheDocument();
  });

  it('never stands over an empty shelf, where there is nothing to remove (LS-063)', async () => {
    for (const i of [...shelf.getItems()]) shelf.remove(i.id);
    at();
    await screen.findByRole('heading', { level: 1 }, { timeout: 3000 });
    expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('Select all checks every cover', async () => {
    at();
    const user = userEvent.setup();
    await box(/Normalization\.pdf/);
    await user.click(within(bar()).getByRole('button', { name: 'Select all' }));
    expect(bar()).toHaveTextContent(`${shelf.getItems().length} selected`);
    for (const c of screen.getAllByRole('checkbox')) expect(c).toHaveAttribute('aria-checked', 'true');
  });

  it('Esc leaves Select, and so does Done', async () => {
    at();
    const user = userEvent.setup();
    await user.click(await box(/Normalization\.pdf/));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull());
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByTestId('loc')).not.toHaveTextContent('select=1');

    await user.click(screen.getByRole('button', { name: 'Select…' }));
    await user.click(within(bar()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull());
  });

  it('Esc inside the confirm closes only the confirm', async () => {
    at();
    const user = userEvent.setup();
    await user.click(await box(/Axioms cheat sheet/));
    await user.click(within(bar()).getByRole('button', { name: 'Remove' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bar()).toHaveTextContent('1 selected');
  });

  it('Share to… never shares a file still being prepared, and names it', async () => {
    /*
     * The mock settles a brought-in file to ready after 3.3 s of wall-clock
     * time, and a loaded machine can run this test past that. Its timers are
     * made on a fake clock that is then dropped, so they never fire: the file
     * is still being prepared for exactly as long as the test needs.
     */
    vi.useFakeTimers();
    const fresh = shelf.bringIn('Fresh scan.pdf');
    vi.useRealTimers();
    at();
    const user = userEvent.setup();
    await user.click(await box(/Fresh scan\.pdf/));
    await user.click(await box(/Design process/));
    await user.click(await box(/Normalization\.pdf/));
    await user.click(within(bar()).getByRole('button', { name: 'Share to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share 3 files' });
    expect(dialog).toHaveTextContent('Left as they are: 1 still being prepared · 1 already in a Space.');
    await user.click(within(dialog).getByRole('radio', { name: 'Database Systems · Guided · you’re a member' }));
    await user.click(within(dialog).getByRole('button', { name: 'Share to Database Systems' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(share(fresh)).toEqual({ kind: 'private' });
    expect(share('m-design-notes').kind).toBe('shared');
    expect(await screen.findByText('1 shared · 1 still being prepared · 1 already in a Space')).toBeInTheDocument();
    // Lifted above the bar, so it never covers Done.
    expect(screen.getByText('1 shared · 1 still being prepared · 1 already in a Space').closest('li')!.style.marginBottom).toBe('72px');
  });

  it('the store will not share a file that is not ready', () => {
    const fresh = shelf.bringIn('Fresh scan.pdf');
    shelf.share(fresh, 's-dbs', 'member', 'guided');
    expect(share(fresh)).toEqual({ kind: 'private' });
  });

  it('follows what you see: a filter drops hidden covers, and Select all means the shown ones', async () => {
    at();
    const user = userEvent.setup();
    await user.click(await box(/Design process/));
    await user.click(await box(/Normalization\.pdf/));
    expect(bar()).toHaveTextContent('2 selected');
    await user.click(screen.getByRole('tab', { name: /Shared/ }));
    // Design notes is private, so Shared hides it — and it leaves the selection.
    await waitFor(() => expect(bar()).toHaveTextContent('1 selected'));
    await user.click(within(bar()).getByRole('button', { name: 'Select all' }));
    const sharedCount = shelf.getItems().filter((i) => i.share.kind !== 'private').length;
    expect(bar()).toHaveTextContent(`${sharedCount} selected`);
    await user.click(screen.getByRole('tab', { name: /Everything/ }));
    expect(await box(/Design process/)).toHaveAttribute('aria-checked', 'false');
    expect(bar()).toHaveTextContent(`${sharedCount} selected`);
  });
});

describe('focus in Select', () => {
  it('Select… hands focus to the first checkbox; Done and Esc give it back to Select…', async () => {
    at('/v4/library');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select…' }, { timeout: 3000 }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'checkbox'));
    await user.click(within(bar()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select…' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Select…' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select…' })).toHaveFocus());
  });

  it('Remove… from a cover’s menu focuses that cover’s checkbox', async () => {
    at('/v4/library');
    const more = await screen.findByRole('button', { name: 'More for Axioms cheat sheet.pdf' }, { timeout: 3000 });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('menuitem', { name: /Remove/ }));
    const checkbox = await box(/Axioms cheat sheet/);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(checkbox).toHaveFocus());
  });

  it('after Remove, focus goes to the first action still enabled', async () => {
    at();
    const user = userEvent.setup();
    await user.click(await box(/Axioms cheat sheet/));
    await user.click(within(bar()).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Select all' })).toHaveFocus());
  });
});
