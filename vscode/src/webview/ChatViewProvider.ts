import * as vscode from 'vscode';
import { AgentOrchestrator, AgentMetadata } from '../agent/orchestrator';
import { collectWorkspaceContext } from '../utils/workspace';
import { invalidateSystemPromptCache } from '../litellm/systemPrompt';
import { ChatMessage } from '../litellm/client';
import { logger } from '../utils/logger';

/** Messages from the webview → extension */
type InboundMessage =
    | { type: 'userMessage'; text: string; mode: string, reasoningLevel: number }
    | { type: 'clearChat' }
    | { type: 'ready' }
    | { type: 'openSettings' };

/** Messages from the extension → webview */
type OutboundMessage =
    | { type: 'token'; content: string }
    | { type: 'done'; metadata: AgentMetadata }
    | { type: 'error'; message: string }
    | { type: 'systemMessage'; text: string }
    | { type: 'clear' };

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kairos.chatView';

    private _view?: vscode.WebviewView;
    private _orchestrator?: AgentOrchestrator;
    /** Conversation history — persists for the session */
    private _history: ChatMessage[] = [];
    private _isStreaming = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        // Watch for config changes so orchestrator is rebuilt with new creds
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('KAIROS')) {
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

    public async sendPrompt(prompt: string, mode = 'agent', reasoningLevel = 2): Promise<void> {
        if (!this._view) {
            await vscode.commands.executeCommand('KAIROS.chatView.focus');
            // Give the webview time to mount
            await sleep(300);
        }
        if (!this._view) {
            vscode.window.showErrorMessage('KAIROS: Could not open chat panel.');
            return;
        }
        await this._processUserMessage(prompt, mode, reasoningLevel);
    }

    public clearChat(): void {
        this._history = [];
        this._post({ type: 'clear' });
    }

    // ── Message handling ──────────────────────────────────────────────────────

    private async _handleMessage(message: InboundMessage): Promise<void> {
        switch (message.type) {
            case 'userMessage':
                await this._processUserMessage(message.text, message.mode, message.reasoningLevel);
                break;
            case 'clearChat':
                this.clearChat();
                break;
            case 'ready':
                this._post({
                    type: 'systemMessage',
                    text: '**KAIROS AI** is ready. Select a mode and start building.',
                });
                break;
            case 'openSettings':
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'KAIROS'
                );
                break;
        }
    }

    private async _processUserMessage(text: string, mode: string, reasoningLevel: number): Promise<void> {
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

            await orchestrator.process(trimmed, ctx, this._history, {
                onToken: (content) => {
                    this._post({ type: 'token', content });
                },
                onDone: (metadata) => {
                    this._isStreaming = false;
                    this._history.push({ role: 'user', content: trimmed });
                    this._post({ type: 'done', metadata });
                },
                onError: (message) => {
                    this._isStreaming = false;
                    this._post({ type: 'error', message });
                    logger.error(`[Orchestrator] ${message}`);
                },
            }, { mode, reasoningLevel });
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
            const config = vscode.workspace.getConfiguration('KAIROS');
            const baseUrl = config.get<string>('litellmBaseUrl', 'http://localhost:4000');
            const apiKey = config.get<string>('litellmApiKey', 'sk-KAIROS');
            const timeoutMs = config.get<number>('autoSelectFamilyTimeout', 1000);
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
        const nonce = getNonce();

        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css')
        );
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js')
        );

        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
            `script-src 'nonce-${nonce}'`,
            `img-src ${webview.cspSource} data: https:`,
            `font-src ${webview.cspSource} data: https://fonts.gstatic.com`,
        ].join('; ');

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KAIROS AI</title>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="app">
    <header id="top-bar">
      <div id="top-left-icons">
        <button class="icon-btn" title="Files"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14,2H6C4.89,2 4,2.89 4,4V20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20V8L14,2M13,9V3.5L18.5,9H13Z"/></svg></button>
        <button class="icon-btn" title="Terminal"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20,19H4V5H20M20,3H4C2.89,3 2,3.89 2,5V19C2,20.11 2.89,21 4,21H20C21.11,21 22,20.11 22,19V5C22,3.89 21.11,3 20,3M13,17H17V15H13V17M9.58,13L12,10.59L9.58,8.17L8.17,9.58L9.17,10.59L8.17,11.59L9.58,13Z"/></svg></button>
        <button class="icon-btn" title="Modules"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21,16.5C21,16.88 20.79,17.21 20.47,17.38L12.57,21.82C12.41,21.94 12.21,22 12,22C11.79,22 11.59,21.94 11.43,21.82L3.53,17.38C3.21,17.21 3,16.88 3,16.5V7.5C3,7.12 3.21,6.79 3.53,6.62L11.43,2.18C11.59,2.06 11.79,2 12,2C12.21,2 12.41,2.06 12.57,2.18L20.47,6.62C20.79,6.79 21,7.12 21,7.5V16.5Z"/></svg></button>
        <button class="icon-btn" title="Web"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.36,14C16.44,13.34 16.5,12.68 16.5,12C16.5,11.32 16.44,10.66 16.36,10H19.74C19.9,10.64 20,11.31 20,12C20,12.69 19.9,13.36 19.74,14M14.59,19.56C15.19,18.45 15.65,17.25 15.97,16H18.92C17.96,17.65 16.43,18.93 14.59,19.56M14.34,14H9.66C9.56,13.34 9.5,12.68 9.5,12C9.5,11.32 9.56,10.66 9.66,10H14.34C14.44,10.66 14.5,11.32 14.5,12C14.5,12.68 14.44,13.34 14.34,14M12,19.96C11.17,18.76 10.5,17.43 10.09,16H13.91C13.5,17.43 12.83,18.76 12,19.96M8,12C8,12.68 8.06,13.34 8.14,14H4.26C4.1,13.36 4,12.69 4,12C4,11.31 4.1,10.64 4.26,10H8.14C8.06,10.66 8,11.32 8,12M4.08,6.5H7.74C8.28,5.17 8.97,3.91 9.81,2.82C8,3.45 6.43,4.78 5.38,6.5M10.12,2.29L10.12,2.29C11.53,4.83 12.33,7.76 12.5,10.84C12.52,11.23 12.5,11.62 12.5,12C12.5,12.38 12.52,12.77 12.5,13.16C12.33,16.24 11.53,19.17 10.12,21.71L10.12,21.71L10.11,21.72C9.46,19.23 9,16.63 8.78,14H6V10H8.78C9,7.37 9.46,4.77 10.11,2.28L10.11,2.28L10.12,2.29M12,2.04C12.83,3.24 13.5,4.57 13.91,6H10.09C10.5,4.57 11.17,3.24 12,2.04M18.92,8H15.97C15.65,6.75 15.19,5.55 14.59,4.44C16.43,5.07 17.96,6.35 18.92,8Z"/></svg></button>
      </div>
      <div id="top-right-actions">
        <button id="btn-review" class="review-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
          Review Changes
        </button>
      </div>
    </header>

    <main id="messages"></main>

    <footer id="chat-container">
      <div id="input-box">
        <textarea
          id="user-input"
          placeholder="Ask anything, @ to mention, / for workflows"
          rows="1"
        ></textarea>
        
        <div id="controls-row">
          <div id="left-controls">
            <button class="control-btn plus-btn"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/></svg></button>
            <button class="selector-btn" id="mode-selector-btn">
              <span>Fast</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z"/></svg>
            </button>
            <button class="selector-btn" id="model-selector-btn">
              <span>Gemini 3 Flash</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z"/></svg>
            </button>
          </div>
          
          <div id="right-controls">
            <button class="control-btn mic-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z"/></svg></button>
            <button id="btn-send" class="stop-btn">
              <div class="stop-icon"></div>
            </button>
          </div>
        </div>
      </div>
    </footer>
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
