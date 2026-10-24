import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import SpaceRoute from '../../screens/SpaceRoute';
import LessonScreen from '../../screens/LessonScreen';
import { resumeItem } from '../../data/useSpaces';

/*
 * LS-006 and LS-007, from the 2026-10-24 readiness walk.
 *
 * - The lesson button said "Continue" (Weiterlesen) on a Lesson with no
 *   material and no text, then opened an idea page with nothing to read.
 *   Its words now follow where it goes.
 * - Home said continue Basics while Database Systems said continue
 *   Introduction. The Space now asks the same "where was I?" as Home.
 */

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('LS-006: the lesson button says where it goes', () => {
  it('a Lesson with ideas but nothing to read offers the ideas, not reading', async () => {
    render(
      <MemoryRouter initialEntries={['/v4/space/s-dbs/lesson/l-s-dbs-1']}>
        <Routes>
          <Route path="/v4/space/:spaceId/lesson/:lessonId" element={<LessonScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'See the ideas' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });
});

describe('LS-007: Home and the Space agree on where you left off', () => {
  it('the Space continues the Lesson Home continues, when it is in this Space', async () => {
    const resume = resumeItem();
    expect(resume, 'the demo has somewhere to continue').not.toBeNull();
    render(
      <MemoryRouter initialEntries={[`/v4/space/${resume!.spaceId}`]}>
        <Routes>
          <Route path="/v4/space/:spaceId" element={<SpaceRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: new RegExp(`^Continue: ${resume!.lessonTitle}`) }, { timeout: 4000 });
    expect(link.getAttribute('href')).toContain(resume!.lessonId);
  });
});
