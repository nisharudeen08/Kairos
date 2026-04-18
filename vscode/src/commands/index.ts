import * as vscode from 'vscode';
import { ChatViewProvider } from '../webview/ChatViewProvider';
import { collectWorkspaceContext } from '../utils/workspace';
import { logger } from '../utils/logger';

/**
 * Registers all command palette commands.
 * Each context-aware command collects the active selection/file info
 * and pre-fills a focused prompt before handing off to the chat panel.
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    provider: ChatViewProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('kairos.openChat', () => {
            vscode.commands.executeCommand('kairos.chatView.focus');
        }),

        vscode.commands.registerCommand('kairos.clearChat', () => {
            provider.clearChat();
        }),

        vscode.commands.registerCommand('kairos.fix', async () => {
            const ctx = await collectWorkspaceContext();
            const prompt = buildPrompt('fix', ctx);
            await focusAndSend(provider, prompt);
        }),

        vscode.commands.registerCommand('kairos.explain', async () => {
            const ctx = await collectWorkspaceContext();
            const prompt = buildPrompt('explain', ctx);
            await focusAndSend(provider, prompt);
        }),

        vscode.commands.registerCommand('kairos.optimize', async () => {
            const ctx = await collectWorkspaceContext();
            const prompt = buildPrompt('optimize', ctx);
            await focusAndSend(provider, prompt);
        }),

        vscode.commands.registerCommand('kairos.generateTests', async () => {
            const ctx = await collectWorkspaceContext();
            const prompt = buildPrompt('generate tests for', ctx);
            await focusAndSend(provider, prompt);
        }),

        vscode.commands.registerCommand('kairos.refactor', async () => {
            const ctx = await collectWorkspaceContext();
            const prompt = buildPrompt('refactor', ctx);
            await focusAndSend(provider, prompt);
        }),

        vscode.commands.registerCommand('kairos.configure', async () => {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'kairos'
            );
        })
    );

    logger.info('All commands registered');
}

/**
 * Builds a pre-filled, context-aware prompt for a command.
 * Uses the selection if available, otherwise the active file.
 */
function buildPrompt(
    verb: string,
    ctx: Awaited<ReturnType<typeof collectWorkspaceContext>>
): string {
    const file = ctx.activeFile;

    if (file?.selection) {
        return `${verb} the following ${file.language} code from \`${file.relativePath}\`:\n\n\`\`\`${file.language}\n${file.selection}\n\`\`\``;
    }

    if (file) {
        return `${verb} \`${file.relativePath}\` (${file.language}, ${file.totalLines} lines)`;
    }

    return `${verb} the current file`;
}

async function focusAndSend(provider: ChatViewProvider, prompt: string): Promise<void> {
    // Focus the sidebar panel first, then send
    await vscode.commands.executeCommand('kairos.chatView.focus');
    await sleep(200); // allow webview to mount/focus
    await provider.sendPrompt(prompt);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
