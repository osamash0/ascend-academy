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

/*
 * How it's landing — the owner's door and the reader's way of sending a
 * question (docs/superpowers/specs/2026-10-26-how-its-landing-design.md).
 * The reader pieces mount in the reader in Phase C; until then the DEV lab
 * (src/pages/LandingLab.tsx) is their call site, through this surface.
 */
export { default as LandingScreen } from './landing/LandingScreen';
export { AnsweredHere } from './landing/AnsweredHere';
export { LunaLine, SendLine, SendSheet } from './landing/SendToSpace';
export type { Sent } from './landing/SendToSpace';
export type * from './landing/types';
