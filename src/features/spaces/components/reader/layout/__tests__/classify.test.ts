import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, groupOf } from '../classify';
import type { LayoutBlock } from '../types';

const blk = (over: Partial<LayoutBlock>): LayoutBlock => ({
  id: 'b',
  kind: 'paragraph',
  bbox: [0.1, 0.1, 0.9, 0.3],
  text: 'Plain words on a page.',
  ...over,
});

describe('classify', () => {
  it('keeps a table with rows a table', () => {
    expect(classify(blk({ kind: 'table', text: 'a | b', rows: [['a', 'b']] }))).toBe('table');
  });

  it('shows a table without rows as it is', () => {
    expect(classify(blk({ kind: 'table', text: 'a | b' }))).toBe('window');
  });

  it('drops a page number as furniture', () => {
    expect(classify(blk({ text: 'Folie 12 von 40' }))).toBe('deco');
    expect(classify(blk({ text: 'Page 3' }))).toBe('deco');
  });

  it('names figures and headings', () => {
    expect(classify(blk({ kind: 'figure', text: '', picture: true }))).toBe('fig');
    expect(classify(blk({ kind: 'heading', text: 'Normalization' }))).toBe('h');
  });

  it('reads four short lines in a thin band as a row', () => {
    expect(classify(blk({ text: 'A\n1\n2\n3', bbox: [0.1, 0.5, 0.9, 0.55] }))).toBe('row');
    expect(classify(blk({ text: 'A\n1\n2\n3', bbox: [0.1, 0.5, 0.9, 0.7] }))).toBe('p');
  });

  it('sets short logic as maths, never a bullet', () => {
    expect(classify(blk({ text: '∀x ∈ X ⇒ P(x)' }))).toBe('math');
    expect(classify(blk({ text: '• ∀x ∈ X ⇒ P(x)' }))).toBe('p');
  });

  it('reads a short line ending in a colon as a label', () => {
    expect(classify(blk({ text: 'Beispiel:' }))).toBe('label');
    expect(classify(blk({ text: 'This sentence is far too long to be a label:' }))).toBe('p');
  });

  it('keeps lists and paragraphs apart', () => {
    expect(classify(blk({ kind: 'list', text: '• one\n• two' }))).toBe('l');
    expect(classify(blk({ kind: 'paragraph' }))).toBe('p');
  });

  it('turns a block with a private-use glyph left in it into a window', () => {
    expect(classify(blk({ text: 'x  y' }))).toBe('window');
    expect(classify(blk({ kind: 'heading', text: 'Rule  result' }))).toBe('window');
  });

  it('drops a symbol-font bullet at the start of a line before judging', () => {
    expect(classify(blk({ kind: 'list', text: ' one\n two' }))).toBe('l');
  });

  it('never turns a figure into a window', () => {
    expect(classify(blk({ kind: 'figure', text: '' }))).toBe('fig');
  });
});

describe('groupOf', () => {
  it('groups kinds as the template does', () => {
    expect(groupOf('h')).toBe('h');
    expect(groupOf('p')).toBe('body');
    expect(groupOf('l')).toBe('body');
    expect(groupOf('math')).toBe('body');
    expect(groupOf('label')).toBe('small');
    expect(groupOf('row')).toBe('row');
    expect(groupOf('table')).toBe('row');
    expect(groupOf('fig')).toBe('fig');
    expect(groupOf('window')).toBe('fig');
  });
});

describe('classify.ts source', () => {
  it('names private-use characters by escape, never as invisible literals', () => {
    const src = readFileSync(join(process.cwd(), 'src/features/spaces/components/reader/layout/classify.ts'), 'utf8');
    expect(src).not.toMatch(/[\uE000-\uF8FF]/);
    expect(src).toContain('\\uE000-\\uF8FF');
  });
});
