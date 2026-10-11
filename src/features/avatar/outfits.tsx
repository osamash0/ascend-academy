/**
 * Home looks — Luna takes her helmet off and dresses like home.
 *
 * Each look draws up to three layers around Luna's face (centre 80,62, r=30):
 *   back  — behind the face (a headscarf's drape)
 *   body  — replaces the space suit
 *   front — over the top of the face (hats, cords, wreaths)
 *
 * Every look shares ONE unlock rule (catalog.ts): earning a home look must
 * never rank one culture above another. Looks are always chosen by the
 * person — never inferred from a name, language or university.
 *
 * Patterns take the avatar's uid so fifty avatars on a leaderboard don't
 * fight over one global <pattern id>.
 */
import type { ReactNode } from 'react';

export type OutfitId =
  | 'gulf'
  | 'levant'
  | 'turkiye'
  | 'texas'
  | 'lederhosen'
  | 'dirndl'
  | 'scotland'
  | 'japan'
  | 'india'
  | 'westafrica';

export const OUTFITS: readonly OutfitId[] = [
  'gulf',
  'levant',
  'turkiye',
  'texas',
  'lederhosen',
  'dirndl',
  'scotland',
  'japan',
  'india',
  'westafrica',
];

const INK = '#4A3F6B';
/** Luna's hands are moonlight, like her face. */
const HAND = '#FFF8E7';
const WHITE = '#FBFBF7';

interface Look {
  back?: ReactNode;
  body: ReactNode;
  front?: ReactNode;
}

const hands = (y = 136, lx = 43, rx = 117) => (
  <>
    <circle cx={lx} cy={y} r="6" fill={HAND} stroke={INK} strokeWidth="1.6" />
    <circle cx={rx} cy={y} r="6" fill={HAND} stroke={INK} strokeWidth="1.6" />
  </>
);

/** Sleeves as soft capsules from the shoulders down to the hands. */
const sleeves = (fill: string) => (
  <>
    <rect x="45" y="104" width="15" height="31" rx="7.5" fill={fill} stroke={INK} strokeWidth="2" transform="rotate(22 56 108)" />
    <rect x="100" y="104" width="15" height="31" rx="7.5" fill={fill} stroke={INK} strokeWidth="2" transform="rotate(-22 104 108)" />
  </>
);

const legs = (fill: string, top = 136, h = 24) => (
  <>
    <rect x="63" y={top} width="14" height={h} rx="5" fill={fill} stroke={INK} strokeWidth="2" />
    <rect x="83" y={top} width="14" height={h} rx="5" fill={fill} stroke={INK} strokeWidth="2" />
  </>
);

const shoes = (fill: string, y = 158) => (
  <>
    <rect x="60" y={y} width="18" height="9" rx="4.5" fill={fill} />
    <rect x="82" y={y} width="18" height="9" rx="4.5" fill={fill} />
  </>
);

/** A woven check (shemagh / keffiyeh / plaid / tartan) as an SVG pattern. */
function Check({ id, base, line, size = 6, w = 2.2, rotate = 0, opacity = 0.85 }: { id: string; base: string; line: string; size?: number; w?: number; rotate?: number; opacity?: number }) {
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform={`rotate(${rotate})`}>
      <rect width={size} height={size} fill={base} />
      <rect width={w} height={size} fill={line} opacity={opacity} />
      <rect width={size} height={w} fill={line} opacity={opacity} />
    </pattern>
  );
}

const LOOKS: Record<OutfitId, (uid: string) => Look> = {
  // ── Gulf: white thobe, red-and-white ghutra, black agal ─────────────────
  gulf: (uid) => ({
    back: (
      <g>
        <defs>
          <Check id={`${uid}-shemagh`} base={WHITE} line="#C0392B" rotate={45} />
        </defs>
        <path d="M44 56 Q42 28 80 24 Q118 28 116 56 L122 112 Q100 104 92 96 L68 96 Q60 104 38 112 Z" fill={`url(#${uid}-shemagh)`} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      </g>
    ),
    body: (
      <g strokeLinejoin="round">
        {sleeves(WHITE)}
        {hands()}
        <path d="M60 96 Q55 130 53 166 L107 166 Q105 130 100 96 Z" fill={WHITE} stroke={INK} strokeWidth="2.4" />
        <path d="M80 98 L80 124" stroke={INK} strokeWidth="1.4" opacity="0.5" />
        {[104, 111, 118].map((y) => (
          <circle key={y} cx="80" cy={y} r="1.3" fill={INK} opacity="0.6" />
        ))}
        <ellipse cx="68" cy="167" rx="8" ry="3" fill="#8B5A2B" />
        <ellipse cx="92" cy="167" rx="8" ry="3" fill="#8B5A2B" />
      </g>
    ),
    front: (
      <g>
        <path d="M50.5 52 A30 30 0 0 1 109.5 52 Q80 43 50.5 52 Z" fill={`url(#${uid}-shemagh)`} stroke={INK} strokeWidth="1.6" />
        <path d="M49 45 Q80 30 111 45" stroke="#111" strokeWidth="3.6" fill="none" strokeLinecap="round" />
        <path d="M51 39 Q80 25 109 39" stroke="#111" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      </g>
    ),
  }),

  // ── Levant: black-and-white keffiyeh worn as a scarf, everyday jacket ───
  levant: (uid) => ({
    body: (
      <g strokeLinejoin="round">
        <defs>
          <pattern id={`${uid}-keff`} width="7" height="7" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" fill={WHITE} />
            <path d="M0 3.5 Q1.75 0.5 3.5 3.5 T7 3.5" stroke="#1A1A1A" strokeWidth="1.1" fill="none" />
            <path d="M0 7 L7 0" stroke="#1A1A1A" strokeWidth="0.7" />
          </pattern>
        </defs>
        {sleeves('#5B6B47')}
        {hands()}
        {legs('#2E3440')}
        {shoes('#E5E5E5')}
        <rect x="56" y="96" width="48" height="44" rx="16" fill="#5B6B47" stroke={INK} strokeWidth="2.4" />
        <path d="M80 112 L80 140" stroke="#3F4A31" strokeWidth="1.6" />
        {/* the keffiyeh: wrapped at the neck, one end hanging down the front */}
        <path d="M60 96 Q80 108 100 96 Q102 104 96 108 Q80 116 64 108 Q58 104 60 96 Z" fill={`url(#${uid}-keff)`} stroke={INK} strokeWidth="1.6" />
        <path d="M66 106 L62 132 L72 132 L74 108 Z" fill={`url(#${uid}-keff)`} stroke={INK} strokeWidth="1.4" />
        {[63, 66, 69, 71].map((x) => (
          <path key={x} d={`M${x} 132 L${x} 136`} stroke="#1A1A1A" strokeWidth="0.9" />
        ))}
      </g>
    ),
  }),

  // ── Türkiye: embroidered yelek (vest) over a white shirt, şalvar ─────────
  turkiye: () => ({
    body: (
      <g strokeLinejoin="round">
        {sleeves(WHITE)}
        {hands()}
        {/* şalvar: full trousers gathered at the ankle */}
        <path d="M60 128 Q56 148 62 162 L78 162 L80 140 L82 162 L98 162 Q104 148 100 128 Z" fill="#1F3A5F" stroke={INK} strokeWidth="2" />
        {shoes('#7A1F1F', 159)}
        <rect x="56" y="96" width="48" height="36" rx="15" fill={WHITE} stroke={INK} strokeWidth="2.4" />
        {/* sash */}
        <rect x="57" y="126" width="46" height="7" rx="2" fill="#B91C1C" stroke={INK} strokeWidth="1.2" />
        {/* yelek with gold embroidery along its edges */}
        <path d="M57 104 Q58 98 66 97 L72 126 L58 126 Z" fill="#7F1D1D" stroke={INK} strokeWidth="1.6" />
        <path d="M103 104 Q102 98 94 97 L88 126 L102 126 Z" fill="#7F1D1D" stroke={INK} strokeWidth="1.6" />
        <path d="M66 99 L71 124 M94 99 L89 124" stroke="#E5C07B" strokeWidth="1.4" strokeDasharray="2 1.6" />
        <circle cx="62" cy="112" r="2" fill="none" stroke="#E5C07B" strokeWidth="1" />
        <circle cx="98" cy="112" r="2" fill="none" stroke="#E5C07B" strokeWidth="1" />
      </g>
    ),
  }),

  // ── Texas: cowboy hat, plaid shirt, bandana, jeans, buckle, boots ───────
  texas: (uid) => ({
    body: (
      <g strokeLinejoin="round">
        <defs>
          <pattern id={`${uid}-plaid`} width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="#B3261E" />
            <rect width="10" height="3" y="3.5" fill="#7F1D1D" opacity="0.7" />
            <rect width="3" height="10" x="3.5" fill="#7F1D1D" opacity="0.7" />
            <rect width="10" height="0.8" y="8" fill="#FCA5A5" opacity="0.5" />
          </pattern>
        </defs>
        {sleeves(`url(#${uid}-plaid)`)}
        {hands()}
        {legs('#2B4C7E', 134, 26)}
        <path d="M58 158 L79 158 L79 167 L54 167 Q54 161 58 158 Z" fill="#6B3F1D" stroke="#3B2412" strokeWidth="1.4" />
        <path d="M81 158 L102 158 Q106 161 106 167 L81 167 Z" fill="#6B3F1D" stroke="#3B2412" strokeWidth="1.4" />
        <rect x="56" y="96" width="48" height="44" rx="16" fill={`url(#${uid}-plaid)`} stroke={INK} strokeWidth="2.4" />
        <rect x="56" y="134" width="48" height="6" fill="#4A2C14" />
        <ellipse cx="80" cy="137" rx="7" ry="5" fill="#E5C07B" stroke="#8A6D2B" strokeWidth="1.2" />
        <path d="M64 97 L96 97 L80 112 Z" fill="#1D4ED8" stroke={INK} strokeWidth="1.4" />
        <circle cx="74" cy="102" r="0.9" fill="#fff" />
        <circle cx="84" cy="101" r="0.9" fill="#fff" />
        <circle cx="80" cy="106" r="0.9" fill="#fff" />
      </g>
    ),
    front: (
      <g strokeLinejoin="round">
        <path d="M57 38 Q56 14 70 14 Q80 20 90 14 Q104 14 103 38 Z" fill="#9A6A3A" stroke="#4A2C14" strokeWidth="2" />
        <rect x="57" y="32" width="46" height="6" fill="#4A2C14" />
        <path d="M30 30 Q38 44 80 44 Q122 44 130 30 Q124 48 80 50 Q36 48 30 30 Z" fill="#9A6A3A" stroke="#4A2C14" strokeWidth="2" />
      </g>
    ),
  }),

  // ── Bavaria: Lederhosen, white shirt, Tyrolean hat with Gamsbart ────────
  lederhosen: () => ({
    body: (
      <g strokeLinejoin="round">
        {sleeves('#FFFFFF')}
        {hands()}
        <rect x="64" y="142" width="12" height="18" rx="4" fill="#EDE6D6" stroke={INK} strokeWidth="1.6" />
        <rect x="84" y="142" width="12" height="18" rx="4" fill="#EDE6D6" stroke={INK} strokeWidth="1.6" />
        {shoes('#2A1A10')}
        <rect x="56" y="96" width="48" height="40" rx="16" fill="#FFFFFF" stroke={INK} strokeWidth="2.4" />
        <path d="M57 126 L103 126 L101 146 L82 146 L80 136 L78 146 L59 146 Z" fill="#6B4423" stroke="#3B2412" strokeWidth="2" />
        <path d="M67 98 L68 127 M93 98 L92 127" stroke="#6B4423" strokeWidth="4" strokeLinecap="round" />
        <rect x="66" y="106" width="28" height="8" rx="2" fill="#6B4423" stroke="#3B2412" strokeWidth="1.2" />
        <path d="M71 110 Q75 106 80 110 Q85 114 89 110" stroke="#4ADE80" strokeWidth="1.3" fill="none" />
        <circle cx="80" cy="110" r="1.4" fill="#F5F0E1" />
      </g>
    ),
    front: (
      <g strokeLinejoin="round">
        <path d="M60 40 Q60 18 80 17 Q100 18 100 40 Z" fill="#2F5D3A" stroke="#1B3622" strokeWidth="2" />
        <path d="M48 40 Q80 48 112 40 Q110 46 80 48 Q50 46 48 40 Z" fill="#2F5D3A" stroke="#1B3622" strokeWidth="2" />
        <path d="M60 35 Q80 39 100 35" stroke="#D9C9A3" strokeWidth="2" fill="none" />
        <path d="M98 34 Q104 14 112 10 M99 34 Q108 18 116 16 M98 34 Q102 20 106 12" stroke="#5C4A3A" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </g>
    ),
  }),

  // ── Bavaria: Dirndl with apron, flower wreath ───────────────────────────
  dirndl: () => ({
    body: (
      <g strokeLinejoin="round">
        <circle cx="54" cy="106" r="9" fill="#FFFFFF" stroke={INK} strokeWidth="2" />
        <circle cx="106" cy="106" r="9" fill="#FFFFFF" stroke={INK} strokeWidth="2" />
        <path d="M50 112 Q44 124 43 133 M110 112 Q116 124 117 133" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        {hands()}
        <path d="M58 122 Q50 146 48 162 L112 162 Q110 146 102 122 Z" fill="#9B1C31" stroke={INK} strokeWidth="2.2" />
        <path d="M68 124 L92 124 L95 158 L65 158 Z" fill="#3E6B8A" stroke={INK} strokeWidth="1.6" opacity="0.95" />
        <path d="M92 124 Q99 120 100 126 Q99 131 92 127 Z M92 125 L96 136" fill="#3E6B8A" stroke={INK} strokeWidth="1.2" />
        <path d="M60 98 L100 98 L102 126 L58 126 Z" fill="#1F3D2B" stroke={INK} strokeWidth="2.2" />
        <path d="M68 98 Q80 108 92 98" fill="#FFFFFF" />
        {[106, 112, 118].map((y) => (
          <path key={y} d={`M76 ${y} L84 ${y + 3} M84 ${y} L76 ${y + 3}`} stroke="#E8D9B0" strokeWidth="1" />
        ))}
        <ellipse cx="68" cy="165" rx="8" ry="3.5" fill="#1A1A1A" />
        <ellipse cx="92" cy="165" rx="8" ry="3.5" fill="#1A1A1A" />
      </g>
    ),
    front: (
      <g>
        <path d="M50 46 Q80 26 110 46" stroke="#3F6212" strokeWidth="2.4" fill="none" />
        {([
          [52, 44, '#F9A8D4'],
          [61, 37, '#FFFFFF'],
          [70, 33, '#FDE047'],
          [80, 31, '#F9A8D4'],
          [90, 33, '#FFFFFF'],
          [99, 37, '#FDE047'],
          [108, 44, '#F9A8D4'],
        ] as const).map(([x, y, c]) => (
          <g key={x}>
            <circle cx={x} cy={y} r="4" fill={c} stroke={INK} strokeWidth="0.8" />
            <circle cx={x} cy={y} r="1.3" fill="#F59E0B" />
          </g>
        ))}
      </g>
    ),
  }),

  // ── Scotland: tartan kilt, sporran, tam o' shanter ──────────────────────
  scotland: (uid) => ({
    body: (
      <g strokeLinejoin="round">
        <defs>
          <Check id={`${uid}-tartan`} base="#14532D" line="#1E3A8A" size={9} w={3.2} opacity={0.9} />
        </defs>
        {sleeves('#FFFFFF')}
        {hands()}
        {/* knee socks + brogues */}
        <rect x="64" y="146" width="12" height="14" rx="4" fill="#ECE7DA" stroke={INK} strokeWidth="1.6" />
        <rect x="84" y="146" width="12" height="14" rx="4" fill="#ECE7DA" stroke={INK} strokeWidth="1.6" />
        <path d="M64 149 L76 149 M84 149 L96 149" stroke="#B91C1C" strokeWidth="1.4" />
        {shoes('#1A1A1A')}
        <rect x="56" y="96" width="48" height="36" rx="15" fill="#FFFFFF" stroke={INK} strokeWidth="2.4" />
        {/* kilt: pleated, knee length */}
        <path d="M57 124 L103 124 L106 148 L54 148 Z" fill={`url(#${uid}-tartan)`} stroke={INK} strokeWidth="2" />
        <path d="M60 128 L58 146 M66 128 L65 146 M94 128 L95 146 M100 128 L102 146" stroke="#B91C1C" strokeWidth="0.9" opacity="0.8" />
        {/* sporran */}
        <path d="M74 128 L86 128 L88 140 Q80 145 72 140 Z" fill="#E7DCC8" stroke={INK} strokeWidth="1.4" />
        <circle cx="80" cy="133" r="1.6" fill="#B5A06A" />
      </g>
    ),
    front: (
      <g strokeLinejoin="round">
        {/* tam o' shanter with its red toorie */}
        <ellipse cx="78" cy="34" rx="30" ry="11" fill={`url(#${uid}-tartan)`} stroke={INK} strokeWidth="1.8" />
        <path d="M54 38 Q80 46 104 38" stroke="#1A1A1A" strokeWidth="2.6" fill="none" />
        <circle cx="74" cy="23" r="4" fill="#B91C1C" stroke={INK} strokeWidth="1" />
      </g>
    ),
  }),

  // ── Japan: indigo yukata with obi, geta ─────────────────────────────────
  japan: (uid) => ({
    body: (
      <g strokeLinejoin="round">
        <defs>
          <pattern id={`${uid}-asanoha`} width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#1E3A6E" />
            <path d="M0 0 L8 8 M8 0 L0 8 M4 0 L4 8" stroke="#DCE6F5" strokeWidth="0.6" opacity="0.7" />
          </pattern>
        </defs>
        {/* wide sleeves */}
        <path d="M58 100 L40 108 L38 132 L52 132 L60 116 Z" fill={`url(#${uid}-asanoha)`} stroke={INK} strokeWidth="2" />
        <path d="M102 100 L120 108 L122 132 L108 132 L100 116 Z" fill={`url(#${uid}-asanoha)`} stroke={INK} strokeWidth="2" />
        {hands(138, 45, 115)}
        {/* robe, ankle length, left-over-right wrap */}
        <path d="M60 96 Q57 132 56 162 L104 162 Q103 132 100 96 Z" fill={`url(#${uid}-asanoha)`} stroke={INK} strokeWidth="2.4" />
        <path d="M68 97 L86 128 M92 97 L80 114" stroke="#DCE6F5" strokeWidth="2.4" />
        {/* obi */}
        <rect x="58" y="120" width="44" height="10" rx="2" fill="#B45309" stroke={INK} strokeWidth="1.4" />
        {/* geta */}
        <rect x="60" y="162" width="17" height="4" rx="1" fill="#C8A26B" />
        <rect x="83" y="162" width="17" height="4" rx="1" fill="#C8A26B" />
        <path d="M63 166 L63 169 M74 166 L74 169 M86 166 L86 169 M97 166 L97 169" stroke="#8A6D45" strokeWidth="2" />
      </g>
    ),
  }),

  // ── India: kurta with embroidered neckline, churidar, juttis ────────────
  india: () => ({
    body: (
      <g strokeLinejoin="round">
        {sleeves('#0F766E')}
        {hands()}
        {legs(WHITE, 140, 20)}
        <path d="M58 159 Q60 155 70 157 L78 159 L78 166 L58 166 Z" fill="#B45309" />
        <path d="M82 159 L90 157 Q100 155 102 159 L102 166 L82 166 Z" fill="#B45309" />
        {/* kurta: knee-length tunic with side slits */}
        <path d="M58 96 Q56 124 56 148 L104 148 Q104 124 102 96 Z" fill="#0F766E" stroke={INK} strokeWidth="2.4" />
        <path d="M56 136 L60 148 M104 136 L100 148" stroke={INK} strokeWidth="1.4" />
        {/* embroidered placket */}
        <path d="M72 97 Q80 104 88 97 L84 120 L76 120 Z" fill="#FDE68A" stroke="#B45309" strokeWidth="1" />
        {[103, 109, 115].map((y) => (
          <circle key={y} cx="80" cy={y} r="1.3" fill="#B45309" />
        ))}
        <path d="M57 142 L103 142" stroke="#FDE68A" strokeWidth="1.6" strokeDasharray="2 2" />
      </g>
    ),
  }),

  // ── West Africa: dashiki and kufi ───────────────────────────────────────
  westafrica: () => ({
    body: (
      <g strokeLinejoin="round">
        {sleeves('#F59E0B')}
        {hands()}
        {legs('#1F2937', 138, 22)}
        {shoes('#3B2412')}
        <path d="M56 98 Q55 126 57 146 L103 146 Q105 126 104 98 Q92 94 80 96 Q68 94 56 98 Z" fill="#F59E0B" stroke={INK} strokeWidth="2.4" />
        {/* the embroidered V-yoke */}
        <path d="M64 97 L80 124 L96 97 Q80 100 64 97 Z" fill="#14532D" stroke={INK} strokeWidth="1.4" />
        <path d="M68 99 L80 119 L92 99" stroke="#FDE047" strokeWidth="1.4" fill="none" />
        <path d="M72 101 L80 114 L88 101" stroke="#DC2626" strokeWidth="1.2" fill="none" />
        {/* hem band */}
        <path d="M57 140 L103 140" stroke="#14532D" strokeWidth="3" />
        <path d="M60 140 L64 136 L68 140 L72 136 L76 140 L80 136 L84 140 L88 136 L92 140 L96 136 L100 140" stroke="#FDE047" strokeWidth="1" fill="none" />
      </g>
    ),
    front: (
      <g strokeLinejoin="round">
        {/* kufi: a round cap in matching colours */}
        <path d="M54 44 Q54 22 80 21 Q106 22 106 44 Q80 38 54 44 Z" fill="#14532D" stroke={INK} strokeWidth="1.8" />
        <path d="M58 38 L64 30 L70 38 L76 30 L82 38 L88 30 L94 38 L100 32" stroke="#FDE047" strokeWidth="1.2" fill="none" />
      </g>
    ),
  }),
};

export function outfitLayers(id: OutfitId | null | undefined, uid: string): Look | null {
  return id ? LOOKS[id]?.(uid) ?? null : null;
}
