# Examples Reference

Five worked examples showing input → process → output for the ide-extension-engineer skill.
Read when generating or debugging IDE extension components.

---

## Table of Contents
1. [VS Code — Scaffold a ChatViewProvider Sidebar](#example-1-vs-code--scaffold-a-chatviewprovider-sidebar)
2. [VS Code — Debug a Broken Message Passing Loop](#example-2-vs-code--debug-a-broken-message-passing-loop)
3. [JetBrains — Scaffold a Tool Window with a Chat Panel](#example-3-jetbrains--scaffold-a-tool-window-with-a-chat-panel)
4. [Antigravity — Scaffold a New Skill Package](#example-4-antigravity--scaffold-a-new-skill-package)
5. [Multi-Platform — Add a Model Selector to Both Extensions](#example-5-multi-platform--add-a-model-selector-to-both-extensions)

---

## Example 1: VS Code — Scaffold a ChatViewProvider Sidebar

**Input (user message):**
> "Build me a VS Code sidebar extension with a chat panel. The panel should let users type messages and show streaming responses."

**Analyzer output:**
```
PLATFORM:  VS Code
TASK TYPE: SCAFFOLD
COMPONENT: ChatViewProvider (sidebar chat panel)
SCOPE:     Full extension scaffold with webview sidebar, message input, streaming display
SIGNALS:   "VS Code", "sidebar", "chat panel", "type messages", "streaming responses"
GAPS:      none
PROCEED:   YES
```

**Planner output:**
```
Step 1: package.json — contributes.views activitybar + chatView, activationEvents
Step 2: tsconfig.json — strict TypeScript config
Step 3: src/extension.ts — activate() registers ChatViewProvider
Step 4: src/ChatViewProvider.ts — resolveWebviewView(), message handler, streaming
Step 5: media/chat.html — input box, message list, nonce-gated scripts
Step 6: media/chat.css — dark-mode glassmorphic styling
Step 7: media/chat.js — postMessage to extension, render streamed response
```

**Key generated code (Step 4 excerpt):**
```typescript
// src/ChatViewProvider.ts
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kairos.chatView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'user-message') {
        await this._streamResponse(msg.payload.text);
      }
    });
  }

  private async _streamResponse(text: string) {
    // stream chunks back to webview
    for await (const chunk of callLLM(text)) {
      this._view?.webview.postMessage({ type: 'stream-chunk', payload: { text: chunk } });
    }
    this._view?.webview.postMessage({ type: 'stream-end' });
  }
}
```

**Reviewer verdict:** APPROVED — CSP present, nonce used, all disposables registered.

---

## Example 2: VS Code — Debug a Broken Message Passing Loop

**Input (user message):**
> "My VS Code extension's webview keeps showing a blank screen. The chat.js is not receiving messages from the extension. Here's my ChatViewProvider.ts..."

**Analyzer output:**
```
PLATFORM:  VS Code
TASK TYPE: DEBUG
COMPONENT: ChatViewProvider (message passing, webview rendering)
SCOPE:     Diagnose why webview is blank and messages aren't received
SIGNALS:   "blank screen", "not receiving messages", "ChatViewProvider"
GAPS:      none
PROCEED:   YES
```

**Root cause analysis:**

Common causes for blank webview / broken message passing:

1. **Missing `enableScripts: true`** in `webviewView.webview.options`
   ```typescript
   // BROKEN:
   webviewView.webview.options = { localResourceRoots: [this._extensionUri] };
   // FIX:
   webviewView.webview.options = {
     enableScripts: true,
     localResourceRoots: [this._extensionUri]
   };
   ```

2. **Resource URIs not converted** — using raw filesystem paths instead of webview URIs
   ```typescript
   // BROKEN:
   const scriptSrc = vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js').fsPath;
   // FIX:
   const scriptUri = webview.asWebviewUri(
     vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js')
   );
   ```

3. **CSP blocking scripts** — nonce missing or CSP too restrictive
   ```html
   <!-- BROKEN (no nonce, script blocked): -->
   <script src="${scriptUri}"></script>
   <!-- FIX: -->
   <meta http-equiv="Content-Security-Policy"
     content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource};">
   <script nonce="${nonce}" src="${scriptUri}"></script>
   ```

4. **`window.acquireVsCodeApi()` called more than once** — causes runtime error
   ```javascript
   // BROKEN (called in multiple files/scope):
   const vscode = acquireVsCodeApi();  // Error if called twice
   // FIX: call once at top of main script, export as module singleton
   ```

**Fix applied:** Cases 1–3 in this example. Reviewer confirmed no CSP issues remain.

---

## Example 3: JetBrains — Scaffold a Tool Window with a Chat Panel

**Input:**
> "Create a JetBrains plugin with a right-side tool window that shows a chat interface. Built in Kotlin."

**Analyzer output:**
```
PLATFORM:  JetBrains
TASK TYPE: SCAFFOLD
COMPONENT: Tool Window with Swing/JCEF chat panel
SCOPE:     Full plugin scaffold: plugin.xml, factory, panel, Kotlin entry
SIGNALS:   "JetBrains", "plugin", "tool window", "chat interface", "Kotlin"
GAPS:      none
PROCEED:   YES
```

**Key generated code:**

`plugin.xml` (excerpt):
```xml
<extensions defaultExtensionNs="com.intellij">
  <toolWindow id="KairosChat"
              anchor="right"
              factoryClass="com.kairos.plugin.ChatToolWindowFactory"
              icon="/icons/kairos.svg"/>
  <projectService serviceImplementation="com.kairos.plugin.ChatService"/>
</extensions>
```

`ChatToolWindowFactory.kt`:
```kotlin
class ChatToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val panel = ChatPanel(project)
    val content = ContentFactory.getInstance().createContent(panel, "Chat", false)
    toolWindow.contentManager.addContent(content)
  }
}
```

`ChatPanel.kt` (Swing UI, EDT-safe):
```kotlin
class ChatPanel(private val project: Project) : JPanel(BorderLayout()) {
  private val chatArea = JTextArea().apply { isEditable = false; lineWrap = true }
  private val inputField = JTextField()
  private val sendButton = JButton("Send")

  init {
    add(JScrollPane(chatArea), BorderLayout.CENTER)
    val inputPanel = JPanel(BorderLayout())
    inputPanel.add(inputField, BorderLayout.CENTER)
    inputPanel.add(sendButton, BorderLayout.EAST)
    add(inputPanel, BorderLayout.SOUTH)

    sendButton.addActionListener {
      val text = inputField.text.trim()
      if (text.isNotEmpty()) {
        inputField.text = ""
        // Background thread for network call
        ApplicationManager.getApplication().executeOnPooledThread {
          val response = ChatService.getInstance(project).send(text)
          // Back to EDT for UI update
          ApplicationManager.getApplication().invokeLater {
            chatArea.append("You: $text\n")
            chatArea.append("AI: $response\n\n")
          }
        }
      }
    }
  }
}
```

**Reviewer verdict:** APPROVED — EDT safety maintained, service accessed correctly.

---

## Example 4: Antigravity — Scaffold a New Skill Package

**Input:**
> "Build an Antigravity skill that helps Kairos write unit tests for Python code."

**Analyzer output:**
```
PLATFORM:  Antigravity
TASK TYPE: SCAFFOLD
COMPONENT: python-test-writer skill
SCOPE:     Full skill package: SKILL.md, agents, references, scripts, evals
SIGNALS:   "Antigravity", "skill", "unit tests", "Python"
GAPS:      none
PROCEED:   YES
```

**SKILL.md frontmatter generated:**
```yaml
---
name: python-test-writer
description: >
  Generate, improve, and fix Python unit tests using pytest — including
  fixtures, mocking, parametrize, coverage analysis, and edge case coverage.
  Use this skill whenever the user asks to write tests for Python code,
  improve test coverage, add pytest fixtures, or debug failing tests.
  Triggers include: "write tests for this", "add unit tests", "test coverage",
  "pytest fixtures", "mock this function", "parametrize this test".
  Always use this skill for Python test generation — do not attempt test
  writing without it.
---
```

**evals/evals.json excerpt:**
```json
{
  "skill_name": "python-test-writer",
  "evals": [
    {
      "id": 1,
      "category": "happy-path",
      "prompt": "Write pytest tests for this Python function:\ndef add(a, b): return a + b",
      "expected_output": "A pytest test file with test_add function, multiple assertions",
      "expectations": [
        "Output contains 'def test_add'",
        "Output contains 'assert'",
        "Output contains 'import pytest' or 'from pytest'"
      ]
    }
  ]
}
```

---

## Example 5: Multi-Platform — Add a Model Selector to Both Extensions

**Input:**
> "Add a model selector dropdown to both the VS Code and JetBrains versions of Kairos. It should show GPT-4, Claude 3.5, and Gemini Pro as options."

**Analyzer output:**
```
PLATFORM:  Multi-platform (VS Code + JetBrains)
TASK TYPE: FEATURE
COMPONENT: Model Selector Dropdown
SCOPE:     Add model selection UI + backend wiring in both extensions
SIGNALS:   "VS Code", "JetBrains", "model selector", "dropdown", "GPT-4", "Claude"
GAPS:      none
PROCEED:   YES
```

**Plan (abbreviated):**
```
Phase A — VS Code:
  1. Add model selector <select> to media/chat.html
  2. Update chat.js to include selected model in postMessage payload
  3. Update ChatViewProvider.ts message handler to read msg.payload.model
  4. Pass model name to LLM call

Phase B — JetBrains:
  1. Add JComboBox to ChatPanel.kt with model options
  2. Update ChatService.kt to accept model parameter in send()
  3. Read selected combo item before sending request

Shared:
  5. Update MODELS list in both platforms: ["gpt-4o", "claude-3-5-sonnet", "gemini-pro"]
```

**VS Code webview change (chat.html):**
```html
<select id="model-selector">
  <option value="gpt-4o">GPT-4o</option>
  <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
  <option value="gemini-pro">Gemini Pro</option>
</select>
```

**VS Code chat.js change:**
```javascript
sendBtn.addEventListener('click', () => {
  const model = document.getElementById('model-selector').value;
  vscode.postMessage({
    type: 'user-message',
    payload: { text: inputField.value, model }
  });
});
```

**JetBrains ChatPanel.kt change:**
```kotlin
private val modelSelector = JComboBox(arrayOf("gpt-4o", "claude-3-5-sonnet", "gemini-pro"))

init {
  inputPanel.add(modelSelector, BorderLayout.WEST)
  // ...
  sendButton.addActionListener {
    val model = modelSelector.selectedItem as String
    val response = ChatService.getInstance(project).send(text, model)
  }
}
```
