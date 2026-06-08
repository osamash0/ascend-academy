/**
 * Spatial (3D) mind map — the WebGL scene.
 *
 * Default-exported so the wrapper (`MindMapGraph3D`) can `lazy()`-load it and
 * keep three.js out of the initial bundle, mirroring `ThreeDScatterPlot`.
 *
 * Nodes are spheres seated on depth shells by the force layout; edges are line
 * segments (faint for tree edges, accented for recurring-concept cross-links).
 * "Glow" is faked with additive radial-gradient sprites rather than a
 * postprocessing bloom pass — cheaper and free of the three/fiber version
 * matrix. Hovering a node lifts it and its neighbours and dims the rest;
 * clicking a slide node flies the camera to it and fires `onSlideClick`.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Html, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  computeGraphLayout,
  buildAdjacency,
  NODE_RADIUS,
  type GraphData,
  type GraphNode,
  type NodeType,
  type PositionMap,
} from '@/features/mindmap/graph3d';

interface Props {
  data: GraphData;
  currentSlideId?: string;
  onSlideClick?: (slideId: string) => void;
  height: number | string;
  prefersReducedMotion: boolean;
  /** Clear the canvas to transparent (lets a page background show through). */
  transparent?: boolean;
  /** Hide the built-in "drag to orbit" hint (immersive views supply their own). */
  hideHint?: boolean;
}

// ─── Palette ─────────────────────────────────────────────────────────────────
// Read the app's themed HSL tokens once so the scene matches light/dark theme,
// falling back to the brand colours used by the celebration modals.

interface Palette {
  root: THREE.Color;
  cluster: THREE.Color;
  slide: THREE.Color;
  concept: THREE.Color;
  edge: THREE.Color;
  cross: THREE.Color;
  background: THREE.Color;
}

const FALLBACK = {
  root: '#3b5bf6',
  cluster: '#a855f7',
  slide: '#cbd5e1',
  concept: '#f0b429',
  edge: '#3a3a4a',
  cross: '#a855f7',
  background: '#0a0a12',
};

function readVar(name: string, fallback: string): THREE.Color {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (raw) {
      // shadcn tokens are stored as "H S% L%" triples.
      const c = new THREE.Color();
      c.setStyle(/%/.test(raw) ? `hsl(${raw.replace(/\s+/g, ', ')})` : raw);
      return c;
    }
  } catch {
    /* SSR / parse failure → fallback */
  }
  return new THREE.Color(fallback);
}

function readPalette(): Palette {
  return {
    root: readVar('--primary', FALLBACK.root),
    cluster: readVar('--secondary', FALLBACK.cluster),
    slide: readVar('--foreground', FALLBACK.slide),
    concept: readVar('--xp', FALLBACK.concept),
    edge: readVar('--border', FALLBACK.edge),
    cross: readVar('--secondary', FALLBACK.cross),
    background: readVar('--background', FALLBACK.background),
  };
}

function colorFor(type: NodeType, p: Palette): THREE.Color {
  return p[type];
}

// ─── Glow sprite texture (built once) ─────────────────────────────────────────

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ─── Edges ─────────────────────────────────────────────────────────────────

function Edges({
  links,
  positions,
  kind,
  color,
  opacity,
}: {
  links: GraphData['links'];
  positions: PositionMap;
  kind: 'tree' | 'cross';
  color: THREE.Color;
  opacity: number;
}) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    for (const l of links) {
      if (l.kind !== kind) continue;
      const a = positions.get(l.source);
      const b = positions.get(l.target);
      if (!a || !b) continue;
      pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, [links, positions, kind]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      {/* fog={false}: thin lines otherwise get swallowed by the scene fog */}
      <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} fog={false} />
    </lineSegments>
  );
}

// ─── A single node (sphere + glow + optional label) ───────────────────────────

function Node({
  node,
  position,
  color,
  glow,
  dimmed,
  highlighted,
  showLabel,
  clickable,
  active,
  onHover,
  onClick,
}: {
  node: GraphNode;
  position: [number, number, number];
  color: THREE.Color;
  glow: THREE.Texture;
  dimmed: boolean;
  highlighted: boolean;
  showLabel: boolean;
  clickable: boolean;
  active: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const radius = NODE_RADIUS[node.type] * (1 + Math.min(node.degree, 6) * 0.04);
  const scale = highlighted || active ? 1.35 : 1;
  const emissive = highlighted || active ? 2.4 : 1.2;
  const opacity = dimmed ? 0.18 : 1;

  // Gentle scale easing toward the target on hover/active.
  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    m.scale.x += (scale - m.scale.x) * 0.18;
    m.scale.y = m.scale.z = m.scale.x;
  });

  return (
    <group position={position}>
      {/* additive glow halo */}
      <sprite scale={radius * (highlighted ? 7 : 5)}>
        <spriteMaterial
          map={glow}
          color={color}
          transparent
          opacity={dimmed ? 0.06 : 0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(node.id);
          if (clickable) document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <sphereGeometry args={[radius, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissive}
          transparent
          opacity={opacity}
          toneMapped={false}
          roughness={0.35}
          metalness={0.1}
        />
      </mesh>

      {showLabel && (
        <Billboard position={[0, radius + 0.7, 0]}>
          <Text
            fontSize={node.type === 'root' ? 1.1 : node.type === 'cluster' ? 0.8 : 0.6}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.04}
            outlineColor="#000000"
            maxWidth={14}
            fillOpacity={dimmed ? 0.25 : 1}
          >
            {node.label}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

// ─── Tooltip for the hovered node (DOM overlay, only one at a time) ────────────

function HoverCard({
  node,
  position,
}: {
  node: GraphNode;
  position: [number, number, number];
}) {
  if (!node.summary) return null;
  return (
    <Html position={position} center distanceFactor={26} style={{ pointerEvents: 'none' }}>
      <div className="px-3 py-2 rounded-xl bg-background/90 border border-white/10 backdrop-blur-md shadow-xl max-w-[220px]">
        <p className="text-[11px] font-bold text-foreground leading-tight">{node.label}</p>
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug line-clamp-3">
          {node.summary}
        </p>
      </div>
    </Html>
  );
}

// ─── Camera rig: idle auto-orbit + fly-to focused slide ────────────────────────

function CameraRig({
  focusPos,
  extent,
  controlsRef,
}: {
  focusPos: [number, number, number] | null;
  extent: number;
  controlsRef: React.MutableRefObject<any>;
}) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    if (focusPos) target.current.set(focusPos[0], focusPos[1], focusPos[2]);
    else target.current.set(0, 0, 0);
  }, [focusPos]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    // Ease the orbit target toward the focused node (or origin).
    controls.target.lerp(target.current, 0.06);
    // When focusing a node, pull the camera to a comfortable standoff.
    if (focusPos) {
      const desired = target.current
        .clone()
        .add(new THREE.Vector3(0, extent * 0.18, extent * 0.55));
      camera.position.lerp(desired, 0.04);
    }
    controls.update();
  });

  return null;
}

// ─── Scene ─────────────────────────────────────────────────────────────────

function Scene({
  layout,
  currentSlideId,
  onSlideClick,
  reducedMotion,
  transparent,
}: {
  layout: ReturnType<typeof computeGraphLayout>;
  currentSlideId?: string;
  onSlideClick?: (slideId: string) => void;
  reducedMotion: boolean;
  transparent?: boolean;
}) {
  const palette = useMemo(readPalette, []);
  const glow = useMemo(makeGlowTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);

  const adjacency = useMemo(() => buildAdjacency(layout.links), [layout.links]);
  const [hovered, setHovered] = useState<string | null>(null);
  const controlsRef = useRef<any>(null);

  const { nodes, links, positions, extent } = layout;

  const neighbours = hovered ? adjacency.get(hovered) ?? new Set<string>() : null;
  const hoveredNode = hovered ? nodes.find((n) => n.id === hovered) ?? null : null;

  const focusPos = useMemo<[number, number, number] | null>(() => {
    if (!currentSlideId) return null;
    return positions.get(currentSlideId) ?? null;
  }, [currentSlideId, positions]);

  const camDist = extent * 2.1 + 8;

  // Tree edges use the (dark) border token — brighten it toward white so the
  // connections read against the dark canvas; cross-links keep the accent hue.
  const treeEdgeColor = useMemo(
    () => palette.edge.clone().lerp(new THREE.Color('#ffffff'), 0.55),
    [palette],
  );

  return (
    <>
      <PerspectiveCamera makeDefault position={[camDist * 0.6, camDist * 0.4, camDist]} fov={45} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        autoRotate={!reducedMotion && !hovered}
        autoRotateSpeed={0.35}
        minDistance={6}
        maxDistance={camDist * 2.5}
      />
      <CameraRig focusPos={focusPos} extent={extent} controlsRef={controlsRef} />

      {/* Skip the opaque clear colour when transparent so a page background
          (e.g. the anime.js ambient layer) shows through the canvas. */}
      {!transparent && <color attach="background" args={[palette.background.getStyle()]} />}
      <fog attach="fog" args={[palette.background.getStyle(), camDist * 1.4, camDist * 3.5]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[20, 20, 20]} intensity={1.2} />
      <pointLight position={[-20, -10, -20]} intensity={0.5} color={palette.cluster} />

      <Edges links={links} positions={positions} kind="tree" color={treeEdgeColor} opacity={hovered ? 0.18 : 0.5} />
      <Edges links={links} positions={positions} kind="cross" color={palette.cross} opacity={hovered ? 0.25 : 0.6} />

      {nodes.map((node) => {
        const pos = positions.get(node.id) ?? [0, 0, 0];
        const isHi = hovered === node.id || (!!neighbours && neighbours.has(node.id));
        const dimmed = !!hovered && !isHi;
        const clickable = node.type === 'slide' && !!onSlideClick;
        const active = !!currentSlideId && node.id === currentSlideId;
        const showLabel =
          node.type === 'root' ||
          node.type === 'cluster' ||
          hovered === node.id ||
          active;
        return (
          <Node
            key={node.id}
            node={node}
            position={pos}
            color={colorFor(node.type, palette)}
            glow={glow}
            dimmed={dimmed}
            highlighted={isHi}
            showLabel={showLabel}
            clickable={clickable}
            active={active}
            onHover={setHovered}
            onClick={() => {
              if (clickable) onSlideClick?.(node.id);
            }}
          />
        );
      })}

      {hoveredNode && hoveredNode.summary && (
        <HoverCard node={hoveredNode} position={positions.get(hoveredNode.id) ?? [0, 0, 0]} />
      )}
    </>
  );
}

export default function MindMapGraph3DCanvas({
  data,
  currentSlideId,
  onSlideClick,
  height,
  prefersReducedMotion,
  transparent,
  hideHint,
}: Props) {
  const layout = useMemo(() => computeGraphLayout(data), [data]);

  // r3f measures its container with a ResizeObserver; when the canvas mounts
  // during a Suspense reveal the container can briefly report 0×0, leaving the
  // GL buffer stuck at the 300×150 default. Nudge a resize on the next frames
  // so r3f re-measures the (now laid-out) container.
  useEffect(() => {
    const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);

  return (
    <div style={{ height, width: '100%', position: 'relative' }} data-testid="mindmap-3d-canvas">
      <Canvas
        gl={{ antialias: true, alpha: !!transparent }}
        dpr={[1, 2]}
        resize={{ scroll: false }}
      >
        <Scene
          layout={layout}
          currentSlideId={currentSlideId}
          onSlideClick={onSlideClick}
          reducedMotion={prefersReducedMotion}
          transparent={transparent}
        />
      </Canvas>
      {!hideHint && (
        <p className="absolute bottom-2 left-3 z-10 text-[9px] text-muted-foreground/50 uppercase tracking-widest pointer-events-none">
          Drag to orbit · Scroll to zoom · Hover a node · Click a slide to open it
        </p>
      )}
    </div>
  );
}
