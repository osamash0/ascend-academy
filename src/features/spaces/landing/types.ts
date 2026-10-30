import type { Person } from '../types';

/**
 * How it's landing — the owner's view of a Space.
 *
 * The wire shape the door renders. The backend (Phase B of the spec,
 * docs/superpowers/specs/2026-10-26-how-its-landing-design.md) emits kinds
 * and numbers only; every word on screen comes from `v4Landing.json`, so the
 * same payload reads in English and German.
 *
 * Numbers are aggregates over the Space's members, never a person: the owner's
 * own reading is excluded, and nothing appears for a page or a Lesson until
 * `floor` people have been through it.
 */

/** How much a finding wants the owner, banded from severity. */
export type Attention = 'act' | 'watch' | 'calm';

/** A Lesson's light: its worst finding, or `few` while under the reader floor. */
export type LessonLight = Attention | 'few';

/** The detector kinds of the insight engine (backend/services/insights). */
export type InsightKind =
  | 'confusion_hotspot'
  | 'silent_misleader'
  | 'skipped_slide'
  | 'speed_bump'
  | 'overpacked'
  | 'leaky_bucket'
  | 'confusion_block'
  | 'quiz_misalignment'
  | 'calibration_gap'
  | 'healthy';

export interface LandingLesson {
  id: string;
  title: string;
  order: number;
  pages: number;
  /** Members who have read any of it. */
  readers: number;
  light: LessonLight;
  /** The Lesson's own colour. Live, the hue sampled from its first page; fixtures use the cover palette. */
  color: string;
  /**
   * How much each page asked of people, 0–1, one value per page: the engine's
   * per-page help index (Explain and Ask opened, foggy check-ins, turning
   * back). Absent while the Lesson is under the floor.
   */
  help?: number[];
}

/** Check-in against checkpoint, paired per person. */
export interface Grid {
  clickedCleared: number;
  clickedMissed: number;
  foggyCleared: number;
  foggyMissed: number;
}

export interface LandingInsight {
  id: string;
  kind: InsightKind;
  attention: Attention;
  /** 0–1, orders the findings. */
  severity: number;
  lessonId: string;
  /** The page the finding is about, where it is about one. */
  page?: number;
  /** A stretch of pages (confusion_block). */
  first?: number;
  last?: number;
  /** Kind-specific figures the copy interpolates. */
  metrics: Record<string, number>;
  /** Clicked vs. missed, present only above the floor. */
  grid?: Grid;
  /** Whether themes exist for this page (≥ floor different askers). */
  themes?: boolean;
}

/** What people asked on a page, as themes. Never the questions themselves. */
export interface Themes {
  lessonId: string;
  page: number;
  askers: number;
  themes: string[];
}

export interface LandingAnswer {
  text: string;
  forEveryone: boolean;
  at: string;
}

/** A question someone chose to send to the people who run the Space. */
export interface LandingQuestion {
  id: string;
  lessonId: string;
  page: number;
  text: string;
  /** Null when sent without a name. The answer still finds its way back. */
  asker: Person | null;
  createdAt: string;
  answer?: LandingAnswer;
}

/**
 * A figure with its last eight weeks, oldest first, in the figure's own unit.
 * `null` is a week with nothing to say: fewer than `floor` people that week.
 * It is not zero, and the door never draws or states it as one.
 */
export interface Figure {
  value: number | null;
  history: (number | null)[];
}

export interface Landing {
  spaceId: string;
  spaceName: string;
  /** The Space's one colour, for when no Lesson leads. */
  accent: string;
  members: number;
  /** Members who have read anything, the owner excluded. */
  readers: number;
  /** People a page needs before anything is said about it. */
  floor: number;
  /** Readers this week; percent of pages landing; percent of checkpoints cleared first try. */
  figures: { reading: Figure; landing: Figure; cleared: Figure };
  lessons: LandingLesson[];
  insights: LandingInsight[];
  questions: LandingQuestion[];
  themes: Themes[];
}
