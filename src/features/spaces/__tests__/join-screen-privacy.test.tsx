import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { setLiveWorld } from '../data/world';
import JoinSpaceScreen from '../screens/JoinSpaceScreen';
import type { Lesson, Space } from '../types';
import { emptyWorld } from './emptyWorld';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const LESSON = '6d2b028b-e4a7-4b95-9627-a8a06f533387';

const space = {
  id: SPACE,
  name: 'Lerngruppe',
  description: null,
  owner: { id: 'u2', name: 'Lea', avatarUrl: null },
  viewerRole: null,
  state: 'active',
  visibility: 'public',
  memberCount: 3,
} as unknown as Space;
const lesson = { id: LESSON, spaceId: SPACE, title: 'Introduction', order: 1, state: 'published' } as unknown as Lesson;

describe('the join screen says what owners can see', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(() => {
    setLiveWorld(null);
  });

  it('shows the line to someone who has not joined yet', async () => {
    setLiveWorld(emptyWorld({ spaces: [space], lessons: [lesson] }));
    render(
      <MemoryRouter>
        <JoinSpaceScreen spaceId={SPACE} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('The people who run this Space can see how its pages are read, never your name.'),
    ).toBeInTheDocument();
  });
});
