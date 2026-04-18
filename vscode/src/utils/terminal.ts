import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execAsync = promisify(exec);

/** Max characters of stdout/stderr captured from a command before truncation */
const MAX_OUTPUT_CHARS = 8_000;

/**
 * Executes a shell command in the background using `child_process.exec`.
 *
 * This version RETURNS stdout so the Orchestrator agentic loop can feed
 * command output back into the LLM context (Fix #5).
 *
 * The command is also echoed into a named VS Code terminal for visual feedback,
 * but the return value comes from the real stdout/stderr stream, not the terminal.
 *
 * @param command  Shell command to execute
 * @param showTerminal  If true, mirrors the command in the UI terminal for visibility
 * @returns Resolved stdout (or stderr if stdout is empty) from the command
 * @throws Error with stderr if the process exits non-zero
 */
export async function runTerminalCommand(command: string, showTerminal = true): Promise<string> {
    logger.info(`[Terminal] Executing: ${command}`);

    // Mirror command in the UI terminal for visual feedback (non-blocking)
    if (showTerminal) {
        _mirrorToTerminal(command);
    }

    // Determine the workspace root as the cwd so relative paths work
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            // Large buffer — agent commands may produce verbose output (e.g. npm install)
            maxBuffer: 1024 * 1024 * 10, // 10 MB
            // Give commands up to 2 minutes before timing out
            timeout: 120_000,
            // Merge environment so PATH, node, git etc. are available
            env: { ...process.env },
        });

        const output = (stdout || stderr || '').trim();
        const truncated = output.length > MAX_OUTPUT_CHARS
            ? output.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)'
            : output;

        logger.info(`[Terminal] Command done (${truncated.length} chars output)`);
        return truncated;

    } catch (err: any) {
        // child_process throws when exit code ≠ 0; err.stdout / err.stderr still available
        const stderr = (err.stderr || err.stdout || err.message || String(err)).trim();
        const truncated = stderr.length > MAX_OUTPUT_CHARS
            ? stderr.slice(0, MAX_OUTPUT_CHARS) + '\n…(output truncated)'
            : stderr;

        logger.warn(`[Terminal] Command failed: ${truncated}`);
        throw new Error(truncated);
    }
}

/**
 * Mirrors a command into a named VS Code terminal for the user to see.
 * This is fire-and-forget — it does NOT block or return output.
 */
function _mirrorToTerminal(command: string): void {
    try {
        let terminal = vscode.window.terminals.find((t) => t.name === 'Kairos Agent');
        if (!terminal) {
            terminal = vscode.window.createTerminal('Kairos Agent');
        }
        terminal.show(true); // show but don't steal focus
        terminal.sendText(command, true);
    } catch {
        // Non-fatal — the real exec above still runs even if the UI mirror fails
    }
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

    async listFiles(
        dirPath: string = '.',
        options?: { recursive?: boolean; maxDepth?: number }
    ): Promise<string> {
        const uri = this.resolvePath(dirPath);

        // ── Flat (1-level) mode — existing behaviour ────────────────────────
        if (!options?.recursive) {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries
                .map(([name, type]) =>
                    type === vscode.FileType.Directory ? `${name}/` : name
                )
                .join('\n');
        }

        // ── Recursive tree walk ──────────────────────────────────────────────
        const SKIP_DIRS = new Set([
            'node_modules', '.git', 'dist', 'out', 'build', '.next',
            '__pycache__', '.venv', 'venv', 'coverage', '.cache',
        ]);
        const MAX_ENTRIES = 500;
        const HARD_CAP_DEPTH = 6;
        const maxDepth = Math.min(options.maxDepth ?? 4, HARD_CAP_DEPTH);

        const lines: string[] = [];
        let entryCount = 0;
        let truncated = false;

        const walk = async (dirUri: vscode.Uri, indent: string, depth: number): Promise<void> => {
            if (depth > maxDepth || truncated) { return; }

            let entries: [string, vscode.FileType][];
            try {
                entries = await vscode.workspace.fs.readDirectory(dirUri);
            } catch {
                return; // Unreadable directory — skip silently
            }

            // Directories first, then files, each group alphabetically
            entries.sort(([a, aType], [b, bType]) => {
                const aIsDir = aType === vscode.FileType.Directory;
                const bIsDir = bType === vscode.FileType.Directory;
                if (aIsDir && !bIsDir) { return -1; }
                if (!aIsDir && bIsDir) { return 1; }
                return a.localeCompare(b);
            });

            for (const [name, type] of entries) {
                if (entryCount >= MAX_ENTRIES) {
                    truncated = true;
                    return;
                }
                if (type === vscode.FileType.Directory) {
                    if (SKIP_DIRS.has(name)) { continue; }
                    lines.push(`${indent}${name}/`);
                    entryCount++;
                    await walk(vscode.Uri.joinPath(dirUri, name), indent + '  ', depth + 1);
                } else {
                    lines.push(`${indent}${name}`);
                    entryCount++;
                }
            }
        };

        await walk(uri, '', 0);

        if (truncated) {
            lines.push('[truncated — showing first 500 entries]');
        }

        return lines.join('\n');
    }
};
