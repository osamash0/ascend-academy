// LearnStation Pixel — The Ranger / Quick Actions & Energy
// React 18 + TypeScript + Tailwind-ready

import React from 'react';

export interface PixelConfig {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
  showShadow?: boolean;
}

const SIZE_MAP = { sm: 80, md: 120, lg: 160, xl: 200 };

export const PixelSpark: React.FC<PixelConfig> = ({
  size = 'lg',
  animated = true,
  showShadow = true,
}) => {
  const pixelSize = SIZE_MAP[size] || 160;

  return (
    <div
      className="inline-block"
      style={{ width: pixelSize, height: (pixelSize * 180) / 160 }}
      aria-label="Pixel, the quick-action ranger"
    >
      <svg viewBox="0 0 160 180" width="100%" height="100%" style={{ overflow: 'visible' }} role="img">
        {showShadow && (
          <ellipse cx="86" cy="168" rx="20" ry="5" fill="#0D0A14" opacity="0.4">
            {animated && (
              <>
                <animate attributeName="rx" values="20;14;20" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.2;0.4" dur="2.2s" repeatCount="indefinite" />
              </>
            )}
          </ellipse>
        )}

        <g>
          {animated && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -8; 0 0"
              dur="2.2s"
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
            />
          )}

          {/* Speed trail */}
          <path d="M74 92 Q52 106 34 138" stroke="#FFD93D" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.6">
            {animated && (
              <animate attributeName="d" values="M74 92 Q52 106 34 138;M74 92 Q46 100 24 128;M74 92 Q52 106 34 138" dur="0.6s" repeatCount="indefinite" />
            )}
          </path>
          <path d="M84 96 Q66 112 54 142" stroke="#E8A598" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.5">
            {animated && (
              <animate attributeName="d" values="M84 96 Q66 112 54 142;M84 96 Q60 106 42 134;M84 96 Q66 112 54 142" dur="0.7s" repeatCount="indefinite" begin="0.1s" />
            )}
          </path>

          {/* Face */}
          <circle cx="86" cy="72" r="32" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="2.4" />

          {/* Goggles */}
          <circle cx="75" cy="68" r="9" fill="none" stroke="#88B0B5" strokeWidth="2.4" opacity="0.9" />
          <circle cx="97" cy="68" r="9" fill="none" stroke="#88B0B5" strokeWidth="2.4" opacity="0.9" />
          <line x1="84" y1="68" x2="88" y2="68" stroke="#88B0B5" strokeWidth="2.4" />

          {/* Eyes — never change */}
          <circle cx="75" cy="68" r="6.4" fill="white" stroke="#4A3F6B" strokeWidth="1.3" />
          <circle cx="75" cy="69" r="3.1" fill="#3B3352">
            {animated && <animate attributeName="cx" values="75;76;75" dur="3.4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="73.6" cy="66.6" r="1.3" fill="white" opacity="0.95" />

          <circle cx="97" cy="68" r="6.4" fill="white" stroke="#4A3F6B" strokeWidth="1.3" />
          <circle cx="97" cy="69" r="3.1" fill="#3B3352">
            {animated && <animate attributeName="cx" values="97;98;97" dur="3.4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="95.6" cy="66.6" r="1.3" fill="white" opacity="0.95" />

          {/* Smile */}
          <path d="M79 82 Q86 87 93 82" stroke="#4A3F6B" strokeWidth="2" fill="none" strokeLinecap="round" />

          {/* Blush — always #E8A598 */}
          <circle cx="67" cy="78" r="3.4" fill="#E8A598" opacity="0.5" />
          <circle cx="105" cy="78" r="3.4" fill="#E8A598" opacity="0.5" />

          {/* Ranger star */}
          <path
            d="M86 34 L88 40 L94 40.5 L89.5 44.5 L91 50 L86 46.8 L81 50 L82.5 44.5 L78 40.5 L84 40 Z"
            fill="#FFD93D"
            stroke="#D4A017"
            strokeWidth="0.8"
          >
            {animated && <animate attributeName="opacity" values="1;0.6;1" dur="1.6s" repeatCount="indefinite" />}
          </path>
        </g>
      </svg>
    </div>
  );
};

export default PixelSpark;
