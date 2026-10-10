import { useState } from 'react';
import { motion } from 'motion/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { boxStyle } from '../geometry';
import type { Region } from '../geometry';
import { FLIGHT_EASE } from '../motion';
import type { StudioTheme } from '../useStudioTheme';

const ZOOMS = [1, 1.5, 2] as const;

/** The whole original page, opened with a page turn (spec §4.1 rule 7). Image-based in Plan 1. */
export function FullPageDialog({
  open, onOpenChange, region, materialName, theme,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  region: Region;
  materialName: string;
  theme: StudioTheme;
}) {
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const { page, box } = region;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="studio-surface max-w-5xl rounded-2xl border-[rgb(var(--studio-hairline))]" data-theme={theme}>
        <DialogTitle className="text-[15px] font-medium tracking-[-0.01em]">
          {materialName} · page {page.page}
        </DialogTitle>
        <DialogDescription className="sr-only">The original page, with the selected spot outlined.</DialogDescription>
        <div className="flex w-fit gap-1 rounded-full bg-[rgb(var(--studio-chip))] p-1" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
              className={cn(
                'console-focusable h-7 rounded-full px-3 text-[12.5px] tabular-nums transition-colors',
                zoom === z ? 'bg-foreground text-background' : 'text-quiet hover:text-foreground',
              )}
            >
              {z * 100}%
            </button>
          ))}
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-xl bg-[rgb(var(--studio-chip))]">
          <motion.div
            initial={{ rotateY: 8, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.3, ease: FLIGHT_EASE }}
            style={{ transformPerspective: 1200, width: `${zoom * 100}%` }}
          >
            <div
              className="relative bg-[hsl(var(--studio-paper))]"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              <img
                src={page.imageUrl}
                alt={`Page ${page.page} of ${materialName}`}
                className="absolute inset-0 h-full w-full object-contain"
              />
              {box && (
                <div
                  aria-hidden
                  style={boxStyle(box)}
                  className="absolute rounded-[4px] border-2 border-[hsl(var(--studio-mark))] bg-[hsl(var(--studio-mark)/0.18)]"
                />
              )}
            </div>
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
