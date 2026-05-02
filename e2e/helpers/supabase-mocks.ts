import type { Page, Route } from "@playwright/test";

/**
 * Hermetic Supabase + FastAPI mocks for Playwright E2E.
 *
 * Strategy
 * ────────
 * • Playwright tries route handlers in REVERSE registration order, so we
 *   register the broadest fallbacks FIRST and the most specific handlers LAST.
 * • Every JSON response includes permissive CORS headers so the SDK does not
 *   bail on a missing access-control header. We also short-circuit OPTIONS
 *   preflight requests.
 * • Single-row PostgREST queries (`.single()`) set
 *   `Accept: application/vnd.pgrst.object+json` — handlers branch on that to
 *   return either an object or an array.
 */

export type Role = "student" | "professor";

export interface SyntheticUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
}

export const STUDENT: SyntheticUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "student@test.com",
  role: "student",
  fullName: "Test Student",
};

export const PROFESSOR: SyntheticUser = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "prof@test.com",
  role: "professor",
  fullName: "Test Professor",
};

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-credentials": "true",
};

const PREFLIGHT_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,PUT,HEAD,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-range,x-total-count",
};

function json(
  route: Route,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { ...CORS_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function buildAuthUser(u: SyntheticUser) {
  const now = new Date().toISOString();
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"], role: u.role },
    user_metadata: { role: u.role, full_name: u.fullName },
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function buildSession(u: SyntheticUser) {
  return {
    access_token: `fake-access-${u.role}`,
    refresh_token: `fake-refresh-${u.role}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: buildAuthUser(u),
  };
}

function buildProfile(u: SyntheticUser) {
  return {
    id: `profile-${u.id}`,
    user_id: u.id,
    email: u.email,
    full_name: u.fullName,
    display_name: u.fullName.split(" ")[0],
    avatar_url: null,
    total_xp: 40,
    current_level: 1,
    current_streak: 0,
    best_streak: 0,
  };
}

interface MockSupabaseOptions {
  user: SyntheticUser;
  /** Tables the test will GET as arrays. */
  tables?: Partial<Record<string, unknown[]>>;
  /** Single-row responses by table name (used when Accept = pgrst.object+json). */
  singletons?: Partial<Record<string, unknown>>;
  /** Return value for `update_user_streak` RPC. */
  streakValue?: number;
  /** Optional handler invoked for unmatched REST routes — useful for asserts. */
  onUnmocked?: (method: string, url: string) => void;
}

/**
 * Install the baseline Supabase mocks (auth, profile, role) plus optional
 * table data. Specific tests can layer extra `page.route()` calls AFTER
 * calling this — those will win because they are registered later.
 */
export async function mockSupabase(
  page: Page,
  opts: MockSupabaseOptions,
): Promise<void> {
  const { user, tables = {}, singletons = {}, streakValue = 1, onUnmocked } = opts;
  const session = buildSession(user);
  const profile = buildProfile(user);

  // ─── Broad fallback for any /rest/v1/ — last resort, returns empty array ──
  await page.route(/\/rest\/v1\//, async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    onUnmocked?.(method, url);
    if (method === "OPTIONS") {
      return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
    }
    const accept = req.headers()["accept"] || "";
    if (accept.includes("vnd.pgrst.object")) {
      // single() with no row → 406 PGRST116 (treated as null by Supabase JS)
      return route.fulfill({
        status: 406,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({
          code: "PGRST116",
          details: "Results contain 0 rows",
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned",
        }),
      });
    }
    return json(route, [], method === "POST" ? 201 : 200);
  });

  // ─── Generic /storage/v1/ fallback (succeeds) ─────────────────────────────
  await page.route(/\/storage\/v1\//, async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
    }
    return json(route, { Key: "stub" });
  });

  // ─── Tables: array reads, single() reads, inserts/upserts ─────────────────
  for (const [table, rows] of Object.entries(tables)) {
    const single = singletons[table];
    await page.route(new RegExp(`/rest/v1/${table}(\\?|$)`), async (route) => {
      const req = route.request();
      const method = req.method();
      if (method === "OPTIONS") {
        return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
      }
      const accept = req.headers()["accept"] || "";
      const prefer = req.headers()["prefer"] || "";

      if (method === "POST" || method === "PATCH" || method === "PUT") {
        // Insert / upsert / update — return the body as inserted rows.
        let body: unknown = [];
        try {
          body = req.postDataJSON();
        } catch {
          body = [];
        }
        const rowsOut = Array.isArray(body) ? body : [body];
        if (
          accept.includes("vnd.pgrst.object") ||
          prefer.includes("return=representation")
        ) {
          if (accept.includes("vnd.pgrst.object")) {
            return json(route, rowsOut[0] ?? {}, 201);
          }
          return json(route, rowsOut, 201);
        }
        return route.fulfill({ status: 201, headers: CORS_HEADERS });
      }

      if (method === "DELETE") {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }

      // HEAD with count=exact (used by countCompletedLectures).
      if (method === "HEAD") {
        const count = (rows ?? []).length;
        return route.fulfill({
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "content-range": `0-${Math.max(count - 1, 0)}/${count}`,
          },
        });
      }

      // GET
      if (accept.includes("vnd.pgrst.object")) {
        if (single !== undefined) return json(route, single);
        const first = (rows ?? [])[0];
        if (first !== undefined) return json(route, first);
        // No row → 406 PGRST116 so Supabase returns { data: null, error }.
        return route.fulfill({
          status: 406,
          contentType: "application/json",
          headers: CORS_HEADERS,
          body: JSON.stringify({
            code: "PGRST116",
            details: "0 rows",
            hint: null,
            message: "No rows found",
          }),
        });
      }
      return json(route, rows ?? []);
    });
  }

  // ─── profiles + user_roles (always required by AuthProvider) ──────────────
  if (!tables.profiles) {
    await page.route(/\/rest\/v1\/profiles(\?|$)/, async (route) => {
      const m = route.request().method();
      if (m === "OPTIONS")
        return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
      const accept = route.request().headers()["accept"] || "";
      if (m === "GET") {
        if (accept.includes("vnd.pgrst.object")) return json(route, profile);
        return json(route, [profile]);
      }
      return json(route, [profile], 201);
    });
  }
  if (!tables.user_roles) {
    await page.route(/\/rest\/v1\/user_roles(\?|$)/, async (route) => {
      const m = route.request().method();
      if (m === "OPTIONS")
        return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
      return json(route, { role: user.role });
    });
  }

  // ─── RPCs needed by the lecture quiz flow ─────────────────────────────────
  await page.route(/\/rest\/v1\/rpc\/add_xp_to_user(\?|$)/, (route) =>
    json(route, null),
  );
  await page.route(/\/rest\/v1\/rpc\/update_user_streak(\?|$)/, (route) =>
    json(route, streakValue),
  );

  // ─── Auth endpoints ───────────────────────────────────────────────────────
  // IMPORTANT: Playwright matches handlers in REVERSE registration order, so
  // the broad `/auth/v1/` fallback MUST be registered first and the specific
  // token/signup/user/logout handlers MUST be registered last so they win.
  await page.route(/\/auth\/v1\//, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
    return json(route, {});
  });
  await page.route(/\/auth\/v1\/logout(\?|$)/, (route) =>
    route.fulfill({ status: 204, headers: CORS_HEADERS }),
  );
  await page.route(/\/auth\/v1\/user(\?|$)/, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
    return json(route, session.user);
  });
  await page.route(/\/auth\/v1\/signup(\?|$)/, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
    // signUp returns the user object with an embedded session.
    return json(route, { ...session.user, session });
  });
  await page.route(/\/auth\/v1\/token(\?|$)/, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
    return json(route, session);
  });
}

/**
 * Drive the Auth.tsx login form to obtain a session via the mocked
 * `/auth/v1/token` endpoint. Waits for the post-login redirect.
 */
export async function loginAs(
  page: Page,
  user: SyntheticUser,
  expectedPath: RegExp,
): Promise<void> {
  await page.goto("/auth");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("Sup3rSecret!");
  await page.getByRole("button", { name: /initiate session/i }).click();
  await page.waitForURL(expectedPath);
}
