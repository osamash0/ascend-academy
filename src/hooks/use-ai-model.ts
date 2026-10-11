import { useState, useEffect } from 'react';

export type AiModelChoice =
  | 'auto'
  | 'cerebras'
  | 'groq'
  | 'openrouter'
  | 'cloudflare'
  | 'openai';

const STORAGE_KEY = 'ascend-academy-ai-model';

const VALID_MODELS: ReadonlyArray<AiModelChoice> = [
  'auto',
  'cerebras',
  'groq',
  'openrouter',
  'cloudflare',
  'openai',
];

/**
 * VITE_AI_PROVIDER_MODE=openai_only mirrors the backend's AI_PROVIDER_MODE:
 * every call runs on OpenAI and the server ignores the requested model, so
 * there is no choice to offer. The hook then always reports 'auto'.
 */
export const AI_MODEL_PICKER_ENABLED = import.meta.env.VITE_AI_PROVIDER_MODE !== 'openai_only';

function isValidModel(value: string | null): value is AiModelChoice {
  return value !== null && (VALID_MODELS as ReadonlyArray<string>).includes(value);
}

export function useAiModel() {
  const [aiModel, setAiModelState] = useState<AiModelChoice>(() => {
    if (!AI_MODEL_PICKER_ENABLED) return 'auto';
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isValidModel(stored)) {
        return stored;
      }
    }
    return 'auto';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, aiModel);
  }, [aiModel]);

  const setAiModel = (model: AiModelChoice) => {
    if (AI_MODEL_PICKER_ENABLED) setAiModelState(model);
  };

  return { aiModel, setAiModel };
}
