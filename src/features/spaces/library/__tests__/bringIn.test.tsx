import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LibraryScreen from '../../screens/LibraryScreen';
import * as shelf from '../../mocks/shelf';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

const at = () =>
  render(
    <MemoryRouter initialEntries={['/v4/library']}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
      </Routes>
    </MemoryRouter>,
  );
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
const settle = () => advance(700);
const input = () => screen.getByLabelText('Bring something in') as HTMLInputElement;
const file = (name = 'Transitivity proof.pdf') => new File(['x'], name, { type: 'application/pdf' });
const bring = (name?: string) => fireEvent.change(input(), { target: { files: [file(name)] } });
const card = () => firstCover().parentElement as HTMLElement;
const firstCover = () => within(screen.getByRole('list', { name: 'Your shelf' })).getAllByRole('link')[0];

beforeEach(() => {
  vi.useFakeTimers();
  shelf.__reset();
  resetNotes();
  resetReanchors();
  window.history.replaceState({}, '', '/v4/library');
});
afterEach(() => {
  vi.useRealTimers();
  shelf.__reset();
  window.history.replaceState({}, '', '/');
});

describe('bringing something in', () => {
  it('offers the first cell as a real picker', async () => {
    at();
    await settle();
    expect(input()).toHaveAttribute('accept', '.pdf,.pptx,image/*');
    expect(screen.getByText('PDF, PPTX or a photo — drop it, or click')).toBeInTheDocument();
  });

  it('puts a developing cover first, then reads, writes and is ready with an announcement', async () => {
    at();
    await settle();
    bring();
    expect(firstCover().getAttribute('aria-label')).toMatch(/^Transitivity proof\.pdf, Developing…/);
    expect(within(card()).getByText('Reading your pages…')).toBeInTheDocument();
    await advance(1200);
    expect(within(card()).getByText('Writing your summary…')).toBeInTheDocument();
    expect(within(card()).queryByText('Reading your pages…')).toBeNull();
    await advance(2100);
    // Ready, it takes its place among the rest of the shelf.
    const ready = screen.getByRole('link', { name: /^Transitivity proof\.pdf, Only you/ });
    expect(ready).toBeInTheDocument();
    expect(within(card()).queryByText('Writing your summary…')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Transitivity proof.pdf is ready');
    expect(within(ready.parentElement as HTMLElement).getByText('Sample pages')).toBeInTheDocument();
  });

  it('leaves seeded files being prepared alone: still developing, never announced', async () => {
    at();
    await settle();
    const seeded = shelf.getItems().filter((i) => i.stage === 'developing');
    expect(seeded.length).toBeGreaterThan(0);
    await advance(10_000);
    expect(shelf.getItems().filter((i) => i.stage === 'developing').map((i) => i.id)).toEqual(
      seeded.map((i) => i.id),
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows the veil on a file drag and brings the dropped files in', async () => {
    at();
    await settle();
    const dataTransfer = { types: ['Files'], files: [file('A.pdf'), file('B.pptx')] };
    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByText('Drop to bring it in')).toBeInTheDocument();
    fireEvent.drop(window, { dataTransfer });
    await advance(400);
    expect(screen.queryByText('Drop to bring it in')).toBeNull();
    const names = shelf.getItems().slice(0, 2).map((i) => i.filename);
    expect(names).toEqual(['B.pptx', 'A.pdf']);
  });

  it('ignores drags that carry no files, and hides the veil on leaving', async () => {
    at();
    await settle();
    fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'] } });
    expect(screen.queryByText('Drop to bring it in')).toBeNull();
    const dataTransfer = { types: ['Files'] };
    fireEvent.dragEnter(window, { dataTransfer });
    fireEvent.dragLeave(window, { dataTransfer });
    await advance(400);
    expect(screen.queryByText('Drop to bring it in')).toBeNull();
  });

  it('drops the veil when the window loses focus or the drag ends', async () => {
    at();
    await settle();
    const dataTransfer = { types: ['Files'] };
    fireEvent.dragEnter(window, { dataTransfer });
    fireEvent.blur(window);
    await advance(400);
    expect(screen.queryByText('Drop to bring it in')).toBeNull();
    fireEvent.dragEnter(window, { dataTransfer });
    fireEvent.dragEnd(window);
    await advance(400);
    expect(screen.queryByText('Drop to bring it in')).toBeNull();
  });

  it('opens the picker with U, but not while typing', async () => {
    at();
    await settle();
    const click = vi.spyOn(input(), 'click');
    fireEvent.keyDown(window, { key: 'u' });
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'u', metaKey: true });
    fireEvent.keyDown(window, { key: 'u', repeat: true });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('fails under ?mock=import-error and develops again on Try again', async () => {
    window.history.replaceState({}, '', '/v4/library?mock=import-error');
    at();
    await settle();
    bring('Broken.pdf');
    await advance(3300);
    expect(firstCover().getAttribute('aria-label')).toMatch(/^Broken\.pdf, Couldn’t read this file/);
    expect(screen.queryByRole('status')?.textContent).toBe('');
    fireEvent.click(within(card()).getByRole('button', { name: 'Try again' }));
    expect(within(card()).getByText('Reading your pages…')).toBeInTheDocument();
    await advance(3300);
    expect(within(card()).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
