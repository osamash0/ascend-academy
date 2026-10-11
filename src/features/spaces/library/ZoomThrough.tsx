import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { FLIGHT_EASE, RECEDE_S, ZOOM_S } from '../studio/motion';

/**
 * Open: the cover becomes the page (One Library spec §5.4).
 *
 * A click on a cover (or the Continue card) is held for one movement: a copy
 * of its page image grows from where it sits to fill the window while the
 * shelf behind recedes, and only then does the route change. The page takes
 * over from that frame (`{ from: 'shelf' }` tells it to fade up).
 *
 * Enter on a link is a click, so the keyboard gets the same movement.
 * ⌘/Ctrl/Shift/Alt-clicks and middle clicks are left to the browser, so a new
 * tab still opens the plain way.
 */

/** Reduced motion: one fade, then the page. */
const FADE_S = 0.15;

export interface ZoomOrigin {
  /** The element whose rect the clone starts from: the cover's page frame. */
  frame: HTMLElement | null;
  /** The page image to grow; '' for a cover without one. */
  src: string;
}

type Start = (e: React.MouseEvent<HTMLAnchorElement>, href: string, origin: ZoomOrigin) => void;

const ZoomContext = createContext<Start | null>(null);

/** Inside `<ZoomThrough>`, the click handler a cover link calls; outside it, null (a plain link). */
export const useZoomThrough = (): Start | null => useContext(ZoomContext);

interface Flight {
  src: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export function ZoomThrough({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [flight, setFlight] = useState<Flight | null>(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const href = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  /** Runs once per flight: from the animation's end, or the fallback timer, whichever is first. */
  const finish = useCallback(() => {
    const to = href.current;
    href.current = null;
    clearTimeout(timer.current);
    if (to) navigateRef.current(to, { state: { from: 'shelf' } });
  }, []);

  const start = useCallback<Start>(
    (e, to, { frame, src }) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (href.current) return; // one flight at a time
      const r = frame?.getBoundingClientRect();
      href.current = to;
      setFlight({ src, top: r?.top ?? 0, left: r?.left ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 });
      // Motion's completion is not guaranteed (a hidden tab, a test DOM): the timer is the floor.
      timer.current = setTimeout(finish, (reduce ? FADE_S : ZOOM_S) * 1000);
    },
    [finish, reduce],
  );

  const full = typeof window === 'undefined' ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight };

  return (
    <ZoomContext.Provider value={start}>
      <motion.div
        initial={false}
        animate={flight ? (reduce ? { opacity: 0 } : { scale: 0.98, opacity: 0.4 }) : { scale: 1, opacity: 1 }}
        transition={{ duration: reduce ? FADE_S : RECEDE_S, ease: FLIGHT_EASE }}
        style={{ transformOrigin: '50% 30%' }}
      >
        {children}
      </motion.div>
      {flight &&
        createPortal(
          <motion.div
            data-testid="zoom-through"
            aria-hidden
            className="pointer-events-none fixed z-[100] overflow-hidden bg-[#0b0b0b]"
            initial={
              reduce
                ? { opacity: 0, top: 0, left: 0, ...full, borderRadius: 0 }
                : { top: flight.top, left: flight.left, width: flight.width, height: flight.height, borderRadius: 14 }
            }
            animate={
              reduce
                ? { opacity: 1 }
                : { top: 0, left: 0, width: full.width, height: full.height, borderRadius: 0 }
            }
            transition={{ duration: reduce ? FADE_S : ZOOM_S, ease: FLIGHT_EASE }}
            onAnimationComplete={finish}
          >
            {flight.src && !reduce && (
              <img src={flight.src} alt="" className="h-full w-full bg-[#f7f6f2] object-cover object-left-top" />
            )}
          </motion.div>,
          document.body,
        )}
    </ZoomContext.Provider>
  );
}
