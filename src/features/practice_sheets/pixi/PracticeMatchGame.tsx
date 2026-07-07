/**
 * PracticeMatchGame — drag-to-match mini-game over a practice sheet's questions.
 *
 * Builds match pairs from any questions that have a usable correct_answer, then
 * renders the Pixi scene with a small React score HUD on top.
 */
import { useMemo, useRef, useState } from 'react';
import { PixiStage, type PixiStageHandle } from '@/lib/pixi';
import type { PracticeSheetQuestion } from '@/services/practiceSheetsService';
import { MatchGameScene, type MatchPair } from './matchGameScene';

interface Props {
  questions: PracticeSheetQuestion[];
  /** Cap the board so it stays playable; defaults to 6 pairs. */
  max?: number;
  className?: string;
}

export function PracticeMatchGame({ questions, max = 6, className }: Props) {
  const sceneRef = useRef<MatchGameScene | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const pairs = useMemo<MatchPair[]>(
    () =>
      questions
        .filter((q) => (q.correct_answer ?? '').trim().length > 0)
        .slice(0, max)
        .map((q) => ({ id: q.id, prompt: q.prompt, answer: q.correct_answer!.trim() })),
    [questions, max],
  );

  if (pairs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No answerable questions to play with yet.
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`} style={{ width: '100%', height: '100%' }}>
      <div className="absolute right-3 top-3 z-10 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow">
        {score.correct} / {score.total} matched
      </div>
      <PixiStage
        deps={[pairs]}
        onReady={({ app }: PixiStageHandle) => {
          const scene = new MatchGameScene(app, {
            onScore: (correct, total) => setScore({ correct, total }),
          });
          sceneRef.current = scene;
          scene.setData(pairs);
          return () => {
            scene.destroy();
            sceneRef.current = null;
          };
        }}
      />
    </div>
  );
}
