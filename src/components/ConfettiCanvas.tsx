import { useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';

export function ConfettiCanvas() {
  const fireConfetti = useCallback(() => {
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  useEffect(() => {
    const handleFire = () => fireConfetti();
    window.addEventListener('fire-confetti', handleFire);
    return () => window.removeEventListener('fire-confetti', handleFire);
  }, [fireConfetti]);

  // It renders nothing visually, just hooks into events
  return null;
}
