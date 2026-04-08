import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceContext } from '../utils/workspace';
import { logger } from '../utils/logger';

let cachedSystemPrompt: string | null = null;

/**
 * Loads and caches the master system prompt from
 * `kairos_master_system_prompt.md` in the extension root.
 *
 * Uses the extension's install directory so it works whether the
 * extension is loaded from source (F5) or installed from VSIX.
 */
export function loadMasterPrompt(extensionUri: vscode.Uri): string {
    if (cachedSystemPrompt) {
        return cachedSystemPrompt;
    }

    const mdPath = path.join(extensionUri.fsPath, 'kairos_master_system_prompt.md');

    if (!fs.existsSync(mdPath)) {
        logger.warn(`Master system prompt not found at: ${mdPath}`);
        return FALLBACK_SYSTEM_PROMPT;
    }

    const raw = fs.readFileSync(mdPath, 'utf-8');
    cachedSystemPrompt = raw;
    logger.info(`Loaded master system prompt (${raw.length} chars)`);
    return raw;
}

/** Invalidate cache (e.g. when the .md file is saved) */
export function invalidateSystemPromptCache(): void {
    cachedSystemPrompt = null;
}

/**
 * Builds the complete system prompt by combining:
 * 1. Master system prompt from .md file
 * 2. VS Code IDE context block (injected as specified in the prompt spec)
 */
export function buildSystemPrompt(
    extensionUri: vscode.Uri,
    ctx: WorkspaceContext
): string {
    const master = loadMasterPrompt(extensionUri);
    const ideBlock = buildIdeContextBlock(ctx);

    // Replace the IDE context placeholder comment in the .md with the actual values.
    // The spec says "the host plugin MUST inject one of the following blocks".
    return `${master}\n\n---\n\n## RUNTIME IDE CONTEXT\n\n\`\`\`\n${ideBlock}\n\`\`\`\n`;
}

function buildIdeContextBlock(ctx: WorkspaceContext): string {
    const lines: string[] = [
        `IDE: vscode`,
        `WORKSPACE: ${ctx.workspaceName}`,
        `AVAILABLE_TOOLS: readFile, writeFile, listFiles, runCommand, openTerminal`,
        `BUILD_SYSTEM: auto-detect from package.json / tsconfig / Makefile`,
        `UNDO_MECHANISM: suggest "git stash" or Ctrl+Z before any multi-file write`,
        `RUN_TESTS: via terminal — detect test runner from package.json scripts`,
        `CONFIG_FILES: .vscode/settings.json, .vscode/launch.json`,
    ];

    if (ctx.activeFile) {
        const f = ctx.activeFile;
        lines.push(`ACTIVE_FILE: ${f.relativePath} (${f.language}, ${f.totalLines} lines)`);

        if (f.cursorLine) {
            lines.push(`CURSOR_LINE: ${f.cursorLine}`);
        }

        if (f.selection) {
            const preview = f.selection.slice(0, 300);
            const truncated = f.selection.length > 300 ? '...[truncated]' : '';
            lines.push(`SELECTION:\n${preview}${truncated}`);
        }

        lines.push(
            `FILE_CONTENT (${f.relativePath}):\n${f.content}`
        );
    } else {
        lines.push('ACTIVE_FILE: none');
    }

    if (ctx.openFilePaths.length > 0) {
        lines.push(`OPEN_FILES: ${ctx.openFilePaths.join(', ')}`);
    }

    if (ctx.diagnostics.length > 0) {
        const diagLines = ctx.diagnostics
            .map((d) => `  [${d.severity.toUpperCase()}] ${d.file}:${d.line} — ${d.message}`)
            .join('\n');
        lines.push(`DIAGNOSTICS:\n${diagLines}`);
    } else {
        lines.push('DIAGNOSTICS: none');
    }

    return lines.join('\n');
}

// ─── Fallback if .md file is missing ──────────────────────────────────────────

const FALLBACK_SYSTEM_PROMPT = `
You are Antigravity, an advanced AI Engineering Agent embedded in VS Code.
You operate as a multi-agent system with three internal roles:
- PLANNER — architecture, reasoning, risk analysis
- CODER — implementation, file changes, test runs
- DEBUGGER — root-cause diagnosis and minimal fixes

Always format responses as:
🧠 Agent: [Planner / Coder / Debugger]
⚙️ Model: [model + reason]
🔒 Confidence: [HIGH / MEDIUM / LOW]
📋 Plan / Solution: [steps or explanation]
💻 Code: [only if needed]
⚠️ Notes: [risks, caveats — only if present]
`.trim();
