import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from '@/i18n';
import { setLiveWorld } from '../../data/world';
import type { Lesson, Space } from '../../types';
import { emptyWorld } from '../../__tests__/emptyWorld';

/*
 * LS-050, from the 2026-10-24 UX review: one app for students.
 * - Old /lecture/:id links find their Lesson's Space on the stage.
 * - "New Space" makes the Space on the stage instead of in the old console.
 * - A Space with nothing in it says so, and its owner gets a way to add Lessons.
 */

const { createSpace, useCourseMock } = vi.hoisted(() => ({ createSpace: vi.fn(), useCourseMock: vi.fn() }));

vi.mock('../../data/liveRepository', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data/liveRepository')>();
  return { ...real, loadLiveRepository: async () => ({ createSpace }) };
});
vi.mock('../../data/useReader', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data/useReader')>();
  return { ...real, useCourse: (id: string) => useCourseMock(id) };
});

import LessonLinkRoute from '../../screens/LessonLinkRoute';
import { NewSpaceDialog } from '../SpaceDialogs';
import CourseScreen from '../../screens/CourseScreen';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const LESSON = '6d2b028b-e4a7-4b95-9627-a8a06f533387';

const space = (viewerRole: Space['viewerRole']) =>
  ({ id: SPACE, name: 'Lerngruppe', owner: { id: 'u', name: 'Lea', avatarUrl: null }, viewerRole, state: 'active', visibility: 'public', memberCount: 1 }) as unknown as Space;
const lesson = { id: LESSON, spaceId: SPACE, title: 'Introduction', order: 1, state: 'published' } as unknown as Lesson;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  createSpace.mockReset();
  useCourseMock.mockReset();
});
afterEach(() => {
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

describe('an old lecture link, on the stage', () => {
  const mount = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/v4/lesson/:lessonId" element={<LessonLinkRoute />} />
          <Route path="/v4/space/:spaceId/lesson/:lessonId" element={<p>the lesson</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('goes to the Lesson under its Space, keeping the page', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('member')], lessons: [lesson] }));
    mount(`/v4/lesson/${LESSON}?page=3`);
    expect(await screen.findByText('the lesson')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe(`/v4/space/${SPACE}/lesson/${LESSON}?page=3`);
  });

  it('a Lesson the viewer cannot see says so on the stage, with a way home', async () => {
    setLiveWorld(emptyWorld());
    mount(`/v4/lesson/${LESSON}`);
    expect(await screen.findByText('That screen isn’t here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/v4/home');
  });
});

describe('New Space, live: made on the stage', () => {
  const mount = () =>
    render(
      <MemoryRouter initialEntries={['/v4/spaces']}>
        <Where />
        <Routes>
          <Route path="/v4/spaces" element={<NewSpaceDialog open onOpenChange={() => {}} />} />
          <Route path="/v4/space/:spaceId" element={<p>the new space</p>} />
        </Routes>
      </MemoryRouter>,
    );

  beforeEach(() => vi.stubEnv('VITE_V4_DATA_MODE', 'live'));

  it('asks only for a name, says it starts private, and lands on the new Space', async () => {
    createSpace.mockResolvedValue({ id: 'new-id' });
    const user = userEvent.setup();
    mount();
    expect(screen.getByText('It starts private: only you can see it.')).toBeInTheDocument();
    expect(screen.queryByText(/change any of this later/)).not.toBeInTheDocument();
    expect(screen.queryByText('Who can publish Lessons')).not.toBeInTheDocument();
    expect(screen.queryByText('Who can see it')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), '  Lerngruppe DBS  ');
    await user.click(screen.getByRole('button', { name: /create and open it/i }));
    await waitFor(() => expect(createSpace).toHaveBeenCalledWith('Lerngruppe DBS'));
    expect(await screen.findByText('the new space')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/v4/space/new-id');
  });

  it('if making it fails it says so and stays', async () => {
    createSpace.mockRejectedValue(new Error('500'));
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Name'), 'Lerngruppe');
    await user.click(screen.getByRole('button', { name: /create and open it/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t make it just now');
    expect(screen.getByTestId('where').textContent).toBe('/v4/spaces');
  });
});

describe('a Space with nothing in it', () => {
  const mount = () =>
    render(
      <MemoryRouter initialEntries={[`/v4/space/${SPACE}`]}>
        <Routes>
          <Route path="/v4/space/:spaceId" element={<CourseScreen courseId={SPACE} />} />
        </Routes>
      </MemoryRouter>,
    );

  beforeEach(() => {
    useCourseMock.mockReturnValue({ state: 'ready', course: { id: SPACE, title: 'Lerngruppe', author: null, lectures: [] } });
  });

  it('tells its owner it is private for now, and offers Add Lessons', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('owner')] }));
    mount();
    expect(await screen.findByRole('heading', { name: 'Lerngruppe' })).toBeInTheDocument();
    expect(screen.getByText('Nothing inside yet. Only you can see this Space for now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add Lessons' })).toHaveAttribute('href', `/professor/courses/${SPACE}`);
    expect(screen.queryByText('Rehearse for the exam')).not.toBeInTheDocument();
  });

  it('a member sees that it is empty, with no owner action', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('member')] }));
    mount();
    expect(await screen.findByText('Nothing inside yet. Lessons show up here once they are added.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add Lessons' })).not.toBeInTheDocument();
  });
});
