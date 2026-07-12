// LearnStation Orbit — The Observer / Journey Tracker
// React 18 + TypeScript + Tailwind-ready

import React from 'react';

export interface OrbitConfig {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
  showShadow?: boolean;
}

const SIZE_MAP = { sm: 80, md: 120, lg: 160, xl: 200 };

export const OrbitExplorer: React.FC<OrbitConfig> = ({
  size = 'lg',
  animated = true,
  showShadow = true,
}) => {
  const pixelSize = SIZE_MAP[size] || 160;

  return (
    <div
      className="inline-block"
      style={{ width: pixelSize, height: (pixelSize * 180) / 160 }}
      aria-label="Orbit, the journey-tracking observer"
    >
      <svg viewBox="0 0 160 180" width="100%" height="100%" style={{ overflow: 'visible' }} role="img">
        <defs>
          <radialGradient id="orbitPlanetGrad" cx="38%" cy="32%">
            <stop offset="0%" stopColor="#8A78B5" />
            <stop offset="100%" stopColor="#5A4C82" />
          </radialGradient>
        </defs>

        {showShadow && (
          <ellipse cx="80" cy="168" rx="30" ry="5.5" fill="#0D0A14" opacity="0.45">
            {animated && (
              <>
                <animate attributeName="rx" values="30;22;30" dur="4s" repeatCount="indefinite" />
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

          {/* Star chart note, propped beside planet */}
          <rect x="98" y="118" width="24" height="30" rx="4" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="1.6" transform="rotate(8 110 133)" />
          <circle cx="105" cy="126" r="1.4" fill="#6B5B95" opacity="0.7" transform="rotate(8 110 133)" />
          <circle cx="114" cy="132" r="1.4" fill="#88B0B5" opacity="0.7" transform="rotate(8 110 133)" />
          <circle cx="107" cy="139" r="1.4" fill="#E8A598" opacity="0.7" transform="rotate(8 110 133)" />

          {/* Antenna */}
          <line x1="80" y1="24" x2="80" y2="12" stroke="#88B0B5" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="80" cy="9" r="4" fill="#E8E4F0" stroke="#4A3F6B" strokeWidth="1" />

          {/* Ring behind planet */}
          <ellipse cx="80" cy="72" rx="46" ry="12" fill="none" stroke="#88B0B5" strokeWidth="2.6" opacity="0.6" transform="rotate(-14 80 72)" />

          {/* Orbiting moon */}
          {animated && (
            <circle r="5" fill="#FFF8E7" stroke="#4A3F6B" strokeWidth="1.1">
              <animateMotion
                dur="6s"
                repeatCount="indefinite"
                path="M 34 72 A 46 12 0 1 1 126 72 A 46 12 0 1 1 34 72"
              />
            </circle>
          )}

          {/* Planet body */}
          <circle cx="80" cy="72" r="34" fill="url(#orbitPlanetGrad)" stroke="#4A3F6B" strokeWidth="2.4" />
          <path d="M50 66 Q80 74 110 66" stroke="#4A3F6B" strokeWidth="1.4" fill="none" opacity="0.25" />

          {/* Ring front half */}
          <path d="M38 72 A 46 12 0 0 0 122 72" fill="none" stroke="#88B0B5" strokeWidth="2.6" opacity="0.95" transform="rotate(-14 80 72)" />

          {/* Eyes — never change */}
          <circle cx="70" cy="70" r="6.6" fill="white" stroke="#4A3F6B" strokeWidth="1.3" />
          <circle cx="70" cy="71" r="3.2" fill="#3B3352">
            {animated && <animate attributeName="cx" values="70;71;70" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="68.5" cy="68.5" r="1.3" fill="white" opacity="0.95" />
          <path d="M63 62 Q70 58 77 62" stroke="#4A3F6B" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.6" />

          <circle cx="90" cy="70" r="6.6" fill="white" stroke="#4A3F6B" strokeWidth="1.3" />
          <circle cx="90" cy="71" r="3.2" fill="#3B3352">
            {animated && <animate attributeName="cx" values="90;89;90" dur="4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="88.5" cy="68.5" r="1.3" fill="white" opacity="0.95" />
          <path d="M83 62 Q90 58 97 62" stroke="#4A3F6B" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.6" />

          {/* Smile */}
          <path d="M74 82 Q80 87 86 82" stroke="#4A3F6B" strokeWidth="2" fill="none" strokeLinecap="round" />

          {/* Blush — always #E8A598 */}
          <circle cx="63" cy="78" r="3.6" fill="#E8A598" opacity="0.5" />
          <circle cx="97" cy="78" r="3.6" fill="#E8A598" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
};

export default OrbitExplorer;
