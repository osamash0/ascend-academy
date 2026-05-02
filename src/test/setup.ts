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

// jsdom does not implement <canvas>.getContext; pages that draw decorative
// effects (e.g. Landing's animated background) call it during effects. A
// minimal no-op 2D-context stub is sufficient for unit tests. We override
// unconditionally because jsdom installs its own throwing implementation
// that a `!proto.getContext` guard would never catch.
if (typeof HTMLCanvasElement !== "undefined") {
  const noop = () => {};
  const stub2d = {
    canvas: null,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "10px sans-serif",
    textBaseline: "alphabetic",
    textAlign: "start",
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    resetTransform: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop,
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: (type: string) => (type === "2d" ? stub2d : null),
  });
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
