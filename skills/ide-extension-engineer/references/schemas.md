# Schemas Reference

All JSON/config/manifest schemas used or produced by the ide-extension-engineer skill.
Read this file when generating or validating manifest files, config files, or eval data.

---

## Table of Contents
1. [VS Code — package.json Schema](#1-vs-code--packagejson-schema)
2. [VS Code — Message Protocol Schema](#2-vs-code--message-protocol-schema)
3. [JetBrains — plugin.xml Schema](#3-jetbrains--pluginxml-schema)
4. [JetBrains — build.gradle.kts Fields](#4-jetbrains--buildgradlekts-fields)
5. [Antigravity — SKILL.md Frontmatter Schema](#5-antigravity--skillmd-frontmatter-schema)
6. [Antigravity — evals.json Schema](#6-antigravity--evalsjson-schema)
7. [Eval Results Schema](#7-eval-results-schema)

---

## 1. VS Code — package.json Schema

```json
{
  "name": "string — kebab-case, no spaces",
  "displayName": "string — human-readable",
  "description": "string — shown in marketplace",
  "version": "string — semver e.g. 0.1.0",
  "publisher": "string — your marketplace publisher ID",
  "engines": {
    "vscode": "string — e.g. ^1.75.0"
  },
  "categories": ["array — e.g. 'Other', 'Language Packs', 'Debuggers'"],
  "keywords": ["array of strings for search"],
  "icon": "string — path to 128x128 PNG",
  "repository": {
    "type": "git",
    "url": "string — GitHub/GitLab URL"
  },
  "license": "string — e.g. MIT",
  "activationEvents": [
    "onStartupFinished",
    "onCommand:myext.commandId",
    "onView:myext.viewId",
    "onLanguage:python"
  ],
  "main": "string — ./dist/extension.js (compiled output)",
  "contributes": {
    "commands": [
      {
        "command": "string — myext.commandId",
        "title": "string — shown in Command Palette",
        "icon": "string — $(codicon-name) or path"
      }
    ],
    "views": {
      "viewContainerId": [
        {
          "id": "string — myext.viewId",
          "name": "string — panel title",
          "type": "webview"
        }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "string — container ID",
          "title": "string",
          "icon": "string — path to SVG"
        }
      ]
    },
    "configuration": {
      "title": "string",
      "properties": {
        "myext.settingKey": {
          "type": "string | boolean | number | array",
          "default": "any",
          "description": "string"
        }
      }
    },
    "menus": {
      "editor/context": [
        {
          "command": "string — commandId",
          "when": "string — context condition",
          "group": "string — e.g. navigation"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src"
  },
  "devDependencies": {
    "@types/vscode": "^1.75.0",
    "@types/node": "^18.0.0",
    "typescript": "^5.0.0",
    "@vscode/vsce": "^2.0.0"
  }
}
```

**Required fields (mandatory for publish):**
`name`, `version`, `publisher`, `engines.vscode`, `main`, `activationEvents`

---

## 2. VS Code — Message Protocol Schema

Standard schema for webview ↔ extension message passing.

```typescript
// All messages must have a `type` field
interface WebviewMessage {
  type: string;
  payload?: unknown;
  requestId?: string;   // optional: for request/response correlation
  error?: string;       // set when type === 'error'
}

// Example message types for a chat extension:
type ChatMessageType =
  | 'user-message'        // webview → extension: user typed a message
  | 'stream-chunk'        // extension → webview: streaming response chunk
  | 'stream-end'          // extension → webview: stream finished
  | 'stream-error'        // extension → webview: stream failed
  | 'history-load'        // extension → webview: load conversation history
  | 'history-clear'       // webview → extension: clear history
  | 'settings-update'     // webview → extension: settings changed
  | 'ready';              // webview → extension: webview DOM loaded

// User message (webview → extension)
interface UserMessagePayload {
  text: string;
  model?: string;
  mode?: string;
  images?: string[];    // base64 encoded
}

// Stream chunk (extension → webview)
interface StreamChunkPayload {
  text: string;
  requestId: string;
  done: false;
}

// Stream end (extension → webview)
interface StreamEndPayload {
  requestId: string;
  done: true;
  totalTokens?: number;
}
```

---

## 3. JetBrains — plugin.xml Schema

```xml
<idea-plugin>
  <!-- REQUIRED -->
  <id>com.vendor.pluginname</id>         <!-- reverse-domain, globally unique -->
  <name>Human Readable Name</name>
  <version>1.0.0</version>
  <vendor email="email" url="url">VendorName</vendor>
  <description><![CDATA[ HTML description ]]></description>

  <!-- REQUIRED: platform compatibility -->
  <idea-version since-build="223" until-build="241.*"/>

  <!-- REQUIRED: what this plugin depends on -->
  <depends>com.intellij.modules.platform</depends>
  <!-- Add more if using language support: -->
  <!-- <depends>com.intellij.modules.java</depends> -->
  <!-- <depends>com.intellij.modules.python</depends> -->

  <!-- OPTIONAL: change notes for marketplace -->
  <change-notes><![CDATA[ <ul><li>1.0.0: Initial release</li></ul> ]]></change-notes>

  <extensions defaultExtensionNs="com.intellij">
    <!-- Tool Window -->
    <toolWindow id="MyToolWindow"
                anchor="right"
                factoryClass="com.vendor.plugin.MyToolWindowFactory"
                icon="/icons/toolwindow.svg"/>

    <!-- Application-level service -->
    <applicationService
      serviceImplementation="com.vendor.plugin.MyAppService"/>

    <!-- Project-level service -->
    <projectService
      serviceImplementation="com.vendor.plugin.MyProjectService"/>

    <!-- Startup activity -->
    <postStartupActivity
      implementation="com.vendor.plugin.MyStartupActivity"/>

    <!-- File type -->
    <fileType name="MyFileType"
              implementationClass="com.vendor.plugin.MyFileType"
              fieldName="INSTANCE"
              extensions="myext"/>
  </extensions>

  <actions>
    <action id="Vendor.ActionId"
            class="com.vendor.plugin.MyAction"
            text="Action Text"
            description="What this action does"
            icon="AllIcons.Actions.Execute">
      <!-- Group placement -->
      <add-to-group group-id="EditorPopupMenu" anchor="first"/>
      <!-- Keyboard shortcut -->
      <keyboard-shortcut keymap="$default" first-keystroke="ctrl alt M"/>
    </action>

    <!-- Action group -->
    <group id="Vendor.ActionGroup" text="My Group" popup="true">
      <add-to-group group-id="MainMenu" anchor="last"/>
      <reference ref="Vendor.ActionId"/>
    </group>
  </actions>
</idea-plugin>
```

---

## 4. JetBrains — build.gradle.kts Fields

```kotlin
plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "1.9.22"
  id("org.jetbrains.intellij") version "1.17.2"  // IntelliJ Gradle Plugin
}

group = "com.vendor"
version = "1.0.0"

repositories {
  mavenCentral()
}

intellij {
  version.set("2023.3")          // IDE version to compile against
  type.set("IC")                  // IC=Community, IU=Ultimate, PY=PyCharm
  plugins.set(listOf("java"))    // additional bundled plugins to depend on
}

tasks {
  withType<JavaCompile> {
    sourceCompatibility = "17"
    targetCompatibility = "17"
  }
  withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
    kotlinOptions.jvmTarget = "17"
  }

  patchPluginXml {
    sinceBuild.set("223")         // 2022.3+
    untilBuild.set("241.*")       // max IDE version supported
    changeNotes.set("<ul><li>...</li></ul>")
  }

  signPlugin {
    certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
    privateKey.set(System.getenv("PRIVATE_KEY"))
    password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
  }

  publishPlugin {
    token.set(System.getenv("PUBLISH_TOKEN"))
    channels.set(listOf("stable"))  // or "beta", "alpha"
  }
}
```

---

## 5. Antigravity — SKILL.md Frontmatter Schema

```yaml
---
name: string                # kebab-case, globally unique within skill set
description: >              # YAML block scalar (multi-line)
  string                    # max 120 words; follows trigger formula (Section 3)
tags:                       # optional; for organisation
  - string
version: string             # optional; semver
author: string              # optional
---
```

**Description formula (must match):**
```
[Action verb] [what skill does] — including [sub-tasks].
Use this skill whenever [trigger 1], [trigger 2], [trigger 3].
Triggers include: "[phrase1]", "[phrase2]", "[phrase3]", "[phrase4]", "[phrase5]".
Always use this skill when [key signal] — do not attempt [task] without this skill.
```

---

## 6. Antigravity — evals.json Schema

```json
{
  "skill_name": "string — matches SKILL.md name field",
  "version": "string — optional semver",
  "evals": [
    {
      "id": "integer — 1-indexed, unique",
      "category": "string — happy-path | edge-case | error-case | regression",
      "prompt": "string — exact user message that should trigger the skill",
      "expected_output": "string — human description of what good output looks like",
      "files": ["array of string paths — relative to skill root; omit if no files"],
      "expectations": [
        "string — verifiable assertion about the output",
        "string — each must be checkable as substring or structural presence"
      ],
      "tags": ["optional array — for filtering in eval viewer"]
    }
  ]
}
```

**Constraint:** min 3 evals, min 2 expectations per eval.
**Required categories:** at least one `happy-path`, one `edge-case`.

---

## 7. Eval Results Schema

Output of `scripts/run_eval.py` — written to `evals/results.json`.

```json
{
  "skill_name": "string",
  "version": "string",
  "run_at": "ISO 8601 timestamp",
  "overall": "float — 0.0 to 1.0 (overall pass rate)",
  "results": [
    {
      "id": "integer — matches eval id",
      "prompt": "string",
      "output": "string — actual model output",
      "pass_rate": "float — passed / total expectations",
      "checks": [
        {
          "expectation": "string — the expectation text",
          "passed": "boolean",
          "reason": "string — optional, why it passed/failed"
        }
      ]
    }
  ]
}
```
