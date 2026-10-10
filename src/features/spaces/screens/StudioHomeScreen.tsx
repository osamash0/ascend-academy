import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ListSkeleton, SpacesError } from '../components/states';
import { useStudioHome } from '../data/useSpaces';
import { STUDIO_CANVAS } from '../mocks/studio-canvas';
import { useStudioTheme } from '../studio/useStudioTheme';
import '../studio/studio-surface.css';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Studio's front door — spec §3.1, in the reader's language: black ground, one white pill. */
export default function StudioHomeScreen() {
  const { state, recent } = useStudioHome();
  const [theme] = useStudioTheme();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);

  /* Mock: any chosen file opens the sample canvas, and says so. */
  const open = () => {
    toast('Opened with sample pages', { description: 'Real import arrives with the file pipeline.' });
    navigate(`/v4/library/studio/c/${STUDIO_CANVAS.id}`);
  };

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <Link
        to="/v4/library"
        aria-label="Back to Library"
        className="console-focusable fixed left-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full text-quiet transition-colors hover:bg-[rgb(var(--studio-chip))] hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="h-5 w-5" />
      </Link>

      <main className="mx-auto max-w-2xl px-4 pb-16 pt-24 md:px-6">
        {/* The hero is also the drop target: a file dropped anywhere on it opens. */}
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
            'flex flex-col items-center rounded-3xl border border-dashed px-6 py-12 text-center transition-colors',
            dragging ? 'border-[rgb(var(--text-faint))] bg-[rgb(var(--studio-chip))]' : 'border-transparent',
          )}
        >
          <p className="mb-2 text-[12.5px] text-quiet">Library</p>
          <h1 className="text-4xl font-bold tracking-[-0.02em] sm:text-[44px]">Studio</h1>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-quiet">
            Open a Material to read it clearly, check it against the source, and make study material from it.
          </p>

          <label className="console-focusable mt-8 inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-foreground px-7 text-[14.5px] font-semibold text-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
            <Upload aria-hidden className="h-4 w-4" />
            Open Material
            <input
              type="file"
              accept=".pdf,.pptx,image/*"
              aria-label="Open Material"
              className="sr-only"
              onChange={(e) => e.target.files?.length && open()}
            />
          </label>
          <p className="mt-3 text-[12px] text-faint">PDF, PPTX or a photo — or drop it here</p>
        </section>

        <h2 className="mt-10 text-[12.5px] font-medium text-faint">
          Continue where you left off
        </h2>
        <div className="mt-3">
          {state === 'loading' ? (
            <ListSkeleton />
          ) : state === 'error' ? (
            <SpacesError what="your recent work" />
          ) : recent.length === 0 ? (
            <p className="text-[14px] text-quiet">Materials you open show up here.</p>
          ) : (
            <ul className="divide-y divide-[rgb(var(--studio-hairline))] border-y border-[rgb(var(--studio-hairline))]">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/v4/library/studio/c/${r.id}`}
                    className="console-focusable group flex min-h-14 items-center gap-3 rounded-md px-1 py-3 transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-foreground">{r.title}</span>
                      <span className="block truncate text-[12.5px] text-faint">
                        {[r.spaceName, formatDate(r.updatedAt)].filter(Boolean).join(' · ')}
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
        </div>

        <nav aria-label="Manage your work" className="mt-12 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-quiet">
          <Link to="/v4/library/uploads" className="console-focusable rounded-sm hover:text-foreground">Manage uploads</Link>
          <Link to="/v4/library/drafts" className="console-focusable rounded-sm hover:text-foreground">Your drafts</Link>
          <Link to="/v4/library/impact" className="console-focusable rounded-sm hover:text-foreground">How your work landed</Link>
        </nav>
      </main>
    </div>
  );
}
