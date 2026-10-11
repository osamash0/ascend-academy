import { useEffect, useState } from 'react';

/**
 * Is this media query true right now?
 *
 * Answered in JS only where what it decides is an attribute or a component,
 * which no stylesheet can write — an `inert` on a covered page, a card that
 * is beside the text at one width and under it at another. Everything that
 * *can* be a class stays a class.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const read = () => setMatches(mql.matches);
    read();
    mql.addEventListener('change', read);
    return () => mql.removeEventListener('change', read);
  }, [query]);
  return matches;
}
