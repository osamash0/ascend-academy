import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { useCanvas } from '../data/useSpaces';
import { CanvasPage } from '../studio/components/CanvasPage';
import { groupByPage } from '../studio/geometry';
import { useStudioTheme } from '../studio/useStudioTheme';
import type { CanvasDoc } from '../studio/types';
import '../studio/studio-surface.css';

/** The Studio canvas — spec §3.2. The Material owns the screen. */
export default function StudioCanvasScreen() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const { state, canvas, pages, material, spaceName } = useCanvas(canvasId);
  const [theme, toggleTheme] = useStudioTheme();
  /** Your edits this session, over the loaded canvas. */
  const [edited] = useState<CanvasDoc | null>(null);
  const doc = edited ?? canvas;
  const groups = useMemo(() => (doc ? groupByPage(doc.blocks) : []), [doc]);

  const frame = (children: React.ReactNode) => (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <div className="mx-auto max-w-3xl p-8">{children}</div>
    </div>
  );
  if (state === 'loading') return frame(<ListSkeleton />);
  if (state === 'error') return frame(<SpacesError what="this Material" />);
  if (!doc || !material)
    return frame(<NotFound what="Material" backTo="/v4/library/studio" backLabel="Back to Studio" />);

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-3 md:px-6">
          <Link
            to="/v4/library/studio"
            aria-label="Back to Studio"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{material.filename}</h1>
            <p className="truncate text-xs text-muted-foreground">{spaceName}</p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {theme === 'dark' ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[90rem] gap-6 px-4 md:px-6 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,46rem)_minmax(18rem,1fr)]">
        <div className="hidden min-[1200px]:block" />
        <main className="min-w-0 py-10 pl-14 md:pl-16">
          <CanvasPage
            groups={groups}
            pages={pages}
            activeBlockId={null}
            flashBlockId={null}
            sourceRemoved={material.sourceRemoved}
            onBlockPointerEnter={() => {}}
            onBlockPointerLeave={() => {}}
            onOpenPeek={() => {}}
            onClosePeek={() => {}}
          />
        </main>
        <div className="hidden min-[1200px]:block" />
      </div>
    </div>
  );
}
