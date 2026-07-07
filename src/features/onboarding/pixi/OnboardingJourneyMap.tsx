/**
 * OnboardingJourneyMap — drop-in animated progress map for the onboarding flow.
 *
 * Wire it to Onboarding's `step` state: <OnboardingJourneyMap current={step}
 * total={TOTAL_STEPS} labels={[...]} />. The traveller eases to the active step
 * and completed stops light up — a gamified replacement for the plain dots.
 */
import { useEffect, useRef } from 'react';
import { PixiStage, type PixiStageHandle } from '@/lib/pixi';
import { JourneyMapScene } from './journeyMapScene';

interface Props {
  current: number;
  total: number;
  labels?: string[];
  className?: string;
  height?: number;
  /** Collapse the traveller's idle pulse + eased travel to static (prefers-reduced-motion). */
  reduceMotion?: boolean;
}

export function OnboardingJourneyMap({ current, total, labels, className, height = 140, reduceMotion = false }: Props) {
  const sceneRef = useRef<JourneyMapScene | null>(null);

  useEffect(() => {
    sceneRef.current?.setProgress(current, total);
  }, [current, total]);

  return (
    <div className={className} style={{ width: '100%', height }}>
      <PixiStage
        deps={[reduceMotion]}
        onReady={({ app }: PixiStageHandle) => {
          const scene = new JourneyMapScene(app, { labels, reduceMotion });
          sceneRef.current = scene;
          scene.setProgress(current, total);
          return () => {
            scene.destroy();
            sceneRef.current = null;
          };
        }}
      />
    </div>
  );
}
