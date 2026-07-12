// LearnStation Nebula — The Scientist / Creative Mode
// React 18 + TypeScript + Tailwind-ready

import React from 'react';

export interface NebulaConfig {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
  showShadow?: boolean;
}

const SIZE_MAP = { sm: 80, md: 120, lg: 160, xl: 200 };

export const NebulaCloud: React.FC<NebulaConfig> = ({
  size = 'lg',
  animated = true,
  showShadow = true,
}) => {
  const pixelSize = SIZE_MAP[size] || 160;

  return (
    <div
      className="inline-block"
      style={{ width: pixelSize, height: (pixelSize * 180) / 160 }}
      aria-label="Nebula, the creative-mode scientist"
    >
      <svg viewBox="0 0 160 180" width="100%" height="100%" style={{ overflow: 'visible' }} role="img">
        <defs>
          <radialGradient id="nebulaCloudGrad" cx="38%" cy="32%">
            <stop offset="0%" stopColor="#8A78B5" />
            <stop offset="100%" stopColor="#6B5B95" />
          </radialGradient>
        </defs>

        {showShadow && (
          <ellipse cx="80" cy="168" rx="34" ry="6" fill="#0D0A14" opacity="0.45">
            {animated && (
              <>
                <animate attributeName="rx" values="34;25;34" dur="4s" repeatCount="indefinite" />
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

          {/* Lab note card */}
          <rect x="46" y="128" width="68" height="38" rx="6" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="2" transform="rotate(-3 80 147)" />
          <line x1="56" y1="140" x2="86" y2="140" stroke="#4A3F6B" strokeWidth="1.4" opacity="0.35" transform="rotate(-3 80 147)" />
          <line x1="56" y1="148" x2="94" y2="148" stroke="#4A3F6B" strokeWidth="1.4" opacity="0.25" transform="rotate(-3 80 147)" />

          {/* Flask */}
          <g transform="rotate(-3 80 147)">
            {animated && (
              <animateTransform attributeName="transform" type="rotate" values="-3 80 147; 3 80 147; -3 80 147" dur="3s" repeatCount="indefinite" additive="sum" />
            )}
            <path d="M99 130 L99 140 L108 154 Q110 158 105 158 L93 158 Q88 158 90 154 L99 140 Z" fill="#88B0B5" opacity="0.4" stroke="#4A3F6B" strokeWidth="1.4" />
            <rect x="96" y="126" width="6" height="6" rx="1.5" fill="#E8E4F0" stroke="#4A3F6B" strokeWidth="1.2" />
            <circle cx="98" cy="152" r="2.4" fill="#FFD93D" opacity="0.85">
              {animated && <animate attributeName="cy" values="152;144;152" dur="1.6s" repeatCount="indefinite" />}
            </circle>
            <circle cx="103" cy="153" r="2" fill="#E8A598" opacity="0.75">
              {animated && <animate attributeName="cy" values="153;146;153" dur="1.9s" repeatCount="indefinite" begin="0.3s" />}
            </circle>
          </g>

          {/* Cloud body — soft overlapping circles */}
          <circle cx="60" cy="92" r="20" fill="url(#nebulaCloudGrad)" stroke="#4A3F6B" strokeWidth="2" />
          <circle cx="100" cy="90" r="18" fill="#88B0B5" stroke="#4A3F6B" strokeWidth="2" opacity="0.95" />
          <circle cx="80" cy="72" r="30" fill="url(#nebulaCloudGrad)" stroke="#4A3F6B" strokeWidth="2.4" />

          {/* Glasses */}
          <circle cx="70" cy="70" r="9" fill="none" stroke="#E8E4F0" strokeWidth="2" opacity="0.9" />
          <circle cx="92" cy="70" r="9" fill="none" stroke="#E8E4F0" strokeWidth="2" opacity="0.9" />
          <line x1="79" y1="70" x2="83" y2="70" stroke="#E8E4F0" strokeWidth="2" />

          {/* Eyes — never change */}
          <circle cx="70" cy="70" r="6.4" fill="white" stroke="#4A3F6B" strokeWidth="1.3" />
          <circle cx="70" cy="71" r="3.1" fill="#3B3352">
            {animated && <animate attributeName="cx" values="70;71;70" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="68.6" cy="68.6" r="1.3" fill="white" opacity="0.95" />

          <circle cx="92" cy="70" r="6.4" fill="white" stroke="#4A3F6B" strokeWidth="1.3" />
          <circle cx="92" cy="71" r="3.1" fill="#3B3352">
            {animated && <animate attributeName="cx" values="92;93;92" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="90.6" cy="68.6" r="1.3" fill="white" opacity="0.95" />

          {/* Smile */}
          <path d="M74 82 Q81 87 88 82" stroke="#4A3F6B" strokeWidth="2" fill="none" strokeLinecap="round" />

          {/* Blush — always #E8A598 */}
          <circle cx="62" cy="78" r="3.6" fill="#E8A598" opacity="0.5" />
          <circle cx="100" cy="78" r="3.6" fill="#E8A598" opacity="0.5" />

          {/* Sparkle */}
          <path d="M116 52 L118 58 L124 60 L118 62 L116 68 L114 62 L108 60 L114 58 Z" fill="#FFD93D" opacity="0.8">
            {animated && <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2.4s" repeatCount="indefinite" />}
          </path>
        </g>
      </svg>
    </div>
  );
};

export default NebulaCloud;
