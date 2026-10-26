import { describe, expect, it } from 'vitest';
import { shapeOf } from '../pageShape';

describe('shapeOf', () => {
  it('reads a landscape page as slides', () => expect(shapeOf(405 / 720)).toBe('slides'));
  it('reads a square-ish page as slides', () => expect(shapeOf(1)).toBe('slides'));
  it('reads an A4 portrait page as a document', () => expect(shapeOf(842 / 595)).toBe('document'));
  it('treats an unknown shape as slides (today’s behaviour)', () => expect(shapeOf(null)).toBe('slides'));
});
