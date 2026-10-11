import { createContext, useContext } from 'react';

/**
 * The ground a screen stands on — set by `Scene`, read by the chrome that has
 * to match it (the top bar, the phone tab bar). Its own module so the chrome
 * can read it without importing `Scene`, which imports the chrome.
 */
export type Surface = 'browse' | 'focus' | 'stage';

export const GroundContext = createContext<Surface>('browse');
export const useGround = () => useContext(GroundContext);
