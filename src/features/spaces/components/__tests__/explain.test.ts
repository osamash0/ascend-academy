import { describe, expect, it } from 'vitest';
import { bcnfSteps, closureOf, closureSteps, violations, type FD } from '../reader/iui/fd';
import { beatsFromMarkdown } from '../reader/beats';
import { composeFromText, explainFor } from '../../mocks/explain';

const fd = (lhs: string, rhs: string): FD => ({ lhs: lhs.split(' '), rhs: rhs.split(' ') });

describe('the FD engine computes what the tools show', () => {
  it('finds the two rows against a dependency, and none for one that holds', () => {
    const cols = ['Title', 'Year', 'Length'];
    const rows = [
      ['Total Recall', '1990', '113'],
      ['Dead Man', '1995', '121'],
      ['Total Recall', '2012', '118'],
    ];
    expect(violations(cols, rows, fd('Title', 'Length'))).toEqual([[0, 2]]);
    expect(violations(cols, rows, fd('Title Year', 'Length'))).toEqual([]);
  });

  it('computes the textbook closure, one fired FD per step', () => {
    const fds = [fd('A B', 'C'), fd('B C', 'A D'), fd('D', 'E'), fd('C F', 'B')];
    expect(closureOf(['A', 'B'], fds).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    const steps = closureSteps(['A', 'B'], fds);
    expect(steps.map((s) => s.added)).toEqual([['A', 'B'], ['C'], ['D'], ['E']]);
  });

  it('decomposes MovieStudio into the textbook BCNF relations', () => {
    const steps = bcnfSteps(
      { name: 'MovieStudio', attrs: ['title', 'year', 'studioName', 'president', 'presAddr'] },
      [fd('title year', 'studioName'), fd('studioName', 'president'), fd('president', 'presAddr')],
    );
    const last = steps[steps.length - 1].relations.map((r) => [...r.attrs].sort().join(','));
    expect(last.sort()).toEqual(['presAddr,president', 'president,studioName', 'studioName,title,year']);
  });
});

describe('a page’s points', () => {
  it('takes top-level items and leaves sub-items to the text', () => {
    const beats = beatsFromMarkdown('- Requirement Analysis\n  - Informal description\n- Logical Design\n  - Relation schemas');
    expect(beats.map((b) => b.text)).toEqual(['Requirement Analysis', 'Logical Design']);
  });

  it('splits prose into sentences and shortens long labels', () => {
    const beats = beatsFromMarkdown('A functional dependency is a promise about the data. It says rows agree.');
    expect(beats).toHaveLength(2);
    expect(beats[0].label.endsWith('…')).toBe(true);
  });
});

describe('Explain always has something to say', () => {
  it('uses the authored answer where there is one', () => {
    expect(explainFor('l-s-dbs-4', 34, { title: '', markdown: '' }).blocks.some((b) => b.type === 'closure')).toBe(true);
  });

  it('composes one from the text anywhere else', () => {
    const a = composeFromText('Motivation', '- Avoid redundancy\n- Split schemas');
    expect(a.blocks[0].type).toBe('explore');
    expect(explainFor('another-lesson', 2, { title: 'X', markdown: 'Just one line.' }).blocks[0].type).toBe('text');
  });
});
