import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SpacesHubScreen from '../../screens/SpacesHubScreen';
import { jumpBackIn, popularNow, worthALook } from '../../mocks/hub';
import { visibleSpaces } from '../../mocks/spaces';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Discover is a scope for the page, not a section inside it.
 *
 * The hub's stated order is *chip row selects → hero reacts → rails discover*,
 * and the rails were the part that never reacted. Selecting Discover changed
 * the hero copy and the cover art while "Jump back in" carried on listing the
 * Spaces you are already in — so the one chip whose whole purpose is "show me
 * something I am not in" left the page showing what you were in. Its single
 * action was a link to `/v4/spaces-legacy`, the screen this hub replaced.
 */

const renderHub = async () => {
  const r = render(
    <MemoryRouter>
      <SpacesHubScreen />
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelector('[data-chip="discover"]')).toBeTruthy(), {
    timeout: 3000,
  });
  return r;
};

const railTitles = () => [...document.querySelectorAll('h3')].map((h) => h.textContent?.trim());

const selectDiscover = async () => {
  fireEvent.click(document.querySelector('[data-chip="discover"]')!);
  // The rails follow `shown`, which lags the selection by one 180ms beat.
  await waitFor(() => expect(railTitles()).toContain('Worth a look'), { timeout: 3000 });
};

describe('what Discover holds', () => {
  it('offers only Spaces you are not in', () => {
    const offered = worthALook();
    expect(offered.length, 'nothing discoverable — these guards would be vacuous')
      .toBeGreaterThan(0);
    for (const s of offered) {
      expect(s.viewerRole, `${s.name} is already yours and is offered as new`).toBeNull();
    }
  });

  it('keeps private Spaces out, and invite-only in', () => {
    /*
     * The three-value `Visibility` exists to draw exactly this line: `invite`
     * is discoverable and asks for a request, `private` is not discoverable at
     * all. Both halves asserted, because dropping `invite` would quietly make
     * the card's lock badge unreachable — the same defect `popularNow`'s
     * comment records.
     */
    for (const s of worthALook()) expect(s.visibility).not.toBe('private');

    const invitable = visibleSpaces().filter(
      (s) => s.viewerRole === null && s.visibility === 'invite' && s.state === 'active',
    );
    expect(invitable.length, 'no invite-only Space to discover — the lock badge is unreachable')
      .toBeGreaterThan(0);
    for (const s of invitable) {
      expect(
        worthALook().some((x) => x.id === s.id),
        `${s.name} asks for a request and is not offered anywhere`,
      ).toBe(true);
    }
  });

  it('ranks by stars, the signal Doc 1 gives for Spaces', () => {
    const stars = worthALook().map((s) => s.starCount);
    expect([...stars].sort((a, b) => b - a)).toEqual(stars);
  });

  it('is a different set from the rails it replaces', () => {
    // If Discover showed the same thing, selecting it would still be a no-op.
    const discover = worthALook().map((s) => s.id).sort();
    const normal = popularNow().map((s) => s.id).sort();
    expect(discover, 'Discover shows exactly what "Popular right now" already showed')
      .not.toEqual(normal);
  });
});

describe('selecting Discover changes the rails', () => {
  it('shows your Spaces before it is selected', async () => {
    const { unmount } = await renderHub();
    expect(jumpBackIn().length, 'no Spaces to jump back into — vacuous').toBeGreaterThan(0);
    await waitFor(() => expect(railTitles()).toContain('Jump back in'));
    expect(railTitles()).toContain('Popular right now');
    expect(railTitles(), 'Discover content is showing before Discover is chosen').not.toContain(
      'Worth a look',
    );
    unmount();
  });

  it('drops "Jump back in" and swaps the rail when it is', async () => {
    const { unmount } = await renderHub();
    await selectDiscover();
    expect(
      railTitles(),
      '"Jump back in" is your Spaces — the one thing Discover is not',
    ).not.toContain('Jump back in');
    expect(railTitles()).not.toContain('Popular right now');
    expect(railTitles()).toContain('Worth a look');
    unmount();
  });

  it('renders a card for every discoverable Space', async () => {
    const { unmount } = await renderHub();
    await selectDiscover();
    const rail = [...document.querySelectorAll('section')].find((s) =>
      /Worth a look/.test(s.querySelector('h3')?.textContent ?? ''),
    );
    expect(rail, 'the rail is not on the page').toBeTruthy();
    const cards = rail!.querySelectorAll('a[href^="/v4/space/"]');
    expect(cards.length).toBe(worthALook().length);
    unmount();
  });
});

describe('the hero tells the truth about Discover', () => {
  it('counts what the rail actually holds', async () => {
    /*
     * This read `popular.length` and called them "public Spaces" —
     * `popularNow` includes invite-only Spaces *and* ones you are already in,
     * so the number was wrong twice over on the one line whose job is to say
     * how much there is to look at.
     */
    const { unmount } = await renderHub();
    await selectDiscover();
    const expected = worthALook().length;
    const meta = [...document.querySelectorAll('p')]
      .map((p) => p.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .find((t) => /you have not joined/.test(t));
    expect(meta, 'the hero says nothing about how much there is').toBeTruthy();
    expect(meta, `the count disagrees with the ${expected} cards below it`).toContain(
      String(expected),
    );
    unmount();
  });

  it('does not claim anything is curated', () => {
    /*
     * "curated weekly" was stated on the hero, and nothing curates anything.
     *
     * Comments stripped first. The first version matched the raw file and
     * failed on the comment *explaining* the removal — `modes.test.tsx` records
     * the same lesson in its own words: "a rule that fires on the prose
     * explaining it is a rule people switch off."
     */
    const src = readFileSync(
      join(process.cwd(), 'src/features/spaces/screens/SpacesHubScreen.tsx'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src, 'the hero claims something is curated').not.toMatch(/curated/i);
  });

  it('keeps its one action on this page', async () => {
    /*
     * The action was a Link to `/v4/spaces-legacy` — so the only thing you
     * could do on Discover was leave the hub for the screen it replaced. The
     * content is the rails below the fold, so the button belongs here.
     */
    const { unmount } = await renderHub();
    await selectDiscover();
    const legacy = [...document.querySelectorAll('a')]
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.includes('spaces-legacy'));
    expect(legacy, 'Discover still walks you out to the legacy screen').toEqual([]);
    expect(
      [...document.querySelectorAll('button')].some((b) => /Browse Spaces/.test(b.textContent ?? '')),
      'Discover has no action of its own',
    ).toBe(true);
    unmount();
  });
});
