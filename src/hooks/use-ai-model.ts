import { useState, useEffect } from 'react';

export type AiModelChoice =
  | 'groq'
  | 'llama3'
  | 'groq_fast'
  | 'gemini-2.0-flash';

const STORAGE_KEY = 'ascend-academy-ai-model';

const VALID_MODELS: ReadonlyArray<AiModelChoice> = [
  'groq',
  'gemini-2.0-flash',
];

function isValidModel(value: string | null): value is AiModelChoice {
  return value !== null && (VALID_MODELS as ReadonlyArray<string>).includes(value);
}

export function useAiModel() {
  const [aiModel, setAiModelState] = useState<AiModelChoice>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isValidModel(stored)) {
        return stored;
      }
    }
    return 'groq';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, aiModel);
  }, [aiModel]);

  const setAiModel = (model: AiModelChoice) => {
    setAiModelState(model);
  };

  return { aiModel, setAiModel };
}
