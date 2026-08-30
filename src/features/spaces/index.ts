/**
 * Learnstation v4 — Spaces.
 *
 * A new namespace, deliberately separate from features/courses, features/student
 * and features/assignments. Those are the previous product and use vocabulary
 * that is now banned; nothing here imports from them, and nothing there is
 * modified. The two coexist.
 *
 * Source of truth: docs/design-v4/01-foundations.md (Locked v1.15).
 */

export * from './types';
export { useSpaces, useSpace, useLessonContributions, useScenario } from './data/useSpaces';
export type { MySpaces, SpacesResult, SpaceResult, Scenario } from './data/useSpaces';
