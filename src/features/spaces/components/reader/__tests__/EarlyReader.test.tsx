import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtl, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const render = (ui: React.ReactElement) => rtl(<MemoryRouter>{ui}</MemoryRouter>);

const base = { pdfUrl: 'x', pages: 10, pagesRead: 3, stage: 'developing', lessonId: null } as any;
const state: { reading: any; url: string | null } = { reading: base, url: 'blob:x' };
vi.mock('../../../data/useEarlyReading', () => ({ useEarlyReading: () => state }));
vi.mock('@/components/pdf', () => ({
  PdfPager: () => <div data-testid="pager" />,
  PdfScroll: () => <div data-testid="scroll" />,
  scrollToPdfPage: () => {},
  warmPdfWorker: () => {},
}));

import { EarlyReader } from '../EarlyReader';

beforeEach(() => {
  state.reading = base;
  state.url = 'blob:x';
});

describe('EarlyReader', () => {
  it('shows the file at once, with Luna’s progress on the timeline', () => {
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={() => {}} />);
    expect(screen.getByTestId('pager')).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 10/)).toBeInTheDocument();
  });

  it('hands over to the Lesson once it exists, at the page being read', () => {
    const onReady = vi.fn();
    state.reading = { ...base, stage: 'ready', lessonId: 'L1', pagesRead: 10 };
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={onReady} />);
    expect(onReady).toHaveBeenCalledWith('L1', 1);
  });

  it('mounts no pdf view until the file url exists', () => {
    state.url = null;
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={() => {}} />);
    expect(screen.queryByTestId('pager')).toBeNull();
    expect(screen.queryByTestId('scroll')).toBeNull();
  });

  it('a failed reading says so and still shows the file', () => {
    state.reading = { ...base, stage: 'failed' };
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={() => {}} />);
    expect(screen.getByText(/could not read this one/i)).toBeInTheDocument();
    expect(screen.getByTestId('pager')).toBeInTheDocument();
  });

  it('has a way out: back to the Library', () => {
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={() => {}} />);
    expect(screen.getByRole('link', { name: /library|bibliothek/i })).toHaveAttribute('href', '/v4/library');
  });

  it('hands over exactly once, however often it re-renders', () => {
    const onReady = vi.fn();
    state.reading = { ...base, stage: 'ready', lessonId: 'L1', pagesRead: 10 };
    const ui = <MemoryRouter><EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => onReady()} /></MemoryRouter>;
    const { rerender } = rtl(ui);
    rerender(<MemoryRouter><EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => onReady()} /></MemoryRouter>);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    rerender(ui);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('turns pages with the arrow keys, clamped to the file', () => {
    render(<EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => {}} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '2');
  });
});
