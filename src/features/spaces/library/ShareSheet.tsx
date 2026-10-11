import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { shareOutcome, shareSplit, type Role, type ShelfItem } from '../studio/shelf';
import { shelfActions, shelfSpaceName } from '../data/useShelf';
import { useMySpaces } from '../data/useSpaces';
import { Journey } from './Journey';
import { ABOVE_SELECT_BAR } from './toasts';

/**
 * Share from the page (One Library spec §5.6). The sheet says what will happen
 * before you press it: choose a Space, read the outcome, then confirm.
 */

const ROLE_SAID: Record<Role, string> = {
  owner: 'you own it',
  editor: 'you edit it',
  member: 'you’re a member',
};

/**
 * The sheet: "Share {filename}". Controlled, so a cover's menu and the page's button open the same one.
 *
 * Given `items` (Select on the shelf), it shares every private one to the
 * chosen Space and leaves the rest as they are, saying so before and after.
 */
export function ShareSheet({
  item,
  items,
  open,
  onOpenChange,
  onShared,
  returnFocus,
}: {
  item?: ShelfItem;
  items?: ShelfItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a confirmed share. */
  onShared?: () => void;
  /** Where focus lands on close. The opener may be gone (a menu item), so name the stable one. */
  returnFocus?: () => HTMLElement | null;
}) {
  const all = items ?? (item ? [item] : []);
  const one = !items && item ? item : null;
  const { go: shareable, left } = shareSplit(all);
  const { spaces, state } = useMySpaces();
  const [chosen, setChosen] = useState<string | null>(null);
  // Opened without a Radix trigger, so focus comes back by hand: the named target, else whatever had focus.
  const opener = useRef<HTMLElement | null>(null);
  const space = spaces.find((s) => s.id === chosen) ?? null;
  const role = space?.viewerRole ?? null;
  const outcome = space && role ? shareOutcome(role, space.mode) : null;

  const confirm = () => {
    if (!space || !role || !outcome) return;
    if (one) {
      shelfActions.share(one.id, space.id, role, space.mode);
      toast(outcome.kind === 'draft' ? `Draft in ${space.name}` : `Shared to ${space.name}`);
    } else {
      for (const i of shareable) shelfActions.share(i.id, space.id, role, space.mode);
      const did = `${shareable.length} ${outcome.kind === 'draft' ? `drafted in ${space.name}` : 'shared'}`;
      toast([did, ...left].join(' · '), ABOVE_SELECT_BAR);
    }
    onOpenChange(false);
    onShared?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setChosen(null);
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          (returnFocus?.() ?? opener.current)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {one ? `Share ${one.filename}` : `Share ${all.length} ${all.length === 1 ? 'file' : 'files'}`}
          </DialogTitle>
          <DialogDescription>Choose a Space. What happens next is written below before you confirm.</DialogDescription>
        </DialogHeader>
        {one && <Journey item={one} className="lg:hidden" />}
        {!one && left.length > 0 && (
          <p className="text-[13.5px] text-quiet">Left as they are: {left.join(' · ')}.</p>
        )}
        {state !== 'ready' ? (
          <p className="text-[14px] text-quiet">Looking for your Spaces…</p>
        ) : spaces.length === 0 ? (
          <p className="text-[14px] text-quiet">You aren’t in a Space yet. Join or make one, then share from here.</p>
        ) : (
          <div role="radiogroup" aria-label="Spaces" className="flex flex-col gap-1.5">
            {spaces.map((s) => (
              <label
                key={s.id}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center rounded-xl border px-3.5 py-2 text-[14px] transition-colors focus-within:ring-2 focus-within:ring-ring',
                  chosen === s.id ? 'border-foreground/60 bg-foreground/[0.06]' : 'border-border hover:bg-foreground/[0.04]',
                )}
              >
                <input
                  type="radio"
                  name="share-space"
                  value={s.id}
                  checked={chosen === s.id}
                  onChange={() => setChosen(s.id)}
                  className="sr-only"
                />
                {s.name} · {s.mode === 'open' ? 'Open' : 'Guided'} · {ROLE_SAID[s.viewerRole as Role]}
              </label>
            ))}
          </div>
        )}
        <p aria-live="polite" className="min-h-[2.75rem] text-[13.5px] leading-relaxed text-quiet">
          {outcome && space ? outcome.copy(space.name) : ''}
        </p>
        <DialogFooter>
          <button
            type="button"
            disabled={!space || (!one && shareable.length === 0)}
            onClick={confirm}
            className="console-focusable h-10 rounded-full bg-foreground px-5 text-[14px] font-medium text-background transition-opacity disabled:opacity-40"
          >
            {space ? `Share to ${space.name}` : 'Share'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BUTTON =
  'console-focusable flex h-9 max-w-[16rem] items-center gap-1.5 rounded-full border border-[rgb(var(--studio-hairline))] px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-[rgb(var(--studio-chip))]';

/** The label: "Share", "Draft in {Space}", or "Shared · ♥ 3". */
function ShareLabel({ item }: { item: ShelfItem }) {
  const s = item.share;
  if (s.kind === 'private')
    return (
      <>
        <Share2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Share
      </>
    );
  if (s.kind === 'draft') return <span className="truncate">Draft in {shelfSpaceName(s.spaceId)}</span>;
  return (
    <span className="truncate">
      Shared
      {s.likes > 0 && (
        <>
          {' · '}
          <span aria-hidden>♥ </span>
          {s.likes}
          <span className="sr-only">{s.likes === 1 ? ' like' : ' likes'}</span>
        </>
      )}
    </span>
  );
}

/** The page's Share button: the sheet when private, a small menu once it is a draft or shared. */
export function ShareButton({ item }: { item: ShelfItem }) {
  const [sheet, setSheet] = useState(false);
  const [takeBack, setTakeBack] = useState(false);
  const s = item.share;
  // The header button swaps element when the state changes, so find it fresh by its wrapper.
  const wrap = useRef<HTMLSpanElement>(null);
  // The dialog outlives the state change by its exit fade, so remember where it was.
  const was = useRef('its Space');
  if (s.kind !== 'private') was.current = shelfSpaceName(s.spaceId);
  const home = () => wrap.current?.querySelector<HTMLElement>('button') ?? null;

  return (
    <>
      <span ref={wrap} className="contents">
      {s.kind === 'private' ? (
        <button type="button" onClick={() => setSheet(true)} className={BUTTON}>
          <ShareLabel item={item} />
        </button>
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={BUTTON}>
              <ShareLabel item={item} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[14rem] rounded-xl p-1 text-[13px]">
            <div className="px-2 pb-2 pt-1.5 lg:hidden">
              <Journey item={item} />
            </div>
            <DropdownMenuSeparator className="lg:hidden" />
            {s.kind === 'draft' ? (
              <DropdownMenuItem
                className="rounded-lg"
                onSelect={() => {
                  shelfActions.publish(item.id);
                  toast(`Shared to ${shelfSpaceName(s.spaceId)}`);
                }}
              >
                Publish to {shelfSpaceName(s.spaceId)}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem asChild className="rounded-lg">
                <Link to={`/v4/space/${s.spaceId}`}>Open in {shelfSpaceName(s.spaceId)}</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="rounded-lg" onSelect={() => setTakeBack(true)}>
              Take back to only you
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      </span>
      <ShareSheet item={item} open={sheet} onOpenChange={setSheet} returnFocus={home} />
      <Dialog open={takeBack} onOpenChange={setTakeBack}>
        <DialogContent
          className="max-w-sm"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            home()?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Take {item.filename} back to only you?</DialogTitle>
            <DialogDescription>
              It leaves {was.current}. Your page and your words stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setTakeBack(false)}
              className="console-focusable h-10 rounded-full border border-border px-5 text-[14px]"
            >
              Keep it shared
            </button>
            <button
              type="button"
              onClick={() => {
                shelfActions.unshare(item.id);
                setTakeBack(false);
                toast('Back to only you');
              }}
              className="console-focusable h-10 rounded-full bg-foreground px-5 text-[14px] font-medium text-background"
            >
              Take it back
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
