import { useEffect } from 'react';
import { captureLandingAttribution } from '@/services/onboardingAttribution';
import { Hero } from '@/features/landing/story';
import { Close, LandingFooter, LandingNav, Lights } from '@/features/landing/sections';

/**
 * The page before you sign in.
 *
 * Rebuilt 2026-10-10: the first screen is the product. A one-line headline,
 * then a live page that changes in place (Original · Explore · Learn ·
 * Practise) and plays itself until the visitor takes over. Few words on
 * purpose — people scan; they try before they read (see features/landing).
 * Same ground as the signed-in stage: pure black, monochrome brand, and the
 * only colour is the deck's own light. The previous template (stat dashboard,
 * six feature tiles, four steps) is in git history.
 */
export default function Landing() {
  useEffect(() => {
    captureLandingAttribution();
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-black text-white antialiased">
      <LandingNav />
      <main>
        <Hero />
        <Lights />
        <Close />
      </main>
      <LandingFooter />
    </div>
  );
}
