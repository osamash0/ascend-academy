import { createContext } from 'react';
import type { TermState } from './recall';

/**
 * Every term's state on the canvas, read by the terms themselves. The canvas
 * provides it, so a mark re-renders the terms and nothing else: paragraphs
 * keep their (stable) recall props and stay memoized. Without it, a term
 * reads its paragraph's `recall.get`.
 */
export const TermStateContext = createContext<((key: string) => TermState) | null>(null);
