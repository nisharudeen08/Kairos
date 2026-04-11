import { MODELS, ModelAlias } from './models';
import { logger } from '../utils/logger';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } }>;
}

export interface StreamChunk {
    content: string;
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
export class LiteLLMClient {
    private readonly timeoutMs: number;

    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string,
        timeoutMs = 1000
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
        messages: ChatMessage[]
    ): AsyncGenerator<StreamChunk> {
        const actualModel = MODELS[modelAlias]?.litellmModel || modelAlias;
        const endpoint = `${this.baseUrl}/v1/chat/completions`;

        logger.debug(`[LiteLLM] POST ${endpoint} model=${actualModel}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs); // Default auto-select family attempt timeout

        let response: Response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: actualModel,
                    messages,
                    stream: true,
                    temperature: 0.3, // lower = more deterministic (cache-friendly)
                }),
                signal: controller.signal
            });
            clearTimeout(timeout);
        } catch (err) {
            clearTimeout(timeout);
            const msg = err instanceof Error ? err.message : String(err);
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

        yield* this.parseSSEStream(response.body);
    }

    /**
     * Non-streaming single-shot completion (used for quick classification).
     */
    async complete(
        modelAlias: ModelAlias,
        messages: ChatMessage[]
    ): Promise<string> {
        const actualModel = MODELS[modelAlias]?.litellmModel || modelAlias;
        const endpoint = `${this.baseUrl}/v1/chat/completions`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: actualModel,
                    messages,
                    stream: false,
                    temperature: 0.1,
                    max_tokens: 50,
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
                        const parsed = JSON.parse(data) as {
                            choices?: Array<{
                                delta?: { content?: string };
                                finish_reason?: string;
                            }>;
                        };

                        const content =
                            parsed.choices?.[0]?.delta?.content ?? '';
                        if (content) {
                            yield { content, done: false };
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
