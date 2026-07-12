// LearnStation Stella — Fleet Commander / Main Mascot
// React 18 + TypeScript + Tailwind-ready

import React from 'react';

export interface StellaConfig {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
  showShadow?: boolean;
}

const SIZE_MAP = { sm: 80, md: 120, lg: 160, xl: 200 };

export const StellaCommander: React.FC<StellaConfig> = ({
  size = 'lg',
  animated = true,
  showShadow = true,
}) => {
  const pixelSize = SIZE_MAP[size] || 160;

  return (
    <div
      className="inline-block"
      style={{ width: pixelSize, height: (pixelSize * 180) / 160 }}
      aria-label="Stella, the fleet commander mascot"
    >
      <svg viewBox="0 0 160 180" width="100%" height="100%" style={{ overflow: 'visible' }} role="img">
        <defs>
          <radialGradient id="stellaFaceGrad" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#FFFEF5" />
            <stop offset="65%" stopColor="#FFF8E7" />
            <stop offset="100%" stopColor="#E8E4F0" />
          </radialGradient>
          <linearGradient id="stellaCapeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6B5B95" />
            <stop offset="100%" stopColor="#2D1B3D" />
          </linearGradient>
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

          {/* Cape */}
          <path d="M58 106 Q46 132 50 158 Q80 148 110 158 Q114 132 102 106 Z" fill="url(#stellaCapeGrad)" stroke="#2D1B3D" strokeWidth="2">
            {animated && (
              <animate
                attributeName="d"
                values="M58 106 Q46 132 50 158 Q80 148 110 158 Q114 132 102 106 Z;M58 106 Q42 132 48 158 Q80 150 112 158 Q118 132 102 106 Z;M58 106 Q46 132 50 158 Q80 148 110 158 Q114 132 102 106 Z"
                dur="4s"
                repeatCount="indefinite"
              />
            )}
          </path>

          {/* Legs */}
          <ellipse cx="68" cy="158" rx="8.5" ry="6.5" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />
          <ellipse cx="92" cy="158" rx="8.5" ry="6.5" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />

          {/* Suit body */}
          <rect x="52" y="102" width="56" height="52" rx="24" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="2.5" />

          {/* Epaulettes */}
          <circle cx="56" cy="104" r="6" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="1.4" />
          <circle cx="104" cy="104" r="6" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="1.4" />

          {/* Badge */}
          <circle cx="80" cy="128" r="10" fill="#FFD93D" stroke="#D4A017" strokeWidth="1.2">
            {animated && <animate attributeName="opacity" values="1;0.75;1" dur="2.4s" repeatCount="indefinite" />}
          </circle>
          <path d="M80 121 L82 126 L87 126.5 L83.2 129.7 L84.4 134.5 L80 131.8 L75.6 134.5 L76.8 129.7 L73 126.5 L78 126 Z" fill="#FFF8E7" opacity="0.9" />

          {/* Belt */}
          <rect x="55" y="146" width="50" height="6" rx="3" fill="#4A3F6B" />
          <circle cx="80" cy="149" r="3.6" fill="#88B0B5" stroke="#2D2445" strokeWidth="1" />

          {/* Arms */}
          <path d="M54 112 Q40 120 36 134" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="35" cy="138" r="6.5" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.5" />
          <path d="M106 112 Q120 120 124 134" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="125" cy="138" r="6.5" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.5" />

          {/* Head */}
          <circle cx="80" cy="62" r="30" fill="url(#stellaFaceGrad)" stroke="#4A3F6B" strokeWidth="1.8" />

          {/* Star crown */}
          <path
            d="M80 20 L83 29 L92 29.5 L85 35.5 L87.5 44.5 L80 39.3 L72.5 44.5 L75 35.5 L68 29.5 L77 29 Z"
            fill="#FFD93D"
            stroke="#D4A017"
            strokeWidth="1"
          >
            {animated && <animate attributeName="opacity" values="1;0.7;1" dur="2.8s" repeatCount="indefinite" />}
          </path>

          {/* Eyes — never change */}
          <circle cx="70" cy="60" r="7" fill="white" stroke="#4A3F6B" strokeWidth="1.4" />
          <circle cx="70" cy="61" r="3.4" fill="#3B3352">
            {animated && <animate attributeName="cx" values="70;71;70" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="68.5" cy="58.5" r="1.4" fill="white" opacity="0.95" />

          <circle cx="90" cy="60" r="7" fill="white" stroke="#4A3F6B" strokeWidth="1.4" />
          <circle cx="90" cy="61" r="3.4" fill="#3B3352">
            {animated && <animate attributeName="cx" values="90;89;90" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="88.5" cy="58.5" r="1.4" fill="white" opacity="0.95" />

          {/* Confident smile */}
          <path d="M74 71 Q80 76 86 71" stroke="#4A3F6B" strokeWidth="2.2" fill="none" strokeLinecap="round" />

          {/* Blush — always #E8A598 */}
          <circle cx="62" cy="68" r="3.6" fill="#E8A598" opacity="0.5" />
          <circle cx="98" cy="68" r="3.6" fill="#E8A598" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
};

export default StellaCommander;
