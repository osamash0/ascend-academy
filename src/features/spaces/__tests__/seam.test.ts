import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The data seam, as a ratchet.
 *
 * v4 is moving from mock data to real data. Every screen and component must
 * read through the hooks in `data/` (and the SpacesRepository behind them),
 * never straight from `mocks/` — otherwise switching
 * `VITE_V4_DATA_MODE=live` leaves that screen silently showing fiction.
 *
 * Today's offenders are frozen below. The list may only shrink: a new direct
 * import fails, and so does an entry that no longer imports mocks (delete it
 * — that is the progress being locked in).
 */
const STILL_ON_MOCKS = [
  'components/ContributionCard.tsx',
  'components/ReanchorDialog.tsx',
  'components/SpaceDialogs.tsx',
  'components/badges.tsx',
  'components/reader/TutorPanel.tsx',
  'screens/ConceptScreen.tsx',
  'screens/LessonFacesScreen.tsx',
  'screens/LessonScreen.tsx',
  'screens/PracticeScreen.tsx',
  'screens/SpaceManageScreen.tsx',
  'screens/SpaceScreen.tsx',
  'screens/SpacesScreen.tsx',
  'screens/StudioCanvasScreen.tsx',
];

const ROOT = join(process.cwd(), 'src/features/spaces');
const DIRS = ['screens', 'components', 'studio'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const onMocks = DIRS.flatMap((d) => walk(join(ROOT, d)))
  .filter((f) => /from\s+['"](?:\.\.?\/)+mocks\//.test(strip(readFileSync(f, 'utf8'))))
  .map((f) => f.slice(ROOT.length + 1))
  .sort();

describe('the data seam', () => {
  it('no new screen or component reads mocks directly', () => {
    expect(onMocks.filter((f) => !STILL_ON_MOCKS.includes(f))).toEqual([]);
  });

  it('files that moved to the seam come off the list', () => {
    expect(STILL_ON_MOCKS.filter((f) => !onMocks.includes(f))).toEqual([]);
  });

  it('nothing outside data/ reads the viewer from mocks', () => {
    const viaMocks = DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) =>
      /import\s*\{[^}]*\bviewer\b[^}]*\}\s*from\s*['"](?:\.\.?\/)+mocks\/people['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(viaMocks).toEqual([]);
  });
});
