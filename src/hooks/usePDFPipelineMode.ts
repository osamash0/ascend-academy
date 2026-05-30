import { useState, useEffect } from 'react';

type PipelineMode = 'lazy' | 'eager';

/**
 * Runtime toggle for PDF import pipeline mode.
 * Stored in localStorage so preference persists across page reloads.
 * Default: 'lazy' if VITE_LAZY_PDF_IMPORT=true, else 'eager'.
 */
export function usePDFPipelineMode() {
  const [mode, setMode] = useState<PipelineMode>('eager'); // Force eager mode so v4 parser is used

  // Persist changes to localStorage
  useEffect(() => {
    localStorage.setItem('pdf_pipeline_mode', mode);
  }, [mode]);

  const toggle = () => setMode(m => m === 'lazy' ? 'eager' : 'lazy');

  return {
    mode,
    setMode,
    toggle,
    isLazy: mode === 'lazy',
  };
}
