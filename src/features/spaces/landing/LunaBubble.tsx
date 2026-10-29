import { Suspense, lazy } from 'react';

/* Lazy, so the door's own bundle doesn't carry the avatar art. */
const LunaAvatar = lazy(() => import('@/features/avatar/LunaAvatar').then((m) => ({ default: m.LunaAvatar })));

/**
 * Luna, saying the one line the room has for its owner.
 *
 * Her real face at a size you can read (never abstracted), beside one
 * sentence in a bubble. The door's lede lives here rather than under the
 * title, so it is said once and by her.
 */
export function LunaBubble({ text, size = 64 }: { text: string; size?: number }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden className="shrink-0" style={{ width: size, height: size }}>
        <Suspense fallback={null}>
          <LunaAvatar variant="head" size={size} showBackdrop={false} title="" />
        </Suspense>
      </span>
      <p className="rounded-2xl rounded-bl-md border border-white/[0.1] bg-white/[0.06] px-5 py-3.5 text-[16px] leading-snug">{text}</p>
    </div>
  );
}
