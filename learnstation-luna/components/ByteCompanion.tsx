// LearnStation Byte — The Lunar Pilot / Gaming Companion
// React 18 + TypeScript + Tailwind-ready

import React from 'react';

export interface ByteConfig {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
  showShadow?: boolean;
}

const SIZE_MAP = { sm: 80, md: 120, lg: 160, xl: 200 };

export const ByteCompanion: React.FC<ByteConfig> = ({
  size = 'lg',
  animated = true,
  showShadow = true,
}) => {
  const pixelSize = SIZE_MAP[size] || 160;

  return (
    <div
      className="inline-block"
      style={{ width: pixelSize, height: (pixelSize * 180) / 160 }}
      aria-label="Byte, the gaming companion bot"
    >
      <svg viewBox="0 0 160 180" width="100%" height="100%" style={{ overflow: 'visible' }} role="img">
        {showShadow && (
          <ellipse cx="80" cy="168" rx="24" ry="5.5" fill="#0D0A14" opacity="0.45">
            {animated && (
              <>
                <animate attributeName="rx" values="24;17;24" dur="3.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.45;0.22;0.45" dur="3.2s" repeatCount="indefinite" />
              </>
            )}
          </ellipse>
        )}

        <g>
          {animated && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -7; 0 0"
              dur="3.2s"
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
            />
          )}

          {/* Antenna */}
          <line x1="80" y1="26" x2="80" y2="14" stroke="#88B0B5" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="80" cy="11" r="4" fill="#FFD93D" stroke="#D4A017" strokeWidth="0.8">
            {animated && <animate attributeName="opacity" values="1;0.25;1" dur="1.3s" repeatCount="indefinite" />}
          </circle>

          {/* Body */}
          <rect x="52" y="102" width="56" height="52" rx="24" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="2.5" />

          {/* Arms */}
          <path d="M54 112 Q40 120 36 134" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="35" cy="138" r="6.5" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="1.8" />
          <path d="M106 112 Q120 120 124 134" stroke="#4A3F6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="125" cy="138" r="6.5" fill="#6B5B95" stroke="#4A3F6B" strokeWidth="1.8" />

          {/* Tread feet */}
          <rect x="58" y="154" width="20" height="10" rx="5" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />
          <rect x="82" y="154" width="20" height="10" rx="5" fill="#4A3F6B" stroke="#2D2445" strokeWidth="1.2" />

          {/* Chest control light */}
          <rect x="68" y="118" width="24" height="16" rx="6" fill="#1A1425" stroke="#4A3F6B" strokeWidth="1.4" />
          <circle cx="76" cy="126" r="3" fill="#FFD93D" opacity="0.85">
            {animated && <animate attributeName="opacity" values="0.85;0.25;0.85" dur="1.4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="84" cy="126" r="3" fill="#E8A598" opacity="0.7">
            {animated && <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.7s" repeatCount="indefinite" begin="0.3s" />}
          </circle>

          {/* Head — screen bezel */}
          <rect x="48" y="30" width="64" height="56" rx="24" fill="#4A3F6B" stroke="#2D2445" strokeWidth="2.5" />
          <rect x="55" y="37" width="50" height="42" rx="16" fill="#1A1425" stroke="#6B5B95" strokeWidth="1.4" />

          {/* Eyes — never change */}
          <circle cx="68" cy="58" r="7" fill="white" stroke="#4A3F6B" strokeWidth="1.4" />
          <circle cx="68" cy="59" r="3.4" fill="#3B3352">
            {animated && <animate attributeName="r" values="3.4;3.4;0.6;3.4" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="66.5" cy="56.5" r="1.4" fill="white" opacity="0.95" />

          <circle cx="92" cy="58" r="7" fill="white" stroke="#4A3F6B" strokeWidth="1.4" />
          <circle cx="92" cy="59" r="3.4" fill="#3B3352">
            {animated && <animate attributeName="r" values="3.4;3.4;0.6;3.4" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="90.5" cy="56.5" r="1.4" fill="white" opacity="0.95" />

          {/* Smile */}
          <path d="M70 69 Q80 74 90 69" stroke="#88B0B5" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.9" />

          {/* Blush — always #E8A598 */}
          <rect x="56" y="63" width="7" height="5" rx="2.5" fill="#E8A598" opacity="0.5" />
          <rect x="97" y="63" width="7" height="5" rx="2.5" fill="#E8A598" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
};

export default ByteCompanion;
