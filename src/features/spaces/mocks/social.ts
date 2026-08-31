import type { Person } from '../types';
import { friendRequests as seedRequests, friends as seedFriends } from './library';

/**
 * Friends and requests, writable.
 *
 * Accept and Decline rendered as an enabled white primary and a matching
 * secondary, with `aria-label`s naming the person, and neither had a handler.
 * A request you accept that stays in the requests list is not a cosmetic
 * problem — it is the screen telling you the action failed.
 *
 * Accepting moves the person into friends; declining drops the request. Both
 * are silent to the other person in this build: `NEEDS-BACKEND` — there is no
 * counterpart notification, and inventing one here would put a claim on screen
 * that nothing behind it can honour.
 */

let friendList: Person[] = [...seedFriends];
let requests = [...seedRequests];

export const resetSocial = (): void => {
  friendList = [...seedFriends];
  requests = [...seedRequests];
};

export const currentFriends = (): Person[] => [...friendList];
export const currentRequests = () => [...requests];

/** Accept: they become a friend, and the request is gone. */
export const acceptRequest = (personId: string): void => {
  const req = requests.find((r) => r.person.id === personId);
  if (!req) return;
  requests = requests.filter((r) => r.person.id !== personId);
  if (!friendList.some((f) => f.id === personId)) friendList = [...friendList, req.person];
};

/** Decline: the request is gone, and nothing else changes. */
export const declineRequest = (personId: string): void => {
  requests = requests.filter((r) => r.person.id !== personId);
};

export const isFriend = (personId: string): boolean => friendList.some((f) => f.id === personId);
