import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LunaSays } from '../LunaSays';

/**
 * Luna's speech bubble: a white pill whose one squared corner points back at
 * her, so it reads as hers wherever it sits — landing guide, sign-in, first run.
 */
describe('LunaSays', () => {
  it('says what it is given', () => {
    render(<LunaSays>Hi, Alice.</LunaSays>);
    expect(screen.getByTestId('luna-says')).toHaveTextContent('Hi, Alice.');
  });

  it('squares the corner that points back at Luna', () => {
    const { rerender } = render(<LunaSays side="right">Hi.</LunaSays>);
    expect(screen.getByTestId('luna-says').className).toMatch(/rounded-bl-\[4px\]/);
    rerender(<LunaSays side="left">Hi.</LunaSays>);
    expect(screen.getByTestId('luna-says').className).toMatch(/rounded-br-\[4px\]/);
  });
});
