import * as vscode from 'vscode';
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
    | { type: 'openArtifacts' };

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
    | { type: 'replayAssistant'; text: string };

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kairos.chatView';

    private _view?: vscode.WebviewView;
    private _orchestrator?: AgentOrchestrator;
    /** Conversation history — persists for the session */
    private _history: ChatMessage[] = [];
    private _sessionId: string = Date.now().toString();
    private _isStreaming = false;

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
            case 'openTerminal':
                vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
                break;
            case 'openChanges':
                vscode.commands.executeCommand('workbench.view.scm');
                break;
            case 'reviewChanges':
                vscode.commands.executeCommand('workbench.action.compareEditor.nextChange').then(
                    () => {},
                    () => vscode.commands.executeCommand('git.openAllChanges')
                );
                break;
            case 'openWeb':
                vscode.env.openExternal(vscode.Uri.parse('https://google.com'));
                break;
            case 'openArtifacts':
                vscode.commands.executeCommand('workbench.view.explorer');
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
            }, { mode, model, reasoningLevel });
        } catch (err) {
            this._isStreaming = false;
            const msg = err instanceof Error ? err.message : String(err);
            this._post({ type: 'error', message: msg });
            logger.error('Unexpected error in _processUserMessage', err);
        }
    }

    private _post(message: OutboundMessage): void {
        this._view?.webview.postMessage(message);
    }

    private _getOrchestrator(): AgentOrchestrator {
        if (!this._orchestrator) {
            // BUG-FIX 2: use lowercase 'kairos' to match package.json configuration key
            const config = vscode.workspace.getConfiguration('kairos');
            const baseUrl = config.get<string>('litellmBaseUrl', 'https://kairos-litellm.onrender.com');
            const apiKey = config.get<string>('litellmApiKey', 'sk-KAIROS');
            const timeoutMs = config.get<number>('autoSelectFamilyTimeout', 30000);
            this._orchestrator = new AgentOrchestrator(
                this._extensionUri,
                baseUrl,
                apiKey,
                timeoutMs
            );
            logger.info(`[ChatViewProvider] Orchestrator created (baseUrl=${baseUrl})`);
        }
        return this._orchestrator;
    }

    // ── HTML generation ───────────────────────────────────────────────────────

    private _getHtml(webview: vscode.Webview): string {
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com; script-src 'nonce-${nonce}' ${webview.cspSource} https://cdn.tailwindcss.com 'unsafe-inline'; font-src ${webview.cspSource} https://fonts.gstatic.com; img-src ${webview.cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script nonce="${nonce}">
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: { colors: { primary: '#b8a9ff', 'primary-dark': '#8b5cf6' } } }
    };
  </script>
  <link rel="stylesheet" href="${cssUri}">
  <style>:root { color-scheme: dark; }</style>
</head>
<body>
<div id="app">
  <!-- History Sidebar -->
  <div id="history-sidebar">
    <div class="history-header">
      <div class="history-title">
        <span class="material-symbols-outlined">history</span>
        <span>History</span>
      </div>
      <button id="btn-close-history" class="icon-btn" title="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div id="history-list-container" style="flex:1;overflow-y:auto;padding:8px;"></div>
  </div>

  <!-- Main Panel -->
  <div id="panel">
    <!-- Top Bar -->
    <div id="top-bar">
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="btn-history"  class="icon-btn" title="Chat History"><span class="material-symbols-outlined">history</span></button>
        <button id="btn-new-chat" class="icon-btn" title="New Chat"><span class="material-symbols-outlined">add_comment</span></button>
      </div>
      <div class="top-bar-center">Kairos Agent</div>
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="btn-clear"    class="icon-btn" title="Clear chat"><span class="material-symbols-outlined">delete_sweep</span></button>
        <button id="btn-settings" class="icon-btn" title="Settings"><span class="material-symbols-outlined">tune</span></button>
      </div>
    </div>

    <!-- Action Bar -->
    <div id="action-bar">
      <div style="display:flex;align-items:center;gap:2px;">
        <button id="btn-changes" class="action-icon-btn" title="Source Control / Changes">
          <span class="material-symbols-outlined" style="font-size:17px;">description</span>
          <span id="changes-badge" class="action-dot" style="background:#64748b;display:none;"></span>
        </button>
        <button id="btn-terminal" class="action-icon-btn" title="Toggle Terminal">
          <span class="material-symbols-outlined" style="font-size:17px;">terminal</span>
        </button>
        <button id="btn-artifacts" class="action-icon-btn" title="Explorer / Artifacts">
          <span class="material-symbols-outlined" style="font-size:17px;">layers</span>
          <span class="action-dot" style="background:#3b82f6;"></span>
        </button>
        <button id="btn-web" class="action-icon-btn" title="Open Web Browser">
          <span class="material-symbols-outlined" style="font-size:17px;">public</span>
        </button>
      </div>
      <button id="btn-review-changes" style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.04);color:var(--text-dim);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font);letter-spacing:0.04em;text-transform:uppercase;">
        <span class="material-symbols-outlined" style="font-size:13px;">checklist</span>
        Review Changes
      </button>
    </div>

    <!-- Messages -->
    <div id="messages"></div>

    <!-- Input Section -->
    <div id="input-section">
      <div class="input-container">
        <div class="input-row">
          <textarea id="user-input" rows="1" placeholder="Ask anything… @ to mention, / for commands"></textarea>
        </div>
        <div class="input-controls-row">
          <div class="controls-left">
            <!-- Upload -->
            <div class="upload-group">
              <button id="btn-file-upload"  class="upload-btn" title="Attach file"><span class="material-symbols-outlined">note_add</span></button>
              <div class="upload-divider"></div>
              <button id="btn-image-upload" class="upload-btn" title="Attach image"><span class="material-symbols-outlined">image</span></button>
            </div>
            <input type="file" id="file-input"  multiple style="display:none;">
            <input type="file" id="image-input" accept="image/png,image/jpeg,image/webp" style="display:none;">

            <div class="ctrl-sep"></div>

            <!-- Mode -->
            <div style="position:relative;">
              <div id="mode-selector-btn" class="selector-pill">
                <span class="material-symbols-outlined">bolt</span>
                <span id="mode-text">Fast</span>
                <span class="material-symbols-outlined" style="font-size:12px;opacity:0.5;">expand_more</span>
              </div>
              <div id="mode-dropdown" class="dropdown-panel hidden">
                <div class="dropdown-inner" id="mode-list"></div>
              </div>
            </div>

            <!-- Model -->
            <div style="position:relative;">
              <div id="model-selector-btn" class="selector-pill">
                <span class="material-symbols-outlined">neurology</span>
                <span id="model-text">Qwen 3 Coder</span>
                <span class="material-symbols-outlined" style="font-size:12px;opacity:0.5;">expand_more</span>
              </div>
              <div id="model-dropdown" class="dropdown-panel wide hidden">
                <div class="dropdown-inner" id="model-list"></div>
              </div>
            </div>

            <!-- Reasoning -->
            <div id="reasoning-selector-btn" class="selector-pill hidden">
              <span class="material-symbols-outlined">psychology</span>
              <span id="reasoning-text">Med</span>
            </div>
          </div>

          <div class="controls-right">
            <span id="token-counter"></span>
            <button id="btn-stop" class="hidden" title="Stop generation">
              <span class="material-symbols-outlined" style="font-size:16px;">stop</span>
            </button>
            <button id="btn-send" title="Send (Enter)">
              <span class="material-symbols-outlined">arrow_upward</span>
            </button>
          </div>
        </div>
      </div>
      <div id="input-footer">✦ Kairos AI · Powered by LiteLLM Proxy</div>
    </div>
  </div>

</div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
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
