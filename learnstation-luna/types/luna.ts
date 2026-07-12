// LearnStation Luna Design System — Types
// Compatible with: React 18, TypeScript, Tailwind CSS

export type MoonPhase = 'full' | 'gibbous' | 'quarter' | 'crescent' | 'dark';

export interface LunaColors {
  faceLight: string;
  faceMid: string;
  faceDark: string;
  visorLight: string;
  visorMid: string;
  visorDark: string;
  glowOpacity: number;
  craterOpacity: number;
}

export interface LunaConfig {
  phase?: MoonPhase | number; // 0-100 or named phase
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  animated?: boolean;
  showShadow?: boolean;
  variant?: 'full' | 'head';
  costume?: 'default' | 'university';
  /** Hex colour for the suit body (default: #FFF8E7 cream-white) */
  suitColor?: string;
  /** Hex colour for the visor tint (default: #88B0B5 teal) */
  visorTint?: string;
  /** Single emoji shown on the star-patch circle (default: ★) */
  patchEmoji?: string;
  patchImage?: string; // URL for custom badge image
}

export type LoaderType =
  | 'helmet-float'
  | 'oxygen-breathing'
  | 'star-patch'
  | 'suit-charge'
  | 'comms-blink'
  | 'thruster-hover'
  | 'warp-speed'
  | 'orbit-ring'
  | 'docking'
  | 'byte-thruster'
  | 'nebula-experiment'
  | 'orbit-scanning'
  | 'pixel-dash'
  | 'pixel-heart'
  | 'stella-command';

export type CharacterId = 'luna' | 'byte' | 'nebula' | 'orbit' | 'pixel' | 'stella';

export interface LoaderProps {
  type: LoaderType;
  size?: number;
  className?: string;
  phase?: MoonPhase | number;
}
