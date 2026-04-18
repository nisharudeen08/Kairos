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
    | 'deepseek-local-quality'
    | 'deepseek-local-fast'
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
    | 'github-deepseek-r1'
    | 'kwaicoder-local'
    | '360-light-local'
    | 'gemma-local-fast'
    | 'qwen-local'
    | 'qwen-ubuntu'
    | 'gemma-4-scout-local';

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
    supportsVision?: boolean;
    provider?: string;
}

export const MODELS: Record<string, ModelConfig> = {
    // We dynamically create this or just trust the alias in selectModel, but let's define the primary ones used for routing
    'qwen3-coder': { alias: 'qwen3-coder', litellmModel: 'qwen3-coder', contextWindow: 32_000, costTier: 'free', label: 'Qwen 3 Coder' },
    'groq-llama-3.1-8b': { alias: 'groq-llama-3.1-8b', litellmModel: 'groq-llama-3.1-8b', contextWindow: 8_000, costTier: 'free', label: 'Groq Llama 3.1 8B' },
    'github-deepseek-r1': { alias: 'github-deepseek-r1', litellmModel: 'github-deepseek-r1', contextWindow: 32_000, costTier: 'free', label: 'GitHub DeepSeek R1' },
    'groq-qwen-qwq-32b': { alias: 'groq-qwen-qwq-32b', litellmModel: 'groq-qwen-qwq-32b', contextWindow: 8_000, costTier: 'free', label: 'Groq QwQ' },
    'llama-3.3-70b': { alias: 'llama-3.3-70b', litellmModel: 'llama-3.3-70b', contextWindow: 32_000, costTier: 'free', label: 'Llama 3.3 70B' },
    'hermes-3-405b': { alias: 'hermes-3-405b', litellmModel: 'hermes-3-405b', contextWindow: 32_000, costTier: 'free', label: 'Hermes 405B' },
    'gemma-3-27b': { alias: 'gemma-3-27b', litellmModel: 'gemma-3-27b', contextWindow: 32_000, costTier: 'free', label: 'Gemma 3 27B', supportsVision: true },
    'codestral': { alias: 'codestral', litellmModel: 'codestral', contextWindow: 32_000, costTier: 'free', label: 'Codestral' },
    'gpt-oss-20b': { alias: 'gpt-oss-20b', litellmModel: 'gpt-oss-20b', contextWindow: 32_000, costTier: 'free', label: 'GPT OSS 20B' },
    'gemini-2.5-pro': { alias: 'gemini-2.5-pro', litellmModel: 'gemini-2.5-pro', contextWindow: 128_000, costTier: 'free', label: 'Gemini 2.5 Pro', supportsVision: true },

    // ── LOCAL MODELS (LiteLLM Proxy Names) ──
    'deepseek-local-quality': { alias: 'deepseek-local-quality', litellmModel: 'kairos-r1-14b',  contextWindow: 32_000, costTier: 'free', label: 'KAIROS R1 14B', provider: 'Ollama' },
    'deepseek-local-fast':    { alias: 'deepseek-local-fast',    litellmModel: 'deepseek-r1-8b',  contextWindow: 16_000, costTier: 'free', label: 'KAIROS R1 8B',  provider: 'Ollama' },
    'gemma-local-fast':       { alias: 'gemma-local-fast',       litellmModel: 'gemma-local-fast', contextWindow: 8_000,  costTier: 'free', label: 'Gemma 2B (Local)', provider: 'Ollama' },

    // Added missing models from Aliases:
    'step-3.5-flash': { alias: 'step-3.5-flash', litellmModel: 'step-3.5-flash', contextWindow: 256000, provider: 'openrouter', costTier: 'free', label: 'Step 3.5 Flash' },
    'nemotron-nano-9b': { alias: 'nemotron-nano-9b', litellmModel: 'nemotron-nano-9b', contextWindow: 128000, provider: 'openrouter', costTier: 'free', label: 'Nemotron Nano 9B' },
    'arcee-trinity-mini': { alias: 'arcee-trinity-mini', litellmModel: 'arcee-trinity-mini', contextWindow: 131000, provider: 'openrouter', costTier: 'free', label: 'Arcee Trinity Mini' },
    'gemma-4-31b': { alias: 'gemma-4-31b', litellmModel: 'gemma-4-31b', contextWindow: 32000, costTier: 'free', label: 'Gemma 4 31B' },
    'qwen3-next-80b': { alias: 'qwen3-next-80b', litellmModel: 'qwen3-next-80b', contextWindow: 262000, provider: 'openrouter', costTier: 'free', label: 'Qwen 3 Next 80B' },
    'nemotron-3-super': { alias: 'nemotron-3-super', litellmModel: 'nemotron-3-super', contextWindow: 262000, provider: 'openrouter', costTier: 'free', label: 'Nemotron 3 Super' },
    'gpt-oss-120b': { alias: 'gpt-oss-120b', litellmModel: 'gpt-oss-120b', contextWindow: 131000, provider: 'openrouter', costTier: 'free', label: 'GPT OSS 120B' },
    'nemotron-nano-12b-vl': { alias: 'nemotron-nano-12b-vl', litellmModel: 'nemotron-nano-12b-vl', contextWindow: 128000, provider: 'openrouter', costTier: 'free', label: 'Nemotron Nano 12B VL', supportsVision: true },
    'gemma-4-26b-vision': { alias: 'gemma-4-26b-vision', litellmModel: 'gemma-4-26b-vision', contextWindow: 32000, costTier: 'free', label: 'Gemma 4 26B Vision', supportsVision: true },
    'dolphin-mistral-24b': { alias: 'dolphin-mistral-24b', litellmModel: 'dolphin-mistral-24b', contextWindow: 33000, provider: 'openrouter', costTier: 'free', label: 'Dolphin Mistral 24B' },
    'lfm-2.5-1.2b-thinking': { alias: 'lfm-2.5-1.2b-thinking', litellmModel: 'lfm-2.5-1.2b-thinking', contextWindow: 33000, provider: 'openrouter', costTier: 'free', label: 'LFM 2.5 1.2B Thinking' },
    'groq-llama-3.3-70b': { alias: 'groq-llama-3.3-70b', litellmModel: 'groq-llama-3.3-70b', contextWindow: 32000, costTier: 'free', label: 'Groq Llama 3.3 70B' },
    'groq-llama-4-scout': { alias: 'groq-llama-4-scout', litellmModel: 'groq-llama-4-scout', contextWindow: 8000, costTier: 'free', label: 'Groq Llama 4 Scout' },
    'mistral-small': { alias: 'mistral-small', litellmModel: 'mistral-small', contextWindow: 32000, costTier: 'free', label: 'Mistral Small' },
    'devstral-small': { alias: 'devstral-small', litellmModel: 'devstral-small', contextWindow: 32000, costTier: 'free', label: 'Devstral Small' },
    'gemini-2.5-flash-lite': { alias: 'gemini-2.5-flash-lite', litellmModel: 'gemini-2.5-flash-lite', contextWindow: 128000, costTier: 'free', label: 'Gemini 2.5 Flash Lite' },
    'gemini-2.5-flash': { alias: 'gemini-2.5-flash', litellmModel: 'gemini-2.5-flash', contextWindow: 128000, costTier: 'free', label: 'Gemini 2.5 Flash', supportsVision: true },
    'github-gpt-4o-mini': { alias: 'github-gpt-4o-mini', litellmModel: 'github-gpt-4o-mini', contextWindow: 128000, costTier: 'free', label: 'GitHub GPT-4o Mini' },
    'github-llama-3.3-70b': { alias: 'github-llama-3.3-70b', litellmModel: 'github-llama-3.3-70b', contextWindow: 32000, costTier: 'free', label: 'GitHub Llama 3.3 70B' },

    // ── NEW LOCAL POWERHOUSE MODELS (Optimized for Drive D) ──
    'kwaicoder-local': { 
        alias: 'kwaicoder-local', 
        litellmModel: 'kairos-coder', 
        contextWindow: 32_000, 
        costTier: 'free', 
        label: 'KwaiCoder 16B (Local)', 
        provider: 'Ollama' 
    },
    '360-light-local': { 
        alias: '360-light-local', 
        litellmModel: '360-light', 
        contextWindow: 16_000, 
        costTier: 'free', 
        label: '360 Light-R1 14B (Local)', 
        provider: 'Ollama' 
    },

    'qwen-local': {
        alias: 'qwen-local',
        litellmModel: 'qwen-coder-win',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Qwen 2.5 Coder 7B (Windows)',
        provider: 'Ollama'
    },
    'qwen-ubuntu': {
        alias: 'qwen-ubuntu',
        litellmModel: 'qwen-coder-ubuntu',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Qwen 2.5 Coder 7B (Ubuntu)',
        provider: 'Ollama'
    },

    'gemma-4-scout-local': {
        alias: 'gemma-4-scout-local',
        litellmModel: 'gemma-4-scout-local',
        contextWindow: 8_000,
        costTier: 'free',
        label: 'Gemma 4 e4B (Local)',
        provider: 'Ollama'
    }
};

export const DEFAULT_VISION_MODEL: ModelAlias = 'gemini-2.5-flash';

/** Fallback chains */
export const FALLBACK_GROUPS: Record<string, ModelAlias[]> = {
    flagship:  ['qwen3-coder', 'hermes-3-405b', 'llama-3.3-70b', 'codestral'],
    balanced:  ['gemma-3-27b', 'groq-llama-3.3-70b', 'gpt-oss-20b'],
    reasoning: ['github-deepseek-r1', 'groq-qwen-qwq-32b', 'lfm-2.5-1.2b-thinking'],
    local:     ['kwaicoder-local', '360-light-local', 'deepseek-local-quality', 'qwen-local', 'qwen-ubuntu', 'gemma-4-scout-local', 'deepseek-local-fast', 'gemma-local-fast'],
};

export function selectModel(
    intent: TaskIntent,
    estimatedTokens: number,
    options: { mode: string; model?: string; reasoningLevel: number }
): { alias: ModelAlias; reason: string } {
    const { mode, model, reasoningLevel } = options;

    if (model && model !== 'auto') {
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

    if (mode === 'local') {
        if (intent === 'CREATION' || intent === 'DEBUG' || intent === 'REFACTOR') {
            return { alias: 'kwaicoder-local', reason: 'Local precision coding' };
        }
        if (reasoningLevel >= 2) {
            return { alias: '360-light-local', reason: 'Local deep reasoning' };
        }
        return { alias: 'gemma-local-fast', reason: 'Local scout mode' };
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
