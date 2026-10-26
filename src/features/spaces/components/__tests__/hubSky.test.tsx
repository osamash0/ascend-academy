import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import SpacesHubScreen from '../../screens/SpacesHubScreen';
import { myHubSpaces } from '../../data/hub';
import { SURFACES } from '../Scene';

/**
 * The hub as a night sky (Abi, 2026-10-26).
 *
 * The hashed cover gradients washed the page in a colour per Space ("moss"
 * green behind a database course) and broke the monochrome stage. These
 * guards keep them gone and check what replaced them: a planet per Space on
 * the same black stage as every other room.
 */

/** The old cover palette's signature stops — any of these back on the page is the gradient returning. */
const OLD_COVER_HEXES = ['#a3adb8', '#e0713a', '#3fae72', '#9ccf3f', '#5f7f9e', '#d8a53f', '#d84f6e', '#3fb8d8', '#32384a'];

const renderHub = async () => {
  await i18n.changeLanguage('en');
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

describe('the hub stands on the black stage', () => {
  it('uses the stage surface, like the other rooms', () => {
    expect(SURFACES.spaces).toBe('stage');
  });

  it('paints no cover gradient anywhere', async () => {
    const { container, unmount } = await renderHub();
    const styleOf = (root: ParentNode) =>
      [...root.querySelectorAll<HTMLElement>('[style]')].map((el) => el.getAttribute('style') ?? '');
    // The old palette, anywhere on the page.
    for (const style of styleOf(container)) {
      for (const hex of OLD_COVER_HEXES) expect(style.toLowerCase()).not.toContain(hex);
    }
    // And no painted gradient in the hub's own layer. (The stage's black sits
    // over Scene's shared wallpaper, which is Scene's, not the hub's.)
    const hub = container.querySelector('[data-hub]');
    expect(hub, 'the hub layer is not on the page').toBeTruthy();
    for (const style of styleOf(hub!)) {
      expect(style, 'a gradient is painted on the hub').not.toMatch(/(radial|linear)-gradient/);
    }
    unmount();
  });

  it('draws a sky behind it', async () => {
    const { unmount } = await renderHub();
    expect(document.querySelector('[data-starfield="spaces-hub"]')).toBeTruthy();
    unmount();
  });
});

describe('your Spaces are planets', () => {
  it('gives every Space in the row its own planet, and Discover a star cluster', async () => {
    const { unmount } = await renderHub();
    for (const s of myHubSpaces()) {
      const chip = document.querySelector(`[data-chip="${s.id}"]`);
      expect(chip, `${s.id} has no entry in the row`).toBeTruthy();
      expect(chip!.querySelector(`[data-planet="${s.id}"]`), `${s.id} has no planet`).toBeTruthy();
    }
    expect(document.querySelector('[data-chip="discover"] [data-star-cluster]')).toBeTruthy();
    unmount();
  });

  it('counts nothing in the row: no Lesson counts, no progress numbers', async () => {
    const { unmount } = await renderHub();
    for (const chip of document.querySelectorAll('[data-chip]')) {
      expect(chip.textContent ?? '').not.toMatch(/\d+\s*(Lessons?|%)|\d+\s*\/\s*\d+/);
    }
    unmount();
  });

  it('shows the selected Space as the hero planet', async () => {
    const { unmount } = await renderHub();
    const selected = document.querySelector('[role="option"][aria-selected="true"]')!;
    const id = selected.getAttribute('data-chip');
    expect(document.querySelector(`[data-hero-art] [data-planet="${id}"]`)).toBeTruthy();
    unmount();
  });
});

describe('"Last opened" is said only when it is true', () => {
  it('labels the Space you were most recently in, and no other', async () => {
    const { unmount } = await renderHub();
    const mine = myHubSpaces();
    expect(mine.length, 'need two Spaces to tell the label apart').toBeGreaterThan(1);
    const latest = [...mine].sort((a, b) => +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt))[0];
    const other = mine.find((s) => s.id !== latest.id)!;

    fireEvent.click(document.querySelector(`[data-chip="${latest.id}"]`)!);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(latest.name), {
      timeout: 3000,
    });
    expect(screen.getByText('Last opened')).toBeTruthy();

    fireEvent.click(document.querySelector(`[data-chip="${other.id}"]`)!);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(other.name), {
      timeout: 3000,
    });
    expect(screen.queryByText('Last opened')).toBeNull();
    unmount();
  });
});
