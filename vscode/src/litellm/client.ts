import { MODELS, ModelAlias } from './models';
import { logger } from '../utils/logger';
export const LITELLM_BASE_URL = process.env.LITELLM_PROXY_URL ?? "https://kairos-litellm.onrender.com";
export const LITELLM_KEY = process.env.LITELLM_API_KEY ?? "sk-KAIROS"; 
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } }>;
}

export interface StreamChunk {
    content: string;
    reasoning_content?: string;
    thinking?: string;
    done: boolean;
}

export interface LiteLLMError {
    status: number;
    message: string;
    isRetryable: boolean;
}

/**
 * Thin streaming client for the LiteLLM proxy.
 * Uses native fetch + SSE (server-sent events) for token streaming.
 * All model name resolution happens here via the MODELS map.
 */

export function resolveMaxTokens(model: ModelAlias, override?: number): number {
    if (override !== undefined) return override;
    const alias = model.toLowerCase();
    if (alias.includes('qwen') || alias.includes('deepseek') || 
        alias.includes('coder') || alias.includes('nemotron-3')) return 4000;
    if (alias.includes('gemini') || alias.includes('vision') || 
        alias.includes('vl')) return 1000;
    return 2000;
}

function resolveTemperature(override?: number): number {
    return override ?? 0.2;
}

export class LiteLLMClient {
    private readonly timeoutMs: number;

    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        timeoutMs = 120000
    ) {
        this.timeoutMs = timeoutMs;
    }

    /**
     * Streams a chat completion from LiteLLM.
     * Yields `StreamChunk` objects — caller consumes as async iterator.
     *
     * @throws {LiteLLMError} on HTTP error or malformed response
     */
    async *streamChat(
        modelAlias: ModelAlias,
        messages: ChatMessage[],
        signal?: AbortSignal
    ): AsyncGenerator<StreamChunk> {
        const config = MODELS[modelAlias];
        let actualModel = config?.litellmModel || modelAlias;
        let endpoint = `${this.baseUrl}/v1/chat/completions`;
        let headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        // Route all traffic through LiteLLM proxy

        logger.debug(`[LiteLLM] POST ${endpoint} model=${actualModel}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs); // Default auto-select family attempt timeout

        let response: Response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: actualModel,
                    messages,
                    stream: true,
                    temperature: 0.3, // lower = more deterministic (cache-friendly)
                }),
                signal: signal || controller.signal
            });
            clearTimeout(timeout);
        } catch (err) {
            clearTimeout(timeout);
            const msg = (err as any).message || String(err);
            const isTimeout = msg.toLowerCase().includes('abort');
            throw {
                status: 0,
                message: isTimeout 
                    ? `Connection to LiteLLM timed out after ${this.timeoutMs}ms. Is your proxy running at ${this.baseUrl}?`
                    : `Network error reaching LiteLLM at ${this.baseUrl}: ${msg}`,
                isRetryable: true,
            } as LiteLLMError;
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            const isRetryable = response.status === 429 || response.status >= 500;
            throw {
                status: response.status,
                message: `LiteLLM ${response.status} ${response.statusText}: ${body}`,
                isRetryable,
            } as LiteLLMError;
        }

        if (!response.body) {
            throw {
                status: 200,
                message: 'LiteLLM returned empty body with 200 OK — no stream',
                isRetryable: false,
            } as LiteLLMError;
        }

        yield* this.parseSSEStream(response.body!);
    }

    /**
     * Non-streaming single-shot completion (used for quick classification).
     */
    async complete(
        modelAlias: ModelAlias,
        messages: ChatMessage[],
        options?: { max_tokens?: number; temperature?: number }
    ): Promise<string> {
        const config = MODELS[modelAlias];
        let actualModel = config?.litellmModel || modelAlias;
        let endpoint = `${this.baseUrl}/v1/chat/completions`;
        let headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }



        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        async function fetchWithRetry(
            url: string,
            init: RequestInit,
            maxRetries = 3
        ): Promise<Response> {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const res = await fetch(url, init);
                if (res.status === 429) {
                    if (attempt === maxRetries - 1) return res;
                    const wait = Math.pow(2, attempt) * 1000 + Math.random() * 500;
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }
                return res;
            }
            throw new Error('Max retries exceeded');
        }

        try {
            const response = await fetchWithRetry(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: actualModel,
                    messages,
                    stream: false,
                    temperature: resolveTemperature(options?.temperature),
                    max_tokens: resolveMaxTokens(modelAlias, options?.max_tokens),
                }),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(`LiteLLM ${response.status}: ${body}`);
            }

            const json = (await response.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
            };

            return json.choices?.[0]?.message?.content ?? '';
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }

    private async *parseSSEStream(
        body: ReadableStream<Uint8Array>
    ): AsyncGenerator<StreamChunk> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                // Keep the last (potentially incomplete) line in the buffer
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) {
                        continue;
                    }

                    const data = trimmed.slice(5).trim();

                    if (data === '[DONE]') {
                        yield { content: '', done: true };
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data) as any;
                        
                        // TEMP DEBUG — Phase 5 Diagnostic
                        console.log("[DEBUG RAW CHUNK]", JSON.stringify(parsed));
                        console.log("[DEBUG CHUNK TYPE]", typeof parsed);
                        console.log("[DEBUG FINISH REASON]", parsed.choices?.[0]?.finish_reason);
                        console.log("[DEBUG DELTA]", parsed.choices?.[0]?.delta);
                        console.log("[DEBUG TOOL CALLS]", parsed.choices?.[0]?.delta?.tool_calls);

                        const delta = parsed.choices?.[0]?.delta;
                        const content = delta?.content ?? '';
                        const reasoning_content = delta?.reasoning_content ?? '';
                        const thinking = delta?.thinking ?? '';

                        if (content || reasoning_content || thinking) {
                            yield { content, reasoning_content, thinking, done: false };
                        }

                        if (parsed.choices?.[0]?.finish_reason === 'stop') {
                            yield { content: '', done: true };
                            return;
                        }
                    } catch {
                        // Malformed SSE chunk — skip silently and continue
                        logger.debug(`[LiteLLM] Skipped malformed SSE chunk: ${data.slice(0, 80)}`);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield { content: '', done: true };
    }
}
