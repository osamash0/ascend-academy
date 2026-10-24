import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { badgeId, momentText, notificationText, type Phrase } from '../data/phrases';
import { notifications } from '../mocks/notifications';
import { moments } from '../mocks/moments';
import { allSpaces as spaces } from '../mocks/spaces';
import { askSuggestions } from '../mocks/assistant';
import type { AppNotification } from '../mocks/notifications';

/*
 * LS-014..017, from the 2026-10-24 readiness walk: with Deutsch picked, the
 * bell, the Moments, the hub's activity lines and Home's ask chips were all
 * English. The sentences are now translation keys with the names filled in;
 * live rows, which the database stores in English, are matched against the
 * closed set it writes.
 */

const t = (key: string, values?: Record<string, string | number>) => i18n.t(key, values);

const row = (title: string, message: string, type: AppNotification['type'] = 'achievement'): AppNotification => ({
  id: 'x',
  title,
  message,
  type,
  read: false,
  created_at: '2026-10-24T10:00:00Z',
  target: { kind: 'profile' },
});

const resolves = (p: Phrase, lng: string) => i18n.exists(p.key, { lng, ...p.values });

beforeEach(async () => {
  await i18n.changeLanguage('de');
});

describe('live notifications, stored in English, read in German', () => {
  it('a badge row says the badge in German', () => {
    expect(notificationText(t, row('Identity Set', 'Chose a display name and a profile photo.'))).toEqual({
      title: 'Profil steht',
      message: 'Anzeigenamen und Profilfoto gewählt.',
    });
  });

  it('older rows with an emoji on the end still match', () => {
    expect(notificationText(t, row('First Quiz Completed 🎯', 'Completed your first lecture quiz!')).title).toBe(
      'Erstes Quiz geschafft',
    );
  });

  it('a level-up keeps its number', () => {
    expect(notificationText(t, row('Level 3!', 'You leveled up to Level 3. Keep going!', 'streak'))).toEqual({
      title: 'Stufe 3',
      message: 'Du hast Stufe 3 erreicht.',
    });
  });

  it('a finished upload keeps the file name', () => {
    expect(
      notificationText(t, row('Material added to your course', 'week-3.pdf is ready to study.', 'achievement')).message,
    ).toBe('week-3.pdf ist bereit zum Lernen.');
  });

  it('anything unknown is shown as stored, not guessed', () => {
    expect(notificationText(t, row('Something new', 'A line we never wrote.'))).toEqual({
      title: 'Something new',
      message: 'A line we never wrote.',
    });
  });

  it('a live Moment (an earned badge) reads in German', () => {
    expect(momentText(t, { id: 'm', title: 'Curious Mind', detail: 'Asked the AI tutor your first question.', at: null })).toEqual({
      title: 'Neugierig',
      detail: 'Dem KI-Tutor deine erste Frage gestellt.',
    });
  });
});

describe('every badge the database can write has words in both languages', () => {
  const stored = [
    'Welcome Aboard', 'Identity Set', 'Verified Scholar', 'First Quiz Completed', 'Perfect Score', 'Flawless Five',
    'Quiz Master', 'Sharpshooter', 'On Fire', 'Unstoppable', 'First Steps', 'Bookworm', 'Graduate', 'Scholar',
    'Course Conqueror', 'Polymath', 'Getting Started', 'Consistent', 'Dedicated', 'Curious Mind', 'Inquisitive',
    'Quick Thinker', 'Checkpoint Champion', 'Voice Heard', 'Level 5 Scholar', 'Level 10 Expert', 'Level 25 Legend',
    'Exam Ready', '5 Streak Master', '10 Streak Champion',
  ];
  it.each(stored)('%s', (name) => {
    const id = badgeId(name);
    expect(id).not.toBeNull();
    for (const lng of ['en', 'de']) {
      expect(i18n.exists(`v4Spaces:achievements.${id}.name`, { lng })).toBe(true);
      expect(i18n.exists(`v4Spaces:achievements.${id}.description`, { lng })).toBe(true);
    }
  });
});

describe('the demo says its sentences through keys that exist', () => {
  const phrases: [string, Phrase][] = [
    ...notifications.flatMap((n) => {
      expect(n.phrase, `${n.id} has a phrase`).toBeDefined();
      return [[`${n.id} title`, n.phrase!.title], [`${n.id} message`, n.phrase!.message]] as [string, Phrase][];
    }),
    ...moments().flatMap((m) => {
      expect(m.phrase, `${m.id} has a phrase`).toBeDefined();
      return [[`${m.id} title`, m.phrase!.title], [`${m.id} detail`, m.phrase!.detail]] as [string, Phrase][];
    }),
    ...spaces.filter((s) => s.lastActivity).map((s) => [`${s.id} activity`, s.lastActivity!] as [string, Phrase]),
    ...askSuggestions.map((p, i) => [`ask ${i}`, p] as [string, Phrase]),
  ];

  it.each(phrases)('%s', (_, p) => {
    expect(resolves(p, 'en')).toBe(true);
    expect(resolves(p, 'de')).toBe(true);
  });

  it('German comes out German, with the names left alone', () => {
    const endorsed = notifications.find((n) => n.id === 'n-1')!;
    expect(notificationText(t, endorsed).title).toBe('Åsa hat deine Arbeit empfohlen');
    expect(t(askSuggestions[0].key)).toBe('Was soll ich zuerst wiederholen?');
  });
});
