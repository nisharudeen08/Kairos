# JetBrains Plugin Guide

Deep-dive reference for JetBrains IntelliJ Platform plugin development (Kotlin).
Read when building or debugging JetBrains-specific components.

---

## Table of Contents
1. [Plugin Lifecycle](#1-plugin-lifecycle)
2. [EDT Rules (Critical)](#2-edt-rules-critical)
3. [Extension Points Reference](#3-extension-points-reference)
4. [Services Pattern](#4-services-pattern)
5. [Tool Windows](#5-tool-windows)
6. [Actions](#6-actions)
7. [PSI & VFS Access](#7-psi--vfs-access)
8. [Common Pitfalls](#8-common-pitfalls)
9. [Publishing Checklist](#9-publishing-checklist)

---

## 1. Plugin Lifecycle

```
IDE starts → Plugin loaded → Components/services instantiated
  → PostStartupActivity.runActivity() called (project opened)
  → User interaction → Actions fire, services respond
  → Project closed → Project-level services disposed
  → IDE shutdown → App-level services disposed
```

**Plugin startup activity:**
```kotlin
class MyStartupActivity : StartupActivity {
  override fun runActivity(project: Project) {
    // Called once per project open
    // OK to access project services here
    MyProjectService.getInstance(project).initialize()
  }
}
```
Register in plugin.xml:
```xml
<postStartupActivity implementation="com.kairos.MyStartupActivity"/>
```

---

## 2. EDT Rules (Critical)

The Event Dispatch Thread (EDT) is the UI thread. **Blocking it freezes the IDE.**

### Rules:
- ✅ UI reads/writes — ONLY on EDT
- ✅ PSI reads — on EDT or inside `ReadAction`
- ✅ PSI writes — inside `WriteCommandAction`
- ❌ Network calls — NEVER on EDT
- ❌ File I/O — NEVER on EDT
- ❌ Long computation — NEVER on EDT
- ❌ Database queries — NEVER on EDT

### Patterns:

```kotlin
// Run something on a background thread:
ApplicationManager.getApplication().executeOnPooledThread {
  val result = networkCall()
  // Then update UI back on EDT:
  ApplicationManager.getApplication().invokeLater {
    updateUiWith(result)
  }
}

// Read PSI safely from background thread:
val result = ReadAction.compute<String, Throwable> {
  psiFile.text
}

// Write PSI (must be on EDT, inside write action):
ApplicationManager.getApplication().invokeLater {
  WriteCommandAction.runWriteCommandAction(project) {
    document.insertString(offset, "text")
  }
}

// Show progress bar for long operation:
ProgressManager.getInstance().runProcessWithProgressSynchronously({
  // background work
  val result = longOperation()
  ApplicationManager.getApplication().invokeLater { renderResult(result) }
}, "Working...", true, project)

// Coroutine-style (IntelliJ 2022.3+):
cs.launch(Dispatchers.IO) {
  val result = networkCall()
  withContext(Dispatchers.EDT) {
    updateUiWith(result)
  }
}
```

---

## 3. Extension Points Reference

Common extension points registered in `plugin.xml`:

```xml
<extensions defaultExtensionNs="com.intellij">

  <!-- Tool Window (sidebar panel) -->
  <toolWindow id="MyTool" anchor="right|left|bottom|top"
              secondary="false"
              factoryClass="com.kairos.MyToolWindowFactory"
              icon="/icons/tool.svg"/>

  <!-- Application service (singleton for IDE lifetime) -->
  <applicationService serviceImplementation="com.kairos.MyAppService"/>

  <!-- Project service (one per open project) -->
  <projectService serviceImplementation="com.kairos.MyProjectService"/>

  <!-- Post-startup activity -->
  <postStartupActivity implementation="com.kairos.MyStartupActivity"/>

  <!-- File type -->
  <fileType name="KairosFile" implementationClass="com.kairos.KairosFileType"
            fieldName="INSTANCE" extensions="kairos;kai"/>

  <!-- Syntax highlighter -->
  <lang.syntaxHighlighterFactory language="KairosLang"
    implementationClass="com.kairos.KairosSyntaxHighlighterFactory"/>

  <!-- Completion contributor -->
  <completion.contributor language="any"
    implementationClass="com.kairos.MyCompletionContributor"/>

  <!-- Inspection tool -->
  <localInspection language="JAVA"
    implementationClass="com.kairos.MyInspection"
    displayName="My Inspection"
    groupName="Kairos"
    enabledByDefault="true"
    level="WARNING"/>

  <!-- Annotator -->
  <annotator language="kotlin"
    implementationClass="com.kairos.MyAnnotator"/>

  <!-- Settings page (Preferences → Tools → My Plugin) -->
  <applicationConfigurable parentId="tools"
    instance="com.kairos.MyConfigurable"
    id="com.kairos.settings"
    displayName="My Plugin Settings"/>

  <!-- Persisted settings state -->
  <applicationService serviceImplementation="com.kairos.MySettings"/>

</extensions>
```

---

## 4. Services Pattern

Services are singletons managed by the platform. Prefer services over global objects.

```kotlin
// Application-level service (IDE-wide singleton)
@Service(Service.Level.APP)
class MyAppService {
  companion object {
    fun getInstance(): MyAppService =
      ApplicationManager.getApplication().getService(MyAppService::class.java)
  }

  private val cache = mutableMapOf<String, String>()

  fun get(key: String): String? = cache[key]
  fun set(key: String, value: String) { cache[key] = value }
}

// Project-level service (one per project)
@Service(Service.Level.PROJECT)
class MyProjectService(val project: Project) {
  companion object {
    fun getInstance(project: Project): MyProjectService =
      project.getService(MyProjectService::class.java)
  }

  fun doProjectWork(): String {
    return project.name  // safe — project reference is valid for service lifetime
  }
}
```

**Persisted state (survives IDE restart):**
```kotlin
@Service(Service.Level.APP)
@State(name = "MySettings", storages = [Storage("myPlugin.xml")])
class MySettings : PersistentStateComponent<MySettings.State> {
  data class State(var apiUrl: String = "", var model: String = "gpt-4o")

  private var myState = State()

  override fun getState(): State = myState
  override fun loadState(state: State) { myState = state }

  companion object {
    fun getInstance(): MySettings = service()
  }
}
```

---

## 5. Tool Windows

```kotlin
// Factory — registered in plugin.xml as <toolWindow factoryClass="..."/>
class ChatToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val chatPanel = ChatPanel(project)
    val content = ContentFactory.getInstance()
      .createContent(chatPanel, "", false)  // "" = default tab title
    toolWindow.contentManager.addContent(content)
  }

  // Optional: control visibility based on project type
  override fun isApplicable(project: Project): Boolean = true
}

// Panel — extends JPanel or uses JCEF for HTML rendering
class ChatPanel(private val project: Project) : JPanel(BorderLayout()) {
  // ... (see examples.md Example 3 for full implementation)
}

// Programmatically show a tool window:
fun showChatWindow(project: Project) {
  val toolWindow = ToolWindowManager.getInstance(project)
    .getToolWindow("MyToolWindowId") ?: return
  toolWindow.show()
  toolWindow.activate(null)
}
```

---

## 6. Actions

```kotlin
// Simple action
class MyAction : AnAction("My Action") {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    // Do work — but NOT long-running work on EDT!
    val editor = e.getData(CommonDataKeys.EDITOR) ?: return
    val selectedText = editor.selectionModel.selectedText ?: return

    // Kick off background work
    ApplicationManager.getApplication().executeOnPooledThread {
      val result = processText(selectedText)
      ApplicationManager.getApplication().invokeLater {
        showResult(project, result)
      }
    }
  }

  // Controls whether action is enabled/visible
  override fun update(e: AnActionEvent) {
    val editor = e.getData(CommonDataKeys.EDITOR)
    val hasSelection = editor?.selectionModel?.hasSelection() == true
    e.presentation.isEnabledAndVisible = hasSelection
  }
}
```

**Register in plugin.xml:**
```xml
<actions>
  <action id="Kairos.MyAction"
          class="com.kairos.MyAction"
          text="Process Selection"
          description="Process selected text with Kairos">
    <add-to-group group-id="EditorPopupMenu" anchor="first"/>
    <keyboard-shortcut keymap="$default" first-keystroke="ctrl alt K"/>
  </action>
</actions>
```

---

## 7. PSI & VFS Access

**PSI (Program Structure Interface)** — the AST of source files.

```kotlin
// Get PSI file from editor
val psiFile = PsiDocumentManager.getInstance(project)
  .getPsiFile(editor.document) ?: return

// Get element at cursor
val element = psiFile.findElementAt(editor.caretModel.offset) ?: return

// Find all references to a symbol
val references = ReferencesSearch.search(element).toList()

// Navigate to a PSI element
element.navigate(true)  // true = request focus
```

**VFS (Virtual File System)** — abstract file access layer.

```kotlin
// Find a file by path
val vFile = LocalFileSystem.getInstance()
  .findFileByPath("/path/to/file.kt") ?: return

// Read file contents
val text = VfsUtilCore.loadText(vFile)

// Watch for file changes
val connection = ApplicationManager.getApplication().messageBus.connect()
connection.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
  override fun after(events: List<VFileEvent>) {
    events.forEach { event ->
      if (event.file?.name?.endsWith(".kt") == true) {
        handleKotlinFileChange(event.file!!)
      }
    }
  }
})
```

---

## 8. Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| IDE freezes on action | Blocking I/O on EDT | Move to `executeOnPooledThread` |
| `AssertionError: Must be EDT` | UI update off EDT | Wrap in `invokeLater` |
| `PluginException: Read access allowed` | PSI read off EDT | Wrap in `ReadAction.compute` |
| NPE in startup | Project not ready | Use `PostStartupActivity` |
| Plugin not found at runtime | Wrong `<depends>` | Match `<depends>` to module used |
| Settings not persisting | Missing `@State` / `@Storage` | Add annotations to service |
| Action always disabled | `update()` not overridden | Override `update()` to set enabled |
| Duplicate plugin ID | Non-unique `<id>` | Use reverse-domain format |
| Build fails: `incompatible` | `since-build` too new | Lower `since-build` or upgrade SDK |

---

## 9. Publishing Checklist

```
plugin.xml:
  □ <id> is unique reverse-domain format
  □ <version> bumped
  □ <idea-version since-build> and until-build set
  □ <vendor> with email and url
  □ <description> is HTML, 40+ words
  □ <change-notes> updated for this release

build.gradle.kts:
  □ intellij.version matches minimum target IDE
  □ patchPluginXml has sinceBuild + untilBuild
  □ signPlugin configured (required for marketplace since 2021)
  □ publishPlugin has PUBLISH_TOKEN from env

Commands:
  ./gradlew verifyPlugin       # check compatibility
  ./gradlew buildPlugin        # produces build/distributions/*.zip
  ./gradlew runIde             # smoke test in sandbox IDE
  ./gradlew publishPlugin      # publish to JetBrains Marketplace

Token setup:
  Get token: https://plugins.jetbrains.com/author/me/tokens
  Set env: $env:PUBLISH_TOKEN = "..."  (PowerShell)
```
