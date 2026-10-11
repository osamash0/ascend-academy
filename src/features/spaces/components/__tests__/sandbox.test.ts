import { describe, expect, it } from 'vitest';
import { buildSrcDoc } from '../reader/iui/Sandbox';

/*
 * A generated app runs in `sandbox="allow-scripts"` (no same-origin) under a
 * CSP with no network. These pin the half of that which lives in the page we
 * build: a change that loosened either would otherwise pass unnoticed.
 */
describe('a generated app is built to stay in its box', () => {
  const doc = buildSrcDoc({ html: '<div id="a"></div>', css: '.x{}', js: 'document.getElementById("a").textContent = 1' }, '#123456');

  it('declares a CSP with no network and no outside code', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(doc)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/connect-src|https?:|\*/);
    expect(csp).toContain("script-src 'unsafe-inline'");
  });

  it('cannot be closed early by the code it carries', () => {
    const hostile = buildSrcDoc({ html: '', css: '</style><script>x()</script>', js: 'const s = "</script><img src=x>";' }, '#fff');
    // The app's own script stays one script: its `</script>` is escaped…
    expect(hostile).toContain('<\\/script><img src=x>');
    // …and its css cannot end the style element it sits in.
    expect(hostile).not.toContain('</style><script>x()');
  });

  it('keeps the accent a colour, not a way into the stylesheet', () => {
    const d = buildSrcDoc({ html: '', css: '', js: '' }, 'red;}</style><script>alert(1)</script>');
    expect(d).not.toContain('<script>alert(1)');
  });
});
