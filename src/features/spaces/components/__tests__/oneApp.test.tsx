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

const { createSpace, useCourseMock, setSpacePublished, addLessonsApi, lessonBatch, refresh } = vi.hoisted(() => ({
  createSpace: vi.fn(),
  useCourseMock: vi.fn(),
  setSpacePublished: vi.fn(),
  addLessonsApi: vi.fn(),
  lessonBatch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../data/liveRepository', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data/liveRepository')>();
  return {
    ...real,
    loadLiveRepository: async () => ({ createSpace, setSpacePublished, addLessons: addLessonsApi, lessonBatch }),
  };
});
vi.mock('../../data/viewer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data/viewer')>();
  return { ...real, useRefreshWorld: () => refresh };
});
vi.mock('../../data/useReader', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data/useReader')>();
  return { ...real, useCourse: (id: string) => useCourseMock(id) };
});

import LessonLinkRoute from '../../screens/LessonLinkRoute';
import { NewSpaceDialog } from '../SpaceDialogs';
import CourseScreen from '../../screens/CourseScreen';
import { POLL_MS, resetPendingLessons } from '../../data/lessonUploads';
import { act, fireEvent } from '@testing-library/react';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const LESSON = '6d2b028b-e4a7-4b95-9627-a8a06f533387';

const space = (viewerRole: Space['viewerRole'], visibility: 'public' | 'private' = 'public') =>
  ({ id: SPACE, name: 'Lerngruppe', owner: { id: 'u', name: 'Lea', avatarUrl: null }, viewerRole, state: 'active', visibility, memberCount: 1 }) as unknown as Space;
const lesson = { id: LESSON, spaceId: SPACE, title: 'Introduction', order: 1, state: 'published' } as unknown as Lesson;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  createSpace.mockReset();
  useCourseMock.mockReset();
  setSpacePublished.mockReset();
  addLessonsApi.mockReset();
  lessonBatch.mockReset();
  refresh.mockReset().mockResolvedValue(undefined);
  resetPendingLessons();
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

const mountCourse = () =>
  render(
    <MemoryRouter initialEntries={[`/v4/space/${SPACE}`]}>
      <Routes>
        <Route path="/v4/space/:spaceId" element={<CourseScreen courseId={SPACE} />} />
      </Routes>
    </MemoryRouter>,
  );
const emptyCourse = { state: 'ready', course: { id: SPACE, title: 'Lerngruppe', author: null, lectures: [] } };

describe('a Space with nothing in it', () => {
  beforeEach(() => useCourseMock.mockReturnValue(emptyCourse));

  it('its owner sees a private draft, Add a Lesson as the one white action, and the manager', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'private')] }));
    mountCourse();
    expect(await screen.findByRole('heading', { name: 'Lerngruppe' })).toBeInTheDocument();
    expect(screen.getByText('Nothing inside yet.')).toBeInTheDocument();
    expect(screen.getByText('Private draft · only you can see it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a Lesson' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Make it visible' })).toBeDisabled();
    expect(screen.getByText('Add a Lesson first, then you can make it visible.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /more in the course manager/i })).toHaveAttribute('href', `/professor/courses/${SPACE}`);
    expect(screen.queryByText('Rehearse for the exam')).not.toBeInTheDocument();
  });

  it('a member sees that it is empty, with no owner controls', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('member')] }));
    mountCourse();
    expect(await screen.findByText('Nothing inside yet. Lessons show up here once they are added.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a Lesson' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your Space' })).not.toBeInTheDocument();
  });
});

describe('LS-072: the owner on the stage', () => {
  it('adds a Lesson: sends the file to this Space, shows it being prepared, reloads when ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useCourseMock.mockReturnValue(emptyCourse);
      setLiveWorld(emptyWorld({ spaces: [space('owner', 'private')] }));
      addLessonsApi.mockResolvedValue({ batch_id: 'b1', files: [{ filename: 'intro.pdf', run_id: 'r1', status: 'queued' }] });
      lessonBatch.mockResolvedValue({ batch_id: 'b1', lectures: [{ run_id: 'r1', status: 'running', error: null, filename: 'intro.pdf', lecture_id: null, title: null }] });
      mountCourse();
      await screen.findByRole('button', { name: 'Add a Lesson' });
      const file = new File(['%PDF-1.4'], 'intro.pdf', { type: 'application/pdf' });
      const input = document.querySelector('input[type=file]') as HTMLInputElement;
      expect(input.accept).toContain('.pdf');
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });
      await waitFor(() => expect(addLessonsApi).toHaveBeenCalledWith(SPACE, [file]));
      expect(await screen.findByText('intro.pdf')).toBeInTheDocument();
      expect(screen.getByText('Being prepared…')).toBeInTheDocument();

      // Still running on the first look: nothing reloads.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS + 10);
      });
      expect(refresh).not.toHaveBeenCalled();

      // Done on the next: the page reloads and the row goes.
      lessonBatch.mockResolvedValue({ batch_id: 'b1', lectures: [{ run_id: 'r1', status: 'completed', error: null, filename: 'intro.pdf', lecture_id: 'l9', title: 'Intro' }] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS + 10);
      });
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByText('Being prepared…')).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('a file that fails says so in its row, in words, and can be dismissed', async () => {
    useCourseMock.mockReturnValue(emptyCourse);
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'private')] }));
    addLessonsApi.mockResolvedValue({ batch_id: 'b2', files: [{ filename: 'broken.pdf', run_id: null, status: 'failed', error: 'Failed to queue this file for parsing.' }] });
    mountCourse();
    await screen.findByRole('button', { name: 'Add a Lesson' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'broken.pdf')] } });
    });
    expect(await screen.findByText('Couldn’t be added. Try another file, or try again later.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to queue/)).not.toBeInTheDocument(); // the server's English stays out
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss broken.pdf' }));
    await waitFor(() => expect(screen.queryByText('broken.pdf')).not.toBeInTheDocument());
  });

  it('publishes a Space with Lessons, then can make it private again', async () => {
    useCourseMock.mockReturnValue({
      state: 'ready',
      course: { id: SPACE, title: 'Lerngruppe', author: null, lectures: [{ id: 'l1', title: 'Intro', total_slides: 3, ideas: [] }] },
    });
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'private')] }));
    setSpacePublished.mockResolvedValue({ published: true });
    mountCourse();
    const make = await screen.findByRole('button', { name: 'Make it visible' });
    expect(make).toBeEnabled();
    fireEvent.click(make);
    await waitFor(() => expect(setSpacePublished).toHaveBeenCalledWith(SPACE, true));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('a published Space says who can see it and offers Make it private', async () => {
    useCourseMock.mockReturnValue({
      state: 'ready',
      course: { id: SPACE, title: 'Lerngruppe', author: null, lectures: [{ id: 'l1', title: 'Intro', total_slides: 3, ideas: [] }] },
    });
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'public')] }));
    mountCourse();
    expect(await screen.findByText('Visible to everyone · anyone can find and join it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make it private' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add a Lesson' })).toBeInTheDocument();
  });

  it('if publishing fails it says so and nothing changes', async () => {
    useCourseMock.mockReturnValue({
      state: 'ready',
      course: { id: SPACE, title: 'Lerngruppe', author: null, lectures: [{ id: 'l1', title: 'Intro', total_slides: 3, ideas: [] }] },
    });
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'private')] }));
    setSpacePublished.mockRejectedValue(new Error('500'));
    mountCourse();
    fireEvent.click(await screen.findByRole('button', { name: 'Make it visible' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change that just now');
    expect(refresh).not.toHaveBeenCalled();
  });
});
