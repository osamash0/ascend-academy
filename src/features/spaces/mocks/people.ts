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

export const lindqvist: Person = {
  id: 'p-lindqvist',
  name: 'Åsa Lindqvist',
  avatarUrl: null,
};

/** Everyone, for member lists and avatar stacks. */
export const people = [viewer, keller, weber, ferreira, okonkwo, lindqvist];
