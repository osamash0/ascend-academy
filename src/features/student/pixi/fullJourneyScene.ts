// src/features/student/pixi/fullJourneyScene.ts
import { Application, Container, Graphics, Text } from 'pixi.js';

export interface JourneyNode {
  id: string;
  label: string;
  status: 'locked' | 'active' | 'completed';
}

export interface FullJourneySceneOpts {
  nodes: JourneyNode[];
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
    currentY += spacingY;
  });

  app.stage.addChild(root);

  return { root, stops, update: () => {} };
}
