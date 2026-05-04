/**
 * MSW Node server used by the Vitest setup file.
 *
 * Default handlers cover the small surface needed for service / hook tests
 * (analytics, AI generation, mind-map, PDF stream). Tests can call
 * `server.use(...)` to override per-case.
 */
import { setupServer } from "msw/node";
import { defaultHandlers } from "./handlers";

export const server = setupServer(...defaultHandlers);
