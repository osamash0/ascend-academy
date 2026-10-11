import { describe, expect, it } from 'vitest';
import { findRange } from '../reader/findText';

/**
 * The words on one face, found on the other.
 *
 * The PDF's text layer splits a sentence across many spans with odd spacing;
 * the column keeps it in one paragraph. The finder has to see through both.
 */

const mount = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
};

describe('findRange', () => {
  it('finds a sentence split across spans with ragged whitespace', () => {
    const el = mount(
      '<span>A functional</span> <span>  dependency (FD)</span><span> X → A is an</span>\n<span>expression</span>',
    );
    const r = findRange(el, 'functional dependency (FD) X → A is an expression');
    expect(r).not.toBeNull();
    expect(r!.toString().replace(/\s+/g, ' ')).toBe('functional dependency (FD) X → A is an expression');
  });

  it('is case-insensitive and ignores the selection’s own whitespace', () => {
    const el = mount('<p>Store one fact in one place.</p>');
    expect(findRange(el, '  store ONE fact\n in one ')?.toString()).toBe('Store one fact in one');
  });

  it('returns null when the words are not there', () => {
    const el = mount('<p>Nothing here matches.</p>');
    expect(findRange(el, 'the second Müller yet')).toBeNull();
  });

  it('refuses a needle too short to mean anything', () => {
    const el = mount('<p>a b c</p>');
    expect(findRange(el, 'a b')).toBeNull();
  });
});
