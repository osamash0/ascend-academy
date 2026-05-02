import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./server";

// ── jsdom polyfills ─────────────────────────────────────────────────────────
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

if (!("ResizeObserver" in window)) {
  // jsdom does not implement ResizeObserver; many shadcn/sidebar components
  // mount it during render. A stub is enough for unit tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!("IntersectionObserver" in window)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

if (!("scrollTo" in window)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).scrollTo = () => {};
}

// ── Test env vars ───────────────────────────────────────────────────────────
// Vite's import.meta.env is a frozen Proxy, so we set values via vi.stubEnv,
// which is the supported escape hatch.
vi.stubEnv("VITE_SUPABASE_URL", "https://fake.supabase.test");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-anon-key");
vi.stubEnv("VITE_API_URL", "http://api.test");
vi.stubEnv("VITE_ANON_SALT", "test-salt");

// ── MSW lifecycle ───────────────────────────────────────────────────────────
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
