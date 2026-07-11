# Chatbot UI Layout Customizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a customizable layout feature inside the lecture player inline view in the Library (`http://127.0.0.1:8080/library`). The user can toggle column order and adjust column width splits, with their layout selection persisted in `localStorage`.

**Architecture:** Add `localStorage`-backed React states for `columnPlacement` and `columnRatio`. Implement an edit layout icon button in the header. Render a glassmorphic sliding config control panel when active. Map selections dynamically to Tailwind columns splits (`lg:grid-cols-[...]`) and orders (`lg:order-1`, `lg:order-2`).

**Tech Stack:** React, Tailwind CSS, Framer Motion, Lucide Icons

## Global Constraints
- Keep all modifications localized to [InlineLecturePlayer.tsx](file:///Users/abdullahabobaker/Desktop/ascend-academy/src/features/student/components/InlineLecturePlayer.tsx).
- Do not introduce breaking styling or runtime compilation issues.

---

### Task 1: Initialize Preferences State and LocalStorage Loading

**Files:**
- Modify: `src/features/student/components/InlineLecturePlayer.tsx`

**Interfaces:**
- Consumes: None
- Produces: Layout variables and states

- [ ] **Step 1: Define Layout Preferences Types and Hook up localStorage**
  
  At the beginning of `InlineLecturePlayer` component, import the `SlidersHorizontal` icon from `lucide-react`. Define states for:
  - `isEditingLayout` (boolean, default `false`)
  - `columnPlacement` (`'left-right'` | `'right-left'`, default `'left-right'`)
  - `columnRatio` (`'50-50'` | `'60-40'` | `'40-60'`, default `'50-50'`)
  
  Write a `useEffect` to load the layout preferences from `localStorage` under key `ascend_player_layout_pref` on component mount, and another `useEffect` to save to it whenever placement or ratio changes.

- [ ] **Step 2: Commit**
  
  ```bash
  git add src/features/student/components/InlineLecturePlayer.tsx
  git commit -m "feat: setup layout preference states and persistence in localStorage"
  ```

---

### Task 2: Implement Layout Control Panel UI & Toggle Button

**Files:**
- Modify: `src/features/student/components/InlineLecturePlayer.tsx`

**Interfaces:**
- Consumes: Layout variables and states
- Produces: Layout controls UI

- [ ] **Step 1: Add Edit Layout Button to Header**
  
  In the header actions container (next to the `Maximize2` button), render a `SlidersHorizontal` icon button.
  - Class: `console-focusable flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground`
  - Clicking this button toggles `isEditingLayout`.
  - Add active state visual highlight (e.g. `bg-white/10 text-foreground` if `isEditingLayout` is true).

- [ ] **Step 2: Render Customizer Control Panel**
  
  Right below the header strip, render a sliding configuration panel (`AnimatePresence`) when `isEditingLayout` is true.
  - Background styling: `rounded-2xl border border-white/5 bg-white/[0.02] p-4 backdrop-blur-md mb-4 flex flex-wrap gap-6 items-center justify-between`
  - **Left section**:
    - Title: "Column Placement"
    - Toggles: `Slide Left / Chat Right` and `Chat Left / Slide Right`.
  - **Middle section**:
    - Title: "Column Split Ratio"
    - Toggles: `40/60`, `50/50`, `60/40`.
  - **Right section**:
    - "Done" button to close the panel.

- [ ] **Step 3: Commit**
  
  ```bash
  git add src/features/student/components/InlineLecturePlayer.tsx
  git commit -m "feat: add Edit Layout button and sliding control panel UI"
  ```

---

### Task 3: Map Layout Preferences to Tailwind Grid and Column Classes

**Files:**
- Modify: `src/features/student/components/InlineLecturePlayer.tsx`

**Interfaces:**
- Consumes: Layout variables and states
- Produces: Dynamic layout styling

- [ ] **Step 1: Apply dynamic columns split to Grid container**
  
  Locate the grid container:
  ```tsx
  <div className="grid grid-cols-1 gap-6 pt-4 lg:grid-cols-2">
  ```
  Change this to dynamically compute its columns split class based on `columnRatio` and `columnPlacement`:
  - Split:
    - `'50-50'`: `lg:grid-cols-2`
    - `'60-40'`: `columnPlacement === 'left-right' ? 'lg:grid-cols-[1.2fr_0.8fr]' : 'lg:grid-cols-[0.8fr_1.2fr]'`
    - `'40-60'`: `columnPlacement === 'left-right' ? 'lg:grid-cols-[0.8fr_1.2fr]' : 'lg:grid-cols-[1.2fr_0.8fr]'`

- [ ] **Step 2: Apply dynamic orders to slide and chat columns**
  
  - Slide container (left column):
    Apply order class: `columnPlacement === 'left-right' ? 'lg:order-1' : 'lg:order-2'`
  - Right content container (notes/chat/quiz):
    Apply order class: `columnPlacement === 'left-right' ? 'lg:order-2' : 'lg:order-1'`

- [ ] **Step 3: Verify and compile**
  
  Run `npm run build` to verify there are no TypeScript or Tailwind compilation errors.

- [ ] **Step 4: Commit**
  
  ```bash
  git add src/features/student/components/InlineLecturePlayer.tsx
  git commit -m "feat: integrate layout preference order and ratio splits to Tailwind grid"
  ```
