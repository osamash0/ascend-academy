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
  
  let hasPanned = false;

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
    nodeContainer.on('pointertap', () => {
      if (!hasPanned) {
        opts.onNodeSelect?.(node);
      }
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
  let activePointerId: number | null = null;
  let dragStart = { x: 0, y: 0 };
  let containerStart = { x: 0, y: 0 };

  root.eventMode = 'static';
  root.hitArea = new Rectangle(-10000000, -10000000, 20000000, 20000000);
  
  root.on('pointerdown', (e) => {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    dragStart = { x: e.global.x, y: e.global.y };
    containerStart = { x: root.x, y: root.y };
    hasPanned = false;
  });

  const onDragEnd = (e: any) => { 
    if (e.pointerId === activePointerId) {
      activePointerId = null; 
    }
  };
  root.on('pointerup', onDragEnd);
  root.on('pointerupoutside', onDragEnd);
  root.on('pointercancel', onDragEnd);

  root.on('globalpointermove', (e) => {
    if (activePointerId === e.pointerId) {
      const dx = e.global.x - dragStart.x;
      const dy = e.global.y - dragStart.y;
      
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasPanned = true;
      }

      root.x = containerStart.x + dx;
      root.y = containerStart.y + dy;

      const maxX = 100;
      const maxY = 50;
      const minX = -100;
      const minY = -Math.max(0, (opts.nodes.length * spacingY) - app.screen.height + 500);

      root.x = Math.max(minX, Math.min(maxX, root.x));
      root.y = Math.max(minY, Math.min(maxY, root.y));
    }
  });

  app.stage.addChild(root);
  return { root, stops, update: () => {} };
}
