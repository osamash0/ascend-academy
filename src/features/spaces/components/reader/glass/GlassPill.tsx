import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { cn } from '@/lib/utils';
import { backdropOps, backdropRect, type Slot } from './compose';
import { FRAGMENT, VERTEX } from './shader';

/**
 * A pill of liquid glass over the slide.
 *
 * What is under it is real: the slide canvases, composed where they sit on
 * screen (`compose.ts`), refracted at the rim, dispersed, frosted and smoked
 * (`shader.ts`). It draws only while something under it moves — a page turn,
 * a resize, a page finishing its paint, the pointer over it — and is idle the
 * rest of the time.
 *
 * Without WebGL2, with reduced transparency asked for, or if the slides
 * cannot be read as pixels, it is the plain translucent pill it replaced.
 */

interface Props {
  /** The element whose `[data-pdf-page] canvas` slides lie under the glass. */
  sourceRef: RefObject<HTMLElement | null>;
  /** Anything that means the picture underneath changed (the page). */
  watch: unknown;
  className?: string;
  children: ReactNode;
}

const MARGIN = 24;
/** How long to keep drawing after a change: the page spring settles in well under this. */
const SETTLE_MS = 1100;

interface Gl {
  gl: WebGL2RenderingContext;
  uni: Record<string, WebGLUniformLocation | null>;
  tex: WebGLTexture;
}

function setup(canvas: HTMLCanvasElement): Gl | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const uni: Gl['uni'] = {};
  for (const n of ['u_bg', 'u_size', 'u_margin', 'u_dpr', 'u_light', 'u_tint', 'u_thickness', 'u_bend']) {
    uni[n] = gl.getUniformLocation(prog, n);
  }
  return { gl, uni, tex };
}

function glassSupported(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return false;
  } catch {
    /* no matchMedia: carry on */
  }
  return typeof WebGL2RenderingContext !== 'undefined';
}

export function GlassPill({ sourceRef, watch, className, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(glassSupported);
  const kick = useRef<(ms?: number) => void>(() => {});
  const light = useRef<[number, number]>([-0.6, -0.8]);

  useEffect(() => {
    if (!live) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = setup(canvas);
    if (!ctx) {
      setLive(false);
      return;
    }
    const { gl, uni, tex } = ctx;
    const back = document.createElement('canvas');
    const b2d = back.getContext('2d');
    if (!b2d) {
      setLive(false);
      return;
    }

    let until = 0;
    let frame = 0;

    const draw = () => {
      const r = host.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      /* The backdrop at 1x: it is frosted anyway, and small is fast. */
      const area = backdropRect({ left: r.left, top: r.top, width: r.width, height: r.height }, MARGIN);
      const bw = Math.ceil(area.width);
      const bh = Math.ceil(area.height);
      if (back.width !== bw || back.height !== bh) {
        back.width = bw;
        back.height = bh;
      }
      b2d.globalAlpha = 1;
      b2d.fillStyle = '#000';
      b2d.fillRect(0, 0, bw, bh);
      const slots: (Slot & { canvas: HTMLCanvasElement })[] = [];
      sourceRef.current?.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((el) => {
        const c = el.querySelector('canvas');
        if (!c || !c.width) return;
        const rect = el.getBoundingClientRect();
        slots.push({
          canvas: c,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          srcWidth: c.width,
          srcHeight: c.height,
          opacity: Number(getComputedStyle(el).opacity) || 0,
        });
      });
      const ops = backdropOps(area, slots);
      ops.forEach((op) => {
        b2d.globalAlpha = op.alpha;
        b2d.drawImage(slots[op.index].canvas, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.dw, op.dh);
      });

      try {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, back);
      } catch {
        /* A canvas we may not read (tainted): fall back for good. */
        setLive(false);
        return;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1i(uni.u_bg, 0);
      gl.uniform2f(uni.u_size, r.width, r.height);
      gl.uniform1f(uni.u_margin, MARGIN);
      gl.uniform1f(uni.u_dpr, dpr);
      gl.uniform2f(uni.u_light, light.current[0], light.current[1]);
      gl.uniform4f(uni.u_tint, 0.05, 0.05, 0.06, 0.5);
      gl.uniform1f(uni.u_thickness, Math.min(10, r.height * 0.3));
      gl.uniform1f(uni.u_bend, 5);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const loop = () => {
      frame = 0;
      draw();
      if (performance.now() < until) frame = requestAnimationFrame(loop);
    };
    kick.current = (ms = SETTLE_MS) => {
      until = Math.max(until, performance.now() + ms);
      if (!frame) frame = requestAnimationFrame(loop);
    };
    kick.current();

    const ro = new ResizeObserver(() => kick.current(200));
    ro.observe(host);
    if (sourceRef.current) ro.observe(sourceRef.current);
    /* A page canvas painting in (pdf.js swaps nodes) is a change underneath. */
    const mo = new MutationObserver(() => kick.current(500));
    if (sourceRef.current) mo.observe(sourceRef.current, { childList: true, subtree: true });
    const onLost = (e: Event) => {
      e.preventDefault();
      setLive(false);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      kick.current = () => {};
    };
  }, [live, sourceRef]);

  /* The page turned: draw through the spring. */
  useEffect(() => {
    kick.current();
  }, [watch]);

  return (
    <div
      ref={hostRef}
      data-glass={live ? 'live' : 'plain'}
      onPointerMove={(e) => {
        if (!live) return;
        /* The glare leans toward the pointer, like light caught on an edge. */
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        const len = Math.hypot(x, y) || 1;
        light.current = [x / len, y / len];
        kick.current(120);
      }}
      onPointerLeave={() => {
        light.current = [-0.6, -0.8];
        kick.current(120);
      }}
      className={cn(
        'relative rounded-full',
        live ? 'shadow-[0_8px_24px_-12px_rgba(0,0,0,0.45)]' : 'bg-white/[0.07]',
        className,
      )}
    >
      {live && <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full rounded-full" />}
      <div className="relative flex items-center gap-1 p-1">{children}</div>
    </div>
  );
}
