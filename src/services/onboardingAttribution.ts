const STORAGE_KEY = 'ascend:onboarding-attribution:v1';

export interface OnboardingAttribution {
  version: 1;
  source: string;
  campaign: string | null;
  medium: string | null;
  landingPath: string;
  capturedAt: string;
}

function readStored(): OnboardingAttribution | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingAttribution>;
    return parsed.version === 1 && typeof parsed.source === 'string' && typeof parsed.landingPath === 'string'
      ? parsed as OnboardingAttribution
      : null;
  } catch {
    return null;
  }
}

/** Capture attribution once per browser session, before authentication. */
export function captureLandingAttribution(): OnboardingAttribution | null {
  if (typeof window === 'undefined') return null;
  const stored = readStored();
  if (stored) return stored;
  const params = new URLSearchParams(window.location.search);
  const source = params.get('utm_source') || document.referrer || 'direct';
  const attribution: OnboardingAttribution = {
    version: 1,
    source: source.slice(0, 500),
    campaign: params.get('utm_campaign'),
    medium: params.get('utm_medium'),
    landingPath: `${window.location.pathname}${window.location.search}`,
    capturedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Attribution is useful, never essential to starting a learning session.
  }
  return attribution;
}

export function getLandingAttribution(): OnboardingAttribution | null {
  if (typeof window === 'undefined') return null;
  return readStored();
}
