# Chatbot UI Redesign: Calm & Immersive Chat Window

Design specification for adjusting the student chatbot UI in the lecture player screen inside `http://127.0.0.1:8080/library`.

## Goal
Make the chatbot interface feel comfy, smooth, natural, and calm by removing the isolated container box and scrollbar constraints, aligning the panels, removing AI Tutor branding elements, and integrating the text directly into the page background.

## User Review Required
No breaking backend changes are introduced. This is a frontend layout and styling update.

## Design Details

### 1. Layout & Column Alignment
- **Left Column**: Keep the slide viewer (PDF container) and the chat input form. Make the left column sticky (`lg:sticky lg:top-8 lg:h-fit`) so that the slide and chat input stay fixed in the viewport as the page scrolls.
- **Right Column**: Remove the height constraint (`lg:h-[var(--pdf-h)]`) and the scrollbar wrapper (`lg:overflow-y-auto`). Let the right column flow naturally. The page will scroll if the chat history gets long.
- **Parent Grid**: Retain the `grid grid-cols-1 lg:grid-cols-2` structure.

### 2. Header Simplification
- **Remove Branding**: Remove the header bar border, "AI Tutor" name text, the gradient icon container with Sparkles icon, and the lecture/slide subtitle text.
- **Keep Controls**: Keep only the back arrow (`ArrowLeft`) button to allow the user to go back to slide notes. Position this button cleanly at the top-left of the chat area, blending in naturally.

### 3. Frameless Chat Messages (Cozy & Cozy Typography)
- **Remove Bubbles**: Remove the background bubbles, borders, and rounded shapes from the chat messages (both user and AI).
- **User Messages**: Align to the left (or keep standard left-aligned but with a soft identifier) with a very clean, dim, or soft primary-tinted text.
- **AI Messages**: Rendered directly as clean typography on the background.
- **Spacing**: Use `space-y-8` for message containers to give the conversation plenty of breathing room.

## Verification Plan
- Verify visually by opening a lecture in the library and clicking "Ask AI about this slide".
- Test scrolling to ensure the left column remains sticky and the right column flows naturally.
- Ensure that clicking the back arrow returns the user to the slide notes.
