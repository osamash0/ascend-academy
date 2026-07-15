# LectureView & InlineLecturePlayer Unification Design

## Context & Goal
The Ascend Academy application currently has two distinct lecture experiences:
- `InlineLecturePlayer.tsx`: A modern, 2-column inline layout used within the library with translucent glass aesthetics, horizontal syllabus rail, and integrated AI chat.
- `LectureView.tsx`: The full-route standalone lecture page (`/lecture/:lectureId`). It currently uses a traditional sidebar (`LectureSidebar`), `ResizablePanelGroup`, and a dedicated `LectureChat` sidebar.

**Goal:** Unify the design of `LectureView.tsx` to match the style and layout of `InlineLecturePlayer.tsx`, bringing the modern glass aesthetic, 2-column responsive layout, and horizontal syllabus rail to the full-route player, while retaining the full-route's extra features (Worksheets, Related Courses, Pomodoro Timer).

## Architecture & Layout

1. **Overall Layout:**
   - The `ResizablePanelGroup` and `LectureSidebar` will be removed.
   - We will adopt the 2-column layout (PDF on the left, interactive content on the right) with the same styling as `InlineLecturePlayer`.
   - The top header will be refined to match the translucent aesthetic, keeping the Pomodoro Timer, XP, and Quiz score counters.

2. **Horizontal Syllabus Rail:**
   - The horizontal scrollable syllabus rail (currently at the bottom/top of the content in `InlineLecturePlayer`) will replace the left-hand `LectureSidebar`.

3. **Right Column (Tabbed Interface):**
   - The right column will now host a tabbed interface to accommodate the extra panels that `LectureView.tsx` supports.
   - **Tabs:**
     - **Slide (Notes & Chat):** The default view containing the markdown-rendered slide narrative (`PROSE_CLASS`) and the inline Chat input. Submitting a question will switch this view to the conversation transcript, just like in `InlineLecturePlayer`.
     - **Worksheets:** Renders the `WorksheetsPanel` and `StudentPracticeSheetsPanel`.
     - **Related:** Renders the `RelatedAcrossCoursesPanel`.
   - When a quiz is active (e.g. at the end of a slide), the quiz card will take precedence in this column.

4. **LectureChat vs Inline Chat:**
   - We will migrate to the inline chat approach used in `InlineLecturePlayer` rather than the dedicated right-sidebar `LectureChat`, ensuring the visual style matches.
   - The AI Tutor interaction will happen in the "Slide" tab.

5. **Completion Recap:**
   - The end-of-lecture recap UI (`LectureRecap`) will render when the lecture completes, replacing the active tab content or taking over the right column.

## Edge Cases & Error Handling
- **Missing PDFs:** The player handles missing PDFs elegantly via the fallback gradient in `InlineLecturePlayer`; `LectureView` will adopt this.
- **Mobile Responsiveness:** The 2-column layout will stack on smaller screens (controlled via grid and `useIsMobile`).

## Testing Strategy
- Ensure all existing unit tests pass (e.g. `src/__tests__/pages/LectureView.test.tsx`).
- Verify that state (XP, Quiz correct answers, correct streak) correctly persists when navigating between slides.
- Validate that the new Tab component switches gracefully without unmounting the Quiz or Chat state improperly.
