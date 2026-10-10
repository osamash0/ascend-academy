/**
 * Luna's wardrobe — every catalog item drawn as an SVG fragment.
 *
 * All art shares the LunaAstronaut coordinate system (viewBox 0 0 160 180):
 * helmet centred at (80, 62), visor ring r=38, face r=30, chest patch at
 * (80, 127). Pieces are pure functions of (id, uid, animated) so the same
 * drawing serves a 28px top-bar chip and a 320px locker stage.
 *
 * Animation is SMIL, matching the existing Luna components: it runs off the
 * main thread's JS, and `animated=false` (reduced motion, long lists) drops
 * every <animate> so the art is a still frame, not a broken one.
 */
import type { ReactNode } from 'react';
import type { Mood } from './types';

const INK = '#4A3F6B';

type Art = (p: { uid: string; animated: boolean }) => ReactNode;

/** Deterministic star field — the same sky every render, no hydration jitter. */
function stars(seed: number, count: number, w = 200, h = 220, ox = -20, oy = -20) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: count }, () => ({
    x: ox + rnd() * w,
    y: oy + rnd() * h,
    r: 0.4 + rnd() * 1.1,
    o: 0.35 + rnd() * 0.6,
    d: 2 + rnd() * 4,
  }));
}

function StarField({ seed, count, animated, twinkleEvery = 4 }: { seed: number; count: number; animated: boolean; twinkleEvery?: number }) {
  return (
    <g>
      {stars(seed, count).map((st, i) => (
        <circle key={i} cx={st.x} cy={st.y} r={st.r} fill="#fff" opacity={st.o}>
          {animated && i % twinkleEvery === 0 && (
            <animate attributeName="opacity" values={`${st.o};0.1;${st.o}`} dur={`${st.d}s`} repeatCount="indefinite" />
          )}
        </circle>
      ))}
    </g>
  );
}

// The backdrop rect overshoots the largest viewBox so a head crop never shows an edge.
const BG = { x: -20, y: -20, width: 200, height: 220 };

// ── Backdrops ─────────────────────────────────────────────────────────────

const BACKDROPS: Record<string, Art> = {
  'backdrop-deepspace': ({ uid, animated }) => (
    <g>
      <defs>
        <radialGradient id={`${uid}-ds`} cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#23262E" />
          <stop offset="60%" stopColor="#111317" />
          <stop offset="100%" stopColor="#050506" />
        </radialGradient>
      </defs>
      <rect {...BG} fill={`url(#${uid}-ds)`} />
      <StarField seed={7} count={42} animated={animated} />
    </g>
  ),
  'backdrop-lunar': ({ uid, animated }) => (
    <g>
      <defs>
        <linearGradient id={`${uid}-lsky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0B1024" />
          <stop offset="100%" stopColor="#1C2547" />
        </linearGradient>
        <linearGradient id={`${uid}-lground`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B9B3CC" />
          <stop offset="100%" stopColor="#6E6788" />
        </linearGradient>
        <radialGradient id={`${uid}-earth`} cx="35%" cy="35%">
          <stop offset="0%" stopColor="#9FE7FF" />
          <stop offset="55%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </radialGradient>
      </defs>
      <rect {...BG} fill={`url(#${uid}-lsky)`} />
      <StarField seed={19} count={26} animated={animated} />
      <circle cx="134" cy="26" r="11" fill={`url(#${uid}-earth)`} />
      <path d="M126 22 q4 -3 8 0 q3 3 7 1" stroke="#34D399" strokeWidth="2.2" fill="none" opacity="0.8" strokeLinecap="round" />
      <path d="M-20 150 Q40 128 80 140 T180 134 L180 200 L-20 200 Z" fill={`url(#${uid}-lground)`} />
      <ellipse cx="34" cy="160" rx="10" ry="3" fill="#5E5778" opacity="0.7" />
      <ellipse cx="128" cy="168" rx="14" ry="3.6" fill="#5E5778" opacity="0.6" />
      <ellipse cx="96" cy="152" rx="5" ry="1.6" fill="#5E5778" opacity="0.6" />
    </g>
  ),
  'backdrop-aurora': ({ uid, animated }) => (
    <g>
      <defs>
        <linearGradient id={`${uid}-asky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06121C" />
          <stop offset="100%" stopColor="#0E1B2E" />
        </linearGradient>
        <linearGradient id={`${uid}-a1`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34D399" stopOpacity="0" />
          <stop offset="50%" stopColor="#34D399" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-a2`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0" />
          <stop offset="50%" stopColor="#A78BFA" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#F472B6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect {...BG} fill={`url(#${uid}-asky)`} />
      <StarField seed={31} count={22} animated={animated} />
      <path d="M-20 40 C20 10 50 70 90 36 S150 20 180 46 L180 96 C140 70 110 110 80 84 S10 80 -20 100 Z" fill={`url(#${uid}-a1)`}>
        {animated && <animateTransform attributeName="transform" type="translate" values="0 0; 8 4; 0 0" dur="9s" repeatCount="indefinite" />}
      </path>
      <path d="M-20 70 C30 50 60 96 100 66 S160 60 180 80 L180 120 C130 100 100 130 70 110 S0 110 -20 124 Z" fill={`url(#${uid}-a2)`}>
        {animated && <animateTransform attributeName="transform" type="translate" values="0 0; -10 3; 0 0" dur="12s" repeatCount="indefinite" />}
      </path>
      <path d="M-20 168 L20 150 L46 160 L80 140 L112 158 L140 146 L180 162 L180 200 L-20 200 Z" fill="#050B12" />
    </g>
  ),
  'backdrop-observatory': ({ uid, animated }) => (
    <g>
      <defs>
        <radialGradient id={`${uid}-obs`} cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopColor="#24305E" />
          <stop offset="100%" stopColor="#0A0E22" />
        </radialGradient>
      </defs>
      <rect {...BG} fill={`url(#${uid}-obs)`} />
      {/* planetarium dome grid */}
      <g stroke="#7C8BD9" strokeWidth="0.5" fill="none" opacity="0.28">
        {[40, 70, 100, 130].map((r) => (
          <path key={r} d={`M${80 - r} 190 A${r} ${r * 1.15} 0 0 1 ${80 + r} 190`} />
        ))}
        {[-60, -30, 0, 30, 60].map((dx) => (
          <path key={dx} d={`M80 30 Q${80 + dx * 1.6} 110 ${80 + dx * 2.6} 190`} />
        ))}
      </g>
      <StarField seed={53} count={18} animated={animated} />
      {/* a constellation — the Big Dipper, because of course */}
      <g stroke="#FFD93D" strokeWidth="0.6" opacity="0.7" fill="none">
        <polyline points="14,30 28,26 40,30 50,38 64,36 66,24 50,22 50,38" />
      </g>
      {[[14, 30], [28, 26], [40, 30], [50, 38], [64, 36], [66, 24], [50, 22]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.3" fill="#FFF3B0">
          {animated && <animate attributeName="r" values="1.3;1.9;1.3" dur={`${2.4 + i * 0.3}s`} repeatCount="indefinite" />}
        </circle>
      ))}
    </g>
  ),
  'backdrop-galaxy': ({ uid, animated }) => (
    <g>
      <defs>
        <radialGradient id={`${uid}-gx`} cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#FBCFE8" />
          <stop offset="12%" stopColor="#C084FC" />
          <stop offset="40%" stopColor="#4C1D95" />
          <stop offset="100%" stopColor="#0B0518" />
        </radialGradient>
      </defs>
      <rect {...BG} fill={`url(#${uid}-gx)`} />
      <g opacity="0.55">
        {animated && <animateTransform attributeName="transform" type="rotate" values="0 80 80; 360 80 80" dur="120s" repeatCount="indefinite" />}
        {[0, 60, 120].map((a) => (
          <ellipse key={a} cx="80" cy="80" rx="96" ry="22" fill="none" stroke="#F0ABFC" strokeWidth="1.2" opacity="0.4" transform={`rotate(${a} 80 80)`} />
        ))}
      </g>
      <StarField seed={97} count={50} animated={animated} twinkleEvery={3} />
    </g>
  ),
};

// ── Auras (two layers: behind Luna, and a front pass for things that wrap her) ──

const AURAS_BACK: Record<string, Art> = {
  'aura-stardust': ({ animated }) => (
    <g>
      {[[34, 50], [126, 44], [28, 104], [132, 110], [50, 20], [112, 18], [22, 76], [140, 80], [62, 150], [102, 152]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 3} L${x + 0.9} ${y - 0.9} L${x + 3} ${y} L${x + 0.9} ${y + 0.9} L${x} ${y + 3} L${x - 0.9} ${y + 0.9} L${x - 3} ${y} L${x - 0.9} ${y - 0.9} Z`} fill="#FFF3B0">
          {animated && <animate attributeName="opacity" values="1;0.15;1" dur={`${1.8 + (i % 4) * 0.6}s`} begin={`${i * 0.25}s`} repeatCount="indefinite" />}
        </path>
      ))}
    </g>
  ),
  'aura-rings': ({ uid }) => (
    <g>
      <defs>
        <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="66" rx="66" ry="15" fill="none" stroke={`url(#${uid}-ring)`} strokeWidth="3" opacity="0.5" transform="rotate(-14 80 66)" />
    </g>
  ),
  'aura-ember': ({ animated }) => (
    <g>
      {Array.from({ length: 9 }, (_, i) => {
        const x = 30 + i * 12.5;
        return (
          <circle key={i} cx={x} cy={150} r={1.6 + (i % 3) * 0.7} fill={i % 2 ? '#FB923C' : '#FDE047'} opacity="0">
            {animated ? (
              <>
                <animate attributeName="cy" values="160;30" dur={`${2.6 + (i % 4) * 0.5}s`} begin={`${i * 0.37}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.9;0" dur={`${2.6 + (i % 4) * 0.5}s`} begin={`${i * 0.37}s`} repeatCount="indefinite" />
              </>
            ) : (
              <set attributeName="opacity" to="0.7" />
            )}
          </circle>
        );
      })}
    </g>
  ),
  'aura-nebula': ({ uid, animated }) => (
    <g>
      <defs>
        <radialGradient id={`${uid}-nb1`}>
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-nb2`}>
          <stop offset="0%" stopColor="#2DD4BF" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="56" cy="70" r="52" fill={`url(#${uid}-nb1)`}>
        {animated && <animate attributeName="r" values="52;60;52" dur="6s" repeatCount="indefinite" />}
      </circle>
      <circle cx="108" cy="96" r="48" fill={`url(#${uid}-nb2)`}>
        {animated && <animate attributeName="r" values="48;40;48" dur="7s" repeatCount="indefinite" />}
      </circle>
    </g>
  ),
  'aura-supernova': ({ uid, animated }) => (
    <g>
      <defs>
        <radialGradient id={`${uid}-sn`}>
          <stop offset="0%" stopColor="#FDE68A" stopOpacity="0.9" />
          <stop offset="45%" stopColor="#F59E0B" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="80" cy="64" r="70" fill={`url(#${uid}-sn)`}>
        {animated && <animate attributeName="opacity" values="1;0.6;1" dur="3s" repeatCount="indefinite" />}
      </circle>
      <g stroke="#FDE68A" strokeWidth="2" strokeLinecap="round" opacity="0.65">
        {animated && <animateTransform attributeName="transform" type="rotate" values="0 80 64; 360 80 64" dur="40s" repeatCount="indefinite" />}
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          const r1 = 46;
          const r2 = i % 2 ? 62 : 72;
          return <line key={i} x1={80 + Math.cos(a) * r1} y1={64 + Math.sin(a) * r1} x2={80 + Math.cos(a) * r2} y2={64 + Math.sin(a) * r2} />;
        })}
      </g>
    </g>
  ),
};

const AURAS_FRONT: Record<string, Art> = {
  // The front half of the ring, so Luna sits *inside* it like a planet.
  'aura-rings': ({ uid }) => (
    <path d="M14 66 A66 15 0 0 0 146 66" fill="none" stroke={`url(#${uid}-ring)`} strokeWidth="3" opacity="0.85" transform="rotate(-14 80 66)" />
  ),
};

// ── Helmet gear ───────────────────────────────────────────────────────────

const GEAR: Record<string, Art> = {
  'gear-antenna': ({ animated }) => (
    <g>
      <path d="M80 24 L80 9" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <circle cx="80" cy="7" r="3.6" fill="#F472B6" stroke={INK} strokeWidth="1.2">
        {animated && <animate attributeName="fill" values="#F472B6;#FFD93D;#22D3EE;#F472B6" dur="3s" repeatCount="indefinite" />}
      </circle>
    </g>
  ),
  'gear-bulb': ({ uid, animated }) => (
    <g>
      <defs>
        <radialGradient id={`${uid}-bulb`}>
          <stop offset="0%" stopColor="#FFF7AE" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFD93D" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g>
        {animated && <animateTransform attributeName="transform" type="translate" values="0 0; 0 -2.5; 0 0" dur="2.6s" repeatCount="indefinite" />}
        <circle cx="112" cy="14" r="13" fill={`url(#${uid}-bulb)`}>
          {animated && <animate attributeName="opacity" values="0.6;1;0.6" dur="1.8s" repeatCount="indefinite" />}
        </circle>
        <path d="M112 6 a6.5 6.5 0 0 1 4 11.6 v2.4 h-8 v-2.4 a6.5 6.5 0 0 1 4 -11.6 Z" fill="#FFE97A" stroke={INK} strokeWidth="1.2" />
        <rect x="108.6" y="20.4" width="6.8" height="3.4" rx="1" fill="#B8A9C9" stroke={INK} strokeWidth="1" />
      </g>
    </g>
  ),
  'gear-headphones': () => (
    <g>
      <path d="M40 64 A40 42 0 0 1 120 64" fill="none" stroke="#2D2445" strokeWidth="5" strokeLinecap="round" />
      <path d="M40 64 A40 42 0 0 1 120 64" fill="none" stroke="#F472B6" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <rect x="31" y="54" width="12" height="22" rx="5" fill="#F472B6" stroke={INK} strokeWidth="1.6" />
      <rect x="117" y="54" width="12" height="22" rx="5" fill="#F472B6" stroke={INK} strokeWidth="1.6" />
      <rect x="34" y="58" width="5" height="14" rx="2.5" fill="#fff" opacity="0.45" />
    </g>
  ),
  'gear-mortarboard': ({ animated }) => (
    <g transform="translate(0,-6)">
      <path d="M80 14 L42 26 L80 38 L118 26 Z" fill="#2D2445" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M58 31 L58 40 Q80 46 102 40 L102 31 L80 38 Z" fill="#1A1425" />
      <g>
        {animated && <animateTransform attributeName="transform" type="rotate" values="0 80 26; 4 80 26; 0 80 26" dur="3s" repeatCount="indefinite" />}
        <path d="M80 26 L112 33 L112 45" fill="none" stroke="#FFD93D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M110 45 L114 45 L113.4 52 L110.6 52 Z" fill="#FFD93D" />
      </g>
      <circle cx="80" cy="26" r="2.5" fill="#FFD93D" />
    </g>
  ),
  'gear-flame': ({ animated }) => (
    <g>
      <g>
        {animated && <animateTransform attributeName="transform" type="scale" values="1 1; 1.04 0.94; 0.97 1.05; 1 1" dur="0.9s" repeatCount="indefinite" additive="sum" />}
        <path d="M80 2 C70 12 66 18 70 26 C72 30 88 30 90 26 C94 18 90 12 86 8 C86 14 82 16 80 14 C82 10 82 6 80 2 Z" fill="#FB923C" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M80 12 C76 18 75 22 77 25 C78 27 83 27 84 25 C86 21 83 18 80 12 Z" fill="#FDE047" />
      </g>
    </g>
  ),
  'gear-laurel': () => {
    const leaves = (side: 1 | -1) =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI * (200 + i * 14)) / 180;
        const x = 80 + side * Math.cos(a) * 41 * -1;
        const y = 62 + Math.sin(a) * 41;
        const rot = side * (i * 14 + 20);
        return <ellipse key={`${side}-${i}`} cx={x} cy={y} rx="6" ry="2.6" fill={i % 2 ? '#84CC16' : '#A3E635'} stroke="#3F6212" strokeWidth="0.7" transform={`rotate(${rot} ${x} ${y})`} />;
      });
    return (
      <g>
        {leaves(1)}
        {leaves(-1)}
        <circle cx="80" cy="21" r="3" fill="#FFD93D" stroke={INK} strokeWidth="1" />
      </g>
    );
  },
  'gear-halo': ({ uid, animated }) => (
    <g>
      <defs>
        <linearGradient id={`${uid}-halo`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="50%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <g>
        {animated && <animateTransform attributeName="transform" type="translate" values="0 0; 0 -3; 0 0" dur="3.2s" repeatCount="indefinite" />}
        <ellipse cx="80" cy="14" rx="24" ry="6.5" fill="none" stroke="#FDE68A" strokeWidth="7" opacity="0.25" />
        <ellipse cx="80" cy="14" rx="24" ry="6.5" fill="none" stroke={`url(#${uid}-halo)`} strokeWidth="3.4" />
      </g>
    </g>
  ),
  'gear-starcrown': ({ animated }) => (
    <g>
      <path d="M50 30 Q80 6 110 30" fill="none" stroke="#FDE68A" strokeWidth="0.8" opacity="0.6" />
      {[[50, 30, 4], [64, 18, 5], [80, 12, 6.5], [96, 18, 5], [110, 30, 4]].map(([x, y, r], i) => (
        <path key={i} d={starPath(x, y, r, r * 0.45)} fill="#FDE68A" stroke="#B45309" strokeWidth="0.7">
          {animated && <animate attributeName="opacity" values="1;0.55;1" dur={`${1.6 + i * 0.3}s`} repeatCount="indefinite" />}
        </path>
      ))}
    </g>
  ),
};

// ── Chest patches (drawn inside the panel, centred on 80,127) ─────────────

function starPath(cx: number, cy: number, R: number, r: number, points = 5) {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? r : R;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push(`${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${out.join(' L')} Z`;
}

const PATCHES: Record<string, Art> = {
  'patch-star': () => <path d={starPath(80, 127.5, 7, 3)} fill="#FFD93D" stroke="#D4A017" strokeWidth="0.6" />,
  'patch-moon': () => <path d="M83 120.5 a7 7 0 1 0 0 14 a5.4 5.4 0 1 1 0 -14 Z" fill="#C4B5FD" stroke={INK} strokeWidth="0.8" />,
  'patch-book': () => (
    <g stroke={INK} strokeWidth="0.8" strokeLinejoin="round">
      <path d="M80 123 Q75 120.5 71 122 L71 132 Q75 130.5 80 133 Z" fill="#60A5FA" />
      <path d="M80 123 Q85 120.5 89 122 L89 132 Q85 130.5 80 133 Z" fill="#93C5FD" />
    </g>
  ),
  'patch-flame': () => <path d="M80 120 C75 125 74 129 76.5 132 C78 134 82 134 83.5 132 C86 129 84 125 82 123 C82 126 80.5 127 80 126 C81 124 81 122 80 120 Z" fill="#FB923C" stroke={INK} strokeWidth="0.7" />,
  'patch-bolt': () => <path d="M82 120 L75 128.5 L80 128.5 L78 135 L85.5 126 L80.5 126 Z" fill="#FDE047" stroke={INK} strokeWidth="0.8" strokeLinejoin="round" />,
  'patch-check': () => (
    <g>
      <circle cx="80" cy="127.5" r="6.6" fill="#34D399" stroke={INK} strokeWidth="0.8" />
      <path d="M76.6 127.6 L79.2 130.2 L83.8 125" stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  'patch-question': () => (
    <g>
      <circle cx="80" cy="127.5" r="6.6" fill="#A78BFA" stroke={INK} strokeWidth="0.8" />
      <path d="M77.6 125.6 a2.5 2.5 0 1 1 3.6 2.2 c-0.9 0.4 -1.2 0.9 -1.2 1.8" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="80" cy="131.6" r="0.9" fill="#fff" />
    </g>
  ),
  'patch-heart': () => <path d="M80 133.5 C72 128 73 121.5 77 121.5 C78.6 121.5 79.6 122.6 80 123.6 C80.4 122.6 81.4 121.5 83 121.5 C87 121.5 88 128 80 133.5 Z" fill="#F472B6" stroke={INK} strokeWidth="0.8" />,
  'patch-target': () => (
    <g stroke={INK} strokeWidth="0.6">
      <circle cx="80" cy="127.5" r="7" fill="#F87171" />
      <circle cx="80" cy="127.5" r="4.6" fill="#fff" />
      <circle cx="80" cy="127.5" r="2.3" fill="#F87171" />
    </g>
  ),
  'patch-trophy': () => (
    <g stroke={INK} strokeWidth="0.8" strokeLinejoin="round">
      <path d="M75 121 L85 121 L84.4 127 Q80 131 75.6 127 Z" fill="#FBBF24" />
      <path d="M75.3 122.5 Q71.5 122.5 72.4 125.4 Q73.2 127.2 75.6 127" fill="none" />
      <path d="M84.7 122.5 Q88.5 122.5 87.6 125.4 Q86.8 127.2 84.4 127" fill="none" />
      <rect x="78.6" y="129" width="2.8" height="3" fill="#FBBF24" />
      <rect x="76" y="132" width="8" height="2.4" rx="0.8" fill="#B45309" />
    </g>
  ),
};

// ── Companions (drawn around 0,0; placed on an orbit by the renderer) ─────

const COMPANIONS: Record<string, Art> = {
  'companion-comet': ({ uid }) => (
    <g>
      <defs>
        <linearGradient id={`${uid}-tail`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0" />
          <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path d="M-20 -5 L0 -3.2 L0 3.2 L-20 5 Z" fill={`url(#${uid}-tail)`} />
      <circle r="4.6" fill="#E0F2FE" stroke="#38BDF8" strokeWidth="1.2" />
    </g>
  ),
  'companion-byte': ({ animated }) => (
    <g>
      <path d="M0 -9 L0 -13" stroke={INK} strokeWidth="1.2" />
      <circle cy="-14" r="1.8" fill="#22D3EE">
        {animated && <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" />}
      </circle>
      <rect x="-9" y="-9" width="18" height="15" rx="5" fill="#E8E4F0" stroke={INK} strokeWidth="1.3" />
      <rect x="-6.5" y="-6" width="13" height="8" rx="3" fill="#1A1425" />
      <circle cx="-3" cy="-2" r="1.5" fill="#22D3EE" />
      <circle cx="3" cy="-2" r="1.5" fill="#22D3EE" />
      <path d="M-3 9 L0 6 L3 9" fill="#F472B6" />
    </g>
  ),
  'companion-spark': ({ animated }) => (
    <g>
      <path d="M0 -10 L2.4 -2.4 L10 0 L2.4 2.4 L0 10 L-2.4 2.4 L-10 0 L-2.4 -2.4 Z" fill="#FDE047" stroke="#CA8A04" strokeWidth="0.8">
        {animated && <animateTransform attributeName="transform" type="rotate" values="0;90" dur="2s" repeatCount="indefinite" />}
      </path>
      <circle cx="-1.6" cy="-0.6" r="0.9" fill={INK} />
      <circle cx="1.6" cy="-0.6" r="0.9" fill={INK} />
    </g>
  ),
  'companion-minimoon': () => (
    <g>
      <circle r="8" fill="#E5E1EE" stroke={INK} strokeWidth="1.2" />
      <circle cx="-3" cy="-3" r="1.6" fill="#000" opacity="0.08" />
      <circle cx="3.6" cy="2.6" r="1.2" fill="#000" opacity="0.08" />
      <circle cx="-2.4" cy="0" r="1" fill={INK} />
      <circle cx="2.4" cy="0" r="1" fill={INK} />
      <path d="M-1.6 2.6 Q0 3.8 1.6 2.6" stroke={INK} strokeWidth="0.8" fill="none" strokeLinecap="round" />
    </g>
  ),
  'companion-owl': ({ animated }) => (
    <g>
      <path d="M-8 -6 L-6 -11 L-3 -7 M8 -6 L6 -11 L3 -7" fill="#92400E" stroke="#78350F" strokeWidth="0.8" />
      <ellipse rx="9" ry="10" fill="#B45309" stroke="#78350F" strokeWidth="1.1" />
      <ellipse cy="3" rx="5.4" ry="5.6" fill="#FDE68A" opacity="0.8" />
      <circle cx="-3.6" cy="-3" r="3.4" fill="#fff" stroke="#78350F" strokeWidth="0.6" />
      <circle cx="3.6" cy="-3" r="3.4" fill="#fff" stroke="#78350F" strokeWidth="0.6" />
      <g>
        {animated && <animateTransform attributeName="transform" type="scale" values="1 1;1 1;1 0.1;1 1" keyTimes="0;0.9;0.95;1" dur="5s" repeatCount="indefinite" />}
        <circle cx="-3.6" cy="-3" r="1.6" fill="#1A1425" />
        <circle cx="3.6" cy="-3" r="1.6" fill="#1A1425" />
      </g>
      <path d="M-1.2 0 L0 2 L1.2 0 Z" fill="#F59E0B" />
    </g>
  ),
};

// ── Expressions ───────────────────────────────────────────────────────────

/** Eyes + mouth for each mood. The identity anchors (white sclera, dark pupil, blush) never change. */
export function Expression({ mood, animated }: { mood: Mood; animated: boolean }) {
  const blink = animated ? (
    <animateTransform attributeName="transform" type="scale" values="1 1; 1 1; 1 0.1; 1 1; 1 1" keyTimes="0; 0.94; 0.96; 0.98; 1" dur="4.5s" repeatCount="indefinite" />
  ) : null;

  const eye = (cx: number, opts: { r?: number; dx?: number; dy?: number; sparkle?: boolean; lid?: boolean }) => {
    const { r = 7, dx = 0, dy = 1, sparkle = false, lid = false } = opts;
    return (
      <g transform={`translate(${cx} 60)`}>
        <g>
          {blink}
          <circle r={r} fill="white" stroke={INK} strokeWidth="1.4" />
          <circle cx={dx} cy={dy} r={3.4} fill="#3B3352" />
          {sparkle ? (
            <path d={starPath(dx - 1.3, dy - 1.6, 2.2, 0.9, 4)} fill="#fff" />
          ) : (
            <circle cx={dx - 1.5} cy={dy - 2.5} r={1.4} fill="white" opacity="0.95" />
          )}
          {lid && <path d={`M${-r - 0.5} -1.5 L${r + 0.5} -1.5 L${r} ${-r} L${-r} ${-r} Z`} fill="#F3EEE0" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />}
        </g>
      </g>
    );
  };

  const happyArc = (cx: number) => <path d={`M${cx - 6} 62 Q${cx} 54 ${cx + 6} 62`} stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />;

  switch (mood) {
    case 'celebrating':
      return (
        <g>
          {happyArc(70)}
          {happyArc(90)}
          <path d="M72 70 Q80 82 88 70 Z" fill="#7C2D12" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M75.5 74 Q80 77.5 84.5 74" fill="#F472B6" />
        </g>
      );
    case 'blazing':
      return (
        <g>
          {eye(70, { sparkle: true })}
          {eye(90, { sparkle: true })}
          <path d="M73 70 Q80 79 87 70 Z" fill="#7C2D12" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
        </g>
      );
    case 'curious':
      return (
        <g>
          {eye(70, { r: 7.6, dy: -0.5, dx: 0.5 })}
          {eye(90, { r: 7.6, dy: -0.5, dx: 0.5 })}
          <ellipse cx="80" cy="73" rx="2.4" ry="2.8" fill="#7C2D12" stroke={INK} strokeWidth="1.2" />
        </g>
      );
    case 'waiting':
      return (
        <g>
          {eye(70, { dx: 1.6, dy: -1.6 })}
          {eye(90, { dx: 1.6, dy: -1.6 })}
          <path d="M76 72 Q80 74.5 84 72" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'thinking':
      // Eyes drift up-left, mouth goes sideways, and a thought trail pulses —
      // so model latency reads as Luna pondering, not the app hanging.
      return (
        <g>
          {eye(70, { dx: -1.8, dy: -2 })}
          {eye(90, { dx: -1.8, dy: -2 })}
          <path d="M76 73 Q80 71.5 84.5 72.8" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={106 + i * 7} cy={30 - i * 6} r={2 + i * 0.8} fill="#fff" stroke={INK} strokeWidth="1">
              {animated && <animate attributeName="opacity" values="0.25;1;0.25" dur="1.2s" begin={`${i * 0.2}s`} repeatCount="indefinite" />}
            </circle>
          ))}
        </g>
      );
    case 'focused':
      return (
        <g>
          {eye(70, { lid: true, dy: 1.6 })}
          {eye(90, { lid: true, dy: 1.6 })}
          <path d="M75.5 72.5 L84.5 72" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'bright':
    default:
      return (
        <g>
          {eye(70, { dx: 0 })}
          {eye(90, { dx: 0 })}
          <path d="M74 71 Q80 76 86 71" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
  }
}

const pick = (table: Record<string, Art>, id: string, uid: string, animated: boolean) => table[id]?.({ uid, animated }) ?? null;

export const drawBackdrop = (id: string, uid: string, animated: boolean) => pick(BACKDROPS, id, uid, animated);
export const drawAuraBack = (id: string, uid: string, animated: boolean) => pick(AURAS_BACK, id, uid, animated);
export const drawAuraFront = (id: string, uid: string, animated: boolean) => pick(AURAS_FRONT, id, uid, animated);
export const drawGear = (id: string, uid: string, animated: boolean) => pick(GEAR, id, uid, animated);
export const drawPatch = (id: string, uid: string, animated: boolean) => pick(PATCHES, id, uid, animated);
export const drawCompanion = (id: string, uid: string, animated: boolean) => pick(COMPANIONS, id, uid, animated);
