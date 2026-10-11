import { describe, expect, it } from 'vitest';
import { cardNumber, splitName } from '../IdCard';

describe('cardNumber', () => {
  const id = 'd6110ac0-664c-461b-94c9-75ea22deab95';

  it('is stable and licence-shaped', () => {
    expect(cardNumber(id)).toBe(cardNumber(id));
    expect(cardNumber(id)).toMatch(/^LS-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('never exposes the account id', () => {
    const no = cardNumber(id).toLowerCase();
    for (const chunk of id.split('-')) expect(no).not.toContain(chunk.slice(0, 4));
  });

  it('differs between people', () => {
    const many = new Set(Array.from({ length: 500 }, (_, i) => cardNumber(`user-${i}`)));
    expect(many.size).toBe(500);
  });
});

describe('splitName', () => {
  it.each([
    ['Mira Al-Hassan', { surname: 'Al-Hassan', given: 'Mira' }],
    ['Ana Maria de Souza', { surname: 'Souza', given: 'Ana Maria de' }],
    ['Ada', { surname: 'Ada', given: '-' }],
    ['  ', { surname: '-', given: '-' }],
  ])('%s', (name, out) => expect(splitName(name)).toEqual(out));
});
