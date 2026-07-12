// src/__tests__/pixi/fullJourneyScene.test.ts
import { Application } from 'pixi.js';
import { createFullJourneyScene } from '@/features/student/pixi/fullJourneyScene';

describe('FullJourneyScene', () => {
  it('initializes with the correct number of nodes', async () => {
    const app = new Application();
    await app.init({ width: 800, height: 600 });
    const scene = createFullJourneyScene(app, {
      nodes: [
        { id: '1', label: 'Intro', status: 'completed' },
        { id: '2', label: 'Basics', status: 'active' },
        { id: '3', label: 'Advanced', status: 'locked' }
      ]
    });
    
    expect(scene.stops.length).toBe(3);
    app.destroy();
  });
});
