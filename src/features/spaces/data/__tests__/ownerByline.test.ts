import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { spaceFromCourse } from '../useReader';

/*
 * A Space whose owner has no name on their profile still gets a byline, and
 * that byline is ours to word: in the reader's language, with the glossary's
 * words for the people who maintain a Space. It used to be a hard-coded
 * English "Course team", which German readers saw on every such Lesson.
 */
const course = (author: string | null) => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Datenbanksysteme',
  description: null,
  color: null,
  author,
  lectures: [],
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('the owner byline of a Space read from its course', () => {
  it('is the owner’s name when the profile has one', () => {
    expect(spaceFromCourse(course('Ada Lovelace')).owner.name).toBe('Ada Lovelace');
  });

  it('names the people who run the Space when it has none, in English', async () => {
    await i18n.changeLanguage('en');
    expect(spaceFromCourse(course(null)).owner.name).toBe('The people who run this Space');
  });

  it('and in German, with the glossary’s words', async () => {
    await i18n.changeLanguage('de');
    expect(spaceFromCourse(course(null)).owner.name).toBe('Die Leute, die diesen Space pflegen');
  });
});
