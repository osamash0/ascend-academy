import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const mount = async () => {
  const utils = render(
    <MemoryRouter initialEntries={['/v4/library/studio/c/c-norm']}>
      <Routes>
        <Route path="/v4/library/studio/c/:canvasId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { vi.advanceTimersByTime(700); });
  return utils;
};
const ask = async (q: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this Material' }), { target: { value: q } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Ask about this Material' }).closest('form')!);
  await act(async () => { vi.advanceTimersByTime(700); });
};
const order = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-view="clean"] [data-block-id]')).map((e) => e.getAttribute('data-block-id'));

describe('asking on the canvas', () => {
  it('weaves the answer under the paragraph it is about and announces it', async () => {
    const { container } = await mount();
    await ask('Why does repeated data cause problems?');
    const ids = order(container);
    const at = ids.indexOf('s-p5-2');
    expect(ids[at + 1]).toMatch(/^ans-/);
    // The Composer has its own status region for notices; the screen's is named.
    expect(screen.getByRole('status', { name: 'Canvas updates' })).toHaveTextContent(/Answer added under: The tools are functional/);
  });

  it('disables the composer while answering', async () => {
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this Material' }), { target: { value: 'What is a functional dependency?' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).not.toBeDisabled();
  });

  it('is honest about questions it cannot answer, and adds nothing', async () => {
    const { container } = await mount();
    const before = order(container).length;
    await ask('Tell me a joke');
    expect(screen.getByText(/In this preview I can answer a few questions/)).toBeInTheDocument();
    expect(order(container).length).toBe(before);
  });

  it('Remove and Undo put the answer back in the same place', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    await act(async () => { vi.advanceTimersByTime(3000); });
    const withAnswer = order(container);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(order(container).some((id) => id?.startsWith('ans-'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(order(container)).toEqual(withAnswer);
  });

  it('answers fade, not fly, in Source view', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('[data-woven="true"][data-morph]')).toBeNull();
  });
});
