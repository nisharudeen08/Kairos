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
    ctx: WorkspaceContext,
    mode: string = 'plan'
): string {
    const master = loadMasterPrompt(extensionUri);
    const ideBlock = buildIdeContextBlock(ctx);
    const modeBlock = buildModeInstructionBlock(mode);

    return `${master}\n\n${modeBlock}\n\n---\n\n## RUNTIME IDE CONTEXT\n\n\`\`\`\n${ideBlock}\n\`\`\`\n`;
}

function buildModeInstructionBlock(mode: string): string {
    switch (mode) {
        case 'full':
            return `
## MODE: FULL ACCESS (AGENTIC)
- You have UNRESTRICTED ACCESS to tools. 
- BE PROACTIVE. If you see an error, use <read> and <execute> to diagnose it.
- If the user asks to "build" something, use <write> to create the files immediately.
- Do not ask for permission before using tools; just execute them and report the result.
`.trim();
        case 'research-expert':
            return `
## MODE: RESEARCH EXPERT
- Focus on deep analysis and architectural trade-offs.
- Use <read> to explore the codebase before making any suggestions.
- Provide highly detailed, multi-step plans.
`.trim();
        case 'reasoning':
            return `
## MODE: DEEP REASONING
- Think step-by-step. 
- Explicitly state your assumptions and verify them using <read> or <execute> first.
`.trim();
        default:
            return '';
    }
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
