# IDE API Agent

## Role
Domain-specific agent that resolves platform API questions — correct method
signatures, extension points, namespaces, and version-gated APIs — for VS Code,
JetBrains, and Antigravity. Prevents deprecated or wrong API usage.

## Activation
Activated by SKILL.md **Step 3 — Implement** when:
- A specific VS Code API method is needed (e.g. how to show a progress notification)
- A JetBrains extension point is unknown (e.g. how to register a file type)
- An Antigravity skill pattern is unclear (e.g. how to pass data between agents)

## Input
- Platform (VS Code | JetBrains | Antigravity)
- API question or intent (e.g. "show progress bar while fetching", "register a
  custom tree view", "pass eval results between agents")
- Target IDE version (minimum supported)

## Process

STEP 1 — ROUTE TO PLATFORM SECTION
  VS Code  → Step 2a
  JetBrains → Step 2b
  Antigravity → Step 2c

STEP 2a — VS CODE API RESOLUTION
  Common API categories and correct patterns:

  NOTIFICATIONS:
    Info:    vscode.window.showInformationMessage('msg')
    Warning: vscode.window.showWarningMessage('msg')
    Error:   vscode.window.showErrorMessage('msg')
    Progress: vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Working...', cancellable: true
              }, async (progress, token) => { ... })

  FILE SYSTEM:
    Read:   vscode.workspace.fs.readFile(uri) → Uint8Array
    Write:  vscode.workspace.fs.writeFile(uri, content)
    Watch:  vscode.workspace.createFileSystemWatcher(pattern)
    Exists: Use try/catch on readFile — no direct exists() API

  EDITOR:
    Active editor:  vscode.window.activeTextEditor
    Selection:      editor.selection / editor.selections
    Edit:           editor.edit(editBuilder => editBuilder.replace(range, text))
    Diagnostics:    vscode.languages.createDiagnosticCollection('myext')

  WORKSPACE:
    Root:     vscode.workspace.workspaceFolders?.[0]?.uri
    Config:   vscode.workspace.getConfiguration('myext').get<string>('key')
    Open doc: vscode.workspace.openTextDocument(uri)

  STORAGE:
    Global:   context.globalState.get/update/setKeysForSync
    Workspace: context.workspaceState.get/update
    Secrets:  context.secrets.get/store/delete

  WEBVIEW:
    Panel:    vscode.window.createWebviewPanel(viewType, title, column, options)
    View:     WebviewViewProvider (sidebar) — implements resolveWebviewView()
    URI:      webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'file.js'))

  TREE VIEW:
    Provider: implements vscode.TreeDataProvider<T>
    Register: vscode.window.createTreeView('viewId', { treeDataProvider: provider })
    Refresh:  EventEmitter<T | undefined> + onDidChangeTreeData

  VERSION-GATED APIS (check engines.vscode before using):
    1.85+: vscode.lm (Language Model API)
    1.82+: vscode.chat (Chat Participant API)
    1.80+: vscode.workspace.fs.isWritableFileSystem()
    1.75+: vscode.window.tabGroups

STEP 2b — JETBRAINS API RESOLUTION
  Common API categories and correct patterns:

  EDT SAFETY:
    Run on EDT:       ApplicationManager.getApplication().invokeLater { ... }
    Run off EDT:      ApplicationManager.getApplication().executeOnPooledThread { ... }
    Read action:      ReadAction.compute { ... }
    Write action:     WriteCommandAction.runWriteCommandAction(project) { ... }
    Progress:         ProgressManager.getInstance().runProcessWithProgressSynchronously(
                        { ... }, "Title", true, project)

  EDITOR ACCESS:
    Current editor:   FileEditorManager.getInstance(project).selectedTextEditor
    Document:         editor.document
    Caret:            editor.caretModel.offset
    Selection:        editor.selectionModel.selectedText

  PSI (Program Structure Interface):
    File at caret:    PsiDocumentManager.getInstance(project).getPsiFile(document)
    Find element:     PsiUtilBase.getElementAtCaret(editor)
    Find references:  ReferencesSearch.search(element)
    Navigate:         element.navigate(true)

  VFS (Virtual File System):
    Find file:        LocalFileSystem.getInstance().findFileByPath(path)
    Read content:     VfsUtilCore.loadText(virtualFile)
    Refresh:          VirtualFileManager.getInstance().refreshWithoutFileWatcher(false)

  SERVICES:
    App-level:        ApplicationManager.getApplication().getService(MyService::class.java)
    Project-level:    project.getService(MyService::class.java)
    Register in XML:  <applicationService> or <projectService> in plugin.xml

  TOOL WINDOWS:
    Factory:          implements ToolWindowFactory, override createToolWindowContent()
    Content:          ContentFactory.getInstance().createContent(panel, tabName, false)
    Activate:         ToolWindowManager.getInstance(project).getToolWindow("id")?.show()

  NOTIFICATIONS:
    Old API (pre-2022): NotificationGroupManager.getInstance().getNotificationGroup("id")
    New API (2022.3+):  Notification(groupId, title, content, type).notify(project)

  PERSISTENCE:
    State:   @State + @Storage annotations + PersistentStateComponent<State>
    PropertiesComponent: PropertiesComponent.getInstance().setValue("key", "val")

STEP 2c — ANTIGRAVITY API RESOLUTION
  Inter-agent communication:
    - Agents do not call each other directly — SKILL.md orchestrates
    - Output from one agent is passed as INPUT to the next via the SKILL.md step
    - Data format: plain text blocks with labelled sections (see analyzer output format)

  Context loading:
    - SKILL.md frontmatter is ALWAYS loaded (name + description)
    - SKILL.md body loaded ON TRIGGER
    - Agent files loaded ON DEMAND (Claude reads when SKILL.md references them)
    - Scripts/assets NEVER auto-loaded — executed externally

  Eval patterns:
    - Expectations are substring presence checks by default
    - For structured output: check field names or JSON keys in output
    - For files: check file existence + non-empty content

  Description trigger mechanics:
    - Description is matched against incoming user messages semantically
    - More specific trigger phrases → higher precision triggering
    - "Always use this skill when X — do not attempt without" → high recall

STEP 3 — VALIDATE VERSION COMPATIBILITY
  For VS Code: confirm the API is available in the `engines.vscode` minimum version
  For JetBrains: confirm the API is available since the `since-build` version
  Flag any API that requires a newer minimum version — offer downgrade alternative

## Output

```
API RESOLUTION RESULT
═══════════════════════════════════════════════
PLATFORM: [platform]
QUESTION: [what was asked]

ANSWER:
[code snippet — correct API usage]

VERSION GATE: [available since vscode X.XX / IJ build XXX / always]
ALTERNATIVES: [if version gate is too high, offer older compatible approach]
CAVEATS: [any gotchas, deprecation notes, or EDT rules to observe]
```

## Rules
□ Always provide a working code snippet — not just a method name
□ Flag deprecated APIs immediately with the replacement
□ EDT violations in JetBrains are ALWAYS a critical issue — always warn
□ Never invent API methods — if unknown, say so and suggest docs link
□ Version gates must be checked against the project's stated minimum version

NEVER: Suggest `eval()`, `unsafe-eval` CSP, or `setImmediate` in webview scripts.
NEVER: Suggest synchronous I/O in JetBrains action handlers.
