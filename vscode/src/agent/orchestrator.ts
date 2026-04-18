import * as vscode from 'vscode';
import { LiteLLMClient, ChatMessage, LiteLLMError, resolveMaxTokens } from '../litellm/client';
import { buildSystemPrompt } from '../litellm/systemPrompt';
import { selectModel, nextFallback, ModelAlias, MODELS, DEFAULT_VISION_MODEL } from '../litellm/models';
import { classify, ClassificationResult } from './classifier';
import { WorkspaceContext } from '../utils/workspace';
import { logger } from '../utils/logger';
import { runTerminalCommand, fsTools } from '../utils/terminal';
import {
    BrainState,
    BrainSwitchController,
    ContextSnapshotManager,
    ContextSnapshot,
    forceUnloadModel,
    adaptiveCooldown,
    waitForVRAMClear,
    MODEL_SIZES_GB,
    BrainSwitchLogger,
    SwitchEvent,
    getVRAMStatus,
} from './brainSwitch';

const SECRET_PATTERNS = [
    /^\.env$/i,
    /^\.env\./i,
    /secret/i,
    /credential/i,
    /\.pem$/i,
    /\.key$/i,
    /\.p12$/i,
    /\.pfx$/i,
    /id_rsa/i,
    /\.token$/i,
];

function isSecretPath(filePath: string): boolean {
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    return SECRET_PATTERNS.some(p => p.test(name));
}

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
    onToken(content: string): void;
    onThinking?: (text: string) => void;
    onDone(metadata: AgentMetadata): void;
    onError(message: string): void;
    onFilePending?: (path: string, content: string) => void;
    /** Returns true if operation is allowed. Agent mode always returns true. */
    onPermissionRequest?: (scope: 'terminal' | 'fileWrite', detail: string) => Promise<boolean>;
    onStatus?: (text: string, ephemeral: boolean) => void;
    onTodo?: (items: string[]) => void;
}

/** Rough chars-per-token estimate for context budgeting */
const CHARS_PER_TOKEN = 4;

/** Max agentic loop iterations to prevent infinite loops */
const MAX_AGENT_TURNS = 6;

/**
 * Parsed tool call extracted from a streaming LLM response.
 */
export type ParsedTool = {
    tag: string;
    content: string;
};

/**
 * The Orchestrator ties together classification, model selection,
 * system prompt construction, streaming, and fallback retry.
 *
 * It implements the agent routing table from Layer 1 of the spec.
 *
 * KEY IMPROVEMENTS in this version:
 *  - Fix #2: Write regex now allows spaces in file paths.
 *  - Fix #3: Recursive agentic loop — read/execute results are fed back into the
 *            LLM context so the model can act on tool outputs.
 *  - Fix #4: Rolling buffer strategy dispatches tools as soon as a closing tag is
 *            found in the stream — no need to wait for the full response.
 */
export class AgentOrchestrator {
    private readonly client: LiteLLMClient;
    private abortController: AbortController | null = null;
    private conversationHistory: ChatMessage[] = [];

    // ── Brain Switch System (Steps 1–11) ────────────────────────────────────
    private readonly brainController = new BrainSwitchController();
    private readonly snapshotManager = new ContextSnapshotManager();
    private readonly switchLogger    = new BrainSwitchLogger();

    constructor(
        private readonly extensionUri: vscode.Uri,
        baseUrl: string,
        apiKey: string,
        timeoutMs = 120000
    ) {
        this.client = new LiteLLMClient(baseUrl, apiKey, timeoutMs);
    }

    public stop() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    public truncateHistory(fromText: string): void {
        const idx = this.conversationHistory.findIndex(m => {
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return content.includes(fromText);
        });
        if (idx !== -1) {
            this.conversationHistory = this.conversationHistory.slice(0, idx);
        }
    }

    async process(
        userMessage: string | any[],
        ctx: WorkspaceContext,
        history: ChatMessage[],
        callbacks: OrchestratorCallbacks,
        options: { mode: string; model: string; reasoningLevel: number }
    ): Promise<void> {
        this.conversationHistory = history;
        const { mode, model, reasoningLevel } = options;
        
        // Extract text for classification
        const textForClassification = typeof userMessage === 'string' 
            ? userMessage 
            // @ts-ignore
            : userMessage.find((item) => item.type === 'text')?.text || '';

        // Detect if this is a multi-step task
        function extractTodoItems(text: string): string[] {
            const lines = text.split('\n');
            
            // Numbered list: "1. do x"
            const numbered = lines.filter(l => /^\d+[\.\)]\s+.+/.test(l.trim()));
            if (numbered.length >= 2) {
                return numbered.map(l => l.trim().replace(/^\d+[\.\)]\s+/, ''));
            }
            
            // Bullet list: "- do x" or "* do x"
            const bulleted = lines.filter(l => /^[-*]\s+.+/.test(l.trim()));
            if (bulleted.length >= 2) {
                return bulleted.map(l => l.trim().replace(/^[-*]\s+/, ''));
            }
            
            // Comma-separated "do x, do y, and do z"
            const commaMatch = text.match(/(?:please\s+)?(.+?),\s+(.+?),?\s+and\s+(.+)/i);
            if (commaMatch) {
                return [commaMatch[1], commaMatch[2], commaMatch[3]]
                    .map(s => s.trim())
                    .filter(s => s.length > 5);
            }
            
            return [];
        }

        const todoItems = extractTodoItems(textForClassification);
        
        if (todoItems.length >= 2) {
            callbacks.onStatus?.('Building task list...', false);
            callbacks.onTodo?.(todoItems);
        }

        // ── Layer 1: Classify ────────────────────────────────────────────────
        const classification = classify(textForClassification, ctx.diagnostics.length > 0);
        logger.info(
            `[Orchestrator] intent=${classification.intent} ` +
            `mode=${mode} model=${model} reasoning=${reasoningLevel} ` +
            `complexity=${classification.complexityScore}(${classification.complexityLevel})`
        );

        // ── Model selection ──────────────────────────────────────────────────
        const systemPromptText = buildSystemPrompt(this.extensionUri, ctx, mode);
        const estimatedTokens = this.estimateTokens(systemPromptText, history, userMessage);

        const { alias: selectedAlias, reason } = selectModel(
            classification.intent,
            estimatedTokens,
            { mode, model, reasoningLevel }
        );

        // ── Agent determination ──────────────────────────────────────────────
        let agent = this.determineAgent(classification);
        if (mode === 'plan') { agent = 'Planner'; }
        if (mode === 'ask') { agent = 'Planner'; } // Ask mode is purely informational
        
        const confidence = this.determineConfidence(classification, mode);

        const metadata: AgentMetadata = {
            agent,
            modelAlias: selectedAlias,
            modelLabel: MODELS[selectedAlias]?.label || selectedAlias,
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

        // TEMP DEBUG — Phase 6 Diagnostic
        console.log("[DEBUG SYSTEM PROMPT]", JSON.stringify(messages[0], null, 2));
        console.log("[DEBUG TOKEN ESTIMATE]", JSON.stringify(messages).length / 4);

        // ── Vision Interceptor ───────────────────────────────────────────────
        const finalMessages = await this.runInterceptors(messages, selectedAlias, callbacks);

        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            // ── Agentic loop (fixes #3) ──────────────────────────────────────────
            // We allow the LLM to issue tools and re-call itself up to MAX_AGENT_TURNS.
            await this.agentLoop(
                selectedAlias,
                finalMessages,
                metadata,
                callbacks,
                mode,
                0,
                signal
            );
        } finally {
            this.abortController = null;
        }
    }

    /**
     * The recursive agent loop.
     *
     * Each turn:
     *  1. Streams the LLM response into the UI using a rolling buffer.
     *  2. Dispatches any tools whose closing tags appear mid-stream.
     *  3. Collects tool outputs from read/execute operations.
     *  4. If there were any tool outputs, appends them as a "user" message
     *     (simulating a tool-result round-trip) and recurses for the next turn.
     */
    private async agentLoop(
        modelAlias: ModelAlias,
        messages: ChatMessage[],
        metadata: AgentMetadata,
        callbacks: OrchestratorCallbacks,
        mode: string,
        turn: number,
        signal: AbortSignal
    ): Promise<void> {
        if (signal.aborted) {
            callbacks.onError('Agent process stopped by user.');
            return;
        }
        if (turn >= MAX_AGENT_TURNS) {
            callbacks.onToken('\n\n> 🔄 **Agent:** Maximum tool-use turns reached. Stopping loop.');
            callbacks.onDone({ ...metadata, modelAlias, modelLabel: MODELS[modelAlias]?.label || modelAlias });
            return;
        }

        // ── Brain switch: mark running ───────────────────────────────────────
        this.brainController.setState(BrainState.RUNNING);
        this.brainController.setCurrentModel(modelAlias);

        if (turn > 0) {
            callbacks.onToken(`\n\n> 🔄 **Agent Turn ${turn + 1}:** Continuing with tool results…\n\n`);
        }

        const toolOutputs: string[] = [];
        // pendingBrainSwitch is set by dispatchStreamingTools when ask_ai fires.
        // Declared with a local type alias so that the 'as' cast below preserves it
        // after TS's control-flow analysis narrows it to 'never' (callback assignment quirk).
        type PendingSwitch = { targetAlias: string; subPrompt: string; msgsSnapshot: ChatMessage[] };
        let _pendingBrainSwitch: PendingSwitch | null = null;

        let fullText = '';

        try {
            fullText = await this.streamWithFallbackAndTools(
                modelAlias,
                messages,
                metadata,
                callbacks,
                mode,
                toolOutputs,
                signal,
                (pending: PendingSwitch) => { _pendingBrainSwitch = pending; }
            );
        } catch (_err) {
            // streamWithFallbackAndTools already called callbacks.onError
            return;
        }

        // ── Brain switch: handle pending ask_ai request ──────────────────────
        // Re-read through a cast: TS can't narrow a variable set inside a callback.
        const bs = _pendingBrainSwitch as PendingSwitch | null;
        if (bs !== null) {
            const switchResult = await this.executeBrainSwitch(
                modelAlias,
                bs.targetAlias as ModelAlias,
                bs.subPrompt,
                bs.msgsSnapshot,
                callbacks
            );

            // Inject sub-agent result into context and continue this model's turn
            const restoredMsgs = this.snapshotManager.restore(modelAlias);
            if (restoredMsgs) {
                restoredMsgs.messages.push({
                    role: 'user',
                    content:
                        `<tool_results>\n` +
                        `<ai_result model="${bs.targetAlias}">\n${switchResult}\n</ai_result>\n` +
                        `</tool_results>\n\nContinue based on the above sub-agent output.`
                });
                this.snapshotManager.clear(modelAlias);
                await this.agentLoop(
                    modelAlias,
                    restoredMsgs.messages,
                    metadata,
                    callbacks,
                    mode,
                    turn + 1,
                    signal
                );
            } else {
                callbacks.onError('[BrainSwitch] Context snapshot lost — cannot resume.');
            }
            return;
        }

        // ── Normal tool-output follow-up (non-brain-switch) ──────────────────
        const needsFollowUp = toolOutputs.length > 0 && (mode === 'agent' || mode === 'full');
        if (needsFollowUp) {
            const resultSummary = toolOutputs.join('\n');
            // Append assistant's last message to context
            messages.push({ role: 'assistant', content: fullText });
            messages.push({
                role: 'user',
                content: `<tool_results>\n${resultSummary}\n</tool_results>\n\nContinue based on the above tool output. If the task is complete, say so.`
            });
            // Recurse for next turn
            await this.agentLoop(modelAlias, messages, metadata, callbacks, mode, turn + 1, signal);
        } else {
            // No follow-up needed — we are done
            this.brainController.setState(BrainState.IDLE);
            this.brainController.resetDepth();
            callbacks.onDone({ ...metadata, modelAlias, modelLabel: MODELS[modelAlias]?.label || modelAlias });
        }
    }

    /**
     * Step 8 — Full Brain Switch Execution (4-phase sequence).
     * Now strictly relies on Remote LiteLLM Proxy.
     */
    private async executeBrainSwitch(
        callingAlias: ModelAlias,
        targetAlias: ModelAlias,
        subPrompt: string,
        msgsSnapshot: ChatMessage[],
        callbacks: OrchestratorCallbacks
    ): Promise<string> {
        const callingModel = MODELS[callingAlias]?.litellmModel ?? callingAlias;
        const targetModel  = MODELS[targetAlias]?.litellmModel  ?? targetAlias;

        logger.info(`\n[BrainSwitch] ══════════════════════════════`);
        logger.info(`[BrainSwitch] ${callingAlias} → ${targetAlias}`);
        logger.info(`[BrainSwitch] ══════════════════════════════\n`);
        callbacks.onStatus?.(`[🧠 Brain Switch: ${callingAlias} → ${targetAlias}]`, true);

        const switchStart = Date.now();
        let vramBefore = 0;

        try {
            const statusBefore = await getVRAMStatus().catch(() => null);
            vramBefore = statusBefore?.usedGB ?? 0;

            // ── Phase 1: Unload calling model ────────────────────────────────
            logger.info(`[BrainSwitch] Phase 1: Unloading ${callingModel}`);
            this.brainController.setState(BrainState.ABORTING);
            callbacks.onStatus?.(`[🧠 Unloading ${callingAlias}…]`, true);

            await forceUnloadModel();
            await adaptiveCooldown(callingModel);
            await waitForVRAMClear(MODEL_SIZES_GB[targetModel] ?? MODEL_SIZES_GB['default']);

            // ── Phase 2: Run target model ─────────────────────────────────────
            logger.info(`[BrainSwitch] Phase 2: Loading ${targetModel}`);
            this.brainController.setState(BrainState.LOADING);
            this.brainController.incrementDepth();
            callbacks.onStatus?.(`[🧠 Consulting ${targetAlias}…]`, true);

            let targetResult = '';
            try {
                targetResult = await this.client.complete(
                    targetAlias,
                    [{ role: 'user', content: subPrompt }],
                    { max_tokens: resolveMaxTokens(targetAlias) }
                );
            } catch (err) {
                targetResult = `[BrainSwitch ERROR] ${targetAlias} failed: ${err}`;
                logger.error(targetResult);
            }

            callbacks.onStatus?.(`[🧠 ${targetAlias} responded]`, true);

            // ── Phase 3: Unload target model ──────────────────────────────────
            logger.info(`[BrainSwitch] Phase 3: Unloading ${targetModel}`);
            this.brainController.setState(BrainState.ABORTING);

            await forceUnloadModel();
            await adaptiveCooldown(targetModel);
            await waitForVRAMClear(MODEL_SIZES_GB[callingModel] ?? MODEL_SIZES_GB['default']);

            // ── Phase 4: Restore calling model context ────────────────────────
            logger.info(`[BrainSwitch] Phase 4: Restoring ${callingAlias} context`);
            this.brainController.setState(BrainState.LOADING);

            // Save snapshot for agentLoop to pick up after this returns
            const snapshot: ContextSnapshot = {
                model: callingAlias,
                messages: [...msgsSnapshot],
                swarmDepth: this.brainController.getSwitchDepth(),
                streamPosition: 0,
                timestamp: Date.now(),
            };
            this.snapshotManager.save(callingAlias, snapshot);

            this.brainController.setState(BrainState.RUNNING);
            logger.info(`[BrainSwitch] Complete ✓ Resuming ${callingAlias}`);
            callbacks.onStatus?.(`[🧠 Brain Switch complete → resuming ${callingAlias}]`, true);

            const statusAfter = await getVRAMStatus().catch(() => null);
            const vramAfter = statusAfter?.usedGB ?? 0;

            const ev: Omit<SwitchEvent, 'timestamp'> = {
                from: callingAlias,
                to: targetAlias,
                phase: 'complete',
                vramBefore,
                vramAfter,
                durationMs: Date.now() - switchStart,
                success: true,
            };
            this.switchLogger.record(ev);

            return targetResult;

        } catch (err) {
            const ev: Omit<SwitchEvent, 'timestamp'> = {
                from: callingAlias,
                to: targetAlias,
                phase: 'failed',
                vramBefore,
                vramAfter: 0,
                durationMs: Date.now() - switchStart,
                success: false,
            };
            this.switchLogger.record(ev);

            this.brainController.setState(BrainState.IDLE);
            callbacks.onStatus?.(`[🧠 Brain Switch FAILED: ${err}]`, true);
            return `[BrainSwitch FAILED] Could not complete switch to ${targetAlias}: ${err}`;
        }
    }

    /**
     * Streams the LLM response with fallback retry.
     *
     * Fix #2: Write tag regex allows file paths with spaces.
     * Fix #4: Uses a rolling buffer to dispatch tools as closing tags appear mid-stream.
     *
     * @returns The full accumulated text for the turn.
     */
    private async streamWithFallbackAndTools(
        modelAlias: ModelAlias,
        messages: ChatMessage[],
        metadata: AgentMetadata,
        callbacks: OrchestratorCallbacks,
        mode: string,
        toolOutputs: string[],
        signal: AbortSignal,
        onBrainSwitch?: (pending: {
            targetAlias: string;
            subPrompt: string;
            msgsSnapshot: ChatMessage[];
        }) => void,
        attempt = 1
    ): Promise<string> {
        logger.info(`[Orchestrator] Attempt ${attempt}: model=${modelAlias}`);

        let fullText = '';
        try {
            let hasContent = false;
            // Rolling buffer for mid-stream tag detection (fix #4)
            let rollingBuffer = '';

            for await (const chunk of this.client.streamChat(modelAlias, messages, signal)) {
                if (signal.aborted) {
                    break;
                }
                if (chunk.done) { break; }
                
                // @ts-ignore
                const thinking = chunk.reasoning_content || chunk.thinking;
                if (thinking) {
                    callbacks.onThinking?.(thinking);
                } else if (chunk.content) {
                    hasContent = true;
                    fullText += chunk.content;
                    rollingBuffer += chunk.content;
                    callbacks.onToken(chunk.content);

                    // Dispatch any complete tool tags that have arrived in the stream
                    if (mode === 'agent' || mode === 'full') {
                        rollingBuffer = await this.dispatchStreamingTools(
                            rollingBuffer,
                            messages,
                            callbacks,
                            toolOutputs,
                            false,
                            onBrainSwitch,
                            mode
                        );
                    }
                }
            }

            // Flush any remaining tags from buffer after stream closes
            if ((mode === 'agent' || mode === 'full') && rollingBuffer.trim()) {
                await this.dispatchStreamingTools(rollingBuffer, messages, callbacks, toolOutputs, true, onBrainSwitch, mode);
            }

            if (!hasContent) {
                throw {
                    status: 200,
                    message: 'Model returned empty response',
                    isRetryable: true,
                } as LiteLLMError;
            }

            return fullText;

        } catch (err) {
            if (signal.aborted) {
                return fullText;
            }
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
                throw litellmErr; // propagate so agentLoop stops
            }

            const fallback = nextFallback(modelAlias);
            if (!fallback) {
                const timeoutMsg = litellmErr.message.includes('timeout') || litellmErr.message.includes('ETIMEDOUT')
                    ? `. Last error: Connection to LiteLLM timed out after ${(this.client as any).timeoutMs}ms. Is your proxy running at ${(this.client as any).baseUrl}?`
                    : `. Last error: ${litellmErr.message}`;

                callbacks.onError(
                    `Exhausted all fallback models${timeoutMsg}`
                );
                throw litellmErr;
            }

            logger.info(`[Orchestrator] Falling back to: ${fallback}`);
            await sleep(1000 * attempt);
            return this.streamWithFallbackAndTools(
                fallback, messages, metadata, callbacks, mode, toolOutputs, signal, onBrainSwitch, attempt + 1
            );
        }
    }

    /**
     * Scans `buffer` for complete XML tool tags and dispatches them immediately.
     *
     * Returns the remaining buffer (text after the last fully processed tag).
     *
     * Fix #2: The write path regex no longer excludes spaces — `([^"'>]+)`.
     * Fix #4: Called on every chunk so tools fire as soon as their closing tag arrives.
     */
    private async dispatchStreamingTools(
        buffer: string,
        messages: ChatMessage[],
        callbacks: OrchestratorCallbacks,
        toolOutputs: string[],
        flushAll = false,
        onBrainSwitch?: (pending: {
            targetAlias: string;
            subPrompt: string;
            msgsSnapshot: ChatMessage[];
        }) => void,
        mode = 'agent'
    ): Promise<string> {
        const askPermission = callbacks.onPermissionRequest;

        // We iterate until no more complete tags remain to process
        let changed = true;
        while (changed) {
            changed = false;

            // ── 1. <execute>cmd</execute> ────────────────────────────────────
            const execMatch = /<execute>([\s\S]*?)<\/execute>/i.exec(buffer);
            if (execMatch) {
                const cmd = execMatch[1].trim();
                const isFullAccess = mode === 'full';
                const allowed = isFullAccess 
                    ? true 
                    : (askPermission ? await askPermission('terminal', `Run: \`${cmd}\``) : true);

                if (!allowed) {
                    callbacks.onToken(`\n\n> ⛔ **Blocked:** Terminal command \`${cmd}\` was denied.`);
                } else {
                    // ── TASK 3: Workspace trust gate ─────────────────────────────────
                    const isTrusted = vscode.workspace.isTrusted;
                    const terminalEnabled = vscode.workspace
                        .getConfiguration('kairos').get('enableTerminal', true);

                    if (!isTrusted || !terminalEnabled) {
                        const denyMsg = 'Terminal access is disabled in untrusted workspaces or by ' +
                            'settings. Enable it in VS Code settings under kairos.enableTerminal.';
                        callbacks.onToken(`\n\n> ⛔ **Blocked:** ${denyMsg}`);
                        toolOutputs.push(
                            `<execute_result cmd="${cmd}" status="denied">\n${denyMsg}\n</execute_result>`
                        );
                    } else {
                        callbacks.onToken(`\n\n> ⚡ **Running:** \`${cmd}\`…`);
                        try {
                            const output = await runTerminalCommand(cmd);
                            const preview = output.length > 800 ? output.slice(0, 800) + '…(truncated)' : output;
                            callbacks.onToken(` ✅ Done\n\`\`\`\n${preview}\n\`\`\``);
                            // Feed output back into the loop (fix #3)
                            toolOutputs.push(`<execute_result cmd="${cmd}">\n${output}\n</execute_result>`);
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            callbacks.onToken(` ❌ Failed: ${msg}`);
                            toolOutputs.push(
                                `<execute_result cmd="${cmd}" status="error">\n${msg}\n</execute_result>`
                            );
                        }
                    }
                }
                buffer = buffer.slice(execMatch.index + execMatch[0].length);
                changed = true;
                continue;
            }

            // ── 2. <read>path</read> ─────────────────────────────────────────
            const readMatch = /<read>([\s\S]*?)<\/read>/i.exec(buffer);
            if (readMatch) {
                const filePath = readMatch[1].trim();
                callbacks.onToken(`\n\n> 🔍 **Reading:** \`${filePath}\`…`);
                
                if (isSecretPath(filePath)) {
                    const msg = 'Access denied: this file is protected and cannot be read or modified by the agent.';
                    callbacks.onToken(` ❌ Failed: ${msg}`);
                    toolOutputs.push(`<read_result path="${filePath}" status="error">\n${msg}\n</read_result>`);
                    buffer = buffer.slice(readMatch.index + readMatch[0].length);
                    changed = true;
                    continue;
                }

                try {
                    const content = await fsTools.readFile(filePath);
                    callbacks.onToken(` (${content.length} chars)`);
                    // Feed file content back into the loop (fix #3)
                    toolOutputs.push(`<read_result path="${filePath}">\n${content}\n</read_result>`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    callbacks.onToken(` ❌ Failed: ${msg}`);
                    toolOutputs.push(`<read_result path="${filePath}" status="error">\n${msg}\n</read_result>`);
                }
                buffer = buffer.slice(readMatch.index + readMatch[0].length);
                changed = true;
                continue;
            }

            // ── 3. <write path="...">content</write> ─────────────────────────
            // FIX #2: removed \s from path capture group — paths with spaces now work.
            const writeMatch = /<write\s+path=["']?([^"'>]+?)["']?\s*>([\s\S]*?)<\/write>/i.exec(buffer);
            if (writeMatch) {
                const filePath = writeMatch[1].trim();
                const content = writeMatch[2];

                if (isSecretPath(filePath)) {
                    const msg = 'Access denied: this file is protected and cannot be read or modified by the agent.';
                    callbacks.onToken(`\n\n> ⛔ **Blocked:** ${msg}`);
                    toolOutputs.push(`<write_result path="${filePath}" status="error">\n${msg}\n</write_result>`);
                    buffer = buffer.slice(writeMatch.index + writeMatch[0].length);
                    changed = true;
                    continue;
                }

                const isFullAccess = mode === 'full';
                const allowed = isFullAccess 
                    ? true 
                    : (askPermission ? await askPermission('fileWrite', `Write to \`${filePath}\``) : true);
                if (!allowed) {
                    callbacks.onToken(`\n\n> ⛔ **Blocked:** File write to \`${filePath}\` was denied.`);
                } else {
                    // ── TASK 3: Workspace trust gate ─────────────────────────────────
                    const isTrusted = vscode.workspace.isTrusted;
                    const writeEnabled = vscode.workspace
                        .getConfiguration('kairos').get('enableFileWrite', true);

                    if (!isTrusted || !writeEnabled) {
                        const denyMsg = 'File write is disabled in untrusted workspaces or by ' +
                            'settings. Enable it in VS Code settings under kairos.enableFileWrite.';
                        callbacks.onToken(`\n\n> ⛔ **Blocked:** ${denyMsg}`);
                        toolOutputs.push(
                            `<write_result path="${filePath}" status="denied">\n${denyMsg}\n</write_result>`
                        );
                    } else {
                        callbacks.onToken(`\n\n> 📥 **Pending Change:** \`${filePath}\` (Review below)`);
                        if (callbacks.onFilePending) {
                            callbacks.onFilePending(filePath, content);
                        }
                        toolOutputs.push(`<write_result path="${filePath}" status="pending_review" />`);
                    }
                }
                buffer = buffer.slice(writeMatch.index + writeMatch[0].length);
                changed = true;
                continue;
            }

            // ── 4. <list [recursive="true"] [maxDepth="N"]>dirPath</list> ─────
            const listMatch = /<list(\s[^>]*)?>([\ s\S]*?)<\/list>/i.exec(buffer);
            if (listMatch) {
                const attrs = listMatch[1] || '';
                const dirPath = (listMatch[2] || '').trim() || '.';
                const isRecursive = /recursive\s*=\s*["']?true["']?/i.test(attrs);
                const depthAttr = /maxDepth\s*=\s*["']?(\d+)["']?/i.exec(attrs);
                const maxDepth = depthAttr ? parseInt(depthAttr[1], 10) : undefined;

                const label = isRecursive ? ' (recursive)' : '';
                callbacks.onToken(`\n\n> 📁 **Listing:** \`${dirPath}\`${label}…`);
                try {
                    const listing = await fsTools.listFiles(dirPath, { recursive: isRecursive, maxDepth });
                    callbacks.onToken(`\n\`\`\`\n${listing}\n\`\`\``);
                    toolOutputs.push(
                        `<list_result path="${dirPath}" recursive="${isRecursive}">\n${listing}\n</list_result>`
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    callbacks.onToken(` ❌ Failed: ${msg}`);
                }
                buffer = buffer.slice(listMatch.index + listMatch[0].length);
                changed = true;
                continue;
            }

            // ── 5. <ask_ai> — sequential brain switch (Steps 6–9) ───────────
            const askAiMatch = /<ask_ai\s+model="([^"]+)">([\s\S]*?)<\/ask_ai>/i.exec(buffer);
            if (askAiMatch) {
                const targetAlias = askAiMatch[1].trim();
                const subPrompt   = askAiMatch[2].trim();

                // Depth guard — fallback to inline message on overflow
                if (!this.brainController.canSwitch()) {
                    const depth = this.brainController.getSwitchDepth();
                    const max   = this.brainController.getMaxSwitches();
                    const msg = `[BrainSwitch] Max depth (${max}) reached after ${depth} switches. ` +
                                `Cannot load ${targetAlias}. Handle this sub-task directly.`;
                    toolOutputs.push(`<ai_result model="${targetAlias}">\n${msg}\n</ai_result>`);
                    buffer = buffer.slice(askAiMatch.index + askAiMatch[0].length);
                    changed = true;
                    continue;
                }

                // Signal agentLoop to abort the current stream and run a brain switch
                if (onBrainSwitch) {
                    onBrainSwitch({
                        targetAlias,
                        subPrompt,
                        msgsSnapshot: messages.map(m => ({ ...m })),
                    });
                }

                // Stop processing further tools so the stream exits cleanly
                buffer = '';
                changed = false;
                break;
            }
        }

        // Keep only content that COULD be the start of an incomplete tag
        // (to avoid dispatching a prefix like "<exe" before we've seen "</execute>")
        if (!flushAll && buffer.includes('<')) {
            const lastTagStart = buffer.lastIndexOf('<');
            // If there's a potential open tag in the tail, hold it in the buffer
            const tail = buffer.slice(lastTagStart);
            const isIncomplete = !tail.includes('>') || (
                /^<(execute|read|write|list)/i.test(tail) && !/<\/(execute|read|write|list)>/i.test(tail)
            );
            if (isIncomplete) {
                // Feed the safe prefix to caller, hold the incomplete tail
                return tail;
            }
        }

        return buffer;
    }

    private emitStatus(text: string, callbacks: OrchestratorCallbacks): void {
        if (callbacks.onStatus) {
            callbacks.onStatus(text, true);
        }
    }

    private async runInterceptors(
        messages: ChatMessage[],
        modelAlias: ModelAlias,
        callbacks: OrchestratorCallbacks
    ): Promise<ChatMessage[]> {
        const supportsVision = MODELS[modelAlias]?.supportsVision === true;
        let hasImage = false;
        
        for (const msg of messages) {
            if (Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'image_url')) {
                hasImage = true;
                break;
            }
        }

        if (!hasImage || supportsVision) {
            return messages;
        }

        const newMessages: ChatMessage[] = [];
        for (const msg of messages) {
            if (Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'image_url')) {
                const imageItems = msg.content.filter((c: any) => c.type === 'image_url');
                
                try {
                    const result = await this.client.complete(
                        DEFAULT_VISION_MODEL,
                        [{
                            role: 'user',
                            content: [
                                ...imageItems,
                                {
                                    type: 'text',
                                    text: 'Describe this image in deep technical detail. Focus on UI structure, code snippets, diagrams, or any visible text. Be precise.'
                                }
                            ]
                        }],
                        { max_tokens: 1000, temperature: 0.1 }
                    );

                    const trimmedResult = result.split(' ').slice(0, 1500).join(' ');
                    
                    const newContent = msg.content.map((c: any) => {
                        if (c.type === 'image_url') {
                            return {
                                type: 'text',
                                text: `<vision_extraction>${trimmedResult}</vision_extraction>`
                            };
                        }
                        return c;
                    });
                    
                    newMessages.push({ ...msg, content: newContent as any });
                    this.emitStatus('[vision extracted via gemini-2.5-flash]', callbacks);
                } catch (err) {
                    logger.error('Vision extraction failed', err);
                    newMessages.push(msg); // fallback to original
                }
            } else {
                newMessages.push(msg);
            }
        }

        return newMessages;
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
        if (mode === 'full') { return 'HIGH'; } // Full access implies autonomous confidence
        if (mode === 'fast') { return 'MEDIUM'; } // Fast responses are less verified
        
        if (c.intent === 'AMBIGUOUS' || c.complexityLevel === 'COMPLEX') {
            return 'LOW';
        }
        if (c.complexityLevel === 'MODERATE' || c.risks.length > 0) {
            return 'MEDIUM';
        }
        return 'HIGH';
    }

    private estimateTokens(
        systemPrompt: string,
        history: ChatMessage[],
        userMessage: string | any[]
    ): number {
        const historyChars = history.reduce((sum, m) => {
            const len = typeof m.content === 'string'
                ? m.content.length
                : JSON.stringify(m.content).length;
            return sum + len;
        }, 0);
        const userLen = typeof userMessage === 'string'
            ? userMessage.length
            : JSON.stringify(userMessage).length;
        const total = systemPrompt.length + historyChars + userLen;
        return Math.ceil(total / CHARS_PER_TOKEN);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
