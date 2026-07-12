// LearnStation Luna — Loader Component
// 9 variants, phase-aware, SVG SMIL animations

import React, { useMemo } from 'react';
import { getLunaColors, phaseToNumber } from '../utils/colors';
import type { LoaderProps } from '../types/luna';

export const LunaLoader: React.FC<LoaderProps> = ({
  type,
  size = 64,
  className = '',
  phase = 'full',
}) => {
  const phaseNum = phaseToNumber(phase);
  const colors = useMemo(() => getLunaColors(phaseNum), [phaseNum]);
  const faceFill = colors.faceMid;

  const renderLoader = () => {
    switch (type) {
      case 'helmet-float':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size} style={{ overflow: 'visible' }}>
            <ellipse cx="40" cy="72" rx="14" ry="3" fill="#0D0A14" opacity="0.4">
              <animate attributeName="rx" values="14;10;14" dur="4s" repeatCount="indefinite" />
            </ellipse>
            <g>
              <animateTransform attributeName="transform" type="translate" values="0 0; 0 -5; 0 0" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1; 0.45 0 0.55 1" />
              <circle cx="40" cy="36" r="20" fill="none" stroke="#88B0B5" strokeWidth="2" opacity="0.8" />
              <circle cx="40" cy="36" r="17" fill={faceFill} stroke="#4A3F6B" strokeWidth="1.5" />
              <circle cx="34" cy="34" r="3" fill="#E8E4F0" opacity="0.4" />
              <circle cx="48" cy="34" r="4" fill="#E8E4F0" opacity="0.3" />
              <circle cx="35" cy="34" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
              <circle cx="35" cy="34" r="1.2" fill="#4A3F6B" />
              <circle cx="45" cy="34" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
              <circle cx="45" cy="34" r="1.2" fill="#4A3F6B" />
              <path d="M37 40 Q40 43 43 40" stroke="#4A3F6B" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <circle cx="32" cy="38" r="2" fill="#E8A598" opacity="0.5" />
              <circle cx="48" cy="38" r="2" fill="#E8A598" opacity="0.5" />
              <path d="M28 24 Q36 20 46 24" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.4" />
              <rect x="28" y="50" width="24" height="18" rx="8" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="1.5" />
              <rect x="32" y="54" width="16" height="8" rx="3" fill="#1A1425" opacity="0.9" />
              <rect x="34" y="56" width="5" height="3" rx="1.5" fill="#6B5B95">
                <animate attributeName="fill" values="#6B5B95;#88B0B5;#6B5B95" dur="3s" repeatCount="indefinite" />
              </rect>
              <rect x="41" y="56" width="5" height="3" rx="1.5" fill="#E8A598" opacity="0.7">
                <animate attributeName="opacity" values="0.7;0.3;0.7" dur="2s" repeatCount="indefinite" />
              </rect>
            </g>
          </svg>
        );

      case 'oxygen-breathing':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size}>
            <circle cx="40" cy="40" r="18" fill="none" stroke="#6B5B95" strokeWidth="2" opacity="0.3">
              <animate attributeName="r" values="18;26;18" dur="3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.3;0;0.3" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="40" cy="40" r="18" fill="none" stroke="#88B0B5" strokeWidth="2" opacity="0.5">
              <animate attributeName="r" values="18;26;18" dur="3s" repeatCount="indefinite" begin="0.5s" />
              <animate attributeName="opacity" values="0.5;0;0.5" dur="3s" repeatCount="indefinite" begin="0.5s" />
            </circle>
            <circle cx="40" cy="40" r="12" fill={faceFill} stroke="#4A3F6B" strokeWidth="2" />
            <circle cx="37" cy="39" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
            <circle cx="37" cy="39" r="1.2" fill="#4A3F6B" />
            <circle cx="43" cy="39" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
            <circle cx="43" cy="39" r="1.2" fill="#4A3F6B" />
            <path d="M38 44 Q40 46 42 44" stroke="#4A3F6B" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <circle cx="34" cy="42" r="2" fill="#E8A598" opacity="0.5" />
            <circle cx="46" cy="42" r="2" fill="#E8A598" opacity="0.5" />
            <circle cx="32" cy="32" r="2.5" fill="#E8E4F0" opacity="0.3" />
          </svg>
        );

      case 'suit-charge':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size}>
            <rect x="10" y="32" width="60" height="8" rx="4" fill="none" stroke="#4A3F6B" strokeWidth="2" />
            <rect x="12" y="34" width="0" height="4" rx="2" fill="#88B0B5">
              <animate attributeName="width" values="0;56;0" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" />
            </rect>
            <g>
              <animateTransform attributeName="transform" type="translate" values="0 0; 38 0; 38 0; 0 0; 0 0" dur="3s" repeatCount="indefinite" keyTimes="0;0.4;0.5;0.9;1" />
              <circle cx="18" cy="28" r="10" fill={faceFill} stroke="#4A3F6B" strokeWidth="1.5" />
              <circle cx="15" cy="26" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
              <circle cx="15" cy="26" r="1.2" fill="#4A3F6B" />
              <circle cx="21" cy="26" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
              <circle cx="21" cy="26" r="1.2" fill="#4A3F6B" />
              <path d="M16 30 Q18 32 20 30" stroke="#4A3F6B" strokeWidth="1" fill="none" strokeLinecap="round" />
              <circle cx="13" cy="28" r="1.5" fill="#E8A598" opacity="0.5" />
              <circle cx="23" cy="28" r="1.5" fill="#E8A598" opacity="0.5" />
              <circle cx="12" cy="24" r="2" fill="#E8E4F0" opacity="0.3" />
              <path d="M14 34 Q18 40 22 34" fill="#FFD93D" opacity="0.5">
                <animate attributeName="d" values="M14 34 Q18 40 22 34;M13 34 Q18 42 23 34;M14 34 Q18 40 22 34" dur="0.3s" repeatCount="indefinite" />
              </path>
            </g>
            <rect x="66" y="33" width="4" height="6" rx="2" fill="#4A3F6B" opacity="0.5" />
          </svg>
        );

      case 'comms-blink':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size}>
            <circle cx="40" cy="40" r="18" fill="none" stroke="#88B0B5" strokeWidth="2" opacity="0.6" />
            <circle cx="40" cy="40" r="15" fill={faceFill} stroke="#4A3F6B" strokeWidth="1.5" />
            <circle cx="37" cy="39" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.6" />
            <circle cx="37" cy="39" r="1.2" fill="#4A3F6B" />
            <circle cx="43" cy="39" r="2.5" fill="white" stroke="#4A3F6B" strokeWidth="0.6" />
            <circle cx="43" cy="39" r="1.2" fill="#4A3F6B" />
            <path d="M38 44 Q40 46 42 44" stroke="#4A3F6B" strokeWidth="1" fill="none" strokeLinecap="round" />
            <circle cx="34" cy="42" r="1.5" fill="#E8A598" opacity="0.5" />
            <circle cx="46" cy="42" r="1.5" fill="#E8A598" opacity="0.5" />
            <rect x="24" y="34" width="4" height="10" rx="2" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="0.8" />
            <circle cx="26" cy="37" r="1.5" fill="#FFD93D">
              <animate attributeName="opacity" values="1;0.2;1" dur="1s" repeatCount="indefinite" />
            </circle>
            <circle cx="26" cy="41" r="1.5" fill="#E8A598">
              <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.5s" repeatCount="indefinite" begin="0.3s" />
            </circle>
            <path d="M20 38 Q16 38 14 34" stroke="#88B0B5" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.6">
              <animate attributeName="opacity" values="0.6;0;0.6" dur="1.2s" repeatCount="indefinite" />
            </path>
          </svg>
        );

      case 'thruster-hover':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size} style={{ overflow: 'visible' }}>
            <ellipse cx="40" cy="72" rx="14" ry="3" fill="#0D0A14" opacity="0.4">
              <animate attributeName="rx" values="14;10;14" dur="2s" repeatCount="indefinite" />
            </ellipse>
            <g>
              <animateTransform attributeName="transform" type="translate" values="0 0; 0 -6; 0 0" dur="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1; 0.45 0 0.55 1" />
              <path d="M18 45 L10 58 L22 55 Z" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="1.5" opacity="0.8" />
              <path d="M62 45 L70 58 L58 55 Z" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="1.5" opacity="0.8" />
              <path d="M32 56 Q36 68 40 56" fill="#FFD93D" opacity="0.6">
                <animate attributeName="d" values="M32 56 Q36 68 40 56;M30 56 Q36 74 42 56;M32 56 Q36 68 40 56" dur="0.3s" repeatCount="indefinite" />
              </path>
              <path d="M40 58 Q44 70 48 58" fill="#E8A598" opacity="0.4">
                <animate attributeName="d" values="M40 58 Q44 70 48 58;M38 58 Q44 76 50 58;M40 58 Q44 70 48 58" dur="0.35s" repeatCount="indefinite" begin="0.1s" />
              </path>
              <ellipse cx="40" cy="38" rx="20" ry="22" fill={faceFill} stroke="#4A3F6B" strokeWidth="2" />
              <circle cx="33" cy="36" r="4.5" fill="white" stroke="#4A3F6B" strokeWidth="1" />
              <circle cx="33" cy="36" r="2.2" fill="#4A3F6B" />
              <circle cx="47" cy="36" r="4.5" fill="white" stroke="#4A3F6B" strokeWidth="1" />
              <circle cx="47" cy="36" r="2.2" fill="#4A3F6B" />
              <path d="M36 44 Q40 47 44 44" stroke="#4A3F6B" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              <circle cx="28" cy="40" r="3" fill="#E8A598" opacity="0.5" />
              <circle cx="52" cy="40" r="3" fill="#E8A598" opacity="0.5" />
              <line x1="40" y1="16" x2="40" y2="8" stroke="#88B0B5" strokeWidth="2" strokeLinecap="round" />
              <circle cx="40" cy="5" r="3" fill="#FFD93D" stroke="#D4A017" strokeWidth="0.8">
                <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </g>
          </svg>
        );

      case 'warp-speed':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size} style={{ overflow: 'visible' }}>
            <line x1="5" y1="30" x2="25" y2="30" stroke="#88B0B5" strokeWidth="1.5" opacity="0.6">
              <animate attributeName="x1" values="5;0;5" dur="0.4s" repeatCount="indefinite" />
              <animate attributeName="x2" values="25;20;25" dur="0.4s" repeatCount="indefinite" />
            </line>
            <line x1="8" y1="40" x2="30" y2="40" stroke="#88B0B5" strokeWidth="1.5" opacity="0.4">
              <animate attributeName="x1" values="8;3;8" dur="0.5s" repeatCount="indefinite" begin="0.1s" />
              <animate attributeName="x2" values="30;25;30" dur="0.5s" repeatCount="indefinite" begin="0.1s" />
            </line>
            <line x1="5" y1="50" x2="22" y2="50" stroke="#88B0B5" strokeWidth="1.5" opacity="0.5">
              <animate attributeName="x1" values="5;0;5" dur="0.45s" repeatCount="indefinite" begin="0.2s" />
              <animate attributeName="x2" values="22;17;22" dur="0.45s" repeatCount="indefinite" begin="0.2s" />
            </line>
            <g>
              <animateTransform attributeName="transform" type="translate" values="0 0; 2 0; 0 0" dur="0.3s" repeatCount="indefinite" />
              <ellipse cx="50" cy="40" rx="16" ry="18" fill={faceFill} stroke="#4A3F6B" strokeWidth="2" />
              <circle cx="44" cy="38" r="3.5" fill="white" stroke="#4A3F6B" strokeWidth="1" />
              <circle cx="44" cy="38" r="1.8" fill="#4A3F6B" />
              <circle cx="56" cy="38" r="3.5" fill="white" stroke="#4A3F6B" strokeWidth="1" />
              <circle cx="56" cy="38" r="1.8" fill="#4A3F6B" />
              <path d="M47 44 Q50 46 53 44" stroke="#4A3F6B" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M42 54 Q46 68 50 54" fill="#FFD93D" opacity="0.7">
                <animate attributeName="d" values="M42 54 Q46 68 50 54;M40 54 Q46 74 52 54;M42 54 Q46 68 50 54" dur="0.2s" repeatCount="indefinite" />
              </path>
              <path d="M50 54 Q54 68 58 54" fill="#E8A598" opacity="0.5">
                <animate attributeName="d" values="M50 54 Q54 68 58 54;M48 54 Q54 74 60 54;M50 54 Q54 68 58 54" dur="0.25s" repeatCount="indefinite" begin="0.05s" />
              </path>
            </g>
          </svg>
        );

      case 'orbit-ring':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size}>
            <ellipse cx="40" cy="40" rx="30" ry="10" fill="none" stroke="#88B0B5" strokeWidth="1.5" opacity="0.4" transform="rotate(-20 40 40)" />
            <g>
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite" calcMode="linear" />
              <ellipse cx="40" cy="40" rx="30" ry="10" fill="none" stroke="#88B0B5" strokeWidth="2" opacity="0.7" transform="rotate(-20 40 40)" strokeDasharray="40 20" />
              <circle cx="40" cy="12" r="5" fill="#FFD93D" stroke="#D4A017" strokeWidth="1" />
            </g>
            <circle cx="40" cy="40" r="10" fill={faceFill} stroke="#4A3F6B" strokeWidth="1.5" />
            <circle cx="37" cy="39" r="2" fill="#4A3F6B" />
            <circle cx="43" cy="39" r="2" fill="#4A3F6B" />
            <path d="M38 44 Q40 46 42 44" stroke="#4A3F6B" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <circle cx="34" cy="42" r="1.5" fill="#E8A598" opacity="0.5" />
            <circle cx="46" cy="42" r="1.5" fill="#E8A598" opacity="0.5" />
          </svg>
        );

      case 'docking':
        return (
          <svg viewBox="0 0 80 80" width={size} height={size}>
            <rect x="8" y="30" width="64" height="8" rx="4" fill="none" stroke="#4A3F6B" strokeWidth="2" />
            <rect x="10" y="32" width="0" height="4" rx="2" fill="#88B0B5">
              <animate attributeName="width" values="0;60;0" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" />
            </rect>
            <g>
              <animateTransform attributeName="transform" type="translate" values="0 0; 44 0; 44 0; 0 0; 0 0" dur="3s" repeatCount="indefinite" keyTimes="0;0.3;0.5;0.8;1" />
              <ellipse cx="18" cy="28" rx="10" ry="11" fill={faceFill} stroke="#4A3F6B" strokeWidth="1.5" />
              <circle cx="14" cy="26" r="3" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
              <circle cx="14" cy="26" r="1.5" fill="#4A3F6B" />
              <circle cx="22" cy="26" r="3" fill="white" stroke="#4A3F6B" strokeWidth="0.8" />
              <circle cx="22" cy="26" r="1.5" fill="#4A3F6B" />
              <path d="M15 31 Q18 33 21 31" stroke="#4A3F6B" strokeWidth="1.2" fill="none" strokeLinecap="round" />
              <circle cx="12" cy="29" r="2" fill="#E8A598" opacity="0.5" />
              <circle cx="24" cy="29" r="2" fill="#E8A598" opacity="0.5" />
              <path d="M14 37 Q18 44 22 37" fill="#FFD93D" opacity="0.5">
                <animate attributeName="d" values="M14 37 Q18 44 22 37;M13 37 Q18 48 23 37;M14 37 Q18 44 22 37" dur="0.3s" repeatCount="indefinite" />
              </path>
            </g>
            <text x="40" y="52" textAnchor="middle" fill="#B8A9C9" fontSize="7" fontFamily="sans-serif" fontWeight="500">docking...</text>
          </svg>
        );

      default:
        return null;
    }
  };

  return (
    <div className={`inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      {renderLoader()}
    </div>
  );
};

export default LunaLoader;
