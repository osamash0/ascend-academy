import { describe, expect, it } from 'vitest';
import { STUDIO_ANSWERS, SUGGESTED_QUESTIONS, findAnswer, nextSuggestions } from '../studio-answers';
import { STUDIO_CANVAS, studioPages } from '../studio-canvas';
import { hasSource } from '../../studio/edit';

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
  it('cite only source blocks a paragraph covers, so a citation chip always opens Peek somewhere', () => {
    for (const a of STUDIO_ANSWERS)
      for (const c of a.citations)
        expect(
          STUDIO_CANVAS.blocks.some((b) => hasSource(b) && b.source.blockIds.includes(c.blockId!)),
          `${a.question} → ${c.blockId}`,
        ).toBe(true);
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
  it('shaped answers use known block types and consistent data', () => {
    const known = ['text', 'key', 'compare', 'fdTable', 'closure', 'bcnf', 'check', 'steps'];
    for (const a of STUDIO_ANSWERS)
      for (const b of a.blocks ?? []) {
        expect(known, a.question).toContain(b.type);
        if (b.type === 'fdTable') {
          for (const r of b.rows) expect(r.length).toBe(b.columns.length);
          for (const x of [...b.fd.lhs, ...b.fd.rhs]) expect(b.columns).toContain(x);
        }
        if (b.type === 'closure') {
          for (const x of [...b.start, ...b.fds.flatMap((f) => [...f.lhs, ...f.rhs])]) expect(b.attrs).toContain(x);
        }
        if (b.type === 'bcnf')
          for (const x of b.fds.flatMap((f) => [...f.lhs, ...f.rhs])) expect(b.relation.attrs).toContain(x);
      }
  });
  it('every shaped answer has a format and a plain-text markdown', () => {
    for (const a of STUDIO_ANSWERS.filter((x) => x.blocks)) {
      expect(a.format, a.question).toBeTruthy();
      expect(a.markdown.length).toBeGreaterThan(20);
    }
  });
  it('every question resolves to itself — no earlier regex steals it', () => {
    for (const a of STUDIO_ANSWERS) expect(findAnswer(a.question)?.question).toBe(a.question);
    expect(STUDIO_ANSWERS.length).toBeGreaterThanOrEqual(8);
  });
  it('nextSuggestions hands out the questions not asked yet, in order', () => {
    const all = STUDIO_ANSWERS.map((a) => a.question);
    expect(nextSuggestions([])).toEqual(all.slice(0, 3));
    expect(nextSuggestions(all.slice(0, 3))).toEqual(all.slice(3, 6));
    expect(nextSuggestions(all)).toEqual([]);
    expect(nextSuggestions([all[0].toUpperCase()], 2)).toEqual(all.slice(1, 3));
  });
});
