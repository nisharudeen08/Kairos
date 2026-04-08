import { TaskIntent } from '../litellm/models';

export interface ClassificationResult {
    intent: TaskIntent;
    /** 0–8 complexity score per the spec */
    complexityScore: number;
    complexityLevel: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
    risks: string[];
}

// ─── Intent detection ─────────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: TaskIntent }> = [
    {
        pattern: /\b(create|build|add|implement|generate|make|write|scaffold|set up|setup|new)\b/i,
        intent: 'CREATION',
    },
    {
        pattern: /\b(fix|bug|error|broken|crash|fail|issue|problem|exception|traceback|undefined|null pointer)\b/i,
        intent: 'DEBUG',
    },
    {
        pattern: /\b(refactor|clean|improve|restructure|reorganize|simplify|dedup|extract|rename)\b/i,
        intent: 'REFACTOR',
    },
    {
        pattern: /\b(explain|what is|what does|how does|why|understand|describe|tell me|walk me through)\b/i,
        intent: 'ANALYSIS',
    },
    {
        pattern: /\b(optimi[sz]e|slow|performance|speed|faster|bottleneck|memory|cpu|latency)\b/i,
        intent: 'OPTIMIZATION',
    },
    {
        pattern: /\b(test|spec|coverage|e2e|unit test|integration test|jest|pytest|vitest|cypress)\b/i,
        intent: 'TESTING',
    },
    {
        pattern: /\b(migrat|upgrade|convert|port|update to|move from|replace|transition)\b/i,
        intent: 'MIGRATION',
    },
];

export function classifyIntent(userMessage: string): TaskIntent {
    // Multi-match: return first definitive match; "DEBUG" wins over "CREATION"
    // if both are present (fixing > building in ambiguous overlap)
    const debugMatch = INTENT_PATTERNS.find(
        (p) => p.intent === 'DEBUG' && p.pattern.test(userMessage)
    );
    if (debugMatch) {
        return 'DEBUG';
    }

    for (const { pattern, intent } of INTENT_PATTERNS) {
        if (pattern.test(userMessage)) {
            return intent;
        }
    }

    return 'AMBIGUOUS';
}

// ─── Complexity scoring ───────────────────────────────────────────────────────

interface ComplexitySignals {
    messageLength: number;
    hasMultipleFiles: boolean;
    hasMigrationHint: boolean;
    hasAsyncHint: boolean;
    hasApiHint: boolean;
    hasDbHint: boolean;
    hasVagueDescription: boolean;
}

function detectSignals(msg: string): ComplexitySignals {
    return {
        messageLength: msg.length,
        hasMultipleFiles: /\b(multiple files|across files|several files|all files)\b/i.test(msg),
        hasMigrationHint: /\b(migrat|upgrading|moving from|converting)\b/i.test(msg),
        hasAsyncHint: /\b(async|await|promise|concurrent|parallel|race condition|thread)\b/i.test(msg),
        hasApiHint: /\b(api|endpoint|rest|graphql|webhook|http|fetch|axios)\b/i.test(msg),
        hasDbHint: /\b(database|db|sql|mongo|redis|schema|migration|orm)\b/i.test(msg),
        hasVagueDescription: msg.trim().split(/\s+/).length < 6,
    };
}

export function scoreComplexity(
    intent: TaskIntent,
    userMessage: string,
    hasDiagnostics: boolean
): number {
    const s = detectSignals(userMessage);
    let score = 0;

    // Each criterion from the spec (1 point each)
    if (s.hasMultipleFiles) { score++; }
    if (intent === 'MIGRATION' || s.hasMigrationHint) { score++; } // crosses systems
    if (s.hasDbHint) { score++; } // state/data migration
    if (s.hasApiHint) { score++; } // external dependencies
    if (s.hasAsyncHint) { score++; } // async/concurrent
    if (intent === 'MIGRATION') { score++; } // backward compat concern
    if (!hasDiagnostics && intent === 'DEBUG') { score++; } // no test coverage signal
    if (s.hasVagueDescription) { score++; } // vague description

    return Math.min(score, 8);
}

export function toComplexityLevel(
    score: number
): 'SIMPLE' | 'MODERATE' | 'COMPLEX' {
    if (score <= 2) { return 'SIMPLE'; }
    if (score <= 5) { return 'MODERATE'; }
    return 'COMPLEX';
}

// ─── Risk assessment ──────────────────────────────────────────────────────────

export function assessRisks(
    intent: TaskIntent,
    userMessage: string
): string[] {
    const risks: string[] = [];

    if (/\b(delete|remove|drop|truncate|overwrite|replace all)\b/i.test(userMessage)) {
        risks.push('DESTRUCTIVE: operation may delete or overwrite data');
    }

    if (/\b(schema|migration|alter table|add column|drop table)\b/i.test(userMessage)) {
        risks.push('DESTRUCTIVE: database schema change');
    }

    if (/\b(auth|login|password|token|secret|permission|role|oauth)\b/i.test(userMessage)) {
        risks.push('DESTRUCTIVE: touches authentication or security layer');
    }

    if (/\b(api|interface|public|export)\b/i.test(userMessage) && intent === 'REFACTOR') {
        risks.push('DESTRUCTIVE: may change public API surface');
    }

    if (intent === 'DEBUG' && !/\b(test|spec|coverage)\b/i.test(userMessage)) {
        risks.push('FRAGILITY: no test coverage signal detected');
    }

    return risks;
}

// ─── Full classification ──────────────────────────────────────────────────────

export function classify(
    userMessage: string,
    hasDiagnostics: boolean
): ClassificationResult {
    const intent = classifyIntent(userMessage);
    const complexityScore = scoreComplexity(intent, userMessage, hasDiagnostics);
    const complexityLevel = toComplexityLevel(complexityScore);
    const risks = assessRisks(intent, userMessage);

    return { intent, complexityScore, complexityLevel, risks };
}
