import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pressable } from './Pressable';
import type { Contribution, Role } from '../types';
import { reanchor, reanchorTargets } from '../mocks/reanchor';

/**
 * Give an orphaned contribution a new Lesson.
 *
 * The Lesson something was attached to can be deleted, and Doc 1's
 * Contributions rule 1 surfaces the result to the Owner *and* the author so it
 * can be re-filed. Library reported that state and offered nothing to do about
 * it — its own copy said "pick a new place for it" with nothing in the product
 * that picked one.
 *
 * Radio rows rather than a `<select>`, matching `SpaceDialogs`' `Choice`, so a
 * Lesson list reads the same here as everywhere else. Scrolls at eight rows;
 * a Space can have many Lessons and the confirm button must never leave the
 * viewport.
 *
 * The destination list is published Lessons only — see `reanchorTargets`.
 */
export function ReanchorDialog({
  contribution,
  spaceId,
  spaceName,
  viewerRole,
  open,
  onOpenChange,
  onMoved,
}: {
  contribution: Contribution;
  spaceId: string;
  spaceName: string;
  /**
   * Who is asking. The author may re-file their own work; an Owner or Editor
   * may re-file anyone's. Passed down rather than inferred here so the check
   * is the same one `canReanchor` makes.
   */
  viewerRole: Role | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onMoved?: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const targets = reanchorTargets(spaceId);

  // Reopening must not offer last time's choice as though it were made.
  useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);

  const confirm = () => {
    if (!chosen) return;
    /*
     * `reanchor` returns whether it took, and this respects the answer. It
     * refuses a Lesson that is missing or unpublished, and a toast saying
     * "Moved" after a refusal would be the most convincing kind of wrong —
     * the row behind the dialog would still say the work has no home.
     */
    const moved = reanchor(contribution, chosen, viewerRole);
    if (!moved) {
      toast('Could not move it', {
        description: 'That Lesson is no longer available. Nothing was changed.',
      });
      onOpenChange(false);
      return;
    }
    const lesson = targets.find((l) => l.id === chosen);
    onOpenChange(false);
    onMoved?.();
    toast('Moved', {
      description: `“${contribution.title}” now sits in ${lesson?.title ?? 'its new Lesson'}.`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-semibold">Find it a new home</DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-quiet">
            The Lesson “{contribution.title}” was attached to is gone. Pick another one in{' '}
            {spaceName} and it will sit there instead, with its likes and its endorsement
            intact.
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          /*
           * Reachable, and the reason the confirm button is not just disabled:
           * a Space whose Lessons are all drafts has nowhere to put this, and
           * saying so is more use than an inert control.
           */
          <p className="py-6 text-[14px] leading-relaxed text-quiet">
            {spaceName} has no published Lessons to move this into yet. Your work stays
            where it is, and nothing is lost — try again once a Lesson is published.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Lessons"
            className="max-h-[46vh] space-y-2 overflow-y-auto py-2"
          >
            {targets.map((l) => {
              const active = chosen === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChosen(l.id)}
                  className={cn(
                    'console-focusable flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
                    active
                      ? 'border-primary/45 bg-primary/[0.08]'
                      : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      active ? 'border-primary' : 'border-white/25',
                    )}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="w-5 shrink-0 text-[12.5px] text-faint tabular-nums">
                    {l.order}
                  </span>
                  <span className="min-w-0 truncate text-[14.5px] font-medium">{l.title}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Pressable
            type="button"
            onClick={() => onOpenChange(false)}
            className="console-focusable h-10 rounded-full px-4 text-[13.5px] font-medium text-quiet hover:text-foreground"
          >
            Cancel
          </Pressable>
          <Pressable
            type="button"
            onClick={confirm}
            disabled={!chosen}
            title={chosen ? undefined : 'Pick a Lesson first'}
            className="console-focusable h-10 rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900 disabled:opacity-40"
          >
            Move it here
          </Pressable>
        </div>
      </DialogContent>
    </Dialog>
  );
}
