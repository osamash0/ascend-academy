import { describe, expect, it } from 'vitest';
import { STUDIO_ANSWERS, SUGGESTED_QUESTIONS, findAnswer } from '../studio-answers';
import { STUDIO_CANVAS, studioPages } from '../studio-canvas';

describe('scripted answers', () => {
  it('anchor on a paragraph that exists, and cite blocks that exist', () => {
    for (const a of STUDIO_ANSWERS) {
      expect(STUDIO_CANVAS.blocks.some((b) => b.id === a.anchorId), a.anchorId).toBe(true);
      expect(a.citations.length).toBeGreaterThan(0);
      for (const c of a.citations) {
        const page = studioPages.find((p) => p.page === c.page)!;
        expect(page.blocks.some((s) => s.id === c.blockId), `${a.question} → ${c.blockId}`).toBe(true);
      }
    }
  });
  it('match their own question, case-insensitively, and nothing else matches by accident', () => {
    for (const a of STUDIO_ANSWERS) {
      expect(findAnswer(a.question)).toBe(a);
      expect(findAnswer(a.question.toUpperCase())).toBe(a);
    }
    expect(findAnswer('What is the capital of France?')).toBeNull();
    expect(findAnswer('')).toBeNull();
  });
  it('suggest the first three questions', () => {
    expect(SUGGESTED_QUESTIONS).toEqual(STUDIO_ANSWERS.slice(0, 3).map((a) => a.question));
  });
});
