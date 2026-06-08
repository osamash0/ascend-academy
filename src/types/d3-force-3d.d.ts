/**
 * Minimal ambient types for `d3-force-3d` (the package ships no .d.ts).
 *
 * Mirrors the subset of the d3-force API we use, extended into 3D: nodes and
 * forces carry a `z` axis alongside `x`/`y`. Only the methods the mind-map
 * layout touches are typed; everything returns `any` where we don't care.
 */
declare module 'd3-force-3d' {
  export interface SimulationNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLink<N> {
    source: N | string | number;
    target: N | string | number;
  }

  export interface Simulation<N extends SimulationNode> {
    nodes(): N[];
    nodes(nodes: N[]): this;
    force(name: string): unknown;
    force(name: string, force: unknown | null): this;
    alpha(alpha: number): this;
    alphaDecay(decay: number): this;
    alphaMin(min: number): this;
    tick(iterations?: number): this;
    stop(): this;
    restart(): this;
    on(typenames: string, listener: (() => void) | null): this;
  }

  export function forceSimulation<N extends SimulationNode>(
    nodes?: N[],
    numDimensions?: number,
  ): Simulation<N>;

  export interface LinkForce<N> {
    id(accessor: (node: N) => string | number): this;
    distance(distance: number | ((link: SimulationLink<N>) => number)): this;
    strength(strength: number | ((link: SimulationLink<N>) => number)): this;
    links(links: SimulationLink<N>[]): this;
  }
  export function forceLink<N>(links?: SimulationLink<N>[]): LinkForce<N>;

  export interface ManyBodyForce {
    strength(strength: number | (() => number)): this;
    distanceMax(max: number): this;
    theta(theta: number): this;
  }
  export function forceManyBody(): ManyBodyForce;

  export interface CenterForce {
    x(x: number): this;
    y(y: number): this;
    z(z: number): this;
    strength(strength: number): this;
  }
  export function forceCenter(x?: number, y?: number, z?: number): CenterForce;

  export interface RadialForce {
    radius(radius: number | ((node: unknown) => number)): this;
    strength(strength: number | ((node: unknown) => number)): this;
  }
  export function forceRadial(
    radius: number | ((node: unknown) => number),
    x?: number,
    y?: number,
    z?: number,
  ): RadialForce;

  export interface CollideForce {
    radius(radius: number | ((node: unknown) => number)): this;
    strength(strength: number): this;
  }
  export function forceCollide(radius?: number): CollideForce;

  export function forceX(x?: number): unknown;
  export function forceY(y?: number): unknown;
  export function forceZ(z?: number): unknown;
}
