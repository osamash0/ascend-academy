import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CanvasPage } from '../components/CanvasPage';
import type { GeneratedBlock } from '../types';

const answer: GeneratedBlock = {
  id: 'ans-1', origin: 'generated', askedAs: 'Why?', anchorId: 's-p6-1', markdown: 'Because.', citations: [],
};
const props = {
  groups: [{ materialId: 'm', page: 6, blocks: [answer] }],
  pages: [{ materialId: 'm', page: 6, width: 720, height: 405, imageUrl: '/p6.webp', geometry: 'page' as const, blocks: [] }],
  view: 'clean' as const,
  activeBlockId: null, flashBlockId: null, sourceRemoved: false, materialName: 'N.pdf',
  freshId: null, glowId: null,
  onBlockPointerEnter: vi.fn(), onBlockPointerLeave: vi.fn(), onOpenPeek: vi.fn(), onClosePeek: vi.fn(),
  onRegion: vi.fn(), onInclude: vi.fn(), onAnswerSettled: vi.fn(), onRemoveAnswer: vi.fn(), onOpenPeekSource: vi.fn(),
};

describe('CanvasPage', () => {
  it('fades an answer back in on the page that flies back from Source, and only there', () => {
    // Coming back from Source: the clean side mounts anew, so its entrance applies.
    const back = (morphPage: number) => {
      const r = render(<CanvasPage {...props} view="original" morphPage={morphPage} flying={false} />);
      r.rerender(<CanvasPage {...props} view="clean" morphPage={morphPage} flying />);
      const el = r.container.querySelector<HTMLElement>('[data-view="clean"] [data-woven]')!;
      const opacity = el.style.opacity;
      r.unmount();
      return opacity;
    };
    expect(back(6)).toBe('0');
    expect(back(2)).not.toBe('0');
  });
});
