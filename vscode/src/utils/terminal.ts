import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from './logger';

/**
 * Executes a shell command in a dedicated VS Code terminal named 'Antigravity Output'.
 * If the terminal already exists, it is reused.
 *
 * This provides the 'Full Access' capability requested by the user.
 * 
 * @param command The shell command to execute
 * @param autoRun If true, command starts immediately. If false, it just pastes it.
 */
export async function runTerminalCommand(command: string, autoRun = true): Promise<void> {
    let terminal = vscode.window.terminals.find((t) => t.name === 'Antigravity Output');
    if (!terminal) {
        terminal = vscode.window.createTerminal('Antigravity Output');
    }
    
    terminal.show(true); // Show but don't steal focus
    logger.info(`[Terminal] Executing command: ${command}`);
    terminal.sendText(command, autoRun);
}

/**
 * Simple file-system tools exposed to the agent.
 */
export const fsTools = {
    /** Resolves a path relative to the workspace root if not absolute. */
    resolvePath(filePath: string): vscode.Uri {
        if (path.isAbsolute(filePath)) {
            return vscode.Uri.file(filePath);
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        }
        return vscode.Uri.file(filePath);
    },

    async readFile(filePath: string): Promise<string> {
        const uri = this.resolvePath(filePath);
        const data = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(data);
    },
    
    async writeFile(filePath: string, content: string): Promise<void> {
        const uri = this.resolvePath(filePath);
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    },

    async listFiles(dirPath: string = '.'): Promise<string[]> {
        const uri = this.resolvePath(dirPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        return entries.map(([name, type]) => {
            const typeStr = type === vscode.FileType.Directory ? '/' : '';
            return `${name}${typeStr}`;
        });
    }
};
