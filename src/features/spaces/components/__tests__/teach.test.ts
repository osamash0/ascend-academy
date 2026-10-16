import { describe, expect, it } from 'vitest';
import { annotate } from '../reader/teach';

describe('marking the student’s own words', () => {
  const text = 'Start with X. It always takes two rounds. Then stop.';

  it('cuts the text where a quote is found, whatever its case', () => {
    expect(annotate(text, ['it ALWAYS takes two rounds'])).toEqual([
      { text: 'Start with X. ', wrong: null },
      { text: 'It always takes two rounds', wrong: 0 },
      { text: '. Then stop.', wrong: null },
    ]);
  });

  it('ignores quotes that are not there, and keeps the first of two that overlap', () => {
    const runs = annotate(text, ['not in it', 'two rounds. Then', 'rounds']);
    expect(runs.filter((r) => r.wrong !== null)).toEqual([{ text: 'two rounds. Then', wrong: 1 }]);
    expect(runs.map((r) => r.text).join('')).toBe(text);
  });
});
