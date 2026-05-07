import { useState, useEffect } from 'react';

type PipelineMode = 'lazy' | 'eager';

/**
 * Runtime toggle for PDF import pipeline mode.
 * Stored in localStorage so preference persists across page reloads.
 * Default: 'lazy' if VITE_LAZY_PDF_IMPORT=true, else 'eager'.
 */
export function usePDFPipelineMode() {
  const [mode, setMode] = useState<PipelineMode>(() => {
    // Check localStorage first
    const stored = localStorage.getItem('pdf_pipeline_mode');
    if (stored === 'lazy' || stored === 'eager') {
      return stored;
    }
    // Fall back to env var
    const envDefault = import.meta.env.VITE_LAZY_PDF_IMPORT === 'true' ? 'lazy' : 'eager';
    return envDefault;
  });

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
