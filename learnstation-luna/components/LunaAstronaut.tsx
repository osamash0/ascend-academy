// LearnStation Luna — Astronaut Character Component
// React 18 + TypeScript + Tailwind-ready

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { getLunaColors, phaseToNumber } from '../utils/colors';
import type { LunaConfig } from '../types/luna';

const SIZE_MAP = { xs: 44, sm: 80, md: 120, lg: 160, xl: 200, xxl: 320 };

export const LunaAstronaut: React.FC<LunaConfig> = ({
  phase = 'full',
  size = 'lg',
  animated = true,
  showShadow = true,
  variant = 'full',
  costume = 'default',
  suitColor = '#FFF8E7',
  visorTint = '#88B0B5',
  patchEmoji,
  patchImage,
}) => {
  const phaseNum = phaseToNumber(phase);
  const colors = useMemo(() => getLunaColors(phaseNum), [phaseNum]);
  const pixelSize = SIZE_MAP[size] || 160;
  const viewBox = '0 0 160 180';

  return (
    <motion.div
      className="inline-block cursor-pointer"
      style={{ width: pixelSize, height: (pixelSize * 180) / 160 }}
      aria-label={`Luna astronaut, moon phase ${phase}`}
      whileHover={{ scale: 1.05, y: -5 }}
      whileTap={{ scale: 0.9, y: 5, rotate: -5 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      <svg viewBox={viewBox} width="100%" height="100%" style={{ overflow: 'visible' }} role="img">
        <defs>
          <radialGradient id={`lunaFace-${phaseNum}`} cx="40%" cy="35%">
            <stop offset="0%" stopColor={colors.faceLight} />
            <stop offset="65%" stopColor={colors.faceMid} />
            <stop offset="100%" stopColor={colors.faceDark} />
          </radialGradient>
          <radialGradient id={`lunaGlow-${phaseNum}`} cx="50%" cy="50%">
            <stop offset="0%" stopColor="#FFD93D" stopOpacity={colors.glowCoreOpacity} />
            <stop offset="100%" stopColor="#FFD93D" stopOpacity="0" />
          </radialGradient>
        </defs>

        {showShadow && (
          <ellipse cx="80" cy="168" rx="26" ry="5.5" fill="#0D0A14" opacity="0.45">
            {animated && (
              <>
                <animate attributeName="rx" values="26;19;26" dur="4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.45;0.22;0.45" dur="4s" repeatCount="indefinite" />
              </>
            )}
          </ellipse>
        )}

        <g>
          {animated && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -6; 0 0"
              dur="4s"
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
            />
          )}

          {/* Suit body and limbs */}
          {variant === 'full' && (
            <>
              {/* Suit body */}
              <rect x="52" y="102" width="56" height="52" rx="24" fill={suitColor} stroke="#4A3F6B" strokeWidth="2.5" />

              {/* University Costume Tie */}
              {costume === 'university' && (
                <g transform="translate(80, 102)">
                  <path d="M-6 0 L6 0 L3 16 L-3 16 Z" fill="#8B5CF6" stroke="#4A3F6B" strokeWidth="1" opacity="0.9" />
                  <path d="M-8 0 Q0 6 8 0 Q0 -4 -8 0" fill="#FFD93D" stroke="#4A3F6B" strokeWidth="1" />
                </g>
              )}

              {/* Arms */}
              <path d="M54 112 Q40 120 36 134" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <circle cx="35" cy="138" r="6.5" fill={suitColor} stroke="#4A3F6B" strokeWidth="1.8" />
              <path d="M106 112 Q120 120 124 134" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <circle cx="125" cy="138" r="6.5" fill={suitColor} stroke="#4A3F6B" strokeWidth="1.8" />

              {/* Legs */}
              <ellipse cx="66" cy="160" rx="9" ry="7" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />
              <ellipse cx="94" cy="160" rx="9" ry="7" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />

              {/* Chest panel */}
              <rect x="66" y="118" width="28" height="18" rx="7" fill="#E8E4F0" stroke="#4A3F6B" strokeWidth="1.4" opacity="0.9" />
              {patchImage ? (
                <>
                  <clipPath id={`patchClip-${phaseNum}`}>
                    <circle cx="80" cy="127" r="8" />
                  </clipPath>
                  <image href={patchImage} x="72" y="119" width="16" height="16" preserveAspectRatio="xMidYMid slice" clipPath={`url(#patchClip-${phaseNum})`} />
                </>
              ) : patchEmoji ? (
                <text x="80" y="130" textAnchor="middle" fontSize="9" dominantBaseline="middle">{patchEmoji}</text>
              ) : (
                <path d="M80 121 L82 126 L87 126.5 L83.2 129.7 L84.4 134.5 L80 131.8 L75.6 134.5 L76.8 129.7 L73 126.5 L78 126 Z" fill="#FFD93D" stroke="#D4A017" strokeWidth="0.6" />
              )}
            </>
          )}

          {/* Helmet ring */}
          <circle cx="80" cy="62" r="38" fill="none" stroke={visorTint} strokeWidth="2.5" opacity="0.85" />
          <circle cx="80" cy="62" r="38" fill={`url(#lunaGlow-${phaseNum})`} opacity="0.25" />

          {/* Luna's face */}
          <circle cx="80" cy="62" r="30" fill={`url(#lunaFace-${phaseNum})`} stroke="#4A3F6B" strokeWidth="1.8" />

          {/* Craters — soft, sparse */}
          <ellipse cx="64" cy="50" rx="4" ry="3" fill="#000" opacity={0.06 + colors.craterBaseOpacity} />
          <ellipse cx="94" cy="72" rx="3.5" ry="2.6" fill="#000" opacity={0.05 + colors.craterBaseOpacity} />
          <ellipse cx="60" cy="68" rx="2.4" ry="1.8" fill="#000" opacity={0.05 + colors.craterBaseOpacity} />

          {/* Eyes — now with blink animation */}
          <g transform="translate(70, 60)">
            <g>
              {animated && <animateTransform attributeName="transform" type="scale" values="1 1; 1 1; 1 0.1; 1 1; 1 1" keyTimes="0; 0.94; 0.96; 0.98; 1" dur="4.5s" repeatCount="indefinite" />}
              <g transform="translate(-70, -60)">
                <circle cx="70" cy="60" r="7" fill="white" stroke="#4A3F6B" strokeWidth="1.4" />
                <circle cx="70" cy="61" r="3.4" fill="#3B3352">
                  {animated && <animate attributeName="cx" values="70;71;70" dur="4s" repeatCount="indefinite" />}
                </circle>
                <circle cx="68.5" cy="58.5" r="1.4" fill="white" opacity="0.95" />
                <path d="M63 55 Q70 51 77 55" stroke="#4A3F6B" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.6" />
              </g>
            </g>
          </g>

          <g transform="translate(90, 60)">
            <g>
              {animated && <animateTransform attributeName="transform" type="scale" values="1 1; 1 1; 1 0.1; 1 1; 1 1" keyTimes="0; 0.94; 0.96; 0.98; 1" dur="4.5s" repeatCount="indefinite" />}
              <g transform="translate(-90, -60)">
                <circle cx="90" cy="60" r="7" fill="white" stroke="#4A3F6B" strokeWidth="1.4" />
                <circle cx="90" cy="61" r="3.4" fill="#3B3352">
                  {animated && <animate attributeName="cx" values="90;89;90" dur="4s" repeatCount="indefinite" />}
                </circle>
                <circle cx="88.5" cy="58.5" r="1.4" fill="white" opacity="0.95" />
                <path d="M83 55 Q90 51 97 55" stroke="#4A3F6B" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.6" />
              </g>
            </g>
          </g>

          {/* Smile */}
          <path d="M74 71 Q80 76 86 71" stroke="#4A3F6B" strokeWidth="2" fill="none" strokeLinecap="round" />

          {/* Blush — always #E8A598 */}
          <circle cx="62" cy="68" r="3.6" fill="#E8A598" opacity="0.5" />
          <circle cx="98" cy="68" r="3.6" fill="#E8A598" opacity="0.5" />

          {/* Helmet shine */}
          <path d="M52 42 Q64 32 82 36" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.45" />

          {/* University Costume Graduation Cap */}
          {costume === 'university' && (
            <g transform="translate(0, -6)">
              {/* Mortarboard Cap */}
              <path d="M80 14 L42 26 L80 38 L118 26 Z" fill="#2D2445" stroke="#4A3F6B" strokeWidth="1.5" strokeLinejoin="round" />
              {/* Cap Base */}
              <path d="M58 31 L58 44 Q80 50 102 44 L102 31 Z" fill="#2D2445" />
              {/* Tassel */}
              <path d="M80 26 L112 33 L112 45" fill="none" stroke="#FFD93D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="80" cy="26" r="2.5" fill="#FFD93D" />
              <path d="M110 45 L114 45 L113 51 L111 51 Z" fill="#FFD93D" />
            </g>
          )}
        </g>
      </svg>
    </motion.div>
  );
};

export default LunaAstronaut;
