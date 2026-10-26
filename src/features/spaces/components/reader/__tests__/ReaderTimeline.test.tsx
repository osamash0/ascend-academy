import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReaderTimeline } from '../ReaderTimeline';

const box = { left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) };

describe('ReaderTimeline', () => {
  it('is a slider at the current page', () => {
    render(<ReaderTimeline page={3} total={10} read={10} quiet={false} onSeek={() => {}} unit="slide" />);
    const s = screen.getByRole('slider');
    expect(s).toHaveAttribute('aria-valuenow', '3');
    expect(s).toHaveAttribute('aria-valuemax', '10');
  });

  it('jumps to the page under the click', () => {
    const onSeek = vi.fn();
    render(<ReaderTimeline page={1} total={10} read={10} quiet={false} onSeek={onSeek} unit="slide" />);
    const s = screen.getByRole('slider');
    s.getBoundingClientRect = () => box as DOMRect;
    fireEvent.click(s, { clientX: 150 });
    expect(onSeek).toHaveBeenCalledWith(8);
  });

  it('draws how far Luna has read as its own bar', () => {
    render(<ReaderTimeline page={2} total={10} read={4} quiet={false} onSeek={() => {}} unit="slide" />);
    expect(screen.getByTestId('timeline-read')).toHaveStyle({ width: '40%' });
  });

  it('is only a hairline while quiet', () => {
    render(<ReaderTimeline page={2} total={10} read={10} quiet onSeek={() => {}} unit="slide" />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByTestId('timeline-hairline')).toBeInTheDocument();
  });

  it('moves with the arrow keys when focused', () => {
    const onSeek = vi.fn();
    render(<ReaderTimeline page={5} total={10} read={10} quiet={false} onSeek={onSeek} unit="page" />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(onSeek).toHaveBeenCalledWith(10);
  });
});
