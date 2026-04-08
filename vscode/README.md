# Antigravity AI

**Multi-Agent · LiteLLM-Routed · Cost-Optimised AI Engineering Assistant for VS Code**

A production-grade VS Code extension that embeds a multi-agent AI system (Planner / Coder / Debugger) powered by a [LiteLLM](https://github.com/BerriAI/litellm) proxy. Free models first. Streaming responses. Context-aware.

---

## Features

- **Streaming chat panel** — sidebar webview with live token streaming
- **Command palette integration** — `Antigravity: Fix`, `Explain`, `Optimize`, `Generate Tests`, `Refactor`
- **Right-click context menu** — on any selection in any file
- **Multi-agent routing** — Planner, Coder, or Debugger activated based on task intent
- **Automatic model selection** — DeepSeek for code, Qwen for general, Groq for fast, Cerebras for large context
- **Fallback chain** — Qwen → DeepSeek → Mistral → Groq (automatic retry)
- **IDE context injection** — active file, cursor position, selection, and diagnostics sent with every request
- **Claude locked by default** — only unlocked when explicitly requested

---

## Quick Start

### 1. Start the LiteLLM proxy

**Option A — Docker (recommended):**
```bash
cd litellm
cp .env.example .env
# Fill in at least OPENROUTER_API_KEY or GROQ_API_KEY in .env
docker compose up -d
```

**Option B — pip:**
```bash
pip install litellm
# Set your keys as environment variables, then:
litellm --config litellm/config.yaml --port 4000
```

Verify it's running: `curl http://localhost:4000/health`

### Deploy LiteLLM on Render

This repo now includes a [`render.yaml`](../render.yaml) blueprint and a [`litellm/Dockerfile`](../litellm/Dockerfile) for the LiteLLM service.

On Render:

1. Create a new Blueprint service from this GitHub repo.
2. Set `LITELLM_MASTER_KEY`, `OPENROUTER_API_KEY_1`, `OPENROUTER_API_KEY_2`, and `OPENROUTER_API_KEY_3` in the Render environment.
3. After deploy, copy your Render URL, for example `https://kairos-litellm.onrender.com`.
4. In VS Code, set `kairos.litellmBaseUrl` to that Render URL.

### 2. Install the extension (development mode)

```bash
cd extension
npm install
npm run build
```

Then press `F5` in VS Code to launch the Extension Development Host.

### 3. Configure (optional)

`Ctrl+Shift+P` → `Antigravity: Configure`

| Setting | Default | Description |
|---|---|---|
| `kairos.litellmBaseUrl` | `http://localhost:4000` or `https://your-service.onrender.com` | LiteLLM proxy URL |
| `kairos.litellmApiKey` | `sk-KAIROS` | Proxy master key |
| `kairos.defaultModel` | `gpt-oss-120b` | Default model alias |
| `kairos.maxContextLines` | `200` | Max file lines to send |

---

## Model Routing

| Task | Model | Reason |
|---|---|---|
| Code generation / debug | DeepSeek | Best code model in free tier |
| General / analysis | Qwen | Broad reasoning, stable |
| Fast / simple | Groq | Lowest latency |
| Fallback | Mistral | Reliable free fallback |
| Large context (>20k tokens) | Cerebras | 128k window |
| Explanation | Qwen | General purpose |
| Deep reasoning | Claude | **LOCKED** — explicit opt-in only |

---

## Agent System

| Agent | Activated by | Role |
|---|---|---|
| 🧠 **Planner** | Complex tasks, refactor, migration | Architecture, risk analysis, phased plans |
| 💻 **Coder** | Simple creation, direct code requests | Precise implementation, minimal changes |
| 🔍 **Debugger** | fix/bug/error/crash keywords | Root-cause diagnosis, minimal fix |

---

## Free API Keys

| Provider | Models | Get key |
|---|---|---|
| [OpenRouter](https://openrouter.ai/keys) | Qwen, DeepSeek, Mistral | Free tier |
| [Groq](https://console.groq.com/keys) | Llama 3.1 | Free tier |
| [Gemini](https://aistudio.google.com/app/apikey) | Gemini Flash | Free tier |

---

## Project Structure

```
extension/
├── src/
│   ├── extension.ts              # Entry point
│   ├── agent/
│   │   ├── classifier.ts         # Intent + complexity + risk (Layer 1)
│   │   └── orchestrator.ts       # Main agent loop + fallback retry
│   ├── litellm/
│   │   ├── client.ts             # SSE streaming client
│   │   ├── models.ts             # Routing table
│   │   └── systemPrompt.ts       # Prompt builder (reads .md spec)
│   ├── webview/
│   │   └── ChatViewProvider.ts   # Sidebar webview provider
│   ├── commands/
│   │   └── index.ts              # Command palette registrations
│   └── utils/
│       ├── workspace.ts          # VS Code context collection
│       └── logger.ts             # Output channel logger
├── media/
│   ├── chat.css                  # Dark-mode chat UI
│   ├── chat.js                   # Streaming webview frontend
│   └── sidebar-icon.svg          # Activity bar icon
├── litellm/
│   ├── config.yaml               # LiteLLM proxy config
│   ├── docker-compose.yml        # Docker setup
│   └── .env.example              # API key template
└── antigravity_master_system_prompt.md   # Agent spec (injected at runtime)
```

---

## Development

```bash
npm run build          # One-shot build (esbuild)
npm run watch          # Watch mode (tsc)
```

Logs appear in: **Output panel → Antigravity AI**
