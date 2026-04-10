---
name: ide-extension-engineer
description: >
  Build, scaffold, debug, and ship IDE extensions — including VS Code extensions
  (TypeScript, Webview, ChatViewProvider, commands, sidebar panels), JetBrains
  plugins (Kotlin/Java, tool windows, actions, services), and Antigravity agent
  skills (SKILL.md packages, eval pipelines, agent files). Use this skill whenever
  the user asks to build or fix a VS Code extension, JetBrains plugin, Antigravity
  skill, or any IDE tooling component. Triggers include: "build a VS Code extension",
  "create a JetBrains plugin", "add a webview panel", "fix my ChatViewProvider",
  "build an Antigravity skill", "scaffold a plugin", "debug my extension command",
  "ship my extension", "write a tool window". Always use this skill for IDE
  extension engineering — do not attempt plugin or extension creation without it.
---

# IDE Extension Engineer

This skill enables Kairos to architect, scaffold, debug, and ship production-grade
IDE extensions across three platforms: **VS Code** (TypeScript/Node), **JetBrains**
(Kotlin/Java via the IntelliJ Platform SDK), and **Antigravity** (SKILL.md-based
agent skill packages). It applies consistent engineering discipline — typed APIs,
proper activation events, lifecycle management, and quality gates — across all
three ecosystems.

Use it whenever the user is building, modifying, or debugging any IDE plugin,
extension, or agent skill.

---

## Step 0 — Detect Platform & Task Type

Classify the request before doing any work:

**PLATFORM:**
- VS Code → TypeScript, `package.json` manifest, `vscode` API
- JetBrains → Kotlin/Java, `plugin.xml`, IntelliJ Platform SDK
- Antigravity → SKILL.md package, `evals/`, `agents/`, `scripts/`
- Multi-platform → Apply appropriate patterns per platform

**TASK TYPE:**
- SCAFFOLD   → New extension/plugin/skill from scratch
- FEATURE    → Add a specific capability to existing project
- DEBUG      → Diagnose and fix a broken component
- REVIEW     → Evaluate quality, security, architecture
- SHIP       → Prepare for marketplace/distribution

If ambiguous, call `agents/analyzer.md` to classify.

---

## Step 1 — Load Platform Context

### VS Code Extensions
- Read `package.json` → check `engines.vscode`, `activationEvents`, `contributes`
- Read `src/extension.ts` → check `activate()` / `deactivate()` lifecycle
- Check for webview usage → read `ChatViewProvider.ts` or equivalent
- Identify commands, views, and output channels registered

### JetBrains Plugins
- Read `plugin.xml` → check `<id>`, `<depends>`, `<extensions>`, `<actions>`
- Check Kotlin vs Java source layout (`src/main/kotlin` vs `src/main/java`)
- Identify services, tool windows, actions, inspections registered
- Verify IDE version compatibility (`<idea-version since-build="...">`)

### Antigravity Skills
- Read `SKILL.md` frontmatter (name, description)
- Check for `agents/`, `references/`, `scripts/`, `evals/` directories
- Load `evals/evals.json` if present to understand scope

---

## Step 2 — Plan Execution

Call `agents/planner.md` to decompose the task into ordered steps.

For SCAFFOLD tasks, always generate in this order:
1. Manifest / package file (`package.json` / `plugin.xml` / `SKILL.md`)
2. Entry point (`extension.ts` / `Plugin.kt` / core agents)
3. Feature components (providers, views, commands, services)
4. Tests / evals
5. README + publish config

For DEBUG tasks:
1. Reproduce the issue with a minimal test case
2. Identify root cause (lifecycle, API misuse, type error, config)
3. Apply targeted fix — do NOT refactor unrelated code
4. Add a regression eval/test

---

## Step 3 — Implement

### VS Code — Key Patterns

**Extension Entry (`extension.ts`)**
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Register all disposables through context.subscriptions
  const provider = new MyViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MyViewProvider.viewType, provider),
    vscode.commands.registerCommand('myext.command', () => { /* ... */ })
  );
}

export function deactivate() {}
```

**WebviewView Provider Pattern**
```typescript
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'myext.chatView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(this._handleMessage.bind(this));
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    // Always set CSP. Always use getNonce().
    return `<!DOCTYPE html><html>...`;
  }
}
```

**CSP Rule (mandatory for webviews):**
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           script-src 'nonce-${nonce}';
           style-src ${webview.cspSource} 'unsafe-inline';">
```

**Message Passing (extension ↔ webview):**
```typescript
// Extension → Webview
this._view.webview.postMessage({ type: 'response', data: result });

// Webview → Extension
vscode.postMessage({ type: 'request', payload: data });
// In resolveWebviewView:
webview.onDidReceiveMessage(msg => {
  switch (msg.type) { case 'request': ...; }
});
```

---

### JetBrains — Key Patterns

**plugin.xml Structure:**
```xml
<idea-plugin>
  <id>com.kairos.myplugin</id>
  <name>My Plugin</name>
  <vendor>Kairos</vendor>
  <description>...</description>
  <depends>com.intellij.modules.platform</depends>

  <extensions defaultExtensionNs="com.intellij">
    <toolWindow id="MyTool" anchor="right"
                factoryClass="com.kairos.MyToolWindowFactory"/>
    <applicationService
      serviceImplementation="com.kairos.MyService"/>
  </extensions>

  <actions>
    <action id="Kairos.MyAction" class="com.kairos.MyAction"
            text="My Action" icon="AllIcons.Actions.Execute">
      <add-to-group group-id="EditorPopupMenu" anchor="first"/>
    </action>
  </actions>
</idea-plugin>
```

**Tool Window Factory (Kotlin):**
```kotlin
class MyToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(
    project: Project, toolWindow: ToolWindow
  ) {
    val panel = MyPanel(project)
    val content = ContentFactory.getInstance()
      .createContent(panel, "", false)
    toolWindow.contentManager.addContent(content)
  }
}
```

**Service Pattern:**
```kotlin
@Service(Service.Level.PROJECT)
class MyService(val project: Project) {
  companion object {
    fun getInstance(project: Project): MyService =
      project.getService(MyService::class.java)
  }
}
```

---

### Antigravity Skills — Key Patterns

See full Skill Creator spec. Key rules:
- SKILL.md frontmatter: `name` + `description` (trigger-engineered)
- agents/ for complex reasoning (analyzer, planner, reviewer)
- evals/evals.json with 3–8 test cases, 2+ expectations each
- scripts/ for automation (run_eval.py, generate_report.py, etc.)

---

## Step 4 — Validate

Call `agents/reviewer.md` to check output before delivery.

**VS Code checklist:**
- [ ] `package.json` has correct `engines.vscode` version
- [ ] All commands in `package.json` `contributes.commands` are registered in `activate()`
- [ ] All disposables pushed to `context.subscriptions`
- [ ] Webview CSP is set with nonce — no `unsafe-eval` or `unsafe-inline` on scripts
- [ ] `getNonce()` used for all script tags
- [ ] No `require()` calls inside webview HTML (use message passing)
- [ ] `deactivate()` implemented if resources need explicit teardown

**JetBrains checklist:**
- [ ] `plugin.xml` has unique `<id>` in reverse-domain format
- [ ] `<depends>` covers all used platform modules
- [ ] Services annotated with `@Service` and registered in `plugin.xml`
- [ ] No EDT-blocking operations — use `ApplicationManager.getApplication().executeOnPooledThread()`
- [ ] `build.gradle.kts` has correct `intellij.version` and `pluginVerifier` configured
- [ ] Actions implement `update()` to control visibility

**Antigravity checklist:**
- [ ] SKILL.md description follows trigger formula (Section 3 of creator spec)
- [ ] evals/evals.json has 3+ cases with 2+ expectations each
- [ ] All 7 scripts present and syntactically valid
- [ ] agents/ has analyzer, planner, reviewer

---

## Step 5 — Ship

**VS Code (`vsce` publish):**
```bash
npm install -g @vscode/vsce
vsce package          # → .vsix file
vsce publish          # → VS Code Marketplace
```
Required in `package.json`: `publisher`, `repository`, `icon`, `license`.

**JetBrains (Gradle publish):**
```bash
./gradlew buildPlugin          # → build/distributions/*.zip
./gradlew publishPlugin        # → JetBrains Marketplace
```
Required: `PUBLISH_TOKEN` env var, `patchPluginXml` with changelog.

**Antigravity (package_skill.py):**
```bash
python scripts/package_skill.py   # → ../skill-name-YYYYMMDD.zip
```

---

## Quality Gates

Before calling any output complete:

- [ ] Platform correctly identified (VS Code / JetBrains / Antigravity)
- [ ] Task type executed (Scaffold / Feature / Debug / Review / Ship)
- [ ] All generated code compiles without errors
- [ ] No deprecated APIs used (check platform version)
- [ ] Lifecycle correctly handled (activate/deactivate, dispose, service teardown)
- [ ] Security: CSP set (VS Code webview), no hardcoded secrets
- [ ] Reviewer agent sign-off — no critical issues flagged
- [ ] At least one eval or test case validates the new behaviour

---

## Platform Version Reference

| Platform        | Current Stable | Min Supported | Notes                          |
|-----------------|---------------|---------------|--------------------------------|
| VS Code API     | 1.87+         | 1.75          | Use `engines.vscode: "^1.75"` |
| JetBrains SDK   | 2024.1        | 2022.3        | Use `since-build="223"`        |
| Node.js (vsce)  | 18+           | 16            | LTS only                       |
| Kotlin          | 1.9+          | 1.8            | Use Kotlin DSL for Gradle      |
