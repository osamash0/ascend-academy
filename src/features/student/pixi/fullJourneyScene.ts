// src/features/student/pixi/fullJourneyScene.ts
import { Application, Container, Graphics, Text, Rectangle } from 'pixi.js';

export interface JourneyNode {
  id: string;
  label: string;
  status: 'locked' | 'active' | 'completed';
}

export interface ThemePalette {
  primary: number;
  secondary: number;
  background: number;
  text: number;
  locked: number;
}

export interface FullJourneySceneOpts {
  nodes: JourneyNode[];
  theme: ThemePalette;
  onNodeSelect?: (node: JourneyNode) => void;
  reduceMotion?: boolean;
}

export function createFullJourneyScene(app: Application, opts: FullJourneySceneOpts) {
  const root = new Container();
  const stops: { x: number; y: number; data: JourneyNode }[] = [];
  
  // Basic winding path logic (scaled up version of onboarding)
  const spacingY = 150;
  let currentY = 50;
  
  opts.nodes.forEach((node, i) => {
    const x = app.screen.width / 2 + Math.sin(i) * 100;
    stops.push({ x, y: currentY, data: node });
    
    const nodeContainer = new Container();
    nodeContainer.x = x;
    nodeContainer.y = currentY;

    const nodeGfx = new Graphics();
    const color = node.status === 'completed' ? opts.theme.primary : 
                  node.status === 'active' ? opts.theme.secondary : 
                  opts.theme.locked;
    
    nodeGfx.circle(0, 0, 30);
    nodeGfx.fill(color);
    
    // Interactivity
    nodeContainer.eventMode = 'static';
    nodeContainer.cursor = 'pointer';
    nodeContainer.on('pointerdown', (e) => {
      e.stopPropagation(); // prevent panning when clicking node
      opts.onNodeSelect?.(node);
    });

    const label = new Text({ text: node.label, style: { fill: opts.theme.text, fontSize: 14 } });
    label.anchor.set(0.5, 0); // Anchor top center
    label.position.set(0, 40); // Below the circle

    nodeContainer.addChild(nodeGfx);
    nodeContainer.addChild(label);
    root.addChild(nodeContainer);

    currentY += spacingY;
  });

  // Panning logic
  let dragging = false;
  let dragStart = { x: 0, y: 0 };
  let containerStart = { x: 0, y: 0 };

  root.eventMode = 'static';
  root.hitArea = new Rectangle(-10000, -10000, 20000, 20000);
  root.on('pointerdown', (e) => {
    dragging = true;
    dragStart = { x: e.global.x, y: e.global.y };
    containerStart = { x: root.x, y: root.y };
  });

  const onDragEnd = () => { dragging = false; };
  root.on('pointerup', onDragEnd);
  root.on('pointerupoutside', onDragEnd);

  root.on('globalpointermove', (e) => {
    if (dragging) {
      const dx = e.global.x - dragStart.x;
      const dy = e.global.y - dragStart.y;
      root.x = containerStart.x + dx;
      root.y = containerStart.y + dy;
    }
  });

  return { root, stops, update: () => {} };
}
