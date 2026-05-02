/**
 * Shared singleton supabase mock for tests that need to both seed/inspect
 * data AND have the mock injected as the @/integrations/supabase/client.
 *
 * Usage:
 *   import { sharedSupabaseMock } from "@/test/sharedSupabaseMock";
 *   vi.mock("@/integrations/supabase/client", async () => {
 *     const m = await import("@/test/sharedSupabaseMock");
 *     return { supabase: m.sharedSupabaseMock };
 *   });
 */
import { createSupabaseMock } from "./supabaseMock";

export const sharedSupabaseMock = createSupabaseMock();
