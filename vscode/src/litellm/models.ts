// ─── Model definitions & routing table ────────────────────────────────────────
// 100% FREE configuration — all models route to free Groq or OpenRouter :free endpoints.
// Keep this in sync with litellm/config.yaml.

export type ModelAlias =
    // Free Flagship
    | 'qwen3-coder'
    | 'hermes-405b'
    | 'llama-3.3-70b'
    | 'gpt-oss-120b'
    // Free Balanced
    | 'gemma-3-27b'
    | 'deepseek-v3'
    | 'glm-4-5-air'
    | 'qwen3-6-plus'
    | 'gpt-oss-20b'
    // Free Reasoning
    | 'deepseek-r1'
    | 'lfm-thinking'
    | 'lfm-instruct';

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
    /** Exact model string sent to LiteLLM proxy (alias in config.yaml) */
    litellmModel: string;
    contextWindow: number;
    costTier: 'free' | 'low' | 'medium' | 'high';
    /** Human-readable label shown in the UI */
    label: string;
}

export const MODELS: Record<ModelAlias, ModelConfig> = {
    // ── FREE FLAGSHIP ──────────────────────────────────────────────────────────
    'qwen3-coder': {
        alias: 'qwen3-coder',
        litellmModel: 'qwen3-coder',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Qwen 2.5 Coder 32B 🆓',
    },
    'hermes-405b': {
        alias: 'hermes-405b',
        litellmModel: 'hermes-405b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Hermes 3 · 405B 🆓',
    },
    'llama-3.3-70b': {
        alias: 'llama-3.3-70b',
        litellmModel: 'llama-3.3-70b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Llama 3.3 70B · Groq 🆓',
    },
    'gpt-oss-120b': {
        alias: 'gpt-oss-120b',
        litellmModel: 'gpt-oss-120b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Hermes 405B (Alt) 🆓',
    },

    // ── FREE BALANCED ──────────────────────────────────────────────────────────
    'gemma-3-27b': {
        alias: 'gemma-3-27b',
        litellmModel: 'gemma-3-27b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Gemma 3 · 27B 🆓',
    },
    'deepseek-v3': {
        alias: 'deepseek-v3',
        litellmModel: 'deepseek-v3',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Qwen 2.5 · 72B 🆓',
    },
    'glm-4-5-air': {
        alias: 'glm-4-5-air',
        litellmModel: 'glm-4-5-air',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'GLM 4.5 Air 🆓',
    },
    'qwen3-6-plus': {
        alias: 'qwen3-6-plus',
        litellmModel: 'qwen3-6-plus',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Qwen 2 · 7B 🆓',
    },
    'gpt-oss-20b': {
        alias: 'gpt-oss-20b',
        litellmModel: 'gpt-oss-20b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'GPT 3.5 Turbo 🆓',
    },

    // ── FREE REASONING ─────────────────────────────────────────────────────────
    'deepseek-r1': {
        alias: 'deepseek-r1',
        litellmModel: 'deepseek-r1',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'DeepSeek R1 · Groq 🆓',
    },
    'lfm-thinking': {
        alias: 'lfm-thinking',
        litellmModel: 'lfm-thinking',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'LFM 32B Thinking 🆓',
    },
    'lfm-instruct': {
        alias: 'lfm-instruct',
        litellmModel: 'lfm-instruct',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'LFM 40B Instruct 🆓',
    },
};

/** Fallback chains — all free models */
export const FALLBACK_GROUPS: Record<string, ModelAlias[]> = {
    flagship:  ['qwen3-coder', 'hermes-405b', 'llama-3.3-70b', 'gpt-oss-120b'],
    balanced:  ['gemma-3-27b', 'deepseek-v3', 'glm-4-5-air', 'qwen3-6-plus', 'gpt-oss-20b'],
    reasoning: ['deepseek-r1', 'lfm-thinking', 'lfm-instruct'],
};

/**
 * Selects the best model based on task intent, user-selected mode, and reasoning level.
 * All models are free — no paid fallback exists.
 */
export function selectModel(
    intent: TaskIntent,
    estimatedTokens: number,
    options: { mode: string; model?: string; reasoningLevel: number }
): { alias: ModelAlias; reason: string } {
    const { mode, model, reasoningLevel } = options;

    // ── MANUAL MODEL SELECTION OVERRIDE ──
    if (model && MODELS[model as ModelAlias]) {
        return { alias: model as ModelAlias, reason: 'Manual model selection by user' };
    }

    // ── HIGH REASONING OVERRIDE ──
    if (reasoningLevel === 3 && mode !== 'fast') {
        return { alias: 'deepseek-r1', reason: 'High reasoning level → DeepSeek R1 (Groq Free)' };
    }
    if (reasoningLevel === 2 && mode !== 'fast') {
        return { alias: 'lfm-thinking', reason: 'Med reasoning level → LFM Thinking (Free)' };
    }

    // ── MODE-BASED ROUTING ──
    if (mode === 'fast') {
        return { alias: 'glm-4-5-air', reason: 'Fast mode → GLM 4.5 Air (Free, low-latency)' };
    }

    if (mode === 'plan') {
        return { alias: 'llama-3.3-70b', reason: 'Plan mode → Llama 3.3 70B Groq (Free)' };
    }

    if (mode === 'ask') {
        return { alias: 'gemma-3-27b', reason: 'Ask mode → Gemma 3 27B (Free)' };
    }

    // ── LARGE CONTEXT ──
    if (estimatedTokens > 30_000) {
        return {
            alias: 'hermes-405b',
            reason: `Large context ~${Math.round(estimatedTokens / 1000)}k tokens → Hermes 405B (Free)`,
        };
    }

    // ── INTENT-BASED ROUTING (Agent mode) ──
    switch (intent) {
        case 'DEBUG':
        case 'CREATION':
        case 'REFACTOR':
        case 'TESTING':
            return { alias: 'qwen3-coder', reason: 'Code task → Qwen 2.5 Coder 32B (Free)' };
        case 'OPTIMIZATION':
            return { alias: 'hermes-405b', reason: 'Complex logic → Hermes 405B (Free)' };
        case 'MIGRATION':
            return { alias: 'llama-3.3-70b', reason: 'Broad reasoning → Llama 3.3 70B Groq (Free)' };
        case 'ANALYSIS':
            return { alias: 'gemma-3-27b', reason: 'Analysis → Gemma 3 27B (Free)' };
        case 'AMBIGUOUS':
        default:
            return { alias: 'qwen3-6-plus', reason: 'Default → Qwen 2 7B (Free)' };
    }
}

/**
 * Returns the next model in the fallback chain.
 */
export function nextFallback(current: ModelAlias): ModelAlias | null {
    for (const group of Object.values(FALLBACK_GROUPS)) {
        const idx = group.indexOf(current);
        if (idx !== -1 && idx < group.length - 1) {
            return group[idx + 1];
        }
    }

    // Cross-group fallbacks
    if (FALLBACK_GROUPS.flagship.includes(current)) return FALLBACK_GROUPS.balanced[0];
    if (FALLBACK_GROUPS.balanced.includes(current)) return FALLBACK_GROUPS.reasoning[0];

    return null;
}
