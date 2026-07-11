# Chatbot UI Redesign: Calm & Immersive Chat Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the student chatbot UI to be larger, aligned, frameless, and integrated naturally into the background, removing the isolated box container and its scrollbar constraints.

**Architecture:** Change layout of the left column to be sticky and right column to flow naturally without height/overflow limits. Strip out background styling, border outlines, and branding text/icons from the chat view container. Format the chat bubbles to be frameless typography.

**Tech Stack:** React, Tailwind CSS, Framer Motion

## Global Constraints
- Keep all file styling changes local to the specified files.
- Ensure text visibility is maintained by selecting correct text colors for dark background.

---

### Task 1: Chatbot UI Layout and Alignments

**Files:**
- Modify: `src/features/student/components/InlineLecturePlayer.tsx:954-1142`

**Interfaces:**
- Consumes: None
- Produces: None

- [ ] **Step 1: Make Left Column Sticky & Remove Right Column Height Constraint**
  
  Locate the grid rendering around lines 954 and 1036. Modify them so that:
  - Left column has `lg:sticky lg:top-8 lg:h-fit` to lock the slide view and input box in place during scroll.
  - Right column has height matching constraints removed (`lg:h-[var(--pdf-h)] lg:overflow-y-auto` -> `flex flex-col lg:h-full`).

- [ ] **Step 2: Clean up Chat Container styling**
  
  In the `chatActive` branch, replace the isolated box styles (`border border-white/5 bg-[#0a0a12]/50 backdrop-blur-sm`) with a transparent flex container `flex flex-col min-h-[320px]`.

- [ ] **Step 3: Simplify Header elements**
  
  Remove the header bottom border, gradient icon with Sparkles, "AI Tutor" name, and current slide/lecture subtitle. Retain only a minimal circular back button containing the `ArrowLeft` icon.

- [ ] **Step 4: Style Message list to be frameless with spacing**
  
  Replace the message list container's scroll styles `custom-scrollbar flex-1 space-y-4 overflow-y-auto p-5` with a natural-flowing container `flex-1 space-y-8 px-2 py-4`.

- [ ] **Step 5: Format User & AI Messages**
  
  Remove bubble background colors (`bg-primary`, `bg-white/[0.03]`), borders, and rounded shapes. Format user messages with a clean text design aligned right with a tiny `You` label, and AI messages aligned left with a `Response` label.

- [ ] **Step 6: Commit changes**
  
  ```bash
  git add src/features/student/components/InlineLecturePlayer.tsx
  git commit -m "feat: redesign chatbot UI to be calm, frameless and sticky aligned"
  ```
