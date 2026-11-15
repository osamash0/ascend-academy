import { describe, expect, it } from 'vitest';
import { bcnfSteps, closureOf, closureSteps, fdText, violations, type FD } from '../answers/fd';

const fd = (l: string, r: string): FD => ({ lhs: l.split(' '), rhs: r.split(' ') });

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

describe('fd engine on the sample deck’s examples', () => {
  it('Product → Name holds on the order lines until a name changes (page 8)', () => {
    const cols = ['Product', 'Name'];
    const rows = [['P7', 'Desk lamp'], ['P7', 'Desk lamp'], ['P2', 'Notebook']];
    expect(violations(cols, rows, fd('Product', 'Name'))).toEqual([]);
    rows[1][1] = 'Reading lamp';
    expect(violations(cols, rows, fd('Product', 'Name'))).toEqual([[0, 1]]);
  });
  it('Y → X fails where one Y value has several X values', () => {
    const cols = ['X', 'Y', 'Z'];
    const rows = [['a1', 'b1', 'c1'], ['a2', 'b1', 'c1'], ['a3', 'b2', 'c1'], ['a4', 'b1', 'c1']];
    expect(violations(cols, rows, fd('X', 'Y'))).toEqual([]);
    expect(violations(cols, rows, fd('Y', 'X')).length).toBe(3);
  });
  it('the closure of {order, product} reaches every attribute', () => {
    const fds = [fd('order product', 'quantity'), fd('product', 'productName'), fd('order', 'customer'), fd('customer', 'city')];
    const steps = closureSteps(['order', 'product'], fds);
    expect(steps[steps.length - 1].after.sort()).toEqual(['city', 'customer', 'order', 'product', 'productName', 'quantity'].sort());
    expect(fdText(fds[1])).toBe('product → productName');
  });
});
