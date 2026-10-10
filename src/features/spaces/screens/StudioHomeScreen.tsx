import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ListSkeleton, SpacesError } from '../components/states';
import { useStudioHome } from '../data/useSpaces';
import { STUDIO_CANVAS } from '../mocks/studio-canvas';
import { useStudioTheme } from '../studio/useStudioTheme';
import '../studio/studio-surface.css';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Studio's front door — spec §3.1. Calm, one primary action. */
export default function StudioHomeScreen() {
  const { state, recent } = useStudioHome();
  const [theme] = useStudioTheme();
  const navigate = useNavigate();

  /* Mock: any chosen file opens the sample canvas, and says so. */
  const open = () => {
    toast('Opened with sample pages', { description: 'Real import arrives with the file pipeline.' });
    navigate(`/v4/library/studio/c/${STUDIO_CANVAS.id}`);
  };

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <Link
          to="/v4/library"
          className="mb-6 inline-flex min-h-6 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" /> Library
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Studio</h1>
        <p className="mt-2 max-w-[56ch] text-muted-foreground">
          Open a Material to read it clean, check it against the original, and make study material from it.
        </p>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) open();
          }}
          className="mt-8 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center hover:border-primary/50"
        >
          <Upload aria-hidden className="h-6 w-6 text-muted-foreground" />
          <span className="font-medium">Open Material</span>
          <span className="text-sm text-muted-foreground">PDF, PPTX or a photo — drop it here or choose a file</span>
          <input
            type="file"
            accept=".pdf,.pptx,image/*"
            aria-label="Open Material"
            className="sr-only"
            onChange={(e) => e.target.files?.length && open()}
          />
        </label>

        <h2 className="mt-12 text-sm font-semibold">Continue where you left off</h2>
        <div className="mt-3">
          {state === 'loading' ? (
            <ListSkeleton />
          ) : state === 'error' ? (
            <SpacesError what="your recent work" />
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Materials you open show up here.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/v4/library/studio/c/${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <FileText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {[r.spaceName, formatDate(r.updatedAt)].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <nav aria-label="Manage your work" className="mt-12 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <Link to="/v4/library/uploads" className="hover:text-foreground">Manage uploads</Link>
          <Link to="/v4/library/drafts" className="hover:text-foreground">Your drafts</Link>
          <Link to="/v4/library/impact" className="hover:text-foreground">How your work landed</Link>
        </nav>
      </div>
    </div>
  );
}
