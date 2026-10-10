import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../components/Composer';

const base = {
  answering: false, suggestions: ['Why does repeated data cause problems?'], showSuggestions: true,
  notice: null, hint: null, pager: <span>2 / 12</span>, onAsk: vi.fn(),
};

describe('Composer', () => {
  it('sends on Enter and clears', () => {
    const onAsk = vi.fn();
    render(<Composer {...base} onAsk={onAsk} />);
    const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
    fireEvent.change(box, { target: { value: 'What is an FD?' } });
    fireEvent.submit(box.closest('form')!);
    expect(onAsk).toHaveBeenCalledWith('What is an FD?');
    expect(box).toHaveValue('');
  });
  it('ignores an empty question', () => {
    const onAsk = vi.fn();
    render(<Composer {...base} onAsk={onAsk} />);
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(onAsk).not.toHaveBeenCalled();
  });
  it('a suggestion chip asks that question', () => {
    const onAsk = vi.fn();
    render(<Composer {...base} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: 'Why does repeated data cause problems?' }));
    expect(onAsk).toHaveBeenCalledWith('Why does repeated data cause problems?');
  });
  it('is disabled while answering', () => {
    render(<Composer {...base} answering />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Answering…' })).toBeDisabled();
  });
  it('/ focuses it, but not while typing elsewhere or with a modifier', () => {
    render(<><input aria-label="other" /><Composer {...base} /></>);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).toHaveFocus();
    const other = screen.getByLabelText('other');
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(other).toHaveFocus();
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    expect(other).toHaveFocus();
  });
  it('says honestly when it cannot answer, and offers the suggestions', () => {
    render(<Composer {...base} showSuggestions={false} notice={{ kind: 'unknown' }} />);
    expect(screen.getByText(/In this preview I can answer a few questions about Normalization/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Why does repeated data cause problems?' })).toBeInTheDocument();
  });
  it('offers Undo and Added below', () => {
    const onUndo = vi.fn();
    const onJump = vi.fn();
    const { rerender } = render(<Composer {...base} notice={{ kind: 'removed', onUndo }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    rerender(<Composer {...base} notice={{ kind: 'below', onJump }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Added below ↓' }));
    expect(onJump).toHaveBeenCalled();
  });
  it('holds the pager at its end', () => {
    render(<Composer {...base} />);
    expect(screen.getByText('2 / 12')).toBeInTheDocument();
  });
  it('a chip does not clear a draft in progress', () => {
    const onAsk = vi.fn();
    render(<Composer {...base} onAsk={onAsk} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Why does repeated data cause problems?' }));
    expect(onAsk).toHaveBeenCalledWith('Why does repeated data cause problems?');
    expect(box).toHaveValue('my draft');
  });
  it('/ inside a dialog does not focus it', () => {
    render(<><div role="dialog"><button>in dialog</button></div><Composer {...base} /></>);
    const inside = screen.getByRole('button', { name: 'in dialog' });
    inside.focus();
    fireEvent.keyDown(inside, { key: '/' });
    expect(screen.getByRole('textbox')).not.toHaveFocus();
  });
  it('announces notices politely', () => {
    render(<Composer {...base} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
