# VS Code Extension Guide

Deep-dive reference for VS Code extension development. Read when building or debugging
VS Code-specific components. See schemas.md for package.json structure.

---

## Table of Contents
1. [Extension Lifecycle](#1-extension-lifecycle)
2. [Activation Events](#2-activation-events)
3. [Webview Security (CSP + Nonce)](#3-webview-security-csp--nonce)
4. [Message Passing Patterns](#4-message-passing-patterns)
5. [Storage & State](#5-storage--state)
6. [Common Pitfalls](#6-common-pitfalls)
7. [Publishing Checklist](#7-publishing-checklist)

---

## 1. Extension Lifecycle

```
Install → activate() called on trigger event
  → Register commands, providers, disposables
  → Push all to context.subscriptions

User closes window → deactivate() called
  → Clean up anything NOT in context.subscriptions
  → context.subscriptions items auto-disposed

Re-open → activate() called again (fresh state)
```

**Rules:**
- Every `vscode.Disposable` MUST be pushed to `context.subscriptions`
- Never store disposables in global variables without also pushing them
- `deactivate()` is called synchronously — no async cleanup
  - For async cleanup: store cleanup Promise in module scope, use `context.subscriptions.push({ dispose: () => myCleanupPromise })`

---

## 2. Activation Events

```json
"activationEvents": [
  "onStartupFinished",          // runs after startup, low priority
  "onCommand:myext.cmd",        // when user runs specific command
  "onView:myext.sidebarView",   // when view is opened
  "onLanguage:python",          // when Python file is opened
  "onFileSystem:myfs",          // when custom file system used
  "workspaceContains:**/.myrc"  // when workspace has specific file
]
```

**Best practice:** Use `onStartupFinished` for low-overhead extensions.
Use specific events for heavy extensions to avoid slowing VS Code startup.

**VS Code 1.74+:** Use `*` to activate immediately — only for lightweight extensions.

---

## 3. Webview Security (CSP + Nonce)

**Why nonce?** VS Code sandboxes webviews. Scripts without a valid nonce are blocked
by the Content Security Policy even if `enableScripts: true` is set.

**getNonce function (always include in extension.ts or utils.ts):**
```typescript
export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

**HTML template (mandatory CSP structure):**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!--
    MANDATORY: CSP meta tag.
    - default-src 'none' → deny everything by default
    - img-src: allow webview images + data URIs
    - style-src: allow extension styles + inline (for dynamic styles)
    - script-src: ONLY scripts with matching nonce
  -->
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} data:;
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">

  <link href="${styleUri}" rel="stylesheet">
  <title>My Extension</title>
</head>
<body>
  <!-- content -->
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
```

**Anti-patterns (never do these):**
```html
<!-- WRONG: no nonce -->
<script src="${scriptUri}"></script>

<!-- WRONG: unsafe-eval (breaks sandboxing) -->
content="script-src 'unsafe-eval'"

<!-- WRONG: no CSP at all -->
<!-- (no meta CSP tag present) -->
```

---

## 4. Message Passing Patterns

### Extension → Webview (push)
```typescript
// In extension:
this._view?.webview.postMessage({ type: 'update', data: { value: 42 } });

// In webview JS:
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'update':
      renderUpdate(message.data);
      break;
  }
});
```

### Webview → Extension (request)
```javascript
// In webview JS:
const vscode = acquireVsCodeApi();  // ONCE per webview page lifetime

function sendRequest(text) {
  vscode.postMessage({ type: 'user-message', payload: { text } });
}
```

```typescript
// In extension (inside resolveWebviewView):
webviewView.webview.onDidReceiveMessage(
  async (message) => {
    switch (message.type) {
      case 'user-message':
        await handleUserMessage(message.payload.text);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  },
  undefined,
  this._disposables  // or context.subscriptions
);
```

### Request/Response Pattern (with correlation ID)
```javascript
// Webview:
let reqId = 0;
const pending = new Map();

function request(type, payload) {
  return new Promise((resolve) => {
    const id = ++reqId;
    pending.set(id, resolve);
    vscode.postMessage({ type, payload, requestId: id });
  });
}

window.addEventListener('message', e => {
  if (e.data.requestId && pending.has(e.data.requestId)) {
    pending.get(e.data.requestId)(e.data.result);
    pending.delete(e.data.requestId);
  }
});
```

### Streaming Pattern
```typescript
// Extension streams chunks to webview:
async function streamResponse(prompt: string, view: vscode.WebviewView) {
  const requestId = crypto.randomUUID();
  try {
    for await (const chunk of callStreamingLLM(prompt)) {
      view.webview.postMessage({
        type: 'stream-chunk',
        requestId,
        payload: { text: chunk, done: false }
      });
    }
    view.webview.postMessage({ type: 'stream-end', requestId, payload: { done: true } });
  } catch (err) {
    view.webview.postMessage({ type: 'stream-error', requestId, payload: { error: String(err) } });
  }
}
```

---

## 5. Storage & State

| Storage Type        | API                                     | Scope       | Persists   |
|---------------------|-----------------------------------------|-------------|------------|
| Global state        | `context.globalState`                   | Machine     | Yes        |
| Workspace state     | `context.workspaceState`                | Workspace   | Yes        |
| Secrets             | `context.secrets`                       | Machine     | Yes (encrypted) |
| Settings            | `vscode.workspace.getConfiguration()`   | User/WS/all | Yes        |
| In-memory           | Module-level variables                  | Session     | No         |

```typescript
// Read
const history = context.globalState.get<Message[]>('chat.history', []);

// Write
await context.globalState.update('chat.history', [...history, newMsg]);

// Sync across devices (VS Code Settings Sync)
context.globalState.setKeysForSync(['chat.history']);

// Secrets (for API keys)
await context.secrets.store('myext.apiKey', apiKey);
const apiKey = await context.secrets.get('myext.apiKey');
```

---

## 6. Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Blank webview | `enableScripts: false` (default) | Set `enableScripts: true` |
| Script not loading | URI not converted | Use `webview.asWebviewUri()` |
| Script blocked | Missing nonce in CSP | Add nonce to `<script>` and CSP |
| `acquireVsCodeApi` error | Called twice | Call once, store as module-level const |
| Extension not activating | Wrong `activationEvents` | Match event to actual trigger |
| Memory leak | Disposable not registered | Push all to `context.subscriptions` |
| Command not found | Registered but not in `contributes.commands` | Add to package.json |
| Webview lost on panel hide | Not persisting | Use `retainContextWhenHidden: true` (costly) |
| State lost on reload | In-memory only | Use `globalState` or `workspaceState` |

---

## 7. Publishing Checklist

```
package.json:
  □ publisher field set (registered at marketplace.visualstudio.com)
  □ version bumped (semver)
  □ icon = 128x128 PNG (not SVG)
  □ repository.url set
  □ license field set
  □ categories set (not empty)

Files:
  □ .vscodeignore excludes: node_modules, src, *.ts, test/
  □ CHANGELOG.md updated with release notes
  □ README.md has screenshots and usage instructions

Build:
  □ npm run compile completes without errors
  □ vsce package generates .vsix without warnings
  □ .vsix file size is reasonable (< 10MB typical)

Commands:
  npm install -g @vscode/vsce
  vsce login <publisher>
  vsce package                    # test locally
  code --install-extension *.vsix # smoke test
  vsce publish                    # publish to marketplace
```
