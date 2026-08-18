/**
 * Roadmap Phase 5.2 ("regenerate with feedback"): the professor-only
 * regenerate-content panel on SlideViewer — instruction input, submit, and
 * the single-level undo affordance.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";

// M22: react-pdf's real Document does a network fetch + pdf.js worker parse,
// neither of which belongs in this unit test. Stub it so tests can control
// exactly when a load "succeeds" vs. "fails" via the file url passed in.
vi.mock("react-pdf", () => ({
  Document: ({
    file,
    children,
    onLoadError,
  }: {
    file?: string | null;
    children?: React.ReactNode;
    onLoadError?: (err: Error) => void;
  }) => {
    useEffect(() => {
      if (file !== "https://example.com/broken.pdf") return;
      // Fire asynchronously, like a real failed network fetch would -- doing
      // it synchronously during the same mount commit as SlideViewer's own
      // "reset pdfError when pdfUrl changes" effect would let mount ordering
      // (child effects before parent effects) mask the error.
      const timer = setTimeout(() => onLoadError?.(new Error("Failed to fetch PDF")), 0);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: () => <div data-testid="pdf-page" />,
  pdfjs: { GlobalWorkerOptions: {} as { workerSrc?: string } },
}));

import { SlideViewer } from "@/components/SlideViewer";

function renderViewer(props: Partial<React.ComponentProps<typeof SlideViewer>> = {}) {
  return render(
    <SlideViewer
      title="Intro to Gradients"
      content="Some content"
      summary="A summary of the slide."
      slideNumber={1}
      totalSlides={3}
      onPrevious={() => {}}
      onNext={() => {}}
      isFirst
      isLast={false}
      {...props}
    />,
  );
}

describe("SlideViewer — regenerate with feedback (Roadmap 5.2)", () => {
  it("hides the regenerate toggle for students", () => {
    renderViewer({ isProfessor: false, onRegenerateContent: vi.fn() });
    expect(screen.queryByTestId("regenerate-content-toggle")).not.toBeInTheDocument();
  });

  it("hides the regenerate toggle when no handler is supplied, even for professors", () => {
    renderViewer({ isProfessor: true, onRegenerateContent: undefined });
    expect(screen.queryByTestId("regenerate-content-toggle")).not.toBeInTheDocument();
  });

  it("opens the panel and submits an instruction", async () => {
    const onRegenerateContent = vi.fn();
    renderViewer({ isProfessor: true, onRegenerateContent });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    const input = screen.getByTestId("regenerate-instruction-input");
    await user.type(input, "Focus on the proof steps.");
    await user.click(screen.getByTestId("regenerate-content-submit"));

    expect(onRegenerateContent).toHaveBeenCalledWith("Focus on the proof steps.");
  });

  it("submits an empty string when the instruction is left blank, so the backend can tell 'clear it' apart from 'reuse the last one'", async () => {
    const onRegenerateContent = vi.fn();
    renderViewer({ isProfessor: true, onRegenerateContent });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));
    await user.click(screen.getByTestId("regenerate-content-submit"));

    expect(onRegenerateContent).toHaveBeenCalledWith("");
  });

  it("submits an empty string when a previously-set instruction is cleared, so it doesn't silently keep reapplying", async () => {
    const onRegenerateContent = vi.fn();
    renderViewer({ isProfessor: true, onRegenerateContent, regenInstruction: "Old instruction." });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));
    const input = screen.getByTestId("regenerate-instruction-input");
    await user.clear(input);
    await user.click(screen.getByTestId("regenerate-content-submit"));

    expect(onRegenerateContent).toHaveBeenCalledWith("");
  });

  it("prefills the instruction input from a persisted regenInstruction", async () => {
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      regenInstruction: "Keep it concise.",
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    expect(screen.getByTestId("regenerate-instruction-input")).toHaveValue("Keep it concise.");
  });

  it("shows the undo affordance only when canUndoRegenerate is true", async () => {
    const onUndoRegenerate = vi.fn();
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      canUndoRegenerate: true,
      onUndoRegenerate,
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    const undoButton = screen.getByTestId("regenerate-undo");
    await user.click(undoButton);
    expect(onUndoRegenerate).toHaveBeenCalledTimes(1);
  });

  it("hides the undo affordance when canUndoRegenerate is false", async () => {
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      canUndoRegenerate: false,
      onUndoRegenerate: vi.fn(),
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    expect(screen.queryByTestId("regenerate-undo")).not.toBeInTheDocument();
  });

  it("disables submit and undo while a regenerate is in flight", async () => {
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      isRegeneratingContent: true,
      canUndoRegenerate: true,
      onUndoRegenerate: vi.fn(),
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    expect(screen.getByTestId("regenerate-content-submit")).toBeDisabled();
    expect(screen.getByTestId("regenerate-undo")).toBeDisabled();
  });
});

describe("SlideViewer — PDF panel error state (M22)", () => {
  it("hides the PDF panel entirely when the lecture genuinely has no PDF", () => {
    renderViewer({ pdfUrl: null, pdfLoadFailed: false });
    expect(screen.queryByText("Original Source Material")).not.toBeInTheDocument();
  });

  it("shows an error state with a retry button when the parent failed to resolve a signed URL", async () => {
    const onPdfRetry = vi.fn();
    renderViewer({ pdfUrl: null, pdfLoadFailed: true, onPdfRetry });

    expect(screen.getByText("Original Source Material")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-document")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("pdf-retry-button"));
    expect(onPdfRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when no retry handler is supplied", () => {
    renderViewer({ pdfUrl: null, pdfLoadFailed: true });
    expect(screen.getByTestId("pdf-error-state")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-retry-button")).not.toBeInTheDocument();
  });

  it("shows the error state instead of silently unmounting the whole panel when the Document fails to load", async () => {
    const onPdfRetry = vi.fn();
    renderViewer({ pdfUrl: "https://example.com/broken.pdf", onPdfRetry });

    expect(await screen.findByTestId("pdf-error-state")).toBeInTheDocument();
    expect(screen.getByText("Original Source Material")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-document")).not.toBeInTheDocument();
  });

  it("renders the PDF normally when the resolved url loads without error (no regression)", () => {
    renderViewer({ pdfUrl: "https://example.com/good.pdf" });
    expect(screen.getByTestId("pdf-document")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-error-state")).not.toBeInTheDocument();
  });
});
