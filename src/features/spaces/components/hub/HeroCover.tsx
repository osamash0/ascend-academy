import { AnimatePresence, motion } from 'motion/react';
import { coverFor, initialFor, SLATE_COVER } from '../../mocks/covers';

/**
 * The hero's cover art, full-bleed and fixed behind everything.
 *
 * **The cross-fade is deliberately slower than the text.** 0.75s here against
 * the foreground's 0.18s: the thing under your cursor answers immediately and
 * the world behind it takes its time. Matching them makes the backdrop twitchy;
 * closing the gap the other way makes the chips feel laggy.
 *
 * Opacity only. Two layers cross-fading is the one case where animating a
 * transform buys nothing — the art does not move, it replaces — and a scale on
 * a full-viewport element is the most expensive thing you can ask a compositor
 * for.
 *
 * `AnimatePresence` keyed by Space id, per the spec. `initial={false}` so the
 * first paint is the art already there rather than a fade from black, which on
 * a 100vh hero reads as the page loading twice.
 *
 * The scrims are three stacked gradients, not one: dark from the left so the
 * copy has ground under it, dark from the bottom so the chip row does, and a
 * light touch from the top so the bar has something to sit on. A single
 * diagonal cannot do all three without dimming the art it is protecting.
 */

export function HeroCover({ spaceId, name }: { spaceId: string; name: string }) {
  const isDiscover = spaceId === 'discover';
  const art = isDiscover ? SLATE_COVER : coverFor(spaceId);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      {/*
        The base sheen never changes, so it sits outside AnimatePresence. It is
        what stops a Space with dark art from bottoming out to flat #0a0b0d.
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(90% 70% at 18% 0%, rgba(255,255,255,.055) 0%, rgba(255,255,255,0) 55%), linear-gradient(160deg,#141519 0%,#0a0b0d 70%)',
        }}
      />

      <AnimatePresence initial={false}>
        <motion.div
          key={spaceId}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Slower than everything in the foreground, and eased both ways.
          transition={{ duration: 0.75, ease: 'easeInOut' }}
        >
          <div className="absolute inset-0" style={{ background: art }} />

          {/*
            The motif: one enormous initial, once, in the hero. Decoration —
            the name is always rendered as text as well, and the spec forbids
            this letter anywhere outside here.
          */}
          <div
            className="absolute bottom-[2%] right-[6%] font-bold leading-none text-white/10"
            style={{ fontSize: '24vw', letterSpacing: '-1vw' }}
          >
            {initialFor(name)}
          </div>

          <div
            className="absolute inset-0"
            style={{
              background: [
                'linear-gradient(90deg, rgba(8,9,11,.9) 0%, rgba(8,9,11,.62) 34%, rgba(8,9,11,.12) 62%, rgba(8,9,11,0) 78%)',
                'linear-gradient(0deg, rgba(10,11,13,.94) 0%, rgba(10,11,13,.28) 24%, rgba(10,11,13,0) 48%)',
                'linear-gradient(180deg, rgba(10,11,13,.4) 0%, rgba(10,11,13,0) 16%)',
              ].join(','),
            }}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
