import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ListSkeleton, SpacesError } from '../components/states';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Masthead, Skylight, backLink, ghostPill, stageCard, stageCardHover } from '../components/stage';
import { Scene, SURFACES } from '../components/Scene';
import { useStudioHome } from '../data/useSpaces';
import { STUDIO_CANVAS } from '../mocks/studio-canvas';
import { viewer } from '../mocks/people';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Studio's front door, in Library's language: the stage, a masthead, one white pill. */
export default function StudioHomeScreen() {
  const { state, recent } = useStudioHome();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);

  /* Mock: any chosen file opens the sample canvas, and says so. */
  const open = () => {
    toast('Opened with sample pages', { description: 'Real import arrives with the file pipeline.' });
    navigate(`/v4/library/studio/c/${STUDIO_CANVAS.id}`);
  };

  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.library} status="progress" motionKey="studio" accent={null}>
      <SpacesTopBar active="library" viewer={viewer} />
      <div className="relative">
        <Skylight accent={null} />
        {body}
      </div>
    </Scene>
  );

  if (state === 'loading') return chrome(<ListSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="your recent work" />);

  return chrome(
    <main className="relative mx-auto max-w-5xl px-6 pb-24 pt-10 lg:px-8">
      <Link to="/v4/library" className={backLink}>
        <ChevronLeft aria-hidden className="h-4 w-4" />
        Library
      </Link>

      {/* The whole hero is the drop target: a file dropped on it opens. */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) open();
        }}
        className={cn(
          'mt-2 rounded-3xl border border-dashed px-2 py-6 transition-colors',
          dragging ? 'border-white/25 bg-white/[0.03]' : 'border-transparent',
        )}
      >
        <Masthead
          title="Studio"
          lede="Turn a file into calm pages you can read, ask and recall — the original always one gesture away."
        />
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
          <label className="console-focusable inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-slate-900 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
            <Upload aria-hidden className="h-4 w-4" />
            Open material
            <input
              type="file"
              accept=".pdf,.pptx,image/*"
              aria-label="Open material"
              className="sr-only"
              onChange={(e) => e.target.files?.length && open()}
            />
          </label>
          <Link to="/v4/library/uploads" className={ghostPill}>
            Manage uploads
          </Link>
        </div>
        <p className="mt-3 text-center text-[12px] text-faint">PDF, PPTX or a photo — or drop it here</p>
      </section>

      <h2 className="mt-16 text-[26px] font-medium tracking-[-0.02em]">Recent</h2>
      {recent.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
          <FileText aria-hidden className="mx-auto mb-4 h-6 w-6 text-quiet" />
          <p className="mb-2 text-[17px] font-semibold">Nothing opened yet</p>
          <p className="mx-auto max-w-[48ch] text-[14.5px] leading-relaxed text-quiet">
            Materials you open show up here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {recent.map((r) => (
            <li key={r.id}>
              <Link
                to={`/v4/library/studio/c/${r.id}`}
                className={cn(
                  stageCard,
                  stageCardHover,
                  'console-focusable group flex items-center gap-4 px-5 py-4',
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-quiet">
                  <FileText aria-hidden className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-semibold text-foreground">{r.title}</span>
                  <span className="mt-1 block truncate text-[13.5px] text-quiet">
                    {[r.spaceName, `updated ${formatDate(r.updatedAt)}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>,
  );
}
