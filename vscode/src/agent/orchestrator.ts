import * as vscode from 'vscode';
import { LiteLLMClient, ChatMessage, LiteLLMError } from '../litellm/client';
import { buildSystemPrompt } from '../litellm/systemPrompt';
import { selectModel, nextFallback, ModelAlias, MODELS } from '../litellm/models';
import { classify, ClassificationResult } from './classifier';
import { WorkspaceContext } from '../utils/workspace';
import { logger } from '../utils/logger';
import { runTerminalCommand, fsTools } from '../utils/terminal';

export interface AgentMetadata {
    agent: 'Planner' | 'Coder' | 'Debugger';
    modelLabel: string;
    modelAlias: ModelAlias;
    modelReason: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    intent: string;
    complexityLevel: string;
    risks: string[];
}

export interface OrchestratorCallbacks {
    /** Called for each streamed token */
    onToken(content: string): void;
    /** Called once when stream is complete */
    onDone(metadata: AgentMetadata): void;
    /** Called if an unrecoverable error occurs */
    onError(message: string): void;
}

/** Rough chars-per-token estimate for context budgeting */
const CHARS_PER_TOKEN = 4;

/**
 * The Orchestrator ties together classification, model selection,
 * system prompt construction, streaming, and fallback retry.
 *
 * It implements the agent routing table from Layer 1 of the spec.
 */
export class AgentOrchestrator {
    private readonly client: LiteLLMClient;

    constructor(
        private readonly extensionUri: vscode.Uri,
        baseUrl: string,
        apiKey: string,
        timeoutMs = 1000
    ) {
        this.client = new LiteLLMClient(baseUrl, apiKey, timeoutMs);
    }

    async process(
        userMessage: string,
        ctx: WorkspaceContext,
        history: ChatMessage[],
        callbacks: OrchestratorCallbacks,
        options: { mode: string; reasoningLevel: number }
    ): Promise<void> {
        const { mode, reasoningLevel } = options;
        
        // ── Layer 1: Classify ────────────────────────────────────────────────
        const classification = classify(userMessage, ctx.diagnostics.length > 0);
        logger.info(
            `[Orchestrator] intent=${classification.intent} ` +
            `mode=${mode} reasoning=${reasoningLevel} ` +
            `complexity=${classification.complexityScore}(${classification.complexityLevel})`
        );

        // ── Model selection ──────────────────────────────────────────────────
        const systemPromptText = buildSystemPrompt(this.extensionUri, ctx);
        const estimatedTokens = this.estimateTokens(systemPromptText, history, userMessage);

        const { alias: selectedAlias, reason } = selectModel(
            classification.intent,
            estimatedTokens,
            { mode, reasoningLevel }
        );

        // ── Agent determination ──────────────────────────────────────────────
        let agent = this.determineAgent(classification);
        if (mode === 'plan') agent = 'Planner';
        if (mode === 'ask') agent = 'Planner'; // Ask mode is purely informational
        
        const confidence = this.determineConfidence(classification, mode);

        const metadata: AgentMetadata = {
            agent,
            modelAlias: selectedAlias,
            modelLabel: MODELS[selectedAlias].label,
            modelReason: reason,
            confidence,
            intent: classification.intent,
            complexityLevel: classification.complexityLevel,
            risks: classification.risks,
        };

        // ── Build messages ───────────────────────────────────────────────────
        const messages: ChatMessage[] = [
            { role: 'system', content: systemPromptText },
            ...history,
            { role: 'user', content: userMessage },
        ];

        // ── Stream with fallback ─────────────────────────────────────────────
        await this.streamWithFallback(
            selectedAlias,
            messages,
            metadata,
            callbacks,
            mode
        );
    }

    private async streamWithFallback(
        modelAlias: ModelAlias,
        messages: ChatMessage[],
        metadata: AgentMetadata,
        callbacks: OrchestratorCallbacks,
        mode: string,
        attempt = 1
    ): Promise<void> {
        logger.info(`[Orchestrator] Attempt ${attempt}: model=${modelAlias}`);

        try {
            let hasContent = false;
            let fullText = '';
            
            for await (const chunk of this.client.streamChat(modelAlias, messages)) {
                if (chunk.done) break;
                if (chunk.content) {
                    hasContent = true;
                    fullText += chunk.content;
                    callbacks.onToken(chunk.content);
                }
            }

            if (!hasContent) {
                throw {
                    status: 200,
                    message: 'Model returned empty response',
                    isRetryable: true,
                } as LiteLLMError;
            }

            // ── TOOL PARSING (only in Agent and Full Access modes) ───────────
            if (mode === 'agent' || mode === 'full') {
                await this.handleToolCalls(fullText, callbacks);
            }

            // Success — finalise with (possibly updated) metadata
            callbacks.onDone({ ...metadata, modelAlias, modelLabel: MODELS[modelAlias].label });

        } catch (err) {
            const litellmErr = err as LiteLLMError;
            logger.warn(
                `[Orchestrator] ${modelAlias} failed (status=${litellmErr.status}): ${litellmErr.message}`
            );

            if (!litellmErr.isRetryable || attempt >= 5) {
                callbacks.onError(
                    `All models failed. Last error from \`${modelAlias}\`: ${litellmErr.message}\n\n` +
                    `Check that your LiteLLM proxy is running at the configured URL ` +
                    `and that your API keys are valid.`
                );
                return;
            }

            const fallback = nextFallback(modelAlias);
            if (!fallback) {
                callbacks.onError(
                    `Exhausted all fallback models. Last error: ${litellmErr.message}`
                );
                return;
            }

            logger.info(`[Orchestrator] Falling back to: ${fallback}`);
            // Brief delay before retry to respect rate limits
            await sleep(1000 * attempt);
            await this.streamWithFallback(fallback, messages, metadata, callbacks, mode, attempt + 1);
        }
    }

    private determineAgent(
        c: ClassificationResult
    ): 'Planner' | 'Coder' | 'Debugger' {
        if (c.intent === 'DEBUG') {
            return 'Debugger';
        }
        if (
            c.intent === 'CREATION' && c.complexityLevel === 'SIMPLE'
        ) {
            return 'Coder';
        }
        if (c.intent === 'ANALYSIS') {
            return 'Planner';
        }
        // MODERATE/COMPLEX CREATION, REFACTOR, MIGRATION, OPTIMIZATION → Planner
        return 'Planner';
    }

    private determineConfidence(c: ClassificationResult, mode: string): 'HIGH' | 'MEDIUM' | 'LOW' {
        if (mode === 'full') return 'HIGH'; // Full access implies autonomous confidence
        if (mode === 'fast') return 'MEDIUM'; // Fast responses are less verified
        
        if (c.intent === 'AMBIGUOUS' || c.complexityLevel === 'COMPLEX') {
            return 'LOW';
        }
        if (c.complexityLevel === 'MODERATE' || c.risks.length > 0) {
            return 'MEDIUM';
        }
        return 'HIGH';
    }

    private async handleToolCalls(text: string, callbacks: OrchestratorCallbacks): Promise<void> {
        // 1. EXECUTE Tags: <execute>cmd</execute>
        const execRegex = /<execute>([\s\S]*?)<\/execute>/gi;
        let execMatch;
        while ((execMatch = execRegex.exec(text)) !== null) {
            const cmd = execMatch[1].trim();
            callbacks.onToken(`\n\n> ⚡ **System:** \`${cmd}\`...`);
            try {
                await runTerminalCommand(cmd);
                callbacks.onToken(` [OK]`);
            } catch (err) {
                callbacks.onToken(` [FAILED: ${err}]`);
            }
        }

        // 2. READ Tags: <read>path</read>
        const readRegex = /<read>([\s\S]*?)<\/read>/gi;
        let readMatch;
        while ((readMatch = readRegex.exec(text)) !== null) {
            const filePath = readMatch[1].trim();
            callbacks.onToken(`\n\n> 🔍 **Reading:** \`${filePath}\`...`);
            try {
                const content = await fsTools.readFile(filePath);
                callbacks.onToken(` (Read ${content.length} chars)`);
            } catch (err) {
                callbacks.onToken(` (Failed: ${err instanceof Error ? err.message : String(err)})`);
            }
        }

        // 3. WRITE Tags: <write path="path">content</write>
        // Support both <write path="..."> and <write path='...'> or no quotes
        const writeRegex = /<write\s+path=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/write>/gi;
        let writeMatch;
        while ((writeMatch = writeRegex.exec(text)) !== null) {
            const filePath = writeMatch[1].trim();
            const content = writeMatch[2];
            callbacks.onToken(`\n\n> 💾 **Writing:** \`${filePath}\`...`);
            try {
                await fsTools.writeFile(filePath, content);
                callbacks.onToken(` (Success)`);
            } catch (err) {
                callbacks.onToken(` (Failed: ${err instanceof Error ? err.message : String(err)})`);
            }
        }

        // 4. LIST Tags: <list>dirPath</list> — lets the agent explore the workspace
        const listRegex = /<list>([\s\S]*?)<\/list>/gi;
        let listMatch;
        while ((listMatch = listRegex.exec(text)) !== null) {
            const dirPath = listMatch[1].trim() || '.';
            callbacks.onToken(`\n\n> 📁 **Listing:** \`${dirPath}\`...`);
            try {
                const entries = await fsTools.listFiles(dirPath);
                callbacks.onToken(`\n\`\`\`\n${entries.join('\n')}\n\`\`\``);
            } catch (err) {
                callbacks.onToken(` (Failed: ${err instanceof Error ? err.message : String(err)})`);
            }
        }
    }

    private estimateTokens(
        systemPrompt: string,
        history: ChatMessage[],
        userMessage: string
    ): number {
        const historyChars = history.reduce((sum, m) => sum + m.content.length, 0);
        const total = systemPrompt.length + historyChars + userMessage.length;
        return Math.ceil(total / CHARS_PER_TOKEN);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
