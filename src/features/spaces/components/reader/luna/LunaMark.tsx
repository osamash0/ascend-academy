import { Suspense, lazy } from 'react';

/* Lazy, so the reader's own bundle doesn't carry the avatar art (as LunaGuide does). */
const LunaAvatar = lazy(() =>
  import('@/features/avatar/LunaAvatar').then((m) => ({ default: m.LunaAvatar })),
);

const SIZE = 22;

/** Luna's real face, small: the reader's way into a study session. */
export function LunaMark() {
  return (
    <span aria-hidden className="inline-flex shrink-0" style={{ width: SIZE, height: SIZE }}>
      <Suspense fallback={null}>
        <LunaAvatar variant="head" size={SIZE} showBackdrop={false} animated={false} title="" />
      </Suspense>
    </span>
  );
}
