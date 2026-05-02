import { useState, useEffect } from 'react';

export type AiModelChoice =
  | 'cerebras'
  | 'groq'
  | 'openrouter'
  | 'cloudflare'
  | 'gemini-2.5-flash'
  | 'llama3';

const STORAGE_KEY = 'ascend-academy-ai-model';

const VALID_MODELS: ReadonlyArray<AiModelChoice> = [
  'cerebras',
  'groq',
  'openrouter',
  'cloudflare',
  'gemini-2.5-flash',
  'llama3',
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
    return 'cerebras';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, aiModel);
  }, [aiModel]);

  const setAiModel = (model: AiModelChoice) => {
    setAiModelState(model);
  };

  return { aiModel, setAiModel };
}
