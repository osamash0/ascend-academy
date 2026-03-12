import { useState, useEffect } from 'react';

export type AiModelChoice = 'llama3' | 'gemini-2.5-flash';

const STORAGE_KEY = 'ascend-academy-ai-model';

export function useAiModel() {
  const [aiModel, setAiModelState] = useState<AiModelChoice>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'llama3' || stored === 'gemini-2.5-flash') {
        return stored;
      }
    }
    return 'llama3'; // Default to Llama 3
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, aiModel);
  }, [aiModel]);

  const setAiModel = (model: AiModelChoice) => {
    setAiModelState(model);
  };

  return { aiModel, setAiModel };
}
