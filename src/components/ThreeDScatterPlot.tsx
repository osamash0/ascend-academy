import { useState, useEffect, useRef, useCallback, memo, Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle } from 'lucide-react';

// Lazy load Three.js components to reduce initial bundle size
const ThreeCanvas = lazy(() => import('./ThreeCanvas'));

interface DataPoint {
  x: number;
  y: number;
  z: number;
  label: string;
  color?: string;
}

interface ThreeDScatterPlotProps {
  data: DataPoint[];
  title?: string;
  height?: number;
}

// Fallback 2D scatter plot for SSR or WebGL failure
function FallbackScatterPlot({ data, title, height = 400 }: ThreeDScatterPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isInView = useRef(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isInView.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.offsetWidth;
    const h = height;

    canvas.width = width * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Normalize data
    const xVals = data.map(d => d.x);
    const yVals = data.map(d => d.y);
    const zVals = data.map(d => d.z);

    const xMin = Math.min(...xVals);
    const xMax = Math.max(...xVals);
    const yMin = Math.min(...yVals);
    const yMax = Math.max(...yVals);
    const zMin = Math.min(...zVals);
    const zMax = Math.max(...zVals);

    const padding = 40;
    const plotW = width - padding * 2;
    const plotH = h - padding * 2;

    const scaleX = (v: number) => padding + ((v - xMin) / (xMax - xMin || 1)) * plotW;
    const scaleY = (v: number) => padding + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
    const scaleZ = (v: number) => ((v - zMin) / (zMax - zMin || 1)) * 8 + 2;

    let frame = 0;

    const animate = () => {
      ctx.clearRect(0, 0, width, h);

      // Draw grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 5; i++) {
        const x = padding + (plotW / 5) * i;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, padding + plotH);
        ctx.stroke();

        const y = padding + (plotH / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(padding + plotW, y);
        ctx.stroke();
      }

      // Draw points with subtle animation
      data.forEach((point, i) => {
        const x = scaleX(point.x);
        const y = scaleY(point.y);
        const r = scaleZ(point.z);

        const pulse = Math.sin(frame * 0.02 + i * 0.5) * 0.3 + 1;

        // Glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 3 * pulse);
        gradient.addColorStop(0, `${point.color || 'hsl(234, 89%, 54%)'}40`);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r * 3 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = point.color || 'hsl(234, 89%, 54%)';
        ctx.beginPath();
        ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
        ctx.fill();
      });

      frame++;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafRef.current);
  }, [data, height]);

  return (
    <div className="relative" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ borderRadius: '24px' }}
      />
      {title && (
        <div className="absolute top-4 left-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
          <p className="text-xs text-muted-foreground/50 mt-1">2D Fallback Mode</p>
        </div>
      )}
    </div>
  );
}

// Loading skeleton
function ScatterSkeleton({ height = 400 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-xs text-muted-foreground">Loading 3D visualization...</p>
      </div>
    </div>
  );
}

export const ThreeDScatterPlot = memo(function ThreeDScatterPlot({ 
  data, 
  title, 
  height = 400 
}: ThreeDScatterPlotProps) {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check WebGL support
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      setWebglSupported(!!gl);
    } catch {
      setWebglSupported(false);
    }
  }, []);

  // Intersection observer for lazy loading
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          container.dataset.inView = 'true';
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (webglSupported === null) {
    return <ScatterSkeleton height={height} />;
  }

  if (!webglSupported) {
    return <FallbackScatterPlot data={data} title={title} height={height} />;
  }

  return (
    <div ref={containerRef} className="relative" style={{ height }}>
      {containerRef.current?.dataset.inView === 'true' ? (
        <Suspense fallback={<ScatterSkeleton height={height} />}>
          <ThreeCanvas data={data} title={title} height={height} />
        </Suspense>
      ) : (
        <ScatterSkeleton height={height} />
      )}
    </div>
  );
});
