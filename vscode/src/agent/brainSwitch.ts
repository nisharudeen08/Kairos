/**
 * brainSwitch.ts — Sequential Brain Switching System
 *
 * Prevents VRAM overflow on RTX 3050 6GB by ensuring only ONE
 * Ollama model is loaded at a time during <ask_ai> swarm calls.
 *
 * Architecture:
 *   BrainState            — state enum for the FSM
 *   BrainSwitchController — guards switches, tracks depth
 *   ContextSnapshotManager — saves/restores agent context across switches
 *   forceUnloadModel      — hits Ollama keep_alive:0 to evict model
 *   getVRAMStatus         — reads /api/ps to measure loaded VRAM
 *   waitForVRAMClear      — polls until VRAM is below threshold
 *   adaptiveCooldown      — model-size-aware sleep before next load
 *   BrainSwitchLogger     — records each switch event for diagnostics
 */

import { ChatMessage, LITELLM_BASE_URL, LITELLM_KEY } from '../litellm/client';
import { logger } from '../utils/logger';

// ─── Step 1: Brain State Machine ────────────────────────────────────────────

export enum BrainState {
    IDLE      = 'idle',
    RUNNING   = 'running',
    ABORTING  = 'aborting',   // stream cut, waiting for unload
    SWITCHING = 'switching',  // cooldown + VRAM verification
    LOADING   = 'loading'     // new model starting up
}

export interface VRAMStatus {
    freeGB: number;
    usedGB: number;
    totalGB: number;
    modelsLoaded: string[];
}

export class BrainSwitchController {
    private currentState: BrainState = BrainState.IDLE;
    private currentModel: string | null = null;
    private switchDepth: number = 0;
    private readonly MAX_SWITCHES = 3;

    getState(): BrainState    { return this.currentState; }
    getCurrentModel(): string | null { return this.currentModel; }

    setState(state: BrainState): void {
        logger.info(`[BrainSwitch] State: ${this.currentState} → ${state}`);
        this.currentState = state;
    }

    setCurrentModel(model: string): void {
        this.currentModel = model;
    }

    canSwitch(): boolean {
        return (
            this.switchDepth < this.MAX_SWITCHES &&
            this.currentState !== BrainState.ABORTING &&
            this.currentState !== BrainState.SWITCHING
        );
    }

    getSwitchDepth(): number { return this.switchDepth; }
    getMaxSwitches(): number { return this.MAX_SWITCHES; }

    incrementDepth(): void { this.switchDepth++; }
    resetDepth(): void     { this.switchDepth = 0; }
}

/** Single global instance — imported by orchestrator */
export const brainController = new BrainSwitchController();

// ─── Step 2: Context Snapshot System ────────────────────────────────────────

export interface ContextSnapshot {
    model: string;
    messages: ChatMessage[];
    swarmDepth: number;
    streamPosition: number;
    timestamp: number;
}

export class ContextSnapshotManager {
    private snapshots: Map<string, ContextSnapshot> = new Map();

    save(model: string, snapshot: Omit<ContextSnapshot, 'timestamp'>): void {
        this.snapshots.set(model, {
            ...snapshot,
            timestamp: Date.now()
        });
        logger.info(`[BrainSwitch] Snapshot saved for ${model} (${snapshot.messages.length} msgs)`);
    }

    restore(model: string): ContextSnapshot | null {
        return this.snapshots.get(model) ?? null;
    }

    clear(model: string): void {
        this.snapshots.delete(model);
    }

    clearAll(): void {
        this.snapshots.clear();
    }
}

/** Single global instance — imported by orchestrator */
export const snapshotManager = new ContextSnapshotManager();

// ─── Step 3 & 4: VRAM Control Functions ─────────────────────────────────────

/**
 * Hits Ollama's keep_alive:0 endpoint to evict a model from VRAM via LiteLLM Proxy.
 */
export async function forceUnloadModel(
    _targetModel: string | null = null
): Promise<void> {
    try {
        const ps = await fetch(`${LITELLM_BASE_URL}/ollama/api/ps`, {
            headers: { 'Authorization': `Bearer ${LITELLM_KEY}` }
        });
        const data = (await ps.json()) as { models?: Array<{ name: string }> };
        const loadedModels = data.models?.map(m => m.name) || [];

        if (loadedModels.length === 0) return;

        logger.info(`[BrainSwitch] Evicting models from VRAM: [${loadedModels.join(', ')}]`);

        for (const model of loadedModels) {
            const unloadBody = JSON.stringify({ model: model, keep_alive: 0, prompt: '' });
            await fetch(`${LITELLM_BASE_URL}/ollama/api/generate`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LITELLM_KEY}`
                },
                body: unloadBody
            }).catch(() => {});
        }
    } catch (err) {
        logger.error(`[BrainSwitch] Force unload failed: ${err}`);
    }
}

/**
 * Reads /api/ps to measure current VRAM usage via LiteLLM Proxy.
 */
export async function getVRAMStatus(): Promise<VRAMStatus> {
    const res = await fetch(`${LITELLM_BASE_URL}/ollama/api/ps`, {
        headers: { 'Authorization': `Bearer ${LITELLM_KEY}` }
    });
    const data = (await res.json()) as { models?: Array<{ name: string; size_vram?: number }> };
    const models = data.models ?? [];

    const usedBytes = models.reduce((sum, m) => sum + (m.size_vram ?? 0), 0);
    const totalBytes = 6 * 1024 * 1024 * 1024; // RTX 3050 6GB

    return {
        freeGB: (totalBytes - usedBytes) / 1e9,
        usedGB: usedBytes / 1e9,
        totalGB: totalBytes / 1e9,
        modelsLoaded: models.map(m => m.name)
    };
}

/**
 * Polls VRAM status until free space meets the requirement or times out.
 */
export async function waitForVRAMClear(
    requiredGB: number,
    timeoutMs: number = 20000,
    pollIntervalMs: number = 500
): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const status = await getVRAMStatus();

        logger.info(
            `[BrainSwitch] VRAM: ${status.freeGB.toFixed(2)}GB free | ` +
            `need: ${requiredGB}GB | ` +
            `loaded: [${status.modelsLoaded.join(', ')}]`
        );

        if (status.freeGB >= requiredGB) {
            logger.info('[BrainSwitch] VRAM clear ✓');
            return;
        }

        await sleep(pollIntervalMs);
    }

    throw new Error(
        `[BrainSwitch] VRAM did not clear within ${timeoutMs}ms. ` +
        `Aborting brain switch to prevent crash.`
    );
}

// ─── Step 5: Adaptive Cooldown ───────────────────────────────────────────────

/** Approximate VRAM footprint per model in GB */
export const MODEL_SIZES_GB: Record<string, number> = {
    // Windows models — share 6GB VRAM pool
    "gemma-local-fast":  1.7,   // fits easily
    "qwen-coder-win":    4.7,   // fits cleanly
    "deepseek-r1-8b":    5.2,   // tight but fits
    "kairos-r1-14b":     9.0,   // overflows → RAM spill
    "360-light":         9.0,   // overflows → RAM spill
    "kairos-coder":     10.0,   // overflows → RAM spill

    // Ubuntu — separate VRAM pool, no conflict
    "qwen-coder-ubuntu": 4.7,   // Ubuntu VRAM, irrelevant to Windows

    // Cloud — no VRAM
    "openrouter-mistral": 0.0,
    "github-gpt4o":       0.0,

    "default": 6.0
};

/**
 * VRAM safety groups — only Windows models need brain switch protection.
 */
export const REQUIRES_BRAIN_SWITCH = [
    "gemma-local-fast",
    "qwen-coder-win",
    "deepseek-r1-8b",
    "kairos-r1-14b",
    "360-light",
    "kairos-coder"
];

export function needsBrainSwitch(modelName: string): boolean {
    return REQUIRES_BRAIN_SWITCH.includes(modelName);
}

/**
 * Model-size-aware cooldown before loading the next model.
 * Base 2 s + 1 s per GB over 5 GB threshold to flush RAM spill.
 */
export async function adaptiveCooldown(modelName: string): Promise<void> {
    const sizeGB =
        MODEL_SIZES_GB[modelName] ??
        MODEL_SIZES_GB['default'];

    const extraMs = Math.max(0, (sizeGB - 5) * 1000);
    const totalMs = 2000 + extraMs;

    logger.info(
        `[BrainSwitch] Cooldown ${totalMs}ms for ${modelName} (${sizeGB}GB model)`
    );

    await sleep(totalMs);
}

// ─── Step 11: Brain Switch Logger ────────────────────────────────────────────

export interface SwitchEvent {
    from: string;
    to: string;
    phase: string;
    vramBefore: number;
    vramAfter: number;
    durationMs: number;
    success: boolean;
    timestamp: number;
}

export class BrainSwitchLogger {
    private log: SwitchEvent[] = [];

    record(event: Omit<SwitchEvent, 'timestamp'>): void {
        const full: SwitchEvent = { ...event, timestamp: Date.now() };
        this.log.push(full);
        logger.info(`[BrainSwitch] ${JSON.stringify(event)}`);
    }

    getSummary(): { totalSwitches: number; avgDurationMs: number; failures: number } {
        return {
            totalSwitches: this.log.length,
            avgDurationMs:
                this.log.length > 0
                    ? this.log.reduce((s, e) => s + e.durationMs, 0) / this.log.length
                    : 0,
            failures: this.log.filter(e => !e.success).length,
        };
    }
}

/** Single global instance — imported by orchestrator */
export const switchLogger = new BrainSwitchLogger();

// ─── Shared Utility ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
