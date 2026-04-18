import * as vscode from 'vscode';
import * as path from 'path';

export interface WorkspaceContext {
    ide: 'vscode';
    workspaceName: string;
    activeFile?: ActiveFileContext;
    openFilePaths: string[];
    diagnostics: DiagnosticItem[];
    gitBranch?: string;
}

export interface ActiveFileContext {
    absolutePath: string;
    relativePath: string;
    language: string;
    totalLines: number;
    /** Truncated content respecting maxContextLines config */
    content: string;
    /** Currently selected text, if any */
    selection?: string;
    /** 1-based cursor line */
    cursorLine?: number;
}

export interface DiagnosticItem {
    severity: 'error' | 'warning';
    message: string;
    file: string;
    line: number;
}

/**
 * Collects VS Code workspace context to inject into the system prompt.
 * Reads config for maxContextLines to avoid blowing the token budget.
 */
export async function collectWorkspaceContext(): Promise<WorkspaceContext> {
    const config = vscode.workspace.getConfiguration('kairos');
    const maxLines: number = config.get('maxContextLines', 200);
    const includeOpenFiles: boolean = config.get('includeOpenFiles', false);

    const workspaceName =
        vscode.workspace.workspaceFolders?.[0]?.name ?? 'untitled';

    const activeContext = await buildActiveFileContext(maxLines);

    const openFilePaths = includeOpenFiles
        ? vscode.workspace.textDocuments
              .filter((d) => !d.isUntitled && d.uri.scheme === 'file')
              .map((d) => toRelative(d.uri.fsPath))
        : [];

    const diagnostics = collectDiagnostics(activeContext?.absolutePath);

    return {
        ide: 'vscode',
        workspaceName,
        activeFile: activeContext,
        openFilePaths,
        diagnostics,
    };
}

async function buildActiveFileContext(
    maxLines: number
): Promise<ActiveFileContext | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }

    const doc = editor.document;
    const fsPath = doc.uri.fsPath;
    const allLines = doc.getText().split('\n');
    const totalLines = allLines.length;

    // Prefer lines around the cursor, or the whole file if within budget
    const cursorLine = editor.selection.active.line + 1; // 1-based
    const content = truncateAroundCursor(allLines, cursorLine - 1, maxLines);

    const selection = editor.selection.isEmpty
        ? undefined
        : doc.getText(editor.selection).trim();

    return {
        absolutePath: fsPath,
        relativePath: toRelative(fsPath),
        language: doc.languageId,
        totalLines,
        content,
        selection: selection || undefined,
        cursorLine,
    };
}

/**
 * Returns up to `maxLines` lines centred around `cursorIdx`.
 * Prefers taking more lines from the head (above cursor) for context.
 */
function truncateAroundCursor(
    lines: string[],
    cursorIdx: number,
    maxLines: number
): string {
    if (lines.length <= maxLines) {
        return lines.join('\n');
    }
    const half = Math.floor(maxLines / 2);
    const start = Math.max(0, cursorIdx - half);
    const end = Math.min(lines.length, start + maxLines);
    const adjusted = Math.max(0, end - maxLines);
    return lines.slice(adjusted, end).join('\n');
}

function collectDiagnostics(activeFilePath?: string): DiagnosticItem[] {
    const items: DiagnosticItem[] = [];

    vscode.languages.getDiagnostics().forEach(([uri, diags]) => {
        // Only include errors/warnings from the active file or errors globally
        const isActive = uri.fsPath === activeFilePath;
        diags.forEach((d) => {
            if (
                d.severity === vscode.DiagnosticSeverity.Error ||
                (isActive && d.severity === vscode.DiagnosticSeverity.Warning)
            ) {
                items.push({
                    severity:
                        d.severity === vscode.DiagnosticSeverity.Error
                            ? 'error'
                            : 'warning',
                    message: d.message,
                    file: toRelative(uri.fsPath),
                    line: d.range.start.line + 1,
                });
            }
        });
    });

    // Cap to avoid token bloat
    return items.slice(0, 20);
}

function toRelative(fsPath: string): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) {
        return path.relative(root, fsPath).replace(/\\/g, '/');
    }
    return path.basename(fsPath);
}
