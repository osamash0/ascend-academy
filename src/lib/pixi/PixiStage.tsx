/**
 * PixiStage — a thin, reliable React mount for a Pixi v8 Application.
 *
 * Imperative on purpose: Pixi's own scene graph owns rendering, so we just give
 * it a sized host element and hand the initialised `Application` back via
 * `onReady`. This sidesteps version churn in declarative React bindings and
 * mirrors how the project already mounts three.js.
 *
 * Lifecycle is StrictMode-safe: init is async, so we track whether the app
 * finished initialising and destroy in whichever order mount/unmount resolves.
 */
import { useEffect, useRef, type CSSProperties, type DependencyList } from 'react';
import { Application } from 'pixi.js';

export interface PixiStageHandle {
  app: Application;
  /** The host <div> Pixi is sized to. */
  host: HTMLDivElement;
}

interface PixiStageProps {
  /**
   * Runs once the Application is initialised and its canvas is mounted.
   * Return an optional cleanup that runs just before the app is destroyed.
   */
  onReady: (handle: PixiStageHandle) => void | (() => void);
  className?: string;
  style?: CSSProperties;
  /** A Pixi color, or 'transparent' (default) to let the page show through. */
  background?: number | string;
  antialias?: boolean;
  /** Like useEffect deps — changing any value tears down and rebuilds the app. */
  deps?: DependencyList;
}

export function PixiStage({
  onReady,
  className,
  style,
  background = 'transparent',
  antialias = true,
  deps = [],
}: PixiStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    let initialised = false;
    let disposed = false;
    let userCleanup: void | (() => void);

    const transparent = background === 'transparent';

    app
      .init({
        resizeTo: host,
        antialias,
        backgroundAlpha: transparent ? 0 : 1,
        background: transparent ? undefined : (background as number),
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      .then(() => {
        initialised = true;
        if (disposed) {
          // Unmounted before init resolved — clean up the now-built renderer.
          app.destroy(true, { children: true, texture: true });
          return;
        }
        host.appendChild(app.canvas);
        userCleanup = onReadyRef.current({ app, host });
      })
      .catch((err) => {
        if (!disposed) console.error('[PixiStage] failed to initialise', err);
      });

    return () => {
      disposed = true;
      if (typeof userCleanup === 'function') {
        try {
          userCleanup();
        } catch (err) {
          console.error('[PixiStage] scene cleanup threw', err);
        }
      }
      // Only destroy if init finished; otherwise the .then branch handles it.
      if (initialised) app.destroy(true, { children: true, texture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', ...style }}
    />
  );
}
