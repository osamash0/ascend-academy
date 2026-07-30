import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CourseDetailsSheet } from '../CourseDetailsSheet';

describe('CourseDetailsSheet lecture actions', () => {
  it('uses one labelled native button that keyboard users can activate to start each lecture', async () => {
    const onStartLecture = vi.fn();

    renderWithProviders(
      <CourseDetailsSheet
        isOpen
        onClose={vi.fn()}
        courseId="course-1"
        title="Algorithms"
        description={null}
        lectures={[{
          lecture: {
            id: 'lecture-1',
            title: 'Introduction to graph theory',
            description: 'The first lesson',
            total_slides: 12,
            created_at: '2026-07-21T00:00:00Z',
          },
          cleanTitle: 'Introduction to graph theory',
          progress: 0,
          status: 'new',
        }]}
        onStartLecture={onStartLecture}
      />,
    );

    const startButton = screen.getByRole('button', { name: /introduction to graph theory/i });
    expect(startButton.tagName).toBe('BUTTON');
    startButton.focus();
    await userEvent.setup().keyboard('{Enter}');

    expect(onStartLecture).toHaveBeenCalledWith('lecture-1');
  });
});
