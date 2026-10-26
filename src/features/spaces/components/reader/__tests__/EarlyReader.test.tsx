import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
});
