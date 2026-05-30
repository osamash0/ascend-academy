/**
 * LectureChat citation-chip tests.
 *
 * Guards the grounded-tutor contract: /api/ai/chat returns
 * { reply, citations: [{ slide_index, similarity }] } and LectureChat
 * renders one "Slide N" button per citation (1-indexed label, 0-indexed
 * slide_index in the onSlideJump callback).
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";

// jsdom does not implement Element.scrollIntoView; LectureChat calls it on
// every message change. Stub for this suite and restore on teardown.
let originalScrollIntoView: PropertyDescriptor | undefined;
beforeAll(() => {
  originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: () => {},
  });
});
afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  } else {
    delete (Element.prototype as unknown as Record<string, unknown>)
      .scrollIntoView;
  }
});

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-ai-model", () => ({
  useAiModel: () => ({ aiModel: "groq", setAiModel: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "s@s.com" },
    session: null,
    profile: null,
    role: "student",
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/services/studentService", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/studentService")
  >("@/services/studentService");
  return {
    ...actual,
    logLearningEvent: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
});

// Markdown rendering is not under test; stub the pipeline to passthrough.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("remark-math", () => ({ default: () => {} }));
vi.mock("rehype-katex", () => ({ default: () => {} }));

import { LectureChat } from "@/components/LectureChat";
import { renderWithProviders } from "@/test/renderWithProviders";

function renderChat(
  props: Partial<React.ComponentProps<typeof LectureChat>> = {},
) {
  return renderWithProviders(
    <LectureChat
      isOpen
      onClose={vi.fn()}
      slideText="Newton's third law: every action has an equal and opposite reaction."
      slideTitle="Newton's Laws"
      lectureId="lec-1"
      currentSlideIndex={0}
      {...props}
    />,
  );
}

async function sendQuestion(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByPlaceholderText(/ask about this slide/i);
  await user.type(input, "What does this mean?");
  await user.keyboard("{Enter}");
}

describe("LectureChat citation chips", () => {
  it("renders a clickable [Slide N] chip and forwards the 0-indexed slide_index to onSlideJump", async () => {
    server.use(
      http.post("http://api.test/api/ai/chat", () =>
        HttpResponse.json({
          reply: "See the cited slide for context.",
          citations: [{ slide_index: 2, similarity: 0.9 }],
        }),
      ),
    );

    const onSlideJump = vi.fn();
    const user = userEvent.setup();
    renderChat({ onSlideJump });

    await sendQuestion(user);

    const chip = await screen.findByRole("button", { name: /slide 3/i });
    expect(chip).not.toBeDisabled();

    await user.click(chip);
    expect(onSlideJump).toHaveBeenCalledTimes(1);
    expect(onSlideJump).toHaveBeenCalledWith(2);
  });

  it("renders no chips and never invokes onSlideJump when the response carries no citations", async () => {
    server.use(
      http.post("http://api.test/api/ai/chat", () =>
        HttpResponse.json({
          reply: "I cannot answer from the provided slides.",
          citations: [],
        }),
      ),
    );

    const onSlideJump = vi.fn();
    const user = userEvent.setup();
    renderChat({ onSlideJump });

    await sendQuestion(user);

    await waitFor(() => {
      expect(
        screen.getByText(/cannot answer from the provided slides/i),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /^slide \d+$/i })).toBeNull();
    expect(onSlideJump).not.toHaveBeenCalled();
  });
});
