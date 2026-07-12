// src/__tests__/pixi/fullJourneyScene.test.ts
import { Application, Graphics } from 'pixi.js';
import { createFullJourneyScene } from '@/features/student/pixi/fullJourneyScene';

describe('FullJourneyScene', () => {
  it('initializes with the correct number of nodes and renders them', async () => {
    const app = new Application();
    await app.init({ width: 800, height: 600 });
    
    let clickedNodeId: string | null = null;

    const scene = createFullJourneyScene(app, {
      nodes: [
        { id: '1', label: 'Intro', status: 'completed' },
        { id: '2', label: 'Basics', status: 'active' },
        { id: '3', label: 'Advanced', status: 'locked' }
      ],
      theme: {
        primary: 0x00ff00,
        secondary: 0x0000ff,
        background: 0xffffff,
        text: 0x000000,
        locked: 0xcccccc
      },
      onNodeSelect: (node) => {
        clickedNodeId = node.id;
      }
    });
    
    expect(scene.stops.length).toBe(3);
    
    // Check if nodes are drawn (should be 3 node containers, each containing a Graphics and Text)
    const nodeContainers = scene.root.children;
    expect(nodeContainers.length).toBe(3);
    
    // Test interactivity
    const firstNode = nodeContainers[0];
    expect(firstNode.eventMode).toBe('static');
    
    // Simulate pointerdown
    firstNode.emit('pointerdown', { stopPropagation: () => {} });
    expect(clickedNodeId).toBe('1');

    // Test panning setup and math
    expect(scene.root.eventMode).toBe('static');
    
    // Simulate panning drag
    scene.root.emit('pointerdown', { global: { x: 100, y: 100 } });
    scene.root.emit('globalpointermove', { global: { x: 150, y: 120 } });
    
    expect(scene.root.x).toBe(50);
    expect(scene.root.y).toBe(20);
    
    scene.root.emit('pointerup');
    
    // Simulate globalpointermove after pointerup (should not pan)
    scene.root.emit('globalpointermove', { global: { x: 200, y: 200 } });
    expect(scene.root.x).toBe(50);
    expect(scene.root.y).toBe(20);

    app.destroy();
  });
});
