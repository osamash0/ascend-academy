/**
 * LunaAvatar — the layered, loadout-driven Luna.
 *
 * Paint order (back → front): backdrop, aura (back), suit body + patch,
 * helmet + face + expression, gear, aura (front), companion.
 *
 * `variant="head"` crops to the helmet for chips and lists; the companion
 * still orbits, so even a 36px avatar carries its owner's little buddy.
 */
import { useId, useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { getLunaColors } from '../../../learnstation-luna/utils/colors';
import { DEFAULT_LOADOUT, itemById } from './catalog';
import { moodPhase } from './mood';
import {
  Expression,
  drawAuraBack,
  drawAuraFront,
  drawBackdrop,
  drawCompanion,
  drawGear,
  drawPatch,
} from './art';
import type { Loadout, Mood } from './types';

const INK = '#4A3F6B';

function isDark(hex: string): boolean {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
}

export interface LunaAvatarProps {
  loadout?: Partial<Loadout>;
  mood?: Mood;
  variant?: 'full' | 'head';
  /** Rendered width in px. */
  size?: number;
  animated?: boolean;
  showBackdrop?: boolean;
  className?: string;
  title?: string;
}

export function LunaAvatar({
  loadout,
  mood = 'bright',
  variant = 'full',
  size = 160,
  animated = true,
  showBackdrop = true,
  className,
  title,
}: LunaAvatarProps) {
  const reduce = useReducedMotion();
  const anim = animated && !reduce;
  const uid = 'la' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const lo = { ...DEFAULT_LOADOUT, ...loadout };

  const suit = itemById(lo.suit) ?? itemById(DEFAULT_LOADOUT.suit)!;
  const visor = itemById(lo.visor) ?? itemById(DEFAULT_LOADOUT.visor)!;
  const colors = useMemo(() => getLunaColors(moodPhase(mood)), [mood]);
  const suitInk = suit.color && isDark(suit.color) ? '#A99BE0' : INK;
  const suitFill = suit.color2 ? `url(#${uid}-suit)` : suit.color;
  const visorStroke = visor.color2 ? `url(#${uid}-visor)` : visor.color;

  const head = variant === 'head';
  const viewBox = head ? '24 0 112 112' : '0 -8 160 188';
  const height = head ? size : (size * 188) / 160;
  const orbit = head
    ? { cx: 80, cy: 60, rx: 50, ry: 14 }
    : { cx: 80, cy: 86, rx: 68, ry: 20 };
  const orbitPath = `M ${orbit.cx - orbit.rx} ${orbit.cy} a ${orbit.rx} ${orbit.ry} 0 1 0 ${orbit.rx * 2} 0 a ${orbit.rx} ${orbit.ry} 0 1 0 ${-orbit.rx * 2} 0`;

  const companion = lo.companion !== 'companion-none' ? drawCompanion(lo.companion, uid, anim) : null;

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={height}
      className={className}
      role="img"
      aria-label={title ?? 'Luna avatar'}
      style={{ overflow: showBackdrop ? 'hidden' : 'visible', display: 'block' }}
    >
      <defs>
        <radialGradient id={`${uid}-face`} cx="40%" cy="35%">
          <stop offset="0%" stopColor={colors.faceLight} />
          <stop offset="65%" stopColor={colors.faceMid} />
          <stop offset="100%" stopColor={colors.faceDark} />
        </radialGradient>
        <radialGradient id={`${uid}-glass`} cx="50%" cy="50%">
          <stop offset="70%" stopColor={visor.color} stopOpacity="0" />
          <stop offset="100%" stopColor={visor.color} stopOpacity="0.35" />
        </radialGradient>
        {suit.color2 && (
          <linearGradient id={`${uid}-suit`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={suit.color} />
            <stop offset="100%" stopColor={suit.color2} />
            {anim && <animateTransform attributeName="gradientTransform" type="rotate" values="0 .5 .5;360 .5 .5" dur="8s" repeatCount="indefinite" />}
          </linearGradient>
        )}
        {visor.color2 && (
          <linearGradient id={`${uid}-visor`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={visor.color} />
            <stop offset="100%" stopColor={visor.color2} />
            {anim && <animateTransform attributeName="gradientTransform" type="rotate" values="0 .5 .5;360 .5 .5" dur="4s" repeatCount="indefinite" />}
          </linearGradient>
        )}
        {mood === 'blazing' && (
          <radialGradient id={`${uid}-blaze`}>
            <stop offset="0%" stopColor="#FFD93D" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FFD93D" stopOpacity="0" />
          </radialGradient>
        )}
      </defs>

      {showBackdrop && drawBackdrop(lo.backdrop, uid, anim)}
      {drawAuraBack(lo.aura, uid, anim)}
      {mood === 'blazing' && <circle cx="80" cy="62" r="54" fill={`url(#${uid}-blaze)`} />}

      {!head && (
        <ellipse cx="80" cy="170" rx="26" ry="5" fill="#0D0A14" opacity="0.4">
          {anim && <animate attributeName="rx" values="26;19;26" dur="4s" repeatCount="indefinite" />}
        </ellipse>
      )}

      <g>
        {anim && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0; 0 -5; 0 0"
            dur={mood === 'blazing' ? '2.6s' : '4s'}
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
          />
        )}

        {!head && (
          <g>
            <path d="M54 112 Q40 120 36 134" stroke={suitInk} strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M106 112 Q120 120 124 134" stroke={suitInk} strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <circle cx="35" cy="138" r="6.5" fill={suitFill} stroke={suitInk} strokeWidth="1.8" />
            <circle cx="125" cy="138" r="6.5" fill={suitFill} stroke={suitInk} strokeWidth="1.8" />
            <ellipse cx="66" cy="160" rx="9" ry="7" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />
            <ellipse cx="94" cy="160" rx="9" ry="7" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />
            <rect x="52" y="102" width="56" height="52" rx="24" fill={suitFill} stroke={suitInk} strokeWidth="2.5" />
            <rect x="66" y="118" width="28" height="19" rx="7" fill="#F4F1FA" stroke={INK} strokeWidth="1.4" opacity="0.95" />
            {drawPatch(lo.patch, uid, anim)}
          </g>
        )}

        {/* Helmet */}
        <circle cx="80" cy="62" r="38" fill={`url(#${uid}-glass)`} />
        <circle cx="80" cy="62" r="38" fill="none" stroke={visorStroke} strokeWidth="3" opacity="0.95" />
        <circle cx="80" cy="62" r="30" fill={`url(#${uid}-face)`} stroke={INK} strokeWidth="1.8" />
        <ellipse cx="64" cy="50" rx="4" ry="3" fill="#000" opacity={0.06 + colors.craterBaseOpacity} />
        <ellipse cx="94" cy="76" rx="3.5" ry="2.6" fill="#000" opacity={0.05 + colors.craterBaseOpacity} />

        <Expression mood={mood} animated={anim} />

        <circle cx="62" cy="68" r="3.6" fill="#E8A598" opacity="0.5" />
        <circle cx="98" cy="68" r="3.6" fill="#E8A598" opacity="0.5" />
        <path d="M52 42 Q64 32 82 36" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.45" />

        {drawGear(lo.gear, uid, anim)}
      </g>

      {drawAuraFront(lo.aura, uid, anim)}

      {companion && (
        <g>
          {anim ? (
            <g>
              <animateMotion dur="9s" repeatCount="indefinite" path={orbitPath} rotate="0" />
              <g transform={head ? 'scale(0.85)' : undefined}>{companion}</g>
            </g>
          ) : (
            <g transform={`translate(${orbit.cx + orbit.rx * 0.82} ${orbit.cy - orbit.ry * 1.6})${head ? ' scale(0.85)' : ''}`}>{companion}</g>
          )}
        </g>
      )}
    </svg>
  );
}

export default LunaAvatar;
