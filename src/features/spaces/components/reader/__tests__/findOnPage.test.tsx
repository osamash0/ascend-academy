import { afterEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { findOnPage } from '../findText';
import { Spotlight } from '../Spotlight';

/*
 * With Layout on, the words the learner sees are the layer's; the pdf.js text
 * layer underneath is hidden by it. Luna's lights (the Spotlight's ring, the
 * marks of "show on page") must land on the visible type, so the page's words
 * are looked for in the shown layer first, and in the whole page only when the
 * layer does not carry them (it re-spaces arrows, drops symbol bullets).
 */

/* A page slot as PdfPager draws it: the pdf.js text layer, then the overlay. */
const slotWith = (layer: string | null, veiled = false) => {
  const slot = document.createElement('div');
  slot.setAttribute('data-pdf-page', '12');
  slot.innerHTML = `<div class="textLayer"><span>Reflexivity: Y ⊆ X ⇒ X→Y</span></div>`;
  if (layer !== null) {
    const l = document.createElement('div');
    l.className = 'ls-layout';
    if (veiled) l.setAttribute('data-veiled', '');
    l.innerHTML = `<div class="blk">${layer}</div>`;
    slot.appendChild(l);
  }
  document.body.appendChild(slot);
  return slot;
};

const inLayer = (r: Range | null) => !!(r?.startContainer.parentElement?.closest('.ls-layout'));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findOnPage: the words where the learner sees them', () => {
  it('finds them in the shown Layout layer, not in the hidden text underneath', () => {
    const r = findOnPage(slotWith('Reflexivity: Y ⊆ X ⇒ X → Y'), 'Reflexivity');
    expect(r).not.toBeNull();
    expect(inLayer(r)).toBe(true);
  });

  it('falls back to the page when the layer does not carry them', () => {
    const r = findOnPage(slotWith('Something else entirely'), 'Reflexivity');
    expect(r).not.toBeNull();
    expect(inLayer(r)).toBe(false);
  });

  it('ignores a veiled layer (one the browser checks failed): the original is what is seen', () => {
    const r = findOnPage(slotWith('Reflexivity: Y ⊆ X ⇒ X → Y', true), 'Reflexivity');
    expect(inLayer(r)).toBe(false);
  });

  it('is the plain page search with no layer', () => {
    const r = findOnPage(slotWith(null), 'Reflexivity');
    expect(r).not.toBeNull();
    expect(inLayer(r)).toBe(false);
  });
});

describe('Spotlight with Layout on', () => {
  const proto = Range.prototype as unknown as { getClientRects?: () => DOMRect[] };
  const had = proto.getClientRects;

  afterEach(() => {
    proto.getClientRects = had;
  });

  it('rings the words where the layer sets them', async () => {
    /* The layer's words at x 300, the hidden pdf.js words at x 10. */
    proto.getClientRects = function (this: Range) {
      const x = this.startContainer.parentElement?.closest('.ls-layout') ? 300 : 10;
      return [{ left: x, top: 50, right: x + 100, bottom: 70, width: 100, height: 20 } as DOMRect];
    };
    const slot = document.createElement('div');
    slot.setAttribute('data-pdf-page', '12');
    document.body.appendChild(slot);
    render(
      <>
        <div className="textLayer">
          <span>Reflexivity holds</span>
        </div>
        <div className="ls-layout">
          <div className="blk">Reflexivity holds</div>
        </div>
        <Spotlight words="Reflexivity holds" />
      </>,
      { container: slot },
    );
    await waitFor(() => expect(slot.querySelector<HTMLElement>('.rounded-lg')).not.toBeNull(), { timeout: 2000 });
    /* The ring's left edge is the layer's words, less the ring's padding. */
    expect(slot.querySelector<HTMLElement>('.rounded-lg')!.style.left).toBe('294px');
  });
});
