import React from "react";
import "@testing-library/jest-dom";

import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { crypto } from "node:crypto";

import { server } from "./server";
// Initialize i18next with the project's English/German resources so any
// component that calls `useTranslation()` renders real localized strings
// in tests instead of bare i18n keys.
import "@/i18n";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AuthProvider: actual.AuthProvider || (({ children }: { children: React.ReactNode }) => children),
    useAuth: actual.useAuth || vi.fn(() => ({
      user: { id: "test-user-id", email: "test@example.com" },
      session: { access_token: "test-token" },
      profile: { id: "test-profile-id", full_name: "Test User", role: "student" },
      role: "student",
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      refreshProfile: vi.fn().mockResolvedValue(undefined),
    })),
  };
});


// ── jsdom polyfills ─────────────────────────────────────────────────────────
Object.defineProperty(window, "AbortController", {
  value: globalThis.AbortController,
});
Object.defineProperty(window, "AbortSignal", {
  value: globalThis.AbortSignal,
});

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

// Fix for "Expected signal to be an instance of AbortSignal" error in JSDOM/Node fetch
Object.defineProperty(window, "AbortController", {
  writable: true,
  value: globalThis.AbortController,
});
Object.defineProperty(window, "AbortSignal", {
  writable: true,
  value: globalThis.AbortSignal,
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

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: crypto,
  });
}

if (!globalThis.crypto.subtle) {
  // node:crypto's webcrypto implementation
  const { webcrypto } = require("node:crypto");
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: webcrypto.subtle,
  });
}

// Stub framer-motion globally to avoid animation stalls in JSDOM
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    AnimatePresence: Passthrough,
    motion: new Proxy(
      {},
      {
        get: (_target, prop) => {
          return ({ children, ...rest }: any) => {
            const {
              initial: _i,
              animate: _a,
              exit: _e,
              transition: _t,
              variants: _v,
              whileHover: _wh,
              whileTap: _wt,
              whileInView: _wi,
              whileFocus: _wf,
              drag: _d,
              layout: _l,
              layoutId: _li,
              custom: _c,
              viewport: _vp,
              ...domProps
            } = rest;
            return React.createElement(prop as string, domProps, children);
          };
        },
      },
    ),
    useInView: () => true,
    useAnimation: () => ({ start: () => Promise.resolve(), stop: () => {} }),
    useScroll: () => {
      const mv = {
        get: () => 0,
        on: () => () => {},
        destroy: () => {},
        onChange: () => () => {},
        clearListeners: () => {},
      };
      return {
        scrollX: mv,
        scrollY: mv,
        scrollXProgress: mv,
        scrollYProgress: mv,
      };
    },
    useSpring: (v: any) => v,
    useTransform: (v: any) => v,
  };
});


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
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
