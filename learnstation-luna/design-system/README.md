# 🌙 LearnStation Luna Design System

A customizable astronaut character + loader family for LearnStation v3.0. Built for React 18 + TypeScript + Tailwind CSS.

## Installation

Copy the `learnstation-luna/` folder into your project:

```bash
src/
  learnstation-luna/
    components/
      LunaAstronaut.tsx
      LunaLoader.tsx
    hooks/
      useLunaPhase.ts
    types/
      luna.ts
    utils/
      colors.ts
    index.ts
```

## Quick Start

```tsx
import { LunaAstronaut, LunaLoader, useLunaPhase } from './learnstation-luna';

// Full character
<LunaAstronaut phase="full" size="lg" animated />

// Loader
<LunaLoader type="helmet-float" size={64} phase="quarter" />

// With user preference
function App() {
  const { phase, setPhase } = useLunaPhase('full');
  return (
    <>
      <LunaAstronaut phase={phase} size="xl" />
      <button onClick={() => setPhase('dark')}>Dark Mode</button>
    </>
  );
}
```

## Moon Phases

| Phase | Value | Vibe |
|-------|-------|------|
| `full` | 0 | Bright, warm, welcoming |
| `gibbous` | 25 | Soft, calm, steady |
| `quarter` | 50 | Balanced, focused, neutral |
| `crescent` | 75 | Moody, deep, intense |
| `dark` | 95 | Mysterious, sleek, minimal |
| `number` | 0-100 | Smooth interpolation between any point |

## Loaders

### Luna Astronaut Loaders
- `helmet-float` — Page load, welcome, idle
- `oxygen-breathing` — Calm wait, meditation, focus
- `star-patch` — Achievements, XP gain, rewards
- `suit-charge` — Saving, uploading, installing
- `comms-blink` — Connecting, syncing, live chat

### Byte Pilot Loaders
- `thruster-hover` — Page load, welcome, boot
- `warp-speed` — Fast actions, transitions, routing
- `orbit-ring` — Data syncing, connecting
- `docking` — Saving, uploading, batch ops

## Identity Anchors (Never Change)

These elements stay constant across all phases to preserve Luna's identity:

- **Eyes**: White sclera + dark pupil, always
- **Blush**: `#E8A598` at 50% opacity, always
- **Craters**: Always visible, only tone shifts
- **Helmet**: Teal ring + glass visor, always

## What Shifts

- **Face tone**: `#FFFEF5` → `#1A1425`
- **Visor tint**: Warm gold → cool teal → deep purple
- **Glow aura**: Bright ambient → dim → none
- **Crater contrast**: Increases with darkness

## CSS Custom Properties (Optional)

Add to your Tailwind config or global CSS:

```css
:root {
  --luna-face: #FFF8E7;
  --luna-visor: #88B0B5;
  --luna-glow: rgba(255, 217, 61, 0.15);
}

[data-luna-phase="dark"] {
  --luna-face: #1A1425;
  --luna-visor: #6B5B95;
  --luna-glow: transparent;
}
```

## Performance

- Pure SVG + SMIL animations — no JavaScript animation overhead
- `useMemo` on color calculations
- Gradient IDs are phase-unique to prevent cache collisions
- ~3KB gzipped per component

## Browser Support

- Chrome 84+, Firefox 75+, Safari 14+, Edge 84+
- SMIL animations work in all modern browsers
- Graceful degradation: static SVG if SMIL unsupported

## License

Internal to LearnStation. Do not distribute.
