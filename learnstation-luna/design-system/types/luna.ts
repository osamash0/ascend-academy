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
  phase: MoonPhase | number; // 0-100 or named phase
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
  showShadow?: boolean;
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
  | 'docking';

export interface LoaderProps {
  type: LoaderType;
  size?: number;
  className?: string;
  phase?: MoonPhase | number;
}
