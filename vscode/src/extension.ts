import * as vscode from 'vscode';
import { ChatViewProvider } from './webview/ChatViewProvider';
import { registerCommands } from './commands/index';
import { logger } from './utils/logger';

export function activate(context: vscode.ExtensionContext): void {
    logger.info(`Antigravity AI activating (extensionUri=${context.extensionUri.fsPath})`);

    // Register the sidebar webview provider
    const provider = new ChatViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            provider,
            {
                // Keep the webview alive when hidden so chat history persists
                webviewOptions: { retainContextWhenHidden: true },
            }
        )
    );

    // Register all command palette commands
    registerCommands(context, provider);

    // Dispose the logger on deactivation
    context.subscriptions.push({ dispose: () => logger.dispose() });

    logger.info('Antigravity AI activated');
}

export function deactivate(): void {
    logger.info('Antigravity AI deactivated');
}
