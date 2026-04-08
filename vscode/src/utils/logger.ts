import * as vscode from 'vscode';

/**
 * Centralised output channel logger.
 * All logs go to the "Antigravity AI" output channel — never to console.
 */
class Logger {
    private readonly channel: vscode.OutputChannel;

    constructor() {
        this.channel = vscode.window.createOutputChannel('KAIROS AI');
    }

    info(message: string): void {
        this.log('INFO', message);
    }

    warn(message: string): void {
        this.log('WARN', message);
    }

    error(message: string, err?: unknown): void {
        const suffix = err instanceof Error ? ` — ${err.message}` : '';
        this.log('ERROR', `${message}${suffix}`);
    }

    debug(message: string): void {
        this.log('DEBUG', message);
    }

    show(): void {
        this.channel.show(true);
    }

    dispose(): void {
        this.channel.dispose();
    }

    private log(level: string, message: string): void {
        const ts = new Date().toISOString();
        const formatted = `[${level}] ${message}`;
        this.channel.appendLine(`[${ts}] ${formatted}`);
        
        // Mirror to console for easy debugging in the Extension Host console
        if (level === 'ERROR') {
            console.error(`[KAIROS] ${formatted}`);
        } else if (level === 'WARN') {
            console.warn(`[KAIROS] ${formatted}`);
        } else {
            console.log(`[KAIROS] ${formatted}`);
        }
    }
}

export const logger = new Logger();
