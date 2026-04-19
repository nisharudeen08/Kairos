import * as vscode from 'vscode';
import * as fs from 'fs';
import { AgentOrchestrator, AgentMetadata } from '../agent/orchestrator';
import { collectWorkspaceContext } from '../utils/workspace';
import { invalidateSystemPromptCache } from '../litellm/systemPrompt';
import { ChatMessage } from '../litellm/client';
import { logger } from '../utils/logger';

/** Messages from the webview → extension */
type InboundMessage =
    | { type: 'userMessage'; text: string; mode: string; model: string; reasoningLevel: number; images?: string[] }
    | { type: 'clearChat' }
    | { type: 'ready' }
    | { type: 'openSettings' }
    | { type: 'acceptFile'; path: string; content: string }
    | { type: 'getHistory' }
    | { type: 'loadSession'; id: string }
    | { type: 'openTerminal' }
    | { type: 'openChanges' }
    | { type: 'reviewChanges' }
    | { type: 'openWeb' }
    | { type: 'openArtifacts' }
    | { type: 'deleteSession'; id: string }
    | { type: 'permissionGrant'; scope: 'terminal' | 'fileWrite'; level: 'once' | 'session' };

export interface ChatSession {
    id: string;
    title: string;
    updatedAt: number;
    history: ChatMessage[];
}

/** Messages from the extension → webview */
type OutboundMessage =
    | { type: 'token'; content: string }
    | { type: 'done'; metadata: AgentMetadata }
    | { type: 'error'; message: string }
    | { type: 'systemMessage'; text: string }
    | { type: 'clear' }
    | { type: 'fileChange'; path: string; content: string }
    | { type: 'historyList'; sessions: ChatSession[] }
    | { type: 'replayUser'; text: string }
    | { type: 'replayAssistant'; text: string }
    | { type: 'permissionRequest'; scope: 'terminal' | 'fileWrite'; detail: string };

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kairos.chatView';

    private _view?: vscode.WebviewView;
    private _orchestrator?: AgentOrchestrator;
    /** Conversation history — persists for the session */
    private _history: ChatMessage[] = [];
    private _sessionId: string = Date.now().toString();
    private _isStreaming = false;

    /** Session-level permission grants: 'none' | 'once' | 'session' */
    private _terminalPermission: 'none' | 'session' = 'none';
    private _fileWritePermission: 'none' | 'session' = 'none';
    /** Pending permission resolvers waiting for user response from webview */
    private _pendingPermissions: Map<string, (granted: boolean) => void> = new Map();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        // Watch for config changes so orchestrator is rebuilt with new creds
        vscode.workspace.onDidChangeConfiguration((e) => {
            // BUG-FIX 2: config key must be lowercase 'kairos' to match package.json
            if (e.affectsConfiguration('kairos')) {
                this._orchestrator = undefined;
            }
        });

        // Invalidate system prompt cache when the .md file is saved
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.fileName.endsWith('KAIROS_master_system_prompt.md')) {
                invalidateSystemPromptCache();
                logger.info('System prompt cache invalidated (file saved)');
            }
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        logger.info(`[KAIROS] resolveWebviewView triggered - initializing chat UI`);
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'out'),
            ],
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (message: InboundMessage) => this._handleMessage(message),
            undefined,
            this._context.subscriptions
        );

        logger.info('ChatViewProvider: webview resolved');
    }

    // ── Public API (used by commands) ─────────────────────────────────────────

    public async sendPrompt(prompt: string, mode = 'agent', model = 'qwen3-coder', reasoningLevel = 2): Promise<void> {
        if (!this._view) {
            await vscode.commands.executeCommand('KAIROS.chatView.focus');
            // Give the webview time to mount
            await sleep(300);
        }
        if (!this._view) {
            vscode.window.showErrorMessage('KAIROS: Could not open chat panel.');
            return;
        }
        await this._processUserMessage(prompt, mode, model, reasoningLevel);
    }

    public clearChat(): void {
        this._saveCurrentSession();
        this._history = [];
        this._sessionId = Date.now().toString();
        this._post({ type: 'clear' });
    }

    private _saveCurrentSession() {
        if (this._history.length === 0) return;
        
        let sessions = this._context.workspaceState.get<ChatSession[]>('kairos_sessions') || [];
        const existingIndex = sessions.findIndex(s => s.id === this._sessionId);
        
        // Use first user message as title
        const titleMatch = this._history.find(h => h.role === 'user');
        const contentStr = typeof titleMatch?.content === 'string' 
            ? titleMatch.content 
            : (Array.isArray(titleMatch?.content) && titleMatch.content[0] && 'text' in titleMatch.content[0])
                ? (titleMatch.content[0] as { text: string }).text
                : 'New Conversation';
            
        const title = contentStr.substring(0, 30) + '...';

        const session: ChatSession = {
            id: this._sessionId,
            title,
            updatedAt: Date.now(),
            history: [...this._history]
        };

        if (existingIndex >= 0) {
            sessions[existingIndex] = session;
        } else {
            sessions.unshift(session); // Add to front
        }

        // Keep last 20
        sessions = sessions.slice(0, 20);
        this._context.workspaceState.update('kairos_sessions', sessions);
    }

    // ── Message handling ──────────────────────────────────────────────────────

    private async _handleMessage(message: InboundMessage): Promise<void> {
        switch (message.type) {
            case 'userMessage':
                await this._processUserMessage(message.text, message.mode, message.model, message.reasoningLevel, message.images);
                break;
            case 'clearChat':
                this.clearChat();
                break;
            case 'ready':
                // Restore current session history so the user doesn't lose context
                // when the webview panel is closed and reopened
                if (this._history.length > 0) {
                    for (const msg of this._history) {
                        if (msg.role === 'user') {
                            const textContent = typeof msg.content === 'string'
                                ? msg.content
                                : (msg.content as Array<{type:string,text?:string}>).find(p => p.type === 'text')?.text || '';
                            this._post({ type: 'replayUser', text: textContent });
                        } else if (msg.role === 'assistant') {
                            const text = typeof msg.content === 'string' ? msg.content : '';
                            this._post({ type: 'replayAssistant', text });
                        }
                    }
                    this._post({ type: 'systemMessage', text: '🔄 Session restored.' });
                }
                break;
            case 'openSettings':
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'kairos'
                );
                break;
            case 'acceptFile':
                const { fsTools } = require('../utils/terminal');
                await fsTools.writeFile(message.path, message.content);
                this._post({ type: 'systemMessage', text: `✅ File updated: ${message.path}` });
                break;
            case 'getHistory':
                const sessions = this._context.workspaceState.get<ChatSession[]>('kairos_sessions') || [];
                this._post({ type: 'historyList', sessions });
                break;
            case 'loadSession':
                const allSessions = this._context.workspaceState.get<ChatSession[]>('kairos_sessions') || [];
                const targetSession = allSessions.find(s => s.id === message.id);
                if (targetSession) {
                    this._saveCurrentSession();
                    this._history = [...targetSession.history];
                    this._sessionId = targetSession.id;
                    this._post({ type: 'clear' });
                    // Replay each message visually so the user can see the conversation
                    for (const msg of targetSession.history) {
                        if (msg.role === 'user') {
                            const textContent = typeof msg.content === 'string'
                                ? msg.content
                                : (msg.content as Array<{type:string,text?:string}>).find(p => p.type === 'text')?.text || '';
                            this._post({ type: 'replayUser', text: textContent });
                        } else if (msg.role === 'assistant') {
                            const text = typeof msg.content === 'string' ? msg.content : '';
                            this._post({ type: 'replayAssistant', text });
                        }
                    }
                    this._post({ type: 'systemMessage', text: `📖 Loaded: <strong>${targetSession.title}</strong> — the AI remembers this context.` });
                }
                break;
            case 'deleteSession':
                let sessionsList = this._context.workspaceState.get<ChatSession[]>('kairos_sessions') || [];
                sessionsList = sessionsList.filter(s => s.id !== message.id);
                this._context.workspaceState.update('kairos_sessions', sessionsList);
                
                // If they deleted the currently active session, clear the screen
                if (this._sessionId === message.id) {
                    this.clearChat();
                }
                break;
            case 'openTerminal':
                // Toggle terminal in the bottom panel (doesn't close sidebar on most setups)
                vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
                // Refocus chat after a brief delay so panel open animation doesn't steal focus
                setTimeout(() => vscode.commands.executeCommand('kairos.chatView.focus'), 300);
                break;
            case 'openChanges':
                // Open SCM in a new editor group instead of sidebar to avoid stealing focus
                vscode.commands.executeCommand('workbench.view.scm').then(() => {
                    setTimeout(() => vscode.commands.executeCommand('kairos.chatView.focus'), 200);
                });
                break;
            case 'reviewChanges':
                vscode.commands.executeCommand('workbench.action.compareEditor.nextChange').then(
                    () => setTimeout(() => vscode.commands.executeCommand('kairos.chatView.focus'), 200),
                    () => vscode.commands.executeCommand('git.openAllChanges').then(
                        () => setTimeout(() => vscode.commands.executeCommand('kairos.chatView.focus'), 200)
                    )
                );
                break;
            case 'openWeb':
                vscode.env.openExternal(vscode.Uri.parse('https://google.com'));
                break;
            case 'openArtifacts':
                // Open explorer without collapsing chat: open file tree in a floating way
                vscode.commands.executeCommand('workbench.view.explorer').then(() => {
                    setTimeout(() => vscode.commands.executeCommand('kairos.chatView.focus'), 200);
                });
                break;
            case 'permissionGrant':
                // Resolve any pending permission promise
                const resolver = this._pendingPermissions.get(message.scope);
                if (resolver) {
                    resolver(true);
                    this._pendingPermissions.delete(message.scope);
                }
                // Optionally persist for the session
                if (message.level === 'session') {
                    if (message.scope === 'terminal') this._terminalPermission = 'session';
                    if (message.scope === 'fileWrite') this._fileWritePermission = 'session';
                }
                break;
        }
    }

    private async _processUserMessage(text: string, mode: string, model: string, reasoningLevel: number, images: string[] = []): Promise<void> {
        if (this._isStreaming) {
            this._post({
                type: 'systemMessage',
                text: '⏳ Please wait for the current response to finish.',
            });
            return;
        }

        const trimmed = text.trim();
        if (!trimmed) {
            return;
        }

        // Agent modes grant full bypass — pre-approve terminal and file writes for the session
        if (mode === 'agent' || mode === 'agent-full') {
            this._terminalPermission = 'session';
            this._fileWritePermission = 'session';
        }

        this._isStreaming = true;

        try {
            const orchestrator = this._getOrchestrator();
            const ctx = await collectWorkspaceContext();

            let userContent: any = trimmed;
            if (images && images.length > 0) {
                userContent = [{ type: 'text', text: trimmed }];
                for (const img of images) {
                    userContent.push({ type: 'image_url', image_url: { url: img } });
                }
            }

            let fullResponse = '';
            await orchestrator.process(userContent, ctx, this._history, {
                onToken: (content) => {
                    fullResponse += content;
                    this._post({ type: 'token', content });
                },
                onDone: (metadata) => {
                    this._isStreaming = false;
                    this._history.push({ role: 'user', content: userContent });
                    this._history.push({ role: 'assistant', content: fullResponse });
                    this._saveCurrentSession();
                    this._post({ type: 'done', metadata });
                },
                onFilePending: (path, content) => {
                    this._post({ type: 'fileChange', path, content });
                },
                onError: (message) => {
                    this._isStreaming = false;
                    this._post({ type: 'error', message });
                    logger.error(`[Orchestrator] ${message}`);
                },
                onPermissionRequest: async (scope: 'terminal' | 'fileWrite', detail: string) => {
                    // Agent mode: always granted (no prompt)
                    if (mode === 'agent') return true;
                    // Session permission already granted
                    if (scope === 'terminal' && this._terminalPermission === 'session') return true;
                    if (scope === 'fileWrite' && this._fileWritePermission === 'session') return true;
                    // Ask the user via the chat UI
                    return this._requestPermission(scope, detail);
                },
            }, { mode, model, reasoningLevel });
        } catch (err) {
            this._isStreaming = false;
            const msg = err instanceof Error ? err.message : String(err);
            this._post({ type: 'error', message: msg });
            logger.error('Unexpected error in _processUserMessage', err);
        }
    }

    /**
     * Sends a permission request to the webview and waits for the user
     * to respond with permissionGrant or to dismiss (deny).
     * Times out after 60 seconds (treat as denial).
     */
    private _requestPermission(scope: 'terminal' | 'fileWrite', detail: string): Promise<boolean> {
        return new Promise((resolve) => {
            // Store resolver for this scope
            this._pendingPermissions.set(scope, resolve);
            // Tell the webview to show the permission dialog
            this._post({ type: 'permissionRequest', scope, detail });
            // Auto-deny after 60s if no response
            setTimeout(() => {
                if (this._pendingPermissions.has(scope)) {
                    this._pendingPermissions.delete(scope);
                    resolve(false);
                }
            }, 60_000);
        });
    }

    private _post(message: OutboundMessage): void {
        this._view?.webview.postMessage(message);
    }

    private _getOrchestrator(): AgentOrchestrator {
        if (!this._orchestrator) {
            // BUG-FIX 2: use lowercase 'kairos' to match package.json configuration key
            const config = vscode.workspace.getConfiguration('kairos');
            const baseUrl = config.get<string>('litellmBaseUrl', 'http://localhost:4000');
            const apiKey = config.get<string>('litellmApiKey', 'sk-KAIROS');
            const timeoutMs = config.get<number>('autoSelectFamilyTimeout', 120000);
            this._orchestrator = new AgentOrchestrator(
                this._extensionUri,
                baseUrl,
                apiKey,
                timeoutMs
            );
        }
        return this._orchestrator;
    }

    private _getHtml(webview: vscode.Webview): string {
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.html');
        const nonce = getNonce();

        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
        
        // Simple template replacement
        html = html.replace(/\${jsUri}/g, jsUri.toString());
        html = html.replace(/\${cssUri}/g, cssUri.toString());
        html = html.replace(/\${nonce}/g, nonce);
        
        return html;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
