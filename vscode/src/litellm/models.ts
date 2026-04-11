// ─── Model definitions & routing table ────────────────────────────────────────
// 100% FREE configuration — all models route to free endpoints.
// Keep this in sync with litellm/config.yaml.

export type ModelAlias =
    | 'step-3.5-flash'
    | 'gpt-oss-20b'
    | 'nemotron-nano-9b'
    | 'arcee-trinity-mini'
    | 'llama-3.3-70b'
    | 'hermes-3-405b'
    | 'gemma-3-27b'
    | 'gemma-4-31b'
    | 'qwen3-coder'
    | 'qwen3-next-80b'
    | 'nemotron-3-super'
    | 'gpt-oss-120b'
    | 'nemotron-nano-12b-vl'
    | 'gemma-4-26b-vision'
    | 'dolphin-mistral-24b'
    | 'lfm-2.5-1.2b-thinking'
    | 'groq-llama-3.1-8b'
    | 'groq-llama-3.3-70b'
    | 'groq-llama-4-scout'
    | 'groq-qwen-qwq-32b'
    | 'codestral'
    | 'mistral-small'
    | 'devstral-small'
    | 'gemini-2.5-flash-lite'
    | 'gemini-2.5-flash'
    | 'gemini-2.5-pro'
    | 'github-gpt-4o-mini'
    | 'github-llama-3.3-70b'
    | 'github-deepseek-r1';

export type TaskIntent =
    | 'CREATION'
    | 'DEBUG'
    | 'REFACTOR'
    | 'ANALYSIS'
    | 'OPTIMIZATION'
    | 'TESTING'
    | 'MIGRATION'
    | 'AMBIGUOUS';

export interface ModelConfig {
    alias: ModelAlias;
    litellmModel: string;
    contextWindow: number;
    costTier: 'free' | 'low' | 'medium' | 'high';
    label: string;
}

export const MODELS: Record<string, ModelConfig> = {
    // We dynamically create this or just trust the alias in selectModel, but let's define the primary ones used for routing
    'qwen3-coder': { alias: 'qwen3-coder', litellmModel: 'qwen3-coder', contextWindow: 32_000, costTier: 'free', label: 'Qwen 3 Coder' },
    'groq-llama-3.1-8b': { alias: 'groq-llama-3.1-8b', litellmModel: 'groq-llama-3.1-8b', contextWindow: 8_000, costTier: 'free', label: 'Groq Llama 3.1 8B' },
    'github-deepseek-r1': { alias: 'github-deepseek-r1', litellmModel: 'github-deepseek-r1', contextWindow: 32_000, costTier: 'free', label: 'GitHub DeepSeek R1' },
    'groq-qwen-qwq-32b': { alias: 'groq-qwen-qwq-32b', litellmModel: 'groq-qwen-qwq-32b', contextWindow: 8_000, costTier: 'free', label: 'Groq QwQ' },
    'llama-3.3-70b': { alias: 'llama-3.3-70b', litellmModel: 'llama-3.3-70b', contextWindow: 32_000, costTier: 'free', label: 'Llama 3.3 70B' },
    'hermes-3-405b': { alias: 'hermes-3-405b', litellmModel: 'hermes-3-405b', contextWindow: 32_000, costTier: 'free', label: 'Hermes 405B' },
    'gemma-3-27b': { alias: 'gemma-3-27b', litellmModel: 'gemma-3-27b', contextWindow: 32_000, costTier: 'free', label: 'Gemma 3 27B' },
    'codestral': { alias: 'codestral', litellmModel: 'codestral', contextWindow: 32_000, costTier: 'free', label: 'Codestral' },
    'gpt-oss-20b': { alias: 'gpt-oss-20b', litellmModel: 'gpt-oss-20b', contextWindow: 32_000, costTier: 'free', label: 'GPT OSS 20B' },
    'gemini-2.5-pro': { alias: 'gemini-2.5-pro', litellmModel: 'gemini-2.5-pro', contextWindow: 128_000, costTier: 'free', label: 'Gemini 2.5 Pro' }
};

/** Fallback chains */
export const FALLBACK_GROUPS: Record<string, ModelAlias[]> = {
    flagship:  ['qwen3-coder', 'hermes-3-405b', 'llama-3.3-70b', 'codestral'],
    balanced:  ['gemma-3-27b', 'groq-llama-3.3-70b', 'gpt-oss-20b'],
    reasoning: ['github-deepseek-r1', 'groq-qwen-qwq-32b', 'lfm-2.5-1.2b-thinking'],
};

export function selectModel(
    intent: TaskIntent,
    estimatedTokens: number,
    options: { mode: string; model?: string; reasoningLevel: number }
): { alias: ModelAlias; reason: string } {
    const { mode, model, reasoningLevel } = options;

    if (model) {
        return { alias: model as ModelAlias, reason: 'Manual model selection by user' };
    }

    if (reasoningLevel === 3 && mode !== 'fast') {
        return { alias: 'github-deepseek-r1', reason: 'High reasoning level' };
    }
    if (reasoningLevel === 2 && mode !== 'fast') {
        return { alias: 'groq-qwen-qwq-32b', reason: 'Med reasoning level' };
    }

    if (mode === 'fast') {
        return { alias: 'groq-llama-3.1-8b', reason: 'Fast mode' };
    }
    if (mode === 'plan') {
        return { alias: 'llama-3.3-70b', reason: 'Plan mode' };
    }
    if (mode === 'ask') {
        return { alias: 'gemma-3-27b', reason: 'Ask mode' };
    }

    if (estimatedTokens > 30_000) {
        return { alias: 'gemini-2.5-pro', reason: `Large context ~${Math.round(estimatedTokens / 1000)}k tokens` };
    }

    switch (intent) {
        case 'DEBUG':
        case 'CREATION':
        case 'REFACTOR':
        case 'TESTING':
            return { alias: 'qwen3-coder', reason: 'Code task' };
        case 'OPTIMIZATION':
            return { alias: 'hermes-3-405b', reason: 'Complex logic' };
        case 'MIGRATION':
            return { alias: 'llama-3.3-70b', reason: 'Broad reasoning' };
        case 'ANALYSIS':
            return { alias: 'gemma-3-27b', reason: 'Analysis' };
        case 'AMBIGUOUS':
        default:
            return { alias: 'gpt-oss-20b', reason: 'Default fallback' };
    }
}

export function nextFallback(current: ModelAlias): ModelAlias | null {
    for (const group of Object.values(FALLBACK_GROUPS)) {
        const idx = group.indexOf(current);
        if (idx !== -1 && idx < group.length - 1) {
            return group[idx + 1];
        }
    }
    if (FALLBACK_GROUPS.flagship.includes(current)) return FALLBACK_GROUPS.balanced[0];
    if (FALLBACK_GROUPS.balanced.includes(current)) return FALLBACK_GROUPS.reasoning[0];
    return null;
}
