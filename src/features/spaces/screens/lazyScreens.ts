import { preloadable } from '../preloadable';

/**
 * The v4 screens a file passes through on its way from the Library to its
 * Lesson, fetchable ahead of time: the Library fetches the reader when it
 * opens, the reader fetches the Lesson while you read. Each opens without
 * the app's loader in between.
 */
export const StudioCanvasRoute = preloadable(() => import('./StudioCanvasScreen'));
export const LessonFacesRoute = preloadable(() => import('./LessonFacesScreen'));
