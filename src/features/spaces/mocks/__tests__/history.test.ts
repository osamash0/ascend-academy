import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentRun, daysStudied, lastStudied, longestRun, recentWeeks, studyDays, TODAY } from '../history';

const strip = (p: string) =>
  readFileSync(join(process.cwd(), 'src/features/spaces', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('one run, derived from the days', () => {
  it('states the streak nowhere', () => {
    /*
     * The defect: `4` written out in four places that could not check each
     * other — `useSpaces.ts`, `ProfileScreen`, badge `b-3` and a notification
     * — two as digits and two as English prose. Home could have said five
     * while Profile said four and nothing would have failed.
     */
    expect(strip('data/useSpaces.ts'), 'Home states a streak literal').not.toMatch(
      /streakDays:\s*ready\s*\?\s*\d/,
    );
    expect(strip('screens/ProfileScreen.tsx'), 'Profile holds its own STREAK').not.toMatch(
      /STREAK/,
    );
    /*
     * The third and fourth sources were prose, not numbers: badge b-3 "Four in
     * a row · Four days running" and a notification reading "You have studied
     * four days in a row." The badge has since been retired outright — see
     * `mocks/moments.ts` — so what this guards now is that no achievement
     * fixture comes back restating a run in its name.
     */
    expect(strip('mocks/library.ts'), 'an achievement fixture states a run again').not.toMatch(
      /earned:\s*(true|false)/,
    );
  });

  it('counts consecutive days and stops at the first gap', () => {
    // Four now (28th–31st); the 25th to the 27th are missing.
    expect(currentRun()).toBe(4);
  });

  it('finds the longest stretch anywhere in the record', () => {
    // Six, the 12th to the 17th — deliberately not the current run, so the
    // two numbers are distinguishable and both render paths are exercised.
    expect(longestRun()).toBe(6);
    expect(longestRun()).toBeGreaterThan(currentRun());
  });

  it('treats two entries for one day as one day', () => {
    expect(daysStudied()).toBe(new Set(studyDays.map((d) => d.date)).size);
  });

  it('never reports a current run longer than the longest', () => {
    expect(currentRun()).toBeLessThanOrEqual(longestRun());
  });

  it('has no gaps in the days it calls a run', () => {
    /*
     * Reconstructs the run from the dates rather than trusting the counter:
     * the four most recent days must be four consecutive calendar days.
     */
    const days = [...new Set(studyDays.map((d) => d.date))].sort().reverse();
    const DAY = 86_400_000;
    for (let i = 1; i < currentRun(); i += 1) {
      const gap =
        Date.parse(`${days[i - 1]}T00:00:00Z`) - Date.parse(`${days[i]}T00:00:00Z`);
      expect(gap, `${days[i - 1]} and ${days[i]} are not consecutive`).toBe(DAY);
    }
  });
});

describe('the calendar', () => {
  it('ends on the week containing today', () => {
    const weeks = recentWeeks();
    const lastWeek = weeks[weeks.length - 1];
    expect(lastWeek.some((d) => d.date === TODAY), 'today is off the grid').toBe(true);
  });

  it('marks days that have not happened rather than calling them unstudied', () => {
    /*
     * The pressure this screen exists to avoid. The grid runs to the end of
     * the current week, so up to six cells are days in the future. Drawn like
     * unstudied days they read as failures already banked.
     */
    const cells = recentWeeks().flat();
    const future = cells.filter((c) => c.date > TODAY);
    expect(future.length, 'no future cells — this guard would be vacuous').toBeGreaterThan(0);
    for (const c of future) {
      expect(c.future, `${c.date} is in the future but not flagged`).toBe(true);
      expect(c.studied, `${c.date} is in the future and marked studied`).toBe(false);
    }
    for (const c of cells.filter((c) => c.date <= TODAY)) {
      expect(c.future, `${c.date} is past but flagged future`).toBe(false);
    }
  });

  it('agrees with the record about which days were studied', () => {
    // The calendar and the counters must not disagree about the same days.
    const studied = new Set(studyDays.map((d) => d.date));
    for (const c of recentWeeks().flat()) {
      expect(c.studied, `${c.date}`).toBe(studied.has(c.date));
    }
  });

  it('runs Monday to Sunday, seven to a row', () => {
    for (const week of recentWeeks()) {
      expect(week).toHaveLength(7);
      expect(new Date(`${week[0].date}T00:00:00Z`).getUTCDay(), 'week starts Monday').toBe(1);
    }
  });

  it('never renders the future as absent on a past week', () => {
    const weeks = recentWeeks();
    for (const week of weeks.slice(0, -1)) {
      expect(week.every((d) => !d.future), 'a past week contains future days').toBe(true);
    }
  });
});

describe('a record, not a streak system', () => {
  /*
   * Abi's decision, held in place. "Streak" is in no design doc, is absent
   * from Doc 1 rule 6's list of words we use, and rule 7 states that "XP and
   * ranks carry all progression" — Engagement rule 4 forbids anything getting
   * "a second progression bolted on".
   *
   * A count of days is a fact. Milestones, freezes and loss-aversion copy
   * would make it a currency, and this is the one mechanic here that would
   * work by making people anxious. The distinction lives in copy, so copy is
   * what this checks.
   */
  const screen = strip('screens/HistoryScreen.tsx');

  it('never warns you about losing a run', () => {
    for (const phrase of [
      "don't break",
      'do not break',
      'keep it up',
      'keep going',
      'streak freeze',
      'at risk',
      'about to lose',
      'you will lose',
      'last chance',
    ]) {
      expect(screen.toLowerCase(), `the screen pressures: "${phrase}"`).not.toContain(phrase);
    }
  });

  it('promises no reward for length', () => {
    // A reward for consecutive days *is* the second progression rule 4 bans.
    expect(screen).not.toMatch(/unlock|milestone|bonus|reward|earn .* run/i);
  });

  it('says out loud that none of this counts toward XP', () => {
    // The one thing that stops a calendar being read as a scoreboard.
    expect(screen).toMatch(/counts toward XP/);
  });

  it('shows the longest run beside the current one', () => {
    // A lone number you might lose invites protecting it. Next to a larger one
    // you already managed, it reads as history rather than as a stake.
    expect(screen).toContain('longestRun');
    expect(screen).toContain('currentRun');
  });

  it('grades the calendar by whether you studied, not by how much', () => {
    /*
     * A five-shade heat map rewards long days in CSS and turns the record into
     * a scoreboard. `StudyDay` carries no volume for exactly this reason —
     * so the guard is that no such field appears.
     */
    const data = strip('mocks/history.ts');
    expect(data, 'a study day carries a volume to grade by').not.toMatch(
      /minutes|intensity|level:|count:/,
    );
  });
});

describe('the fixtures have no clock', () => {
  it('anchors to a fixed day', () => {
    /*
     * Anchoring to the real date would mean the streak dies overnight and the
     * tests with it — green on Tuesday, red on Wednesday, with nobody having
     * changed anything.
     */
    expect(TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(strip('mocks/history.ts'), 'the fixtures read the real clock').not.toMatch(
      /Date\.now\(\)|new Date\(\)/,
    );
  });

  it('records nothing after the day it is anchored to', () => {
    for (const d of studyDays) {
      expect(d.date <= TODAY, `${d.date} is in the future`).toBe(true);
    }
    expect(lastStudied()).toBe(TODAY);
  });

  it('gives every day something to show for it', () => {
    for (const d of studyDays) {
      expect(d.summary.trim().length, d.date).toBeGreaterThan(0);
    }
  });
});
