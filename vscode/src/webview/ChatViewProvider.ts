import * as vscode from 'vscode';
import { AgentOrchestrator, AgentMetadata } from '../agent/orchestrator';
import { collectWorkspaceContext } from '../utils/workspace';
import { invalidateSystemPromptCache } from '../litellm/systemPrompt';
import { ChatMessage } from '../litellm/client';
import { logger } from '../utils/logger';

/** Messages from the webview → extension */
type InboundMessage =
    | { type: 'userMessage'; text: string; mode: string; model: string; reasoningLevel: number }
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
        this._history = [];
        this._post({ type: 'clear' });
    }

    // ── Message handling ──────────────────────────────────────────────────────

    private async _handleMessage(message: InboundMessage): Promise<void> {
        switch (message.type) {
            case 'userMessage':
                await this._processUserMessage(message.text, message.mode, message.model, message.reasoningLevel);
                break;
            case 'clearChat':
                this.clearChat();
                break;
            case 'ready':
                break;
            case 'openSettings':
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'KAIROS'
                );
                break;
        }
    }

    private async _processUserMessage(text: string, mode: string, model: string, reasoningLevel: number): Promise<void> {
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
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html class="dark" lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com; script-src 'nonce-${nonce}' https://cdn.tailwindcss.com 'unsafe-inline'; font-src ${webview.cspSource} https://fonts.gstatic.com; img-src ${webview.cspSource} https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script nonce="${nonce}">
    console.log('Antigravity UI Redesign v1.3 - Loaded');
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: { 
            primary: '#b8a9ff',
            'primary-dark': '#8b5cf6',
            surface: '#0a0d1a'
          }
        }
      }
    }
  </script>
  <link rel="stylesheet" href="${cssUri}">
  <style>
    :root { color-scheme: dark; }
    body {
      background: radial-gradient(circle at top, rgba(124, 58, 237, 0.12), transparent 25%),
                  linear-gradient(180deg, #090b14 0%, #121826 60%, #0a0d17 100%);
    }
    .glass-panel {
      background: rgba(10, 13, 26, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
    
    /* Hover effects for pills */
    .selector-pill {
      @apply flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-[11px] font-medium text-slate-300 cursor-pointer transition-all hover:bg-white/10 hover:border-white/20 hover:text-white;
    }
    .selector-pill.active {
      @apply bg-primary/20 border-primary/30 text-primary;
    }
  </style>
</head>
<body class="h-screen overflow-hidden flex flex-col p-3 gap-3">
  <div id="panel" class="flex flex-col flex-1 rounded-2xl overflow-hidden glass-panel">
    <!-- Top Bar -->
    <div id="top-bar" class="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/2">
      <div id="title-group" class="flex flex-col">
        <p class="text-[9px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-0.5">Kairos Agent</p>
        <h1 class="text-sm font-bold text-white flex items-center gap-2">
          New Conversation
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <button id="btn-clear" class="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-colors">Clear</button>
        <button id="btn-settings" class="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
          <span class="material-symbols-outlined text-[18px]">tune</span>
        </button>
      </div>
    </div>

    <!-- Messages Area -->
    <div id="messages" class="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
      <!-- Empty State -->
      <div id="empty-state" class="h-full flex flex-col items-center justify-center text-center max-w-[280px] mx-auto space-y-4">
        <div class="w-16 h-16 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-2xl shadow-primary/10">
          <span class="material-symbols-outlined text-[32px]">auto_awesome</span>
        </div>
        <div class="space-y-1">
          <h2 class="text-white font-bold">How can I help today?</h2>
          <p class="text-[12px] text-slate-400 leading-relaxed">I can help you build, test, or debug your codebase using the latest AI models.</p>
        </div>
        <div class="grid grid-cols-1 gap-2 w-full pt-4">
            <div class="p-3 rounded-xl bg-white/2 border border-white/5 text-left flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors group">
                <span class="material-symbols-outlined text-sm text-slate-500 group-hover:text-primary transition-colors">terminal</span>
                <span class="text-[11px] text-slate-400">Explain this file structure</span>
            </div>
             <div class="p-3 rounded-xl bg-white/2 border border-white/5 text-left flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors group">
                <span class="material-symbols-outlined text-sm text-slate-500 group-hover:text-primary transition-colors">bug_report</span>
                <span class="text-[11px] text-slate-400">Find security vulnerabilities</span>
            </div>
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div class="p-4 border-t border-white/5 bg-white/2">
      <div id="input-box" class="relative flex flex-col gap-3 p-3 rounded-2xl bg-[#1a1b26]/60 border border-white/10 focus-within:border-primary/40 focus-within:bg-[#1a1b26]/80 transition-all shadow-inner">
        <!-- Input wrapper -->
        <textarea 
          id="user-input" 
          placeholder="Ask anything, @ to mention, / for workflows" 
          rows="1" 
          style="field-sizing: content;"
          class="w-full bg-transparent border-none focus:ring-0 text-[13px] text-slate-200 placeholder-slate-500 resize-none min-h-[44px] max-h-[180px] py-1 custom-scrollbar"
        ></textarea>

        <!-- Controls Row -->
        <div class="flex items-center justify-between gap-2 pt-1">
          <div class="flex items-center flex-wrap gap-2 flex-1">
            <!-- File Upload -->
            <button id="btn-file-upload" title="Attach context" class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all">
              <span class="material-symbols-outlined text-[20px]">add_circle</span>
            </button>
            <input type="file" id="file-input" multiple style="display: none;" />

            <div class="h-4 w-px bg-white/10 mx-1"></div>

            <!-- Mode Selector -->
            <div class="relative group">
                <div id="mode-selector-btn" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-400 cursor-pointer hover:bg-indigo-500/20 transition-all uppercase tracking-wider">
                    <span class="material-symbols-outlined text-[14px]">bolt</span>
                    <span id="mode-text">Fast</span>
                    <span class="material-symbols-outlined text-[12px] opacity-50 transition-opacity">expand_more</span>
                </div>
                <!-- Mode Dropdown -->
                <div id="mode-dropdown" class="hidden absolute bottom-full mb-2 left-0 w-48 rounded-xl bg-[#1a1b26] border border-white/10 shadow-2xl z-50 overflow-hidden">
                    <div class="p-1" id="mode-list"></div>
                </div>
            </div>

            <!-- Model Selector -->
            <div class="relative group">
                <div id="model-selector-btn" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold text-slate-400 cursor-pointer hover:bg-white/10 hover:border-white/20 transition-all uppercase tracking-wider">
                    <span class="material-symbols-outlined text-[14px]">neurology</span>
                    <span id="model-text">Qwen 3.0</span>
                    <span class="material-symbols-outlined text-[12px] opacity-50 transition-opacity">expand_more</span>
                </div>
                <!-- Model Dropdown -->
                <div id="model-dropdown" class="hidden absolute bottom-full mb-2 left-0 w-64 rounded-xl bg-[#1a1b26] border border-white/10 shadow-2xl z-50 overflow-hidden">
                    <div class="p-1" id="model-list"></div>
                </div>
            </div>

             <!-- Reasoning Selector -->
             <div id="reasoning-selector-btn" class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold text-slate-400 cursor-pointer hover:bg-white/10 transition-all uppercase tracking-wider">
              <span class="material-symbols-outlined text-[14px]">psychology</span>
              <span id="reasoning-text">Med</span>
            </div>
          </div>

          <!-- Send Button (Right Most) -->
          <div class="flex-shrink-0">
            <button id="btn-send" title="Send (Enter)" class="w-9 h-9 flex items-center justify-center rounded-xl bg-primary text-slate-900 border-none hover:scale-105 active:scale-95 transition-all shadow-[0_0_15px_rgba(184,169,255,0.3)] disabled:opacity-50 disabled:hover:scale-100">
               <span class="material-symbols-outlined text-[20px] font-bold">arrow_upward</span>
            </button>
          </div>
        </div>
      </div>
      <!-- Footer Info -->
      <div class="flex items-center justify-center gap-4 mt-3">
        <p class="text-[9px] text-slate-600 font-medium">✨ Connected to Antigravity AI Cloud</p>
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
