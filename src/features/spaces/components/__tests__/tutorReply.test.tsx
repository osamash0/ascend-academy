import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { tutorReply, withoutSources } from '../tutorReply';

/** LS-104: the Home answer card showed `**Question 1:**` and "[Source 2]" as typed. */

const shown = (text: string) => render(<p>{tutorReply(text)}</p>).container.firstElementChild!;

describe('the tutor reply, as prose', () => {
  it('drops [Source N] markers, which the page chips already carry', () => {
    expect(withoutSources('A key is minimal [Source 2]. Every table has one [Source 1, Source 3].')).toBe(
      'A key is minimal. Every table has one.',
    );
    expect(withoutSources('Ein Schlüssel [Quelle 2] ist minimal.')).toBe('Ein Schlüssel ist minimal.');
  });

  it('keeps square brackets that are not citations', () => {
    expect(withoutSources('The range is [0, 1] [Source 4].')).toBe('The range is [0, 1].');
  });

  it('shows **bold** in bold and *emphasis* in italics, without the asterisks', () => {
    const p = shown('**Question 1:** What makes a key *minimal*? [Source 2]');
    expect(p.textContent).toBe('Question 1: What makes a key minimal?');
    expect(p.querySelector('strong')?.textContent).toBe('Question 1:');
    expect(p.querySelector('em')?.textContent).toBe('minimal');
  });

  it('leaves a lone asterisk alone', () => {
    expect(shown('Use SELECT * FROM t.').textContent).toBe('Use SELECT * FROM t.');
  });
});
