import { describe, expect, it } from 'vitest';
import { firstWords, plainText } from '../text';

describe('text', () => {
  it('strips Markdown structure', () => {
    expect(plainText('### Normal forms')).toBe('Normal forms');
    expect(plainText('- one\n- two')).toBe('one two');
    expect(plainText('A **bold** and `code` move')).toBe('A bold and code move');
  });
  it('takes the first words with an ellipsis only when cut', () => {
    expect(firstWords('one two three', 6)).toBe('one two three');
    expect(firstWords('a b c d e f g h', 6)).toBe('a b c d e f…');
  });
});
