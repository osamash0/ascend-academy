/**
 * NudgeBanner tests.
 *
 * Guards the contract for the dismissible banner:
 *   * Picks the highest-priority unread nudge (priority desc).
 *   * Open button navigates to the row's deep_link.
 *   * Dismiss POSTs /api/nudges/{id}/dismiss and hides the banner; the
 *     next-highest nudge takes its place.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("framer-motion", () => {
    const ANIM = new Set([
        "initial", "animate", "exit", "transition", "variants",
        "whileHover", "whileTap", "whileInView", "layout", "layoutId",
    ]);
    const make = (tag: string) => {
        const Cmp = React.forwardRef<HTMLElement, Record<string, unknown> & { children?: React.ReactNode }>(
            ({ children, ...rest }, ref) => {
                const safe: Record<string, unknown> = {};
                for (const k of Object.keys(rest)) if (!ANIM.has(k)) safe[k] = rest[k];
                return React.createElement(tag, { ref, ...safe } as any, children as any);
            },
        );
        return Cmp;
    };
    return {
        AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
        motion: new Proxy({} as Record<string, unknown>, { get: (_t, prop) => make(String(prop)) }),
    };
});

import { NudgeBanner } from "@/components/NudgeBanner";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", async () => {
    const m = await import("@/test/sharedSupabaseMock");
    return { supabase: m.sharedSupabaseMock };
});

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("react-router-dom", async () => {
    const actual = await vi.importActual<typeof import("react-router-dom")>(
        "react-router-dom",
    );
    return { ...actual, useNavigate: () => mockNavigate };
});

const { authValue } = vi.hoisted(() => ({
    authValue: {
        user: { id: "u1", email: "s@s.com" },
        session: { access_token: "t" },
    },
}));
vi.mock("@/lib/auth", () => ({
    useAuth: () => authValue,
}));

import { sharedSupabaseMock } from "@/test/sharedSupabaseMock";

beforeEach(() => {
    sharedSupabaseMock.reset();
    mockNavigate.mockReset();
});

function seed(rows: Array<Record<string, unknown>>) {
    sharedSupabaseMock.seed("notifications", rows);
}

describe("NudgeBanner", () => {
    it("renders nothing when there are no nudges", async () => {
        seed([]);
        renderWithProviders(<NudgeBanner />);
        // Allow the supabase useEffect a tick to resolve.
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByTestId("nudge-banner")).toBeNull();
    });

    it("renders the highest-priority unread nudge first", async () => {
        seed([
            {
                id: "n_low",
                user_id: "u1",
                title: "Time to review",
                message: "Backprop",
                type: "review",
                read: false,
                created_at: "2026-05-02T13:00:00Z",
                priority: 60,
                deep_link: "/concepts/c1",
            },
            {
                id: "n_high",
                user_id: "u1",
                title: "Assignment due soon",
                message: "Week 5 is due today.",
                type: "assignment",
                read: false,
                created_at: "2026-05-02T12:00:00Z",
                priority: 90,
                deep_link: "/assignments/a1",
            },
        ]);
        renderWithProviders(<NudgeBanner />);
        await screen.findByTestId("nudge-banner");
        expect(screen.getByText("Assignment due soon")).toBeInTheDocument();
        expect(screen.queryByText("Time to review")).toBeNull();
    });

    it("Open navigates to the nudge's deep_link", async () => {
        seed([
            {
                id: "n1",
                user_id: "u1",
                title: "Assignment due soon",
                message: "Week 5",
                type: "assignment",
                read: false,
                created_at: "2026-05-02T12:00:00Z",
                priority: 90,
                deep_link: "/assignments/a1",
            },
        ]);
        renderWithProviders(<NudgeBanner />);
        const btn = await screen.findByTestId("nudge-open");
        btn.click();
        expect(mockNavigate).toHaveBeenCalledWith("/assignments/a1");
    });

    it("Dismiss hits the API and reveals the next-highest nudge", async () => {
        const fetchSpy = vi.fn(async () =>
            new Response(JSON.stringify({ success: true, data: { dismissed: true } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchSpy);
        try {
            seed([
                {
                    id: "n_high",
                    user_id: "u1",
                    title: "Assignment due soon",
                    message: "Week 5",
                    type: "assignment",
                    read: false,
                    created_at: "2026-05-02T12:00:00Z",
                    priority: 90,
                    deep_link: "/assignments/a1",
                },
                {
                    id: "n_low",
                    user_id: "u1",
                    title: "Time to review",
                    message: "Backprop",
                    type: "review",
                    read: false,
                    created_at: "2026-05-02T13:00:00Z",
                    priority: 60,
                    deep_link: "/concepts/c1",
                },
            ]);
            renderWithProviders(<NudgeBanner />);
            await screen.findByText("Assignment due soon");

            const dismissBtn = screen.getByTestId("nudge-dismiss");
            dismissBtn.click();

            await screen.findByText("Time to review", {}, { timeout: 2000 });
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
            expect(url).toBe("http://api.test/api/v1/nudges/n_high/dismiss");
            expect(init.method).toBe("POST");
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
