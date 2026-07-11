# Chatbot UI Layout Customizer

Design specification for adding layout customizability in the lecture player inline view in the Library (`http://127.0.0.1:8080/library`).

## Goal
Allow the user to customize the sizes and placement of the slide and chat/notes columns in the lecture player screen using a sleek layout editing control panel.

## Design Details

### 1. State and Storage
- **State**:
  - `isEditingLayout`: boolean (toggles layout controls panel).
  - `columnPlacement`: `'left-right'` | `'right-left'` (slide on left vs slide on right).
  - `columnRatio`: `'50-50'` | `'60-40'` | `'40-60'` (column width proportions).
- **Persistence**: Save preferences to `localStorage` under `ascend_player_layout_pref` as a JSON object on change. Load from it on component mount.

### 2. Layout Editing Interface
- Render an edit layout button (represented by a clean settings/layout slider icon like `Settings2` or `Sliders`) at the top right of the lecture player header.
- When clicked, it toggles a sleek, borderless, glassmorphic dropdown panel (`isEditingLayout === true`) with smooth animations (Framer Motion).
- The panel contains two options rows:
  - **Layout Placement**: Toggle buttons for `[Slide Left | Chat Right]` and `[Chat Left | Slide Right]`.
  - **Column Size Ratio**: Toggle buttons for `[40 / 60]`, `[50 / 50]`, and `[60 / 40]`.

### 3. Tailwind Layout Grid Integration
- Update the columns container to dynamically resolve the column width splits and orders:
  - Order:
    - Slide column: `columnPlacement === 'left-right' ? 'lg:order-1' : 'lg:order-2'`
    - Right content column: `columnPlacement === 'left-right' ? 'lg:order-2' : 'lg:order-1'`
  - Ratio (applied to the parent grid `grid grid-cols-1 gap-6 pt-4 lg:grid`):
    - `'50-50'`: `lg:grid-cols-2`
    - `'60-40'`:
      - If `columnPlacement === 'left-right'`: `lg:grid-cols-[1.2fr_0.8fr]`
      - If `columnPlacement === 'right-left'`: `lg:grid-cols-[0.8fr_1.2fr]`
    - `'40-60'`:
      - If `columnPlacement === 'left-right'`: `lg:grid-cols-[0.8fr_1.2fr]`
      - If `columnPlacement === 'right-left'`: `lg:grid-cols-[1.2fr_0.8fr]`

## Verification Plan
- Verify layout settings persist across reloads.
- Verify column orders swap correctly when selecting different alignments.
- Verify sizes adjust dynamically on split selections.
