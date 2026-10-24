import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/*
 * `?new=1` opens the create dialog straight away (v4's New Space hands off
 * here), then drops the flag so Back or a reload does not open it again.
 */

vi.mock('@/services/coursesService', () => ({
  listCourses: vi.fn(async () => []),
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  deleteCourse: vi.fn(),
  archiveCourse: vi.fn(),
  unarchiveCourse: vi.fn(),
}));

import ProfessorCourses from '@/pages/ProfessorCourses';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/professor/courses"
          element={
            <>
              <ProfessorCourses />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe('courses page ?new=1', () => {
  it('opens the create dialog and removes the flag', async () => {
    mount('/professor/courses?new=1');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/professor\/courses$/);
  });

  it('without it, no dialog opens', async () => {
    mount('/professor/courses');
    await screen.findByTestId('where');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
