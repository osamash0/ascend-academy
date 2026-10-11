/**
 * Luna's space suit — drawn under the helmet in the full-body variant.
 *
 * Shares LunaAvatar's coordinate system (helmet centred at 80,62, r=38, so
 * its lower edge sits at y=100); the chest patch is drawn at (80,127).
 * (A home look replaces this suit entirely — see outfits.tsx.)
 */
import type { ReactNode } from 'react';

const INK = '#4A3F6B';
const GLOVE = '#F4F1FA';
const BOOT = '#3B3352';

interface BodyProps {
  suitFill: string | undefined;
  suitInk: string;
  collar: string | undefined;
  patch: ReactNode;
}

function ChestPanel({ patch, y = 118, h = 19 }: { patch: ReactNode; y?: number; h?: number }) {
  return (
    <>
      <rect x="66" y={y} width="28" height={h} rx="7" fill={GLOVE} stroke={INK} strokeWidth="1.4" opacity="0.95" />
      {patch}
    </>
  );
}

/**
 * A real little astronaut: life-support pack, padded sleeves, gloves,
 * boots, and a collar ring that joins helmet to suit.
 */
export function LunaBody({ suitFill, suitInk, collar, patch }: BodyProps) {
  return (
    <g strokeLinejoin="round">
      {/* life-support pack, peeking out behind the shoulders */}
      <rect x="47" y="104" width="66" height="42" rx="14" fill={suitFill} stroke={suitInk} strokeWidth="2.2" />
      <rect x="47" y="104" width="66" height="42" rx="14" fill={INK} opacity="0.16" />

      {/* legs + boots */}
      <rect x="63" y="140" width="14" height="22" rx="7" fill={suitFill} stroke={suitInk} strokeWidth="2.2" />
      <rect x="83" y="140" width="14" height="22" rx="7" fill={suitFill} stroke={suitInk} strokeWidth="2.2" />
      <rect x="60" y="156" width="19" height="10" rx="5" fill={BOOT} stroke="#2D2445" strokeWidth="1.2" />
      <rect x="81" y="156" width="19" height="10" rx="5" fill={BOOT} stroke="#2D2445" strokeWidth="1.2" />

      {/* padded sleeves + gloves */}
      <rect x="45" y="105" width="15" height="30" rx="7.5" fill={suitFill} stroke={suitInk} strokeWidth="2.2" transform="rotate(22 56 110)" />
      <rect x="100" y="105" width="15" height="30" rx="7.5" fill={suitFill} stroke={suitInk} strokeWidth="2.2" transform="rotate(-22 104 110)" />
      <circle cx="43" cy="135" r="6.5" fill={GLOVE} stroke={INK} strokeWidth="1.8" />
      <circle cx="117" cy="135" r="6.5" fill={GLOVE} stroke={INK} strokeWidth="1.8" />

      {/* torso */}
      <rect x="55" y="98" width="50" height="54" rx="22" fill={suitFill} stroke={suitInk} strokeWidth="2.5" />
      <path d="M57 140 Q80 146 103 140" stroke={suitInk} strokeWidth="2" fill="none" opacity="0.35" strokeLinecap="round" />
      <ChestPanel patch={patch} />

      {/* collar ring where the helmet seals onto the suit */}
      <ellipse cx="80" cy="100" rx="23" ry="6.5" fill={collar} stroke={INK} strokeWidth="2" />
    </g>
  );
}
