# Full Journeys Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing PixiJS `OnboardingJourneyMap` into a comprehensive `FullJourneyPath` component for the student dashboard, visualizing their entire curriculum and progress like a continuous, interactive trail.

**Architecture:** We will extend the existing PixiJS scene (`journeyMapScene.ts`) to support dynamic data loading, scrolling/panning for long paths, and interactive nodes representing lectures, quizzes, and milestones. The component will consume the student's actual enrolled courses and progress from Supabase and render them on a winding 2D path.

**Tech Stack:** React, PixiJS (`pixi.js`), Supabase (data fetching), Framer Motion (UI overlays).

## Global Constraints

- Must follow the Learnstation design system and brand voice (calm, focused, no "Ascend" references).
- Must be accessible via keyboard (visually hidden interactive list fallback for screen readers).
- Must perform well on mobile (PixiJS canvas should handle resizing and touch panning smoothly).
- Uses standard React + PixiJS integration patterns already established in `PixiLab.tsx`.

---

## Open Questions for Review

> [!WARNING]
> **User Feedback Required Before Execution:**
> 1. **Scope Confirmation:** Does this "Full Journeys Path" refer to the visual curriculum map (like Duolingo's learning path) on the Student Dashboard, or did you mean documenting the 3 high-value End-to-End Test Journeys? 
> 2. **Data Model:** Do we already have the curriculum progression data (courses/modules order) fully defined in Supabase, or should this plan include creating those tables/mock data?
> 3. **Interactivity:** Should clicking a node on the full journey path immediately navigate the user to the `LectureView`, or open a detail drawer first?

---

### Task 1: Extend PixiJS Scene for Full Curriculum Path

**Files:**
- Create: `src/features/student/pixi/fullJourneyScene.ts`
- Modify: `src/features/student/pixi/index.ts` (if it exists, else create it)
- Test: `src/__tests__/pixi/fullJourneyScene.test.ts`

**Interfaces:**
- Consumes: Theme palette from `useTheme()`, curriculum node data (id, label, status: 'locked' | 'active' | 'completed').
- Produces: A PixiJS Application instance with a scrollable/draggable container mapping out the nodes.

- [ ] **Step 1: Write the failing test for the scene initializer**

```typescript
// src/__tests__/pixi/fullJourneyScene.test.ts
import { Application } from 'pixi.js';
import { createFullJourneyScene } from '@/features/student/pixi/fullJourneyScene';

describe('FullJourneyScene', () => {
  it('initializes with the correct number of nodes', async () => {
    const app = new Application();
    await app.init({ width: 800, height: 600 });
    const scene = createFullJourneyScene(app, {
      nodes: [
        { id: '1', label: 'Intro', status: 'completed' },
        { id: '2', label: 'Basics', status: 'active' },
        { id: '3', label: 'Advanced', status: 'locked' }
      ]
    });
    
    expect(scene.stops.length).toBe(3);
    app.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/pixi/fullJourneyScene.test.ts`
Expected: FAIL with "createFullJourneyScene is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/student/pixi/fullJourneyScene.ts
import { Application, Container, Graphics, Text } from 'pixi.js';

export interface JourneyNode {
  id: string;
  label: string;
  status: 'locked' | 'active' | 'completed';
}

export interface FullJourneySceneOpts {
  nodes: JourneyNode[];
  reduceMotion?: boolean;
}

export function createFullJourneyScene(app: Application, opts: FullJourneySceneOpts) {
  const root = new Container();
  const stops: { x: number; y: number; data: JourneyNode }[] = [];
  
  // Basic winding path logic (scaled up version of onboarding)
  const spacingY = 150;
  let currentY = 50;
  
  opts.nodes.forEach((node, i) => {
    const x = app.screen.width / 2 + Math.sin(i) * 100;
    stops.push({ x, y: currentY, data: node });
    currentY += spacingY;
  });

  app.stage.addChild(root);

  return { root, stops, update: () => {} };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/pixi/fullJourneyScene.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/pixi/fullJourneyScene.test.ts src/features/student/pixi/fullJourneyScene.ts
git commit -m "feat: implement baseline PixiJS scene for full journey path"
```

---

### Task 2: Create the React Wrapper Component

**Files:**
- Create: `src/features/student/components/FullJourneyPath.tsx`
- Modify: `src/pages/StudentDashboard.tsx:120-130`
- Test: `src/__tests__/components/FullJourneyPath.test.tsx`

**Interfaces:**
- Consumes: `JourneyNode[]` from parent.
- Produces: `<FullJourneyPath nodes={nodes} onNodeSelect={(id) => ...} />`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/FullJourneyPath.test.tsx
import { render, screen } from '@testing-library/react';
import { FullJourneyPath } from '@/features/student/components/FullJourneyPath';

describe('FullJourneyPath', () => {
  it('renders the canvas and fallback accessibility list', () => {
    render(<FullJourneyPath nodes={[{ id: '1', label: 'Test Node', status: 'active' }]} onNodeSelect={vi.fn()} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('Test Node')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/FullJourneyPath.test.tsx`
Expected: FAIL with "FullJourneyPath not found"

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/student/components/FullJourneyPath.tsx
import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import { createFullJourneyScene, JourneyNode } from '../pixi/fullJourneyScene';

interface Props {
  nodes: JourneyNode[];
  onNodeSelect: (id: string) => void;
}

export function FullJourneyPath({ nodes, onNodeSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const app = new Application();
    
    const initPixi = async () => {
      await app.init({ 
        width: containerRef.current!.clientWidth, 
        height: 600, 
        backgroundAlpha: 0 
      });
      containerRef.current!.appendChild(app.canvas);
      createFullJourneyScene(app, { nodes });
    };

    initPixi();

    return () => {
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    };
  }, [nodes]);

  return (
    <div className="relative w-full">
      <div ref={containerRef} className="w-full h-[600px] overflow-hidden rounded-xl border border-white/10" aria-hidden="true" />
      
      {/* Screen reader fallback */}
      <ul className="sr-only">
        {nodes.map(n => (
          <li key={n.id}>
            <button onClick={() => onNodeSelect(n.id)}>{n.label} - {n.status}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/FullJourneyPath.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/components/FullJourneyPath.test.tsx src/features/student/components/FullJourneyPath.tsx
git commit -m "feat: add React wrapper for FullJourneyPath Pixi scene"
```

---

### Task 3: Integrate with Student Dashboard and Data Layer

**Files:**
- Modify: `src/pages/StudentDashboard.tsx`
- Modify: `src/services/studentService.ts`

**Interfaces:**
- Consumes: Supabase API for fetching `user_curriculum_progress`
- Produces: Integrated dashboard view

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/pages/StudentDashboard.test.tsx
// Add this new test case to the existing file
import { render, screen, waitFor } from '@testing-library/react';
import StudentDashboard from '@/pages/StudentDashboard';

// Mock the FullJourneyPath to avoid PixiJS webgl issues in JSDOM
vi.mock('@/features/student/components/FullJourneyPath', () => ({
  FullJourneyPath: () => <div data-testid="mock-journey-path" />
}));

it('renders the full journey path on the dashboard', async () => {
  render(<StudentDashboard />);
  await waitFor(() => {
    expect(screen.getByTestId('mock-journey-path')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/pages/StudentDashboard.test.tsx`
Expected: FAIL 

- [ ] **Step 3: Write minimal implementation**

```tsx
// Edit src/pages/StudentDashboard.tsx to include the component
import { FullJourneyPath } from '@/features/student/components/FullJourneyPath';

// Inside StudentDashboard component, mock data for now if no service exists, or use existing hooks:
const mockNodes = [
  { id: 'l1', label: 'Welcome to Learnstation', status: 'completed' as const },
  { id: 'l2', label: 'First Concepts', status: 'active' as const },
  { id: 'l3', label: 'Deep Dive', status: 'locked' as const },
];

// Add this in the main content area (e.g., replacing a static section)
<section className="mt-8">
  <h2 className="text-xl font-semibold mb-4 text-white">Your Learning Journey</h2>
  <FullJourneyPath 
    nodes={mockNodes} 
    onNodeSelect={(id) => console.log('Navigate to', id)} 
  />
</section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/pages/StudentDashboard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/StudentDashboard.tsx src/__tests__/pages/StudentDashboard.test.tsx
git commit -m "feat: integrate FullJourneyPath into StudentDashboard"
```
