import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtl, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const render = (ui: React.ReactElement) => rtl(<MemoryRouter>{ui}</MemoryRouter>);

const base = { pdfUrl: 'x', pages: 10, pagesRead: 3, pagesReady: [], practiceReady: false, readable: false, stage: 'developing', lessonId: null } as any;
const state: { reading: any; url: string | null; aspect: number } = { reading: base, url: 'blob:x', aspect: 0.56 };
const scrollTo = vi.hoisted(() => vi.fn());
vi.mock('../../../data/useEarlyReading', () => ({ useEarlyReading: () => state }));
vi.mock('@/components/pdf', () => ({
  PdfPager: ({ onAspect }: any) => {
    onAspect?.(state.aspect);
    return <div data-testid="pager" />;
  },
  PdfScroll: (props: any) => (
    /* Like the real one: the first page paints after mount. A click stands in for that paint. */
    <div ref={props.scrollRef} data-testid="scroll" onClick={() => props.onFirstRender?.(null)} />
  ),
  scrollToPdfPage: (...a: unknown[]) => scrollTo(...a),
  warmPdfWorker: () => {},
}));

const uploadsMock = vi.hoisted(() => ({ to: null as string | null, subs: new Set<() => void>(), v: 0 }));
vi.mock('../../../data/uploads', () => ({
  subscribeUploads: (fn: () => void) => (uploadsMock.subs.add(fn), () => uploadsMock.subs.delete(fn)),
  uploadsVersion: () => uploadsMock.v,
  resolvedUploadId: () => uploadsMock.to,
}));
import { act } from '@testing-library/react';
import { EarlyReader } from '../EarlyReader';

beforeEach(() => {
  state.reading = base;
  state.url = 'blob:x';
  state.aspect = 0.56;
  scrollTo.mockClear();
});

const resolve = (to: string) =>
  act(() => {
    uploadsMock.to = to;
    uploadsMock.v += 1;
    uploadsMock.subs.forEach((f) => f());
  });

describe('EarlyReader on a temporary id', () => {
  beforeEach(() => {
    uploadsMock.to = null;
  });
  it('moves to the real id, at the page you are on, once the server answers', () => {
    const onResolved = vi.fn();
    state.reading = null;
    render(<EarlyReader uploadId="sending-1" filename="a.pdf" onReady={() => {}} onResolved={onResolved} />);
    expect(onResolved).not.toHaveBeenCalled();
    resolve('run-9');
    expect(onResolved).toHaveBeenCalledWith('run-9', 1);
  });
  it('unmounted before the answer, nothing moves', () => {
    const onResolved = vi.fn();
    state.reading = null;
    const { unmount } = render(<EarlyReader uploadId="sending-1" filename="a.pdf" onReady={() => {}} onResolved={onResolved} />);
    unmount();
    resolve('run-9');
    expect(onResolved).not.toHaveBeenCalled();
  });
  it('a refused file stays readable, says it is only on this device, and offers to try again', () => {
    state.reading = null;
    const onRetry = vi.fn();
    render(<EarlyReader uploadId="sending-1" filename="a.pdf" onReady={() => {}} refused onRetry={onRetry} />);
    expect(screen.getByText('Saved on this device only')).toBeInTheDocument();
    expect(screen.queryByText(/could not read this one/i)).toBeNull();
    expect(screen.getByTestId('pager')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /library|bibliothek/i })).toHaveAttribute('href', '/v4/library');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('refused with nothing to resend: the line, without a dead button', () => {
    state.reading = null;
    render(<EarlyReader uploadId="sending-1" filename="a.pdf" onReady={() => {}} refused />);
    expect(screen.getByText('Saved on this device only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('EarlyReader', () => {
  it('shows the file at once, with Luna’s progress on the timeline and the page once', () => {
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={() => {}} />);
    expect(screen.getByTestId('pager')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-read')).toHaveStyle({ width: '30%' });
    expect(screen.getByTestId('timeline-count')).toHaveTextContent('1 / 10');
    /* One fact, once: the total is the timeline's, nowhere else. */
    expect(screen.getAllByText(/\/ 10/)).toHaveLength(1);
  });

  it('reports the page it is on, so a handover elsewhere keeps it', () => {
    const onPage = vi.fn();
    render(<EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => {}} onPage={onPage} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onPage).toHaveBeenLastCalledWith(2);
  });

  it('Page Down on the focused timeline is the slider’s, not a page turn', () => {
    render(<EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => {}} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'PageDown' });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '1');
  });

  it('a document is placed at the asked page only after its first page has painted', () => {
    state.aspect = 1.41;
    render(<EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => {}} initialPage={4} />);
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('scroll'));
    expect(scrollTo).toHaveBeenCalledWith(screen.getByTestId('scroll'), 4, 0.38, 'auto');
    fireEvent.click(screen.getByTestId('scroll'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('hands over to the Lesson once it exists, at the page being read', () => {
    const onReady = vi.fn();
    state.reading = { ...base, stage: 'developing', readable: true, lessonId: 'L1', pagesRead: 10 };
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={onReady} />);
    expect(onReady).toHaveBeenCalledWith('L1', 1);
  });

  it('does not hand over while the Lesson has no pages', () => {
    const onReady = vi.fn();
    state.reading = { ...base, stage: 'developing', readable: false, lessonId: 'L1' };
    render(<EarlyReader uploadId="run-1" filename="Normalization.pdf" onReady={onReady} />);
    expect(onReady).not.toHaveBeenCalled();
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
    state.reading = { ...base, stage: 'developing', readable: true, lessonId: 'L1', pagesRead: 10 };
    const ui = <MemoryRouter><EarlyReader uploadId="run-1" filename="N.pdf" onReady={onReady} /></MemoryRouter>;
    const { rerender } = rtl(ui);
    rerender(<MemoryRouter><EarlyReader uploadId="run-1" filename="N.pdf" onReady={onReady} /></MemoryRouter>);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    rerender(ui);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenLastCalledWith('L1', 1);
  });

  it('turns pages with the arrow keys, clamped to the file', () => {
    render(<EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => {}} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '2');
  });

  it('in a document, keys scroll to the page instead of moving the page alone', () => {
    state.aspect = 1.41;
    render(<EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => {}} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(scrollTo).toHaveBeenCalledWith(screen.getByTestId('scroll'), 2, 0.38, expect.any(String));
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '1');
  });

  it('leaves browser shortcuts alone', () => {
    render(<EarlyReader uploadId="run-1" filename="N.pdf" onReady={() => {}} />);
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '1');
  });
});
