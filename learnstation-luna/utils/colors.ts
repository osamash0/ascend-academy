// LearnStation Luna — Color Utilities
// Pure functions, no React dependencies

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

export function lerpColor(c1: string, c2: string, t: number): string {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  return rgbToHex(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t
  );
}

// Moon phase spectrum: 0 = full moon, 1 = dark moon
export function getLunaColors(phase: number): {
  faceLight: string;
  faceMid: string;
  faceDark: string;
  visorLight: string;
  visorMid: string;
  visorDark: string;
  glowCoreOpacity: number;
  craterBaseOpacity: number;
} {
  const t = Math.max(0, Math.min(1, phase / 100));

  return {
    faceLight: lerpColor('#FFFEF5', '#2D2445', t),
    faceMid: lerpColor('#FFF8E7', '#1A1425', t),
    faceDark: lerpColor('#E8E4F0', '#0D0A14', t),
    visorLight: lerpColor('#FFF8E7', '#6B5B95', t),
    visorMid: lerpColor('#88B0B5', '#4A3F6B', t),
    visorDark: lerpColor('#6B5B95', '#1A1425', t),
    glowCoreOpacity: 0.15 * (1 - t),
    craterBaseOpacity: t * 0.15,
  };
}

export function phaseToNumber(phase: string | number): number {
  if (typeof phase === 'number') return Math.max(0, Math.min(100, phase));
  const map: Record<string, number> = {
    full: 0,
    gibbous: 25,
    quarter: 50,
    crescent: 75,
    dark: 95,
  };
  return map[phase] ?? 0;
}
