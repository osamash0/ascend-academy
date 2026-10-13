import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CourseMap } from '../course/CourseMap';

const LECTURES = [
  { id: 'a', title: 'Basics', total_slides: 20, ideas: [{ name: 'Keys', first_page: 1 }] },
  {
    id: 'b',
    title: 'Normalization',
    total_slides: 60,
    ideas: [
      { name: 'FDs', first_page: 1 },
      { name: 'Closure', first_page: 31 },
      { name: 'BCNF', first_page: 41 },
    ],
  },
];
const link = (fl: string, fp: number, tl: string, tp: number) => ({ from: { lecture_id: fl, first_page: fp }, to: { lecture_id: tl, first_page: tp }, why: '' });
const LINKS = [link('a', 1, 'b', 1), link('b', 1, 'b', 31), link('b', 31, 'b', 41)];
// Closure was missed; BCNF too.
const MARKS = [
  { lecture_id: 'b', page: 33, correct: false },
  { lecture_id: 'b', page: 45, correct: false },
];

const renderMap = () =>
  render(
    <MemoryRouter initialEntries={['/course']}>
      <Routes>
        <Route
          path="/course"
          element={<CourseMap lectures={LECTURES} marks={MARKS} links={LINKS} linksState="ready" readHref={(l, p) => `/read/${l}/${p}`} />}
        />
        <Route path="/read/:l/:p" element={<p>reader</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('the course map', () => {
  it('draws every idea as a star you can reach', () => {
    renderMap();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'BCNF, Normalization, to revisit' })).toBeInTheDocument();
  });

  it('pointing at a stuck idea says what it builds on and where to start', async () => {
    renderMap();
    fireEvent.focus(screen.getByRole('link', { name: /^BCNF/ }));
    expect(await screen.findByText(/Builds on/)).toHaveTextContent('Builds on Closure');
    expect(screen.getByRole('button', { name: /Start with Closure — it's red/ })).toBeInTheDocument();
  });

  it('a starting point needs nothing, and a star opens its page', async () => {
    renderMap();
    fireEvent.focus(screen.getByRole('link', { name: /^Keys/ }));
    expect(await screen.findByText(/A starting point/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('link', { name: /^Keys/ }), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('reader')).toBeInTheDocument());
  });
});
