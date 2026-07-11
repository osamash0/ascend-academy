// LearnStation Luna — Astronaut Character Component
// React 18 + TypeScript + Tailwind-ready

import React, { useMemo } from 'react';
import { getLunaColors, phaseToNumber } from '../utils/colors';
import type { LunaConfig } from '../types/luna';

const SIZE_MAP = { sm: 80, md: 120, lg: 160, xl: 200 };

export const LunaAstronaut: React.FC<LunaConfig> = ({
  phase = 'full',
  size = 'lg',
  animated = true,
  showShadow = true,
  suitColor = '#FFF8E7',
  visorTint = '#88B0B5',
  patchEmoji,
}) => {
  const phaseNum = phaseToNumber(phase);
  const colors = useMemo(() => getLunaColors(phaseNum), [phaseNum]);
  const pixelSize = SIZE_MAP[size] || 160;
  const viewBox = "0 0 160 180";

  return (
    <div
      className="inline-block"
      style={{ width: pixelSize, height: (pixelSize * 180) / 160 }}
      aria-label={`Luna astronaut, moon phase ${phase}`}
    >
      <svg
        viewBox={viewBox}
        width="100%"
        height="100%"
        style={{ overflow: 'visible' }}
        role="img"
      >
        <defs>
          <radialGradient id={`lunaFace-${phaseNum}`} cx="40%" cy="35%">
            <stop offset="0%" stopColor={colors.faceLight} />
            <stop offset="60%" stopColor={colors.faceMid} />
            <stop offset="100%" stopColor={colors.faceDark} />
          </radialGradient>
          <radialGradient id={`lunaVisor-${phaseNum}`} cx="35%" cy="30%">
            <stop offset="0%" stopColor={colors.visorLight} stopOpacity="0.7" />
            <stop offset="50%" stopColor={colors.visorMid} stopOpacity="0.2" />
            <stop offset="100%" stopColor={colors.visorDark} stopOpacity="0.05" />
          </radialGradient>
          <radialGradient id={`lunaGlow-${phaseNum}`} cx="50%" cy="50%">
            <stop offset="0%" stopColor="#FFD93D" stopOpacity={colors.glowCoreOpacity} />
            <stop offset="100%" stopColor="#FFD93D" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="suitGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#E8E4F0" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Shadow */}
        {showShadow && (
          <ellipse cx="80" cy="168" rx="32" ry="6" fill="#0D0A14" opacity="0.5">
            {animated && (
              <>
                <animate attributeName="rx" values="32;24;32" dur="4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.25;0.5" dur="4s" repeatCount="indefinite" />
              </>
            )}
          </ellipse>
        )}

        <g>
          {animated && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -5; 0 0"
              dur="4s"
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
            />
          )}

          {/* Backpack */}
          <rect x="42" y="88" width="76" height="52" rx="16" fill="#4A3F6B" stroke="#2D2445" strokeWidth="2" opacity="0.9" />
          <rect x="48" y="94" width="64" height="40" rx="12" fill="#6B5B95" opacity="0.6" />
          <rect x="52" y="90" width="14" height="44" rx="7" fill="#88B0B5" opacity="0.4" stroke="#4A3F6B" strokeWidth="1" />
          <rect x="94" y="90" width="14" height="44" rx="7" fill="#88B0B5" opacity="0.4" stroke="#4A3F6B" strokeWidth="1" />
          <rect x="55" y="96" width="8" height="4" rx="2" fill="#FFD93D" opacity="0.8">
            {animated && <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite" />}
          </rect>
          <rect x="97" y="96" width="8" height="4" rx="2" fill="#E8A598" opacity="0.7">
            {animated && <animate attributeName="opacity" values="0.7;0.3;0.7" dur="2.5s" repeatCount="indefinite" begin="0.5s" />}
          </rect>

          {/* Suit body */}
          <rect x="48" y="96" width="64" height="56" rx="20" fill={suitColor} stroke="#4A3F6B" strokeWidth="2.5" />
          <rect x="48" y="96" width="64" height="56" rx="20" fill="url(#suitGrad)" opacity="0.25" />

          {/* Neck ring */}
          <ellipse cx="80" cy="96" rx="22" ry="8" fill={visorTint} stroke="#4A3F6B" strokeWidth="2" />
          <ellipse cx="80" cy="96" rx="18" ry="5" fill="#6B5B95" opacity="0.3" />

          {/* Chest module */}
          <rect x="60" y="104" width="40" height="28" rx="10" fill="#E8E4F0" stroke="#4A3F6B" strokeWidth="1.5" />
          <rect x="62" y="106" width="36" height="24" rx="8" fill="#1A1425" opacity="0.9" />
          <rect x="66" y="110" width="10" height="6" rx="2" fill="#6B5B95">
            {animated && <animate attributeName="fill" values="#6B5B95;#88B0B5;#6B5B95" dur="3s" repeatCount="indefinite" />}
          </rect>
          <rect x="78" y="110" width="10" height="6" rx="2" fill="#E8A598" opacity="0.7">
            {animated && <animate attributeName="opacity" values="0.7;0.3;0.7" dur="2s" repeatCount="indefinite" begin="0.5s" />}
          </rect>
          <rect x="88" y="110" width="4" height="6" rx="1" fill="#FFD93D" opacity="0.8">
            {animated && <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1s" repeatCount="indefinite" begin="0.6s" />}
          </rect>
          <rect x="66" y="118" width="20" height="3" rx="1.5" fill="#88B0B5" opacity="0.4">
            {animated && <animate attributeName="width" values="20;12;20" dur="2.5s" repeatCount="indefinite" />}
          </rect>

          {/* Star patch */}
          <circle cx="56" cy="112" r="8" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="1" />
          {patchEmoji ? (
            <text x="56" y="116" textAnchor="middle" fontSize="10" dominantBaseline="auto">{patchEmoji}</text>
          ) : (
            <path d="M56 106 L57 109 L60 109 L58 111 L59 114 L56 112 L53 114 L54 111 L52 109 L55 109 Z" fill="#FFD93D" stroke="#D4A017" strokeWidth="0.6" />
          )}

          {/* Name tag */}
          <rect x="96" y="108" width="12" height="8" rx="2" fill="#E8E4F0" stroke="#4A3F6B" strokeWidth="0.8" />
          <rect x="98" y="110" width="8" height="2" rx="1" fill="#4A3F6B" opacity="0.5" />
          <rect x="98" y="113" width="6" height="2" rx="1" fill="#4A3F6B" opacity="0.3" />

          {/* Arms */}
          <path d="M50 108 Q36 118 32 132" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <rect x="28" y="128" width="14" height="18" rx="7" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="1.5" transform="rotate(-12 35 137)" />
          <circle cx="30" cy="140" r="5" fill="#88B0B5" stroke="#4A3F6B" strokeWidth="1.5" />
          <circle cx="30" cy="138" r="2" fill="#88B0B5" opacity="0.5" />

          <path d="M110 108 Q124 118 128 132" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <rect x="118" y="128" width="14" height="18" rx="7" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="1.5" transform="rotate(12 125 137)" />
          <circle cx="130" cy="140" r="5" fill="#88B0B5" stroke="#4A3F6B" strokeWidth="1.5" />
          <circle cx="130" cy="138" r="2" fill="#88B0B5" opacity="0.5" />

          {/* Legs */}
          <path d="M66 148 Q64 162 62 170" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round">
            {animated && <animate attributeName="d" values="M66 148 Q64 162 62 170;M66 148 Q66 164 66 172;M66 148 Q64 162 62 170" dur="2s" repeatCount="indefinite" />}
          </path>
          <rect x="54" y="166" width="16" height="10" rx="5" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="1.5" />
          <ellipse cx="62" cy="174" rx="9" ry="4" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.5" />
          <ellipse cx="62" cy="172" rx="6" ry="2" fill="#88B0B5" opacity="0.4" />

          <path d="M94 148 Q96 162 98 170" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round">
            {animated && <animate attributeName="d" values="M94 148 Q96 162 98 170;M94 148 Q94 164 94 172;M94 148 Q96 162 98 170" dur="2s" repeatCount="indefinite" begin="0.5s" />}
          </path>
          <rect x="90" y="166" width="16" height="10" rx="5" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="1.5" />
          <ellipse cx="98" cy="174" rx="9" ry="4" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.5" />
          <ellipse cx="98" cy="172" rx="6" ry="2" fill="#88B0B5" opacity="0.4" />

          {/* === HELMET === */}
          <circle cx="80" cy="56" r="40" fill="none" stroke="#88B0B5" strokeWidth="3" opacity="0.9" />
          <circle cx="80" cy="56" r="37" fill="#E8E4F0" opacity="0.15" />

          {/* Visor */}
          <circle cx="80" cy="56" r="34" fill={`url(#lunaVisor-${phaseNum})`} opacity="0.4" stroke={visorTint} strokeWidth="1.5" />
          <circle cx="80" cy="56" r="34" fill="none" stroke="#4A3F6B" strokeWidth="2" opacity="0.6" />

          {/* Comms ring */}
          <rect x="42" y="48" width="6" height="16" rx="3" fill={visorTint} stroke="#4A3F6B" strokeWidth="1" />
          <circle cx="45" cy="52" r="2" fill="#FFD93D" opacity="0.8">
            {animated && <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.5s" repeatCount="indefinite" />}
          </circle>
          <circle cx="45" cy="60" r="2" fill="#E8A598" opacity="0.6">
            {animated && <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite" begin="0.5s" />}
          </circle>

          {/* === LUNA'S FACE === */}
          <circle cx="80" cy="56" r="28" fill={`url(#lunaFace-${phaseNum})`} stroke="#4A3F6B" strokeWidth="1.5" />
          <circle cx="80" cy="56" r="28" fill={`url(#lunaGlow-${phaseNum})`} opacity="0.3" />

          {/* Craters */}
          <circle cx="66" cy="44" r="4.5" fill="#000" opacity={0.08 + colors.craterBaseOpacity} />
          <circle cx="94" cy="50" r="5.5" fill="#000" opacity={0.06 + colors.craterBaseOpacity} />
          <circle cx="72" cy="68" r="3.5" fill="#000" opacity={0.07 + colors.craterBaseOpacity} />
          <circle cx="90" cy="64" r="2.5" fill="#000" opacity={0.05 + colors.craterBaseOpacity} />
          <circle cx="62" cy="58" r="2" fill="#000" opacity={0.06 + colors.craterBaseOpacity} />

          {/* Eyes — NEVER CHANGE */}
          <circle cx="72" cy="54" r="6" fill="white" stroke="#4A3F6B" strokeWidth="1.2" />
          <circle cx="72" cy="54" r="3" fill="#4A3F6B">
            {animated && <animate attributeName="cx" values="72;73;72" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="72" cy="52" r="1.5" fill="white" opacity="0.9" />

          <circle cx="88" cy="54" r="6" fill="white" stroke="#4A3F6B" strokeWidth="1.2" />
          <circle cx="88" cy="54" r="3" fill="#4A3F6B">
            {animated && <animate attributeName="cx" values="88;87;88" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="88" cy="52" r="1.5" fill="white" opacity="0.9" />

          {/* Sleepy lids */}
          <path d="M66 52 Q72 56 78 52" stroke="#4A3F6B" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5">
            {animated && <animate attributeName="d" values="M66 52 Q72 56 78 52;M66 54 Q72 58 78 54;M66 52 Q72 56 78 52" dur="4s" repeatCount="indefinite" keyTimes="0;0.05;0.1" />}
          </path>
          <path d="M82 52 Q88 56 94 52" stroke="#4A3F6B" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5">
            {animated && <animate attributeName="d" values="M82 52 Q88 56 94 52;M82 54 Q88 58 94 54;M82 52 Q88 56 94 52" dur="4s" repeatCount="indefinite" keyTimes="0;0.05;0.1" />}
          </path>

          {/* Smile */}
          <path d="M76 64 Q80 68 84 64" stroke="#4A3F6B" strokeWidth="2" fill="none" strokeLinecap="round" />

          {/* Blush — ALWAYS #E8A598 */}
          <circle cx="66" cy="60" r="4" fill="#E8A598" opacity="0.5" />
          <circle cx="94" cy="60" r="4" fill="#E8A598" opacity="0.5" />

          {/* Visor reflections */}
          <path d="M58 36 Q68 30 82 34" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.5" />
          <circle cx="62" cy="38" r="4" fill="white" opacity="0.3" />
          <path d="M88 40 Q92 38 96 42" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.3" />
        </g>
      </svg>
    </div>
  );
};

export default LunaAstronaut;
