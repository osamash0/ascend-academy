import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { NAV_TABS, navHref, type NavKey } from './SpacesTopBar';

/**
 * The five destinations, on a phone.
 *
 * Doc 2 listed the bottom bar as an open question. The answer here is the
 * plain one: the same five destinations, in the same order, at the bottom
 * where a thumb reaches — and the top bar drops its pills below `md` so there
 * is exactly one navigation control on screen, not two that must agree.
 *
 * Labels stay. An icon-only bar saves a row of pixels and costs the one thing
 * a five-tab bar needs, which is knowing what the fourth tab is before you tap
 * it. There is room for both at 375px.
 *
 * The destinations and the route rule come from `SpacesTopBar`. This file held
 * a byte-for-byte copy of both, and the guard compared only the keys — so a
 * renamed label or a changed route left the two navs disagreeing, green.
 *
 * `Link`, not `button`. These were buttons calling `navigate()`, so they were
 * announced as buttons rather than links and offered no middle-click, no "open
 * in new tab" and no status-bar preview — and `aria-current="page"` reads
 * oddly on a role that is not a link. Navigation should be navigable.
 *
 * The visible label doubles as the accessible name, so the `aria-label` that
 * duplicated it is gone: two sources for one string, and the pair could drift.
 *
 * Safe-area padding is real, not decorative: without it the bar sits under the
 * home indicator on every iPhone since the X, and the two rightmost tabs are
 * the ones you cannot hit.
 *
 * **Portalled to `document.body` on purpose.** It is mounted from the top bar,
 * which sits inside `DepthScene` — and DepthScene animates a transform for the
 * parallax. A transformed ancestor becomes the containing block for
 * `position: fixed`, so the first version pinned itself to the top of the
 * scene instead of the bottom of the viewport. It looked like a second header.
 * Nothing in the CSS was wrong; the tree was.
 */

export function MobileNav({ active }: { active: NavKey }) {
  return createPortal(
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around md:hidden',
        'border-t border-white/[0.08] bg-[#070b14]/95 backdrop-blur-xl',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {NAV_TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            to={navHref(tab.key)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              // 56px tall: comfortably past the 24px floor, and the whole
              // column is the target rather than the glyph inside it.
              'console-focusable relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5',
              // 11.5px, which is the calm table's floor. It was 10.5 — the
              // smallest type in the build, on the primary navigation, on the
              // smallest screens.
              'text-[11.5px] font-medium transition-colors',
              isActive ? 'text-foreground' : 'text-quiet',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="v4MobileTab"
                className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <tab.icon aria-hidden className="h-[18px] w-[18px]" />
            {tab.label}
          </Link>
        );
      })}
    </nav>,
    document.body,
  );
}

/**
 * Spacer so a fixed bottom bar never covers the last row of a screen.
 *
 * Mounted by `Scene` rather than by each screen: a screen that forgets it
 * looks fine until you scroll to the bottom, which is exactly the kind of bug
 * that survives review.
 */
export function MobileNavSpacer() {
  return <div aria-hidden className="h-[68px] md:hidden" />;
}
