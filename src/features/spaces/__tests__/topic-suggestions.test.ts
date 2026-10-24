import { describe, expect, it } from 'vitest';
import { topicSuggestions } from '../screens/CourseScreen';

const ideas = (...names: string[]) => names.map((name) => ({ name }));

describe('topicSuggestions', () => {
  it("takes one idea from the middle of each lecture — not its housekeeping first slides", () => {
    expect(
      topicSuggestions([
        { title: 'Introduction', ideas: ideas('Course Info', 'Contact Details', 'Software Crisis', 'Process Phases') },
        { title: 'Versions', ideas: ideas('Goals', 'Locking', 'Merging') },
      ]),
    ).toEqual(['Software Crisis', 'Locking', 'Introduction', 'Versions']);
  });

  it('falls back to lecture titles while no ideas are known, and stops at four', () => {
    const lectures = ['A', 'B', 'C', 'D', 'E'].map((title) => ({ title, ideas: null }));
    expect(topicSuggestions(lectures)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('never repeats a topic', () => {
    expect(
      topicSuggestions([
        { title: 'One', ideas: ideas('Joins') },
        { title: 'Two', ideas: ideas('Joins') },
      ]),
    ).toEqual(['Joins', 'One', 'Two']);
  });
});
