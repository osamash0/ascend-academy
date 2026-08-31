import type { Person } from '../types';

/**
 * People fixtures.
 *
 * Foundations, Separation Rule 2: "Everything carries its real author — name
 * and avatar, always. Anonymous content is not allowed." So every fixture here
 * is a whole person, and nothing in the mock set is ever authored by null.
 *
 * `viewer` is the signed-in account taken from the running app (Abdulah,
 * Rank 1, 60 XP) so the "Created by you" grouping has a real subject.
 */

export const viewer: Person = {
  id: 'p-viewer',
  name: 'Abdulah',
  avatarUrl: null,
};

export const keller: Person = {
  id: 'p-keller',
  name: 'Marion Keller',
  avatarUrl: null,
};

export const weber: Person = {
  id: 'p-weber',
  name: 'Jonas Weber',
  avatarUrl: null,
};

export const ferreira: Person = {
  id: 'p-ferreira',
  name: 'Inês Ferreira',
  avatarUrl: null,
};

export const okonkwo: Person = {
  id: 'p-okonkwo',
  name: 'Chidi Okonkwo',
  avatarUrl: null,
};

/**
 * The one person with a picture.
 *
 * Every `avatarUrl` was `null`, so `Avatar`'s *first* branch had never
 * rendered anywhere. It is the branch that will run for most people once real
 * accounts exist, and it was the only one no screen had been seen with.
 *
 * (The discovery pass flagged this as an accessibility risk too — that the
 * image would add itself to every byline's accessible name. It would not:
 * `alt=""` already makes it decorative, exactly as `aria-hidden` does for the
 * other two branches. Reported as clean rather than fixed.)
 *
 * An inline data URI rather than a URL: this namespace makes no network
 * requests, and a broken image is not the state being tested.
 */
export const lindqvist: Person = {
  id: 'p-lindqvist',
  name: 'Åsa Lindqvist',
  avatarUrl:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" fill="#2b3350"/>' +
        '<circle cx="32" cy="25" r="12" fill="#7d8bc4"/>' +
        '<path d="M8 64c0-13 11-21 24-21s24 8 24 21z" fill="#7d8bc4"/>' +
        '</svg>',
    ),
};

/** Everyone, for member lists and avatar stacks. */
export const people = [viewer, keller, weber, ferreira, okonkwo, lindqvist];
