// LearnStation Loader Showcase — per-context loader gallery
// React 18 + TypeScript + Tailwind-ready

import React from 'react';
import { LunaLoader } from './LunaLoader';
import type { LoaderType } from '../types/luna';

interface LoaderMeta {
  type: LoaderType;
  label: string;
  context: string;
}

const LOADERS: LoaderMeta[] = [
  { type: 'stella-command', label: 'stella float', context: 'initial page load · welcome screen' },
  { type: 'orbit-ring', label: 'xp orbit', context: 'leveling up · achievements · saving' },
  { type: 'suit-charge', label: 'health bar', context: 'file upload · data sync · batch ops' },
  { type: 'orbit-scanning', label: 'starfield', context: 'searching · exploring · discovering' },
  { type: 'oxygen-breathing', label: 'breathing ring', context: 'meditation · focus mode · calm wait' },
  { type: 'pixel-heart', label: 'pixel heart', context: 'saving progress · loved content' },
];

export const LoaderShowcase: React.FC = () => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-6" style={{ background: '#0D0A14' }}>
      {LOADERS.map((loader) => (
        <div
          key={loader.type}
          className="flex items-center gap-4 rounded-2xl border p-5"
          style={{
            background: 'linear-gradient(180deg, #1A1425 0%, #150F1E 100%)',
            borderColor: 'rgba(107, 91, 149, 0.35)',
          }}
        >
          <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 64, height: 64 }}>
            <LunaLoader type={loader.type} size={56} />
          </div>
          <div>
            <h4 className="text-base font-semibold" style={{ color: '#FFF8E7' }}>
              {loader.label}
            </h4>
            <p className="text-sm mt-0.5" style={{ color: '#B8A9C9' }}>
              {loader.context}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default LoaderShowcase;
