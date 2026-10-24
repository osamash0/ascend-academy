import type { AppNotification } from '../mocks/notifications';
import type { Moment } from '../mocks/moments';

/**
 * Sentences the screen builds in the viewer's language.
 *
 * A `Phrase` is a translation key plus the names and numbers it needs. Names,
 * titles and counts stay as written; the words around them follow the
 * language picker. Keys carry their namespace (`v4Spaces:…`), so one helper
 * works from any screen.
 *
 * Live rows arrive as stored text: the database writes a badge's English
 * name into `notifications.title` and `achievements.badge_name`. That set is
 * closed (the badge catalog plus a few older rows), so it is matched here and
 * anything unknown is shown as stored rather than guessed at.
 */
/** The `t` from `useTranslation()`, as narrow as these helpers need it. */
type TFunction = (key: string, values?: Record<string, string | number>) => string;

export interface Phrase {
  key: string;
  values?: Record<string, string | number>;
}

export const say = (t: TFunction, p: Phrase): string => t(p.key, p.values);

/** Badge name as stored → its translation id. The catalog keys, plus older rows still in the table. */
const BADGES: Record<string, string> = {
  'Welcome Aboard': 'welcomeAboard',
  'Identity Set': 'identitySet',
  'Verified Scholar': 'verifiedScholar',
  'First Quiz Completed': 'firstQuiz',
  'Perfect Score': 'perfectScore',
  'Flawless Five': 'flawlessFive',
  'Quiz Master': 'quizMaster',
  Sharpshooter: 'sharpshooter',
  'On Fire': 'onFire',
  Unstoppable: 'unstoppable',
  'First Steps': 'firstSteps',
  Bookworm: 'bookworm',
  Graduate: 'graduate',
  Scholar: 'scholar',
  'Course Conqueror': 'courseConqueror',
  Polymath: 'polymath',
  'Getting Started': 'gettingStarted',
  Consistent: 'consistent',
  Dedicated: 'dedicated',
  'Curious Mind': 'curiousMind',
  Inquisitive: 'inquisitive',
  'Quick Thinker': 'quickThinker',
  'Checkpoint Champion': 'checkpointChampion',
  'Voice Heard': 'voiceHeard',
  'Level 5 Scholar': 'level5',
  'Level 10 Expert': 'level10',
  'Level 25 Legend': 'level25',
  'Exam Ready': 'examReady',
  '5 Streak Master': 'streak5',
  '10 Streak Champion': 'streak10',
};

/** Older rows end the name with an emoji ("First Quiz Completed 🎯"). */
const bare = (s: string) => s.replace(/[\s\p{Extended_Pictographic}\uFE0F]+$/u, '');

export const badgeId = (name: string): string | null => BADGES[bare(name)] ?? null;

const badge = (t: TFunction, id: string) => ({
  title: t(`v4Spaces:achievements.${id}.name`),
  text: t(`v4Spaces:achievements.${id}.description`),
});

/** A notification's two lines, in the viewer's language where we know the sentence. */
export function notificationText(t: TFunction, n: AppNotification): { title: string; message: string } {
  if (n.phrase) return { title: say(t, n.phrase.title), message: say(t, n.phrase.message) };
  const id = badgeId(n.title);
  if (id) {
    const b = badge(t, id);
    return { title: b.title, message: b.text };
  }
  const level = /^Level (\d+)!$/.exec(n.title);
  if (level) {
    const values = { level: Number(level[1]) };
    return {
      title: t('v4Spaces:notifications.items.levelUp.title', values),
      message: t('v4Spaces:notifications.items.levelUp.message', values),
    };
  }
  if (n.title === 'Material added to your course') {
    const file = /^(.*) is ready to study\.$/.exec(n.message);
    return {
      title: t('v4Spaces:notifications.items.materialAdded.title'),
      message: file
        ? t('v4Spaces:notifications.items.materialAdded.message', { file: file[1] })
        : n.message,
    };
  }
  return { title: n.title, message: n.message };
}

/** A Moment's title and sentence, in the viewer's language where we know them. */
export function momentText(t: TFunction, m: Moment): { title: string; detail: string } {
  if (m.phrase) return { title: say(t, m.phrase.title), detail: say(t, m.phrase.detail) };
  const id = badgeId(m.title);
  if (id) {
    const b = badge(t, id);
    return { title: b.title, detail: b.text };
  }
  return { title: m.title, detail: m.detail };
}
