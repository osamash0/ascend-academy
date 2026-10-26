import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import SpaceMemberGate from '../../screens/SpaceMemberGate';
import { setLiveWorld } from '../../data/world';
import type { Lesson, Space } from '../../types';
import { emptyWorld } from '../../__tests__/emptyWorld';

/*
 * LS-045, from the 2026-10-24 UX review. A classmate's link to a Lesson in a
 * Space you have not joined said "That Lesson isn't here — the link may be
 * wrong" (the reader said "the connection dropped"), with no way in. It now
 * shows the Space, names the Lesson, and offers Join; members see the Lesson.
 */

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const LESSON = '6d2b028b-e4a7-4b95-9627-a8a06f533387';
const OTHER = '126bb3c8-6f69-4184-9ceb-9ccbfd4b3609';

const space = (viewerRole: Space['viewerRole']): Space =>
  ({
    id: SPACE,
    name: 'Datenbanksysteme',
    shortCode: 'DBS',
    description: null,
    owner: { id: 'p', name: 'Professor', avatarUrl: null },
    universe: null,
    classification: { domain: '', subject: null },
    mode: 'guided',
    visibility: 'public',
    state: 'active',
    groundingEnabled: false,
    strictMode: false,
    memberCount: 127,
    starCount: 0,
    starredByViewer: false,
    viewerRole,
    viewerProgress: 0,
    lessonCount: 2,
    lessonsDone: 0,
    newSinceLastVisit: 0,
    lastActiveAt: '2026-10-24T00:00:00Z',
  }) as unknown as Space;

const lesson = (id: string, title: string, order: number): Lesson =>
  ({
    id,
    spaceId: SPACE,
    title,
    order,
    state: 'published',
    origin: 'official',
    author: { id: 'p', name: 'Professor', avatarUrl: null },
    grounding: null,
    progress: 'not-started',
    percentComplete: 0,
    concepts: [],
    material: null,
    contributionCount: 0,
    practiceCount: 0,
  }) as unknown as Lesson;

const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/v4/space/:spaceId/lesson/:lessonId/faces"
          element={
            <SpaceMemberGate>
              <p>the reader</p>
            </SpaceMemberGate>
          }
        />
        <Route
          path="/v4/space/:spaceId/concept/:conceptId"
          element={
            <SpaceMemberGate>
              <p>the concept</p>
            </SpaceMemberGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const world = (role: Space['viewerRole']) =>
  emptyWorld({ spaces: [space(role)], lessons: [lesson(LESSON, 'Introduction', 1), lesson(OTHER, 'Basics', 2)] });

beforeEach(async () => {
  vi.stubEnv('VITE_V4_DATA_MODE', 'live');
  await i18n.changeLanguage('en');
});
afterEach(() => {
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

describe('LS-045: a shared Lesson link to a Space you have not joined', () => {
  it('shows the Space, names the Lesson the link was for, and offers Join', async () => {
    setLiveWorld(world(null));
    mount(`/v4/space/${SPACE}/lesson/${LESSON}/faces?page=3`);
    expect(await screen.findByRole('heading', { name: 'Datenbanksysteme' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Join to open Introduction.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument();
    expect(screen.getByText('Introduction').closest('li')).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByText('the reader')).not.toBeInTheDocument();
    expect(screen.queryByText(/isn.t here|connection dropped/i)).not.toBeInTheDocument();
  });

  it('a concept link offers Join too, without naming a Lesson', async () => {
    setLiveWorld(world(null));
    mount(`/v4/space/${SPACE}/concept/c-1`);
    expect(await screen.findByRole('button', { name: 'Join' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/Join to open/)).not.toBeInTheDocument();
  });

  it('says it in German', async () => {
    await i18n.changeLanguage('de');
    setLiveWorld(world(null));
    mount(`/v4/space/${SPACE}/lesson/${LESSON}/faces`);
    expect(await screen.findByText('Tritt bei, um Introduction zu öffnen.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/127/).parentElement?.textContent).toContain('127 Mitglieder');
  });

  it('a member gets the Lesson itself', () => {
    setLiveWorld(world('member'));
    mount(`/v4/space/${SPACE}/lesson/${LESSON}/faces?page=3`);
    expect(screen.getByText('the reader')).toBeInTheDocument();
  });

  it('a Space the viewer cannot see falls through to the screen', () => {
    setLiveWorld(emptyWorld());
    mount(`/v4/space/${SPACE}/lesson/${LESSON}/faces`);
    expect(screen.getByText('the reader')).toBeInTheDocument();
  });
});
