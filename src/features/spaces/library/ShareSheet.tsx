import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
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
import { say } from '../components/course/phrase';
import { knownSpaceName, shelfActions, shelfSpaceName } from '../data/useShelf';
import { useMySpaces } from '../data/useSpaces';
import { Journey } from './Journey';
import { ABOVE_SELECT_BAR } from './toasts';

/**
 * Share from the page (One Library spec §5.6). The sheet says what will happen
 * before you press it: choose a Space, read the outcome, then confirm.
 */

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
  const { t } = useTranslation('v4Library', { keyPrefix: 'library.shelf' });
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
    // Only what the store really shared is said to be shared.
    if (one) {
      if (shelfActions.share(one.id, space.id, role, space.mode))
        toast(t(outcome.kind === 'draft' ? 'share.toastDraft' : 'share.toastShared', { space: space.name }));
    } else {
      const done = shareable.filter((i) => shelfActions.share(i.id, space.id, role, space.mode)).length;
      const did = outcome.kind === 'draft' ? t('share.drafted', { count: done, space: space.name }) : t('share.done', { count: done });
      toast([did, ...left.map((p) => say(t, p))].join(' · '), ABOVE_SELECT_BAR);
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
            {one ? t('share.title', { name: one.filename }) : t('share.titleMany', { count: all.length })}
          </DialogTitle>
          <DialogDescription>{t('share.intro')}</DialogDescription>
        </DialogHeader>
        {one && <Journey item={one} className="lg:hidden" />}
        {!one && left.length > 0 && (
          <p className="text-[13.5px] text-quiet">{t('share.left', { list: left.map((p) => say(t, p)).join(' · ') })}</p>
        )}
        {state !== 'ready' ? (
          <p className="text-[14px] text-quiet">{t('share.loading')}</p>
        ) : spaces.length === 0 ? (
          <p className="text-[14px] text-quiet">{t('share.none')}</p>
        ) : (
          <div role="radiogroup" aria-label={t('share.spaces')} className="flex flex-col gap-1.5">
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
                {s.name} · {t(s.mode === 'open' ? 'share.mode.open' : 'share.mode.guided')} · {t(`share.role.${s.viewerRole as Role}`)}
              </label>
            ))}
          </div>
        )}
        <p aria-live="polite" className="min-h-[2.75rem] text-[13.5px] leading-relaxed text-quiet">
          {outcome && space ? say(t, outcome.copy(space.name)) : ''}
        </p>
        <DialogFooter>
          <button
            type="button"
            disabled={!space || (!one && shareable.length === 0)}
            onClick={confirm}
            className="console-focusable h-10 rounded-full bg-foreground px-5 text-[14px] font-medium text-background transition-opacity disabled:opacity-40"
          >
            {space ? t('share.confirmTo', { space: space.name }) : t('share.confirm')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BUTTON =
  'console-focusable flex h-9 min-w-0 max-w-[16rem] items-center gap-1.5 rounded-full border border-[rgb(var(--studio-hairline))] px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-[rgb(var(--studio-chip))]';

/** The label: "Share", "Draft in {Space}", or "Shared · ♥ 3". */
function ShareLabel({ item }: { item: ShelfItem }) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'library.shelf' });
  const s = item.share;
  if (s.kind === 'private')
    return (
      <>
        <Share2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {t('share.button')}
      </>
    );
  if (s.kind === 'draft') return <span className="truncate">{t('share.draftLabel', { space: shelfSpaceName(s.spaceId) })}</span>;
  return (
    <span className="truncate">
      {/*
        On a phone the page's top bar has no room for the word as well
        ("Geteilt · ♥ 3" pushed the whole page to 413px at 375): there the
        heart and count say it, and screen readers still hear the word.
      */}
      <span className={s.likes > 0 ? 'sr-only sm:not-sr-only' : undefined}>{t('share.sharedLabel')}</span>
      {s.likes > 0 && (
        <>
          <span className="sr-only sm:not-sr-only">{' · '}</span>
          <span aria-hidden>♥ </span>
          {s.likes}
          <span className="sr-only">{t('share.likes', { count: s.likes })}</span>
        </>
      )}
    </span>
  );
}

/**
 * Everything you can do about where a file lives, in one place, for the
 * page's button and a cover's menu alike: private → Share; a draft → Publish
 * or Take back; shared → Open in its Space or Take back. Nothing re-shares a
 * file that is already drafted or shared.
 *
 * `home` names where focus returns when a dialog closes: the opener may be a
 * menu item that is gone by then. `children` lays out the trigger; it gets the
 * menu items (with the class its menu uses) and a way to open the sheet.
 */
export interface ShareApi {
  menuItems: (itemClassName: string, shareIcon?: ReactNode) => ReactNode;
  openSheet: () => void;
}

export function ShareActions({
  item,
  home,
  children,
}: {
  item: ShelfItem;
  home: () => HTMLElement | null;
  children: (share: ShareApi) => ReactNode;
}) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'library.shelf' });
  const [sheet, setSheet] = useState(false);
  const [takeBack, setTakeBack] = useState(false);
  const s = item.share;
  // The dialog outlives the state change by its exit fade, so remember where it was (null: its Space is gone).
  const was = useRef<string | null>(null);
  if (s.kind !== 'private') was.current = knownSpaceName(s.spaceId);
  const ready = item.stage === 'ready';

  const menuItems = (itemClassName: string, shareIcon?: ReactNode): ReactNode =>
    s.kind === 'private' ? (
      <DropdownMenuItem disabled={!ready} onSelect={() => setSheet(true)} className={itemClassName}>
        {shareIcon}
        {t('share.button')}
      </DropdownMenuItem>
    ) : (
      <>
        {s.kind === 'draft' ? (
          <DropdownMenuItem
            disabled={!ready}
            className={itemClassName}
            onSelect={() => {
              shelfActions.publish(item.id);
              toast(t('share.toastShared', { space: shelfSpaceName(s.spaceId) }));
            }}
          >
            {t('share.publish', { space: shelfSpaceName(s.spaceId) })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild className={itemClassName}>
            <Link to={`/v4/space/${s.spaceId}`}>{t('share.openIn', { space: shelfSpaceName(s.spaceId) })}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={itemClassName} onSelect={() => setTakeBack(true)}>
          {t('share.takeBack')}
        </DropdownMenuItem>
      </>
    );

  return (
    <>
      {children({ menuItems, openSheet: () => setSheet(true) })}
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
            <DialogTitle>{t('share.takeBackTitle', { name: item.filename })}</DialogTitle>
            <DialogDescription>
              {was.current ? t('share.takeBackBody', { space: was.current }) : t('share.takeBackBodyNoSpace')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setTakeBack(false)}
              className="console-focusable h-10 rounded-full border border-border px-5 text-[14px]"
            >
              {t('share.keepShared')}
            </button>
            <button
              type="button"
              onClick={() => {
                shelfActions.unshare(item.id);
                setTakeBack(false);
                toast(t('share.backToYou'));
              }}
              className="console-focusable h-10 rounded-full bg-foreground px-5 text-[14px] font-medium text-background"
            >
              {t('share.takeIt')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The page's Share button: the sheet when private, a small menu once it is a
 * draft or shared. A file not read yet cannot be shared, and says so.
 */
export function ShareButton({ item }: { item: ShelfItem }) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'library.shelf' });
  const NOT_READY = t('share.notReady');
  const s = item.share;
  // The header button swaps element when the state changes, so find it fresh by its wrapper.
  const wrap = useRef<HTMLSpanElement>(null);
  const home = () => wrap.current?.querySelector<HTMLElement>('button') ?? null;
  const ready = item.stage === 'ready';

  return (
    <ShareActions item={item} home={home}>
      {(share) => (
        <span ref={wrap} className="contents">
          {s.kind === 'private' ? (
            ready ? (
              <button type="button" onClick={share.openSheet} className={BUTTON}>
                <ShareLabel item={item} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled
                  title={NOT_READY}
                  aria-describedby={`share-not-ready-${item.id}`}
                  className={cn(BUTTON, 'cursor-not-allowed opacity-50 hover:bg-transparent')}
                >
                  <ShareLabel item={item} />
                </button>
                <span id={`share-not-ready-${item.id}`} className="sr-only">
                  {NOT_READY}
                </span>
              </>
            )
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
                {share.menuItems('rounded-lg')}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      )}
    </ShareActions>
  );
}
