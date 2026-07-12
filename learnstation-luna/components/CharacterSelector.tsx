// LearnStation Character Selector — pick your active mascot
// React 18 + TypeScript + Tailwind-ready

import React from 'react';
import { LunaAstronaut } from './LunaAstronaut';
import { ByteCompanion } from './ByteCompanion';
import { NebulaCloud } from './NebulaCloud';
import { OrbitExplorer } from './OrbitExplorer';
import { PixelSpark } from './PixelSpark';
import { StellaCommander } from './StellaCommander';
import type { CharacterId } from '../types/luna';

interface CharacterMeta {
  id: CharacterId;
  name: string;
  role: string;
  tags: string[];
  render: () => React.ReactNode;
}

const CHARACTERS: CharacterMeta[] = [
  { id: 'luna', name: 'luna', role: 'the calm moon · night mode guardian', tags: ['round', 'sleepy'], render: () => <LunaAstronaut size="md" phase="quarter" /> },
  { id: 'byte', name: 'byte', role: 'the companion bot · gaming buddy', tags: ['tech', 'playful'], render: () => <ByteCompanion size="md" /> },
  { id: 'nebula', name: 'nebula', role: 'the dream cloud · creative mode', tags: ['soft', 'ethereal'], render: () => <NebulaCloud size="md" /> },
  { id: 'orbit', name: 'orbit', role: 'the explorer · journey tracker', tags: ['explorer', 'curious'], render: () => <OrbitExplorer size="md" /> },
  { id: 'pixel', name: 'pixel', role: 'the spark · quick actions · energy', tags: ['fast', 'bright'], render: () => <PixelSpark size="md" /> },
  { id: 'stella', name: 'stella', role: 'the cosmic learner · main mascot', tags: ['main', 'balanced'], render: () => <StellaCommander size="md" /> },
];

export interface CharacterSelectorProps {
  currentId?: CharacterId;
  onSelect?: (id: CharacterId) => void;
}

export const CharacterSelector: React.FC<CharacterSelectorProps> = ({
  currentId = 'stella',
  onSelect,
}) => {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-6"
      style={{ background: '#0D0A14' }}
    >
      {CHARACTERS.map((char) => {
        const isCurrent = char.id === currentId;
        return (
          <button
            key={char.id}
            type="button"
            onClick={() => onSelect?.(char.id)}
            className="relative flex flex-col items-center text-center rounded-2xl border p-6 transition-colors focus:outline-none focus-visible:ring-2"
            style={{
              background: 'linear-gradient(180deg, #1A1425 0%, #150F1E 100%)',
              borderColor: isCurrent ? '#FFD93D' : 'rgba(107, 91, 149, 0.35)',
              boxShadow: isCurrent ? '0 0 0 1px rgba(255,217,61,0.25)' : 'none',
            }}
          >
            {isCurrent && (
              <span
                className="absolute top-4 right-4 flex items-center gap-1 text-xs font-medium"
                style={{ color: '#FFD93D' }}
              >
                ★ current
              </span>
            )}

            <div className="h-32 flex items-end justify-center mb-4">{char.render()}</div>

            <h3 className="text-lg font-semibold" style={{ color: '#FFF8E7' }}>
              {char.name}
            </h3>
            <p className="text-sm mt-1 mb-4" style={{ color: '#B8A9C9' }}>
              {char.role}
            </p>

            <div className="flex gap-2 flex-wrap justify-center">
              {char.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-3 py-1 rounded-full border"
                  style={{
                    color: '#E8E4F0',
                    borderColor: 'rgba(136, 176, 181, 0.4)',
                    background: 'rgba(107, 91, 149, 0.2)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default CharacterSelector;
