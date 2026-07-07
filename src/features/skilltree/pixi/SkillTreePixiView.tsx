/**
 * SkillTreePixiView — React wrapper that mounts the Pixi tech-tree and feeds it
 * the live SkillNode tree. The Pixi app lifecycle is owned by PixiStage; data
 * updates are pushed into the scene through a ref so the app isn't rebuilt.
 */
import { useEffect, useRef } from 'react';
import { PixiStage, type PixiStageHandle } from '@/lib/pixi';
import type { SkillNode } from '../skillTree';
import { SkillTreeScene } from './skillTreeScene';

interface Props {
  tree: SkillNode | null;
  onOpenLecture?: (lectureId: string) => void;
  className?: string;
}

export function SkillTreePixiView({ tree, onOpenLecture, className }: Props) {
  const sceneRef = useRef<SkillTreeScene | null>(null);
  const onOpenRef = useRef(onOpenLecture);
  onOpenRef.current = onOpenLecture;

  // Push data into the scene whenever the tree changes.
  useEffect(() => {
    if (sceneRef.current && tree) sceneRef.current.setData(tree);
  }, [tree]);

  return (
    <PixiStage
      className={className}
      onReady={({ app }: PixiStageHandle) => {
        const scene = new SkillTreeScene(app, {
          onOpenLecture: (id) => onOpenRef.current?.(id),
        });
        sceneRef.current = scene;
        if (tree) scene.setData(tree);
        return () => {
          scene.destroy();
          sceneRef.current = null;
        };
      }}
    />
  );
}
