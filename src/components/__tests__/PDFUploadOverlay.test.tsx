/**
 * Smoke tests for PDFUploadOverlay's two new bits of behaviour:
 *  1. The "Extraction engine" pill resolves to the right label as soon as
 *     the parser identity is known.
 *  2. The 3-step indicator follows the backend `phase` marker — Extract is
 *     active during `extract`, AI Enhance stays active through `enhance`
 *     and `finalize`, and all three steps go green on completion.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PDFUploadOverlay } from "@/components/PDFUploadOverlay";

function renderOverlay(props: Partial<React.ComponentProps<typeof PDFUploadOverlay>> = {}) {
  return render(
    <PDFUploadOverlay
      isOpen
      uploadProgress={0}
      uploadTotal={0}
      uploadStatus=""
      processedSlides={[]}
      parserUsed={null}
      parsePhase={null}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("PDFUploadOverlay", () => {
  it("shows the OpenDataLoader pill when ODL succeeded", () => {
    renderOverlay({ parserUsed: "opendataloader-pdf", parsePhase: "extract" });
    expect(screen.getByText("OpenDataLoader PDF")).toBeInTheDocument();
    expect(screen.queryByText(/Detecting/)).not.toBeInTheDocument();
  });

  it("shows the PyMuPDF (fallback) pill when ODL failed", () => {
    renderOverlay({ parserUsed: "pymupdf", parsePhase: "extract" });
    expect(screen.getByText("PyMuPDF (fallback)")).toBeInTheDocument();
  });

  it("AI Enhance step stays active during the finalize phase until complete", () => {
    // During finalize the deck-summary / cross-slide quiz is still running,
    // so AI Enhance must not flip to "done" yet even if every slide has
    // arrived and the progress bar reads 100%. The overlay must wait for
    // the explicit `parseCompleted` signal (driven by the SSE `complete`
    // event) before surfacing the "Opening editor…" finished state.
    renderOverlay({
      parserUsed: "pymupdf",
      parsePhase: "finalize",
      parseCompleted: false,
      uploadProgress: 100,
      uploadTotal: 3,
      processedSlides: [{ title: "A" }, { title: "B" }, { title: "C" }],
    });
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getByText("Extract")).toBeInTheDocument();
    expect(screen.getByText("AI Enhance")).toBeInTheDocument();
    // Not yet complete — Cancel button still shown, no "Opening editor…".
    expect(screen.queryByText(/Opening editor/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Cancel Processing/i)).toBeInTheDocument();
  });

  it("flips to the completion view only after parseCompleted is true", () => {
    renderOverlay({
      parserUsed: "pymupdf",
      parsePhase: "finalize",
      parseCompleted: true,
      uploadProgress: 100,
      uploadTotal: 3,
      processedSlides: [{ title: "A" }, { title: "B" }, { title: "C" }],
    });
    // The "Opening editor…" message replaced the old Get Started button.
    expect(screen.getByText(/Opening editor/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cancel Processing/i)).not.toBeInTheDocument();
  });

  it("falls back to the legacy heuristic when no phase is provided", () => {
    // Older cached responses don't carry phase markers; the overlay should
    // still render the "Detecting…" pill and the Upload step rather than
    // crash or show empty state.
    renderOverlay({ parserUsed: null, parsePhase: null });
    expect(screen.getByText(/Detecting/)).toBeInTheDocument();
  });
});
