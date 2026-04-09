// ─── Model definitions & routing table ────────────────────────────────────────
// Maps simple alias names (used throughout the extension) to LiteLLM model
// strings. The LiteLLM proxy config.yaml maps these names on its side too,
// so both layers stay in sync.

export type ModelAlias =
    // Flagship Group
    | 'gpt-oss-120b'
    | 'qwen3-coder'
    | 'llama-3.3-70b'
    | 'hermes-405b'
    | 'gemma-3-27b'
    // Balanced Group
    | 'gpt-oss-20b'
    | 'qwen3-next-80b'
    | 'qwen3-6-plus'
    | 'nemotron-30b'
    | 'gemma-3-12b'
    // Fast Group
    | 'stepfun-flash'
    | 'glm-4-5-air'
    | 'dolphin-mistral-24b'
    | 'gemma-3-4b'
    | 'gemma-3n-e4b'
    // Specialty / Edge
    | 'nemotron-nano-9b'
    | 'nemotron-embed-vl'
    | 'lfm-thinking'
    | 'lfm-instruct'
    | 'llama-3.2-3b'
    // Legacy / Fallback
    | 'claude';

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
    // ── FLAGSHIP ──
    'gpt-oss-120b': {
        alias: 'gpt-oss-120b',
        litellmModel: 'gpt-oss-120b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'GPT OSS 120B',
    },
    'qwen3-coder': {
        alias: 'qwen3-coder',
        litellmModel: 'qwen3-coder',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Qwen 3 Coder',
    },
    'llama-3.3-70b': {
        alias: 'llama-3.3-70b',
        litellmModel: 'llama-3.3-70b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Llama 3.3 70B',
    },
    'hermes-405b': {
        alias: 'hermes-405b',
        litellmModel: 'hermes-405b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Hermes 3 405B',
    },
    'gemma-3-27b': {
        alias: 'gemma-3-27b',
        litellmModel: 'gemma-3-27b',
        contextWindow: 128_000,
        costTier: 'free',
        label: 'Gemma 3 27B',
    },

    // ── BALANCED ──
    'gpt-oss-20b': {
        alias: 'gpt-oss-20b',
        litellmModel: 'gpt-oss-20b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'GPT OSS 20B',
    },
    'qwen3-next-80b': {
        alias: 'qwen3-next-80b',
        litellmModel: 'qwen3-next-80b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Qwen 3 Next 80B',
    },
    'qwen3-6-plus': {
        alias: 'qwen3-6-plus',
        litellmModel: 'qwen3-6-plus',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Qwen 3.6 Plus',
    },
    'nemotron-30b': {
        alias: 'nemotron-30b',
        litellmModel: 'nemotron-30b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Nemotron 30B',
    },
    'gemma-3-12b': {
        alias: 'gemma-3-12b',
        litellmModel: 'gemma-3-12b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Gemma 3 12B',
    },

    // ── FAST ──
    'stepfun-flash': {
        alias: 'stepfun-flash',
        litellmModel: 'stepfun-flash',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'StepFun 3.5 Flash',
    },
    'glm-4-5-air': {
        alias: 'glm-4-5-air',
        litellmModel: 'glm-4-5-air',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'GLM 4.5 Air',
    },
    'dolphin-mistral-24b': {
        alias: 'dolphin-mistral-24b',
        litellmModel: 'dolphin-mistral-24b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Dolphin Mistral 24B',
    },
    'gemma-3-4b': {
        alias: 'gemma-3-4b',
        litellmModel: 'gemma-3-4b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Gemma 3 4B',
    },
    'gemma-3n-e4b': {
        alias: 'gemma-3n-e4b',
        litellmModel: 'gemma-3n-e4b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Gemma 3n E4B',
    },

    // ── SPECIALTY ──
    'nemotron-nano-9b': {
        alias: 'nemotron-nano-9b',
        litellmModel: 'nemotron-nano-9b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Nemotron Nano 9B',
    },
    'nemotron-embed-vl': {
        alias: 'nemotron-embed-vl',
        litellmModel: 'nemotron-embed-vl',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Nemotron Embed VL',
    },
    'lfm-thinking': {
        alias: 'lfm-thinking',
        litellmModel: 'lfm-thinking',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'LFM 2.5 Thinking',
    },
    'lfm-instruct': {
        alias: 'lfm-instruct',
        litellmModel: 'lfm-instruct',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'LFM 2.5 Instruct',
    },
    'llama-3.2-3b': {
        alias: 'llama-3.2-3b',
        litellmModel: 'llama-3.2-3b',
        contextWindow: 32_000,
        costTier: 'free',
        label: 'Llama 3.2 3B',
    },

    'claude': {
        alias: 'claude',
        litellmModel: 'claude',
        contextWindow: 200_000,
        costTier: 'high',
        label: 'Claude 3.5 Sonnet',
    },
};

/** Fallback chains per grouping */
export const FALLBACK_GROUPS: Record<string, ModelAlias[]> = {
    flagship: ['gpt-oss-120b', 'qwen3-coder', 'llama-3.3-70b', 'hermes-405b'],
    balanced: ['qwen3-6-plus', 'gpt-oss-20b', 'qwen3-next-80b', 'nemotron-30b'],
    fast: ['qwen3-coder', 'stepfun-flash', 'glm-4-5-air', 'dolphin-mistral-24b'],
};

/**
 * Selects the best model based on task intent, user-selected mode, and reasoning level.
 */
export function selectModel(
    intent: TaskIntent,
    estimatedTokens: number,
    options: { mode: string; model?: string; reasoningLevel: number; forceClaude?: boolean }
): { alias: ModelAlias; reason: string } {
    const { mode, model, reasoningLevel, forceClaude = false } = options;

    if (forceClaude) {
        return { alias: 'claude', reason: 'force_claude flag set by user' };
    }

    // ── MANUAL MODEL SELECTION OVERRIDE ──
    if (model && MODELS[model as ModelAlias]) {
        return { alias: model as ModelAlias, reason: 'Manual model selection by user' };
    }

    // ── HIGH REASONING OVERRIDE ──
    if (reasoningLevel === 3 && mode !== 'fast') {
        return { alias: 'lfm-thinking', reason: 'High reasoning level requested — using thinking model' };
    }

    // ── MODE-BASED ROUTING ──
    if (mode === 'fast') {
        return { alias: 'stepfun-flash', reason: 'Fast mode requested — using low-latency flagship' };
    }

    if (mode === 'full' || mode === 'plan') {
        return { alias: 'gpt-oss-120b', reason: `${mode} mode requested — using max capability flagship` };
    }

    if (mode === 'ask') {
        return { alias: 'qwen3-6-plus', reason: 'Ask mode — using balanced general purpose model' };
    }

    // ── DEFAULT INTENT-BASED ROUTING (Agent mode) ──
    if (estimatedTokens > 30_000) {
        return {
            alias: 'gpt-oss-120b',
            reason: `context ~${Math.round(estimatedTokens / 1000)}k tokens requires flagship context`,
        };
    }

    switch (intent) {
        case 'DEBUG':
        case 'CREATION':
        case 'REFACTOR':
            return { alias: 'qwen3-coder', reason: 'code-centric task — Qwen3 Coder primary' };
        case 'OPTIMIZATION':
            return { alias: 'gpt-oss-120b', reason: 'complex logic — Flagship primary' };
        case 'TESTING':
            return { alias: 'qwen3-coder', reason: 'test generation — Qwen3 Coder primary' };
        case 'MIGRATION':
            return { alias: 'llama-3.3-70b', reason: 'broad reasoning — Llama 3.3 primary' };
        case 'ANALYSIS':
            return { alias: 'qwen3-6-plus', reason: 'explanation — Balanced primary' };
        case 'AMBIGUOUS':
        default:
            return { alias: 'stepfun-flash', reason: 'default — Fast Group primary' };
    }
}

/**
 * Returns the next model in the fallback chain.
 * This should ideally look at which group the current model belongs to.
 */
export function nextFallback(current: ModelAlias): ModelAlias | null {
    // Simple implementation: check all groups
    for (const group of Object.values(FALLBACK_GROUPS)) {
        const idx = group.indexOf(current);
        if (idx !== -1 && idx < group.length - 1) {
            return group[idx + 1];
        }
    }
    
    // If it's a flagship model and we're at the end, maybe fallback to Balanced?
    if (FALLBACK_GROUPS.flagship.includes(current)) return FALLBACK_GROUPS.balanced[0];
    if (FALLBACK_GROUPS.balanced.includes(current)) return FALLBACK_GROUPS.fast[0];

    return null;
}
