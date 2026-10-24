/**
 * The `ai_tutor_query` learning event used to carry the whole AI reply next
 * to the question (audit Q-B-F4). Both tutor surfaces now build the payload
 * through one helper: the question (bounded), never the answer.
 */
import { describe, expect, it } from "vitest";

import { buildTutorQueryEvent, TUTOR_QUERY_MAX_CHARS } from "@/lib/tutorEvents";

describe("buildTutorQueryEvent", () => {
  const base = {
    lectureId: "lec-1",
    slideId: "slide-3",
    slideTitle: "Normalization",
    sessionId: "sess-9",
    query: "why is 3NF not enough?",
  };

  it("never includes the model's reply", () => {
    const event = buildTutorQueryEvent({ ...base, response: "because of multivalued dependencies" } as never);
    expect(event).not.toHaveProperty("response");
  });

  it("keeps the attribution fields and a timestamp", () => {
    const event = buildTutorQueryEvent(base);
    expect(event).toMatchObject({
      lectureId: "lec-1",
      slideId: "slide-3",
      slideTitle: "Normalization",
      sessionId: "sess-9",
      query: "why is 3NF not enough?",
    });
    expect(typeof event.timestamp).toBe("string");
  });

  it("bounds the stored question", () => {
    const event = buildTutorQueryEvent({ ...base, query: "x".repeat(TUTOR_QUERY_MAX_CHARS + 50) });
    expect(event.query).toHaveLength(TUTOR_QUERY_MAX_CHARS);
  });
});
