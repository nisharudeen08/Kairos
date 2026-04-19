let vscode;
try {
  vscode = acquireVsCodeApi();
} catch (e) {
  vscode = /** @type {any} */ (window).vscodeApi;
}
if (vscode) {
  /** @type {any} */ (window).vscodeApi = vscode;
}


function safeRender(raw) {
  const html = (typeof marked !== 'undefined')
    ? marked.parse(raw || '')
    : (raw || '').replace(/</g, '&lt;');
  return (typeof DOMPurify !== 'undefined')
    ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
    : html;
}

let _scrollPending = false;
function scheduleScroll() {
  if (_scrollPending) return;
  _scrollPending = true;
  requestAnimationFrame(() => {
    const msgEl = document.getElementById('messages');
    if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;
    _scrollPending = false;
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const modeOptions = [
  { value: 'agent',      label: 'Agent',       icon: 'smart_toy',    color: 'rose'    },
  { value: 'agent-full', label: 'Agent Full',  icon: 'shield',       color: 'rose'    },
  { value: 'fast',       label: 'Fast',        icon: 'bolt',         color: 'indigo'  },
  { value: 'ask',        label: 'Ask',         icon: 'help_outline', color: 'emerald' },
  { value: 'plan',       label: 'Plan',        icon: 'architecture', color: 'amber'   },
];

const modelOptions = [
  // ── AUTO ──
  { value: 'auto',                  label: 'Auto (AI picks)',          provider: 'Auto',       group: 'Auto'       },

  // ── LOCAL (Ollama → ollama.pulsyra.com) ──
  { value: 'gemma-local-fast',      label: '🏠 Gemma 2B (Fast)',          provider: 'Local',      group: 'Local'      },
  { value: 'qwen-coder-ubuntu',     label: '🏠 Qwen 2.5 Coder 7B',        provider: 'Local',      group: 'Local'      },
  { value: 'deepseek-r1-8b',        label: '🏠 DeepSeek R1 8B 🧠',        provider: 'Local',      group: 'Local'      },
  { value: 'kairos-r1-14b',         label: '🏠 Kairos R1 14B 🧠',         provider: 'Local',      group: 'Local'      },
  { value: '360-light',             label: '🏠 360 Light Local',           provider: 'Local',      group: 'Local'      },
  { value: 'kairos-coder',          label: '🏠 KwaiCoder DS Lite',          provider: 'Local',      group: 'Local'      },
  { value: 'gemma-4-scout-local',   label: '🏠 Gemma Scout Local',          provider: 'Local',      group: 'Local'      },

  // ── OPENROUTER (free tier) ──
  { value: 'llama-3.3-70b',         label: 'Llama 3.3 70B',             provider: 'OpenRouter', group: 'OpenRouter'  },
  { value: 'gpt-oss-20b',           label: 'GPT-OSS 20B',               provider: 'OpenRouter', group: 'OpenRouter'  },
  { value: 'gemma-3-27b',           label: 'Gemma 3 27B',               provider: 'OpenRouter', group: 'OpenRouter'  },
  { value: 'lfm-2.5-1.2b-thinking', label: 'LFM 2.5 1.2B Thinking',    provider: 'OpenRouter', group: 'OpenRouter'  },

  // ── GROQ ──
  { value: 'groq-llama-3.1-8b',    label: '⚡ Llama 3.1 8B',             provider: 'Groq',       group: 'Groq'        },
  { value: 'groq-llama-3.3-70b',   label: '⚡ Llama 3.3 70B',            provider: 'Groq',       group: 'Groq'        },
  { value: 'groq-qwen-qwq-32b',    label: '⚡ Qwen QwQ 32B',             provider: 'Groq',       group: 'Groq'        },

  // ── MISTRAL ──
  { value: 'codestral',             label: 'Codestral ⭐',               provider: 'Mistral',    group: 'Mistral'     },
  { value: 'mistral-large',         label: 'Mistral Large',             provider: 'Mistral',    group: 'Mistral'     },

  // ── GEMINI ──
  { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',          provider: 'Gemini',     group: 'Gemini'      },

  // ── GITHUB ──
  { value: 'github-gpt4o',          label: 'GPT-4o',                    provider: 'GitHub',     group: 'GitHub'      },
  { value: 'github-deepseek-r1',    label: 'DeepSeek R1',               provider: 'GitHub',     group: 'GitHub'      },
];


// Models that support reasoning — show reasoning toggle only for these
const REASONING_MODELS = new Set([
  'groq-qwen-qwq-32b', 'lfm-2.5-1.2b-thinking', 'github-deepseek-r1',
  'deepseek-r1-8b', 'kairos-r1-14b',
]);

const reasoningLabels = ['Low', 'Med', 'High'];

// ─── State ────────────────────────────────────────────────────────────────────

let isStreaming       = false;
let streamBuffer      = '';
/** @type {HTMLElement | null} */ let streamTarget = null;
/** @type {HTMLElement | null} */ let cursorEl     = null;
/** @type {AbortController | null} */ let streamAbortController = null;

let currentModeIndex      = 0;  // index into modeOptions
let currentModelIndex     = 0;  // 0 = Auto (first entry)
let currentReasoningLevel = 1;  // 1 | 2 | 3

/** @type {string[]} */ let pendingImages = [];
/** @type {Array<{userText: string, wrapperEl: HTMLElement}>} */
let messageHistory = [];
let messageIndex   = 0;
let lastUserText   = '';
/** @type {HTMLElement | null} */ let lastUserWrapper = null;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const messagesEl          = /** @type {HTMLElement} */ (document.getElementById('messages'));
const inputEl             = /** @type {HTMLTextAreaElement} */ (document.getElementById('user-input'));
const sendBtn             = /** @type {HTMLButtonElement} */ (document.getElementById('btn-send'));
const stopBtn             = /** @type {HTMLButtonElement} */ (document.getElementById('btn-stop'));
const clearBtn            = document.getElementById('btn-clear');
const settingsBtn         = document.getElementById('btn-settings');
const historyBtn          = document.getElementById('btn-history');
const newChatBtn          = document.getElementById('btn-new-chat');
const closeHistoryBtn     = document.getElementById('btn-close-history');
const historySidebar      = document.getElementById('history-sidebar');
const historyListContainer= document.getElementById('history-list-container');
const tokenCounterEl      = document.getElementById('token-counter');

const modeBtn             = document.getElementById('mode-selector-btn');
const modelBtn            = document.getElementById('model-selector-btn');
const reasoningBtn        = document.getElementById('reasoning-selector-btn');
const modeTextEl          = document.getElementById('mode-text');
const modelTextEl         = document.getElementById('model-text');
const reasoningTextEl     = document.getElementById('reasoning-text');

const fileUploadBtn       = document.getElementById('btn-file-upload');
const fileInput           = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
const imageUploadBtn      = document.getElementById('btn-image-upload');
const imageInput          = /** @type {HTMLInputElement} */ (document.getElementById('image-input'));

// ─── Action Bar Buttons ───────────────────────────────────────────────────────
const changesBtn          = document.getElementById('btn-changes');
const terminalBtn         = document.getElementById('btn-terminal');
const artifactsBtn        = document.getElementById('btn-artifacts');
const webBtn              = document.getElementById('btn-web');
const reviewChangesBtn    = document.getElementById('btn-review-changes');

const modeDropdown        = document.getElementById('mode-dropdown');
const modelDropdown       = document.getElementById('model-dropdown');
const modeList            = document.getElementById('mode-list');
const modelList           = document.getElementById('model-list');


// ─── Send / Stop ──────────────────────────────────────────────────────────────

// ─── Button Listeners (Delegated) ─────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);

  // ── Hint chips ──────────────────────────────────────────
  const hintChip = target.closest('.hint-chip');
  if (hintChip) {
    const text = hintChip.querySelector(
      'span:not(.material-symbols-outlined)')?.textContent;
    if (text) fillInput(text);
    return;
  }

  // ── Mode pill ───────────────────────────────────────────
  if (target.closest('#mode-selector-btn')) {
    e.stopPropagation();
    modeDropdown?.classList.toggle('hidden');
    modelDropdown?.classList.add('hidden');
    return;
  }

  // ── Model pill ──────────────────────────────────────────
  if (target.closest('#model-selector-btn')) {
    e.stopPropagation();
    modelDropdown?.classList.toggle('hidden');
    modeDropdown?.classList.add('hidden');
    return;
  }

  // ── Reasoning pill ──────────────────────────────────────
  if (target.closest('#reasoning-selector-btn')) {
    currentReasoningLevel = (currentReasoningLevel % 3) + 1;
    syncControls();
    updateTokenEstimate(); // keep this or whatever might be needed
    return;
  }

  // ── Sidebar close on outside click ──────────────────────
  if (historySidebar?.classList.contains('open')) {
    if (!historySidebar.contains(target) &&
        !target.closest('#btn-history')) {
      historySidebar.classList.remove('open');
    }
  }

  // ── Close dropdowns (only if click was outside them) ────
  if (!target.closest('#mode-dropdown') &&
      !target.closest('#mode-selector-btn')) {
    modeDropdown?.classList.add('hidden');
  }
  if (!target.closest('#model-dropdown') &&
      !target.closest('#model-selector-btn')) {
    modelDropdown?.classList.add('hidden');
  }

  // ── Main buttons ────────────────────────────────────────
  if (target.closest('#btn-send'))     { handleSend(); return; }
  if (target.closest('#btn-stop')) {
    if (streamAbortController) {
      streamAbortController.abort();
      streamAbortController = null;
    }
    handleDone(true);
    return;
  }
  if (target.closest('#btn-clear')) {
    if (vscode) vscode.postMessage({ type: 'clearChat' });
    return;
  }
  if (target.closest('#btn-settings')) {
    if (vscode) vscode.postMessage({ type: 'openSettings' });
    return;
  }
  if (target.closest('#btn-new-chat')) {
    if (vscode) vscode.postMessage({ type: 'clearChat' });
    appendSystemMessage('✨ New conversation started.');
    return;
  }

  // ── History ─────────────────────────────────────────────
  if (target.closest('#btn-history')) {
    historySidebar?.classList.add('open');
    if (vscode) vscode.postMessage({ type: 'getHistory' });
    return;
  }
  if (target.closest('#btn-close-history')) {
    historySidebar?.classList.remove('open');
    return;
  }

  // ── Action bar ───────────────────────────────────────────
  if (target.closest('#btn-changes')) {
    if (vscode) vscode.postMessage({ type: 'openChanges' });
    return;
  }
  if (target.closest('#btn-terminal')) {
    if (vscode) vscode.postMessage({ type: 'openTerminal' });
    return;
  }
  if (target.closest('#btn-artifacts')) {
    if (vscode) vscode.postMessage({ type: 'openArtifacts' });
    return;
  }
  if (target.closest('#btn-web')) {
    if (vscode) vscode.postMessage({ type: 'openWeb' });
    return;
  }
  if (target.closest('#btn-review-changes')) {
    if (vscode) vscode.postMessage({ type: 'reviewChanges' });
    return;
  }

  // ── File upload triggers ─────────────────────────────────
  if (target.closest('#btn-file-upload'))  { fileInput?.click(); return; }
  if (target.closest('#btn-image-upload')) { imageInput?.click(); return; }
  
  // ── Inline Message Buttons (Copy etc) ───────────────────
  const copyMsgBtn = target.closest('.copy-msg-btn');
  if (copyMsgBtn) {
    // handled in createCopyMessageButton
    return;
  }
});

// ─── Input Handlers ───────────────────────────────────────────────────────────

// Added a separate delegation for the case where inputEl was null at start
document.addEventListener('input', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  if (target.id === 'user-input') {
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 180) + 'px';
    updateTokenEstimate();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && (/** @type {HTMLElement} */ (e.target).id === 'user-input')) {
    e.preventDefault();
    handleSend();
  }
});

// ─── Top-bar & controls ───────────────────────────────────────────────────────



fileInput?.addEventListener('change',  handleFileSelect);
imageInput?.addEventListener('change', handleImageSelect);

// ─── Action Bar Button Handlers ───────────────────────────────────────────────


// ─── Dropdowns ────────────────────────────────────────────────────────────────

// Handled by document level delegation

// BUG-FIX 1 cont.: single event delegation per list — no duplicates
modeList?.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = /** @type {HTMLElement} */ (e.target)?.closest('[data-index]');
  if (item) setMode(parseInt(item.getAttribute('data-index') || '0', 10));
});

modelList?.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = /** @type {HTMLElement} */ (e.target)?.closest('[data-index]');
  if (item) setModel(parseInt(item.getAttribute('data-index') || '0', 10));
});



// ─── VS Code message bus ──────────────────────────────────────────────────────

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!vscode) return;
  switch (msg.type) {
    case 'token':           handleToken(msg.content); break;
    case 'done':            handleDone(false, msg.metadata); break;
    case 'error':           handleError(msg.message); break;
    case 'systemMessage':   appendSystemMessage(msg.text); break;
    case 'clear':           clearMessages(); break;
    case 'fileChange':      appendFileReview(msg.path, msg.content); break;
    case 'historyList':     renderHistory(msg.sessions); break;
    // Session replay — visually reconstruct past conversation
    case 'replayUser':
      replayUserMessage(msg.text);
      break;
    case 'replayAssistant':
      replayAssistantMessage(msg.text);
      break;
    case 'permissionRequest': showPermissionDialog(msg.scope, msg.detail); break;
  }
});

// ─── Build dropdown HTML ──────────────────────────────────────────────────────

function buildDropdowns() {
  if (modeList) {
    modeList.innerHTML = modeOptions.map((opt, i) => `
      <div data-index="${i}"
           class="flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 cursor-pointer rounded-lg transition-colors text-[11px] text-slate-300 hover:text-white">
        <span class="material-symbols-outlined text-sm text-${opt.color}-400">${opt.icon}</span>
        <div>
          <div class="font-semibold">${opt.label}</div>
        </div>
      </div>
    `).join('');
  }

  if (modelList) {
    // Group models by provider (Auto group comes first)
    const providers = [...new Set(modelOptions.map(m => m.provider))];
    modelList.innerHTML = providers.map(provider => {
      const items = modelOptions
        .map((opt, i) => ({ opt, i }))
        .filter(({ opt }) => opt.provider === provider);
      const isAuto = provider === 'Auto';
      return `
        <div class="px-2 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest ${
          isAuto ? 'text-violet-400' : 'text-slate-600'
        } border-b border-white/5 mb-1">── ${provider} ──</div>
        ${items.map(({ opt, i }) => `
          <div data-index="${i}"
               class="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer rounded-lg transition-colors text-[11px] ${
                 isAuto ? 'text-violet-300 font-semibold' : 'text-slate-300'
               } hover:text-white">
            ${isAuto ? '🤖' : `<span class="opacity-40 text-[9px] font-mono mr-1">[${opt.provider}]</span>`}
            ${opt.label}
          </div>
        `).join('')}
      `;
    }).join('');
  }
}

// ─── Selector state ───────────────────────────────────────────────────────────

function setMode(index) {
  currentModeIndex = index;
  syncControls();
  modeDropdown?.classList.add('hidden');
}

function setModel(index) {
  currentModelIndex = index;
  syncControls();
  modelDropdown?.classList.add('hidden');
}

function syncControls() {
  const mode  = modeOptions[currentModeIndex];
  const model = modelOptions[currentModelIndex];

  if (modeTextEl)      modeTextEl.textContent  = mode.label;
  if (modelTextEl)     modelTextEl.textContent  = `[${model.provider}] ${model.label}`;
  if (reasoningTextEl) reasoningTextEl.textContent = reasoningLabels[currentReasoningLevel - 1];

  // Update mode button color
  const colorMap = {
    rose:    'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20',
    amber:   'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20',
    indigo:  'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20',
  };
  if (modeBtn) {
    const iconEl = modeBtn.querySelector('.material-symbols-outlined');
    if (iconEl) iconEl.textContent = mode.icon;
    modeBtn.className =
      `selector-pill flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer ` +
      `transition-all uppercase tracking-wider border ${colorMap[mode.color] || colorMap.indigo}`;
  }

  // BUG-FIX 4: show/hide reasoning button based on selected model
  const showReasoning = REASONING_MODELS.has(model.value) || currentReasoningLevel > 1;
  if (reasoningBtn) {
    reasoningBtn.classList.toggle('hidden', !showReasoning);
    // Highlight reasoning button at level 3
    reasoningBtn.classList.toggle('text-amber-400', currentReasoningLevel === 3);
    reasoningBtn.classList.toggle('border-amber-500/30', currentReasoningLevel === 3);
  }

  // Highlight active model in dropdown
  const modelItems = modelList?.querySelectorAll('[data-index]');
  modelItems?.forEach((el, i) => {
    el.classList.toggle('bg-white/5', i === currentModelIndex);
    el.classList.toggle('text-primary', i === currentModelIndex);
  });

  // Highlight active mode in dropdown
  const modeItems = modeList?.querySelectorAll('[data-index]');
  modeItems?.forEach((el, i) => {
    el.classList.toggle('bg-white/5', i === currentModeIndex);
    el.classList.toggle('text-primary', i === currentModeIndex);
  });
}

// ─── Token estimate ───────────────────────────────────────────────────────────

function updateTokenEstimate() {
  if (!tokenCounterEl || !inputEl) return;
  const approxTokens = Math.ceil(inputEl.value.length / 4);
  tokenCounterEl.textContent = approxTokens > 0 ? `~${approxTokens} tokens` : '';
}

// ─── Sending ──────────────────────────────────────────────────────────────────

function handleSend() {
  const input = inputEl || /** @type {HTMLTextAreaElement} */ (document.getElementById('user-input'));
  if (!input) return;
  const text = input.value.trim();
  if (!text || isStreaming) return;

  removeEmptyState();
  const userWrapper = appendUserMessage(text);
  lastUserText = text;
  lastUserWrapper = userWrapper;

  input.value = '';
  input.style.height = 'auto';
  const tokens = tokenCounterEl || document.getElementById('token-counter');
  if (tokens) tokens.textContent = '';

  streamAbortController = new AbortController();

  // Capture images to send — then clear so next message starts fresh
  const imagesToSend = [...pendingImages];
  pendingImages = [];

  beginStream();

  if (vscode) {
    try {
      vscode.postMessage({
        type: 'userMessage',
        text,
        mode:           modeOptions[currentModeIndex].value,
        model:          modelOptions[currentModelIndex].value,
        reasoningLevel: currentReasoningLevel,
        images:         imagesToSend,
      });
    } catch (err) {
      console.error('Failed to post message', err);
      handleDone(true); // reset UI state
      appendSystemMessage('❌ Failed to communicate with extension. Please reload window.');
    }
  } else {
    handleDone(true);
    appendSystemMessage('❌ VS Code API not acquired. Please reload window.');
  }
}

// ─── Stream lifecycle ─────────────────────────────────────────────────────────

function beginStream() {
  isStreaming  = true;
  streamBuffer = '';

  if (sendBtn) sendBtn.disabled = true;
  stopBtn?.classList.remove('hidden');

  const wrapper = createEl('div', 'flex flex-col items-start w-full gap-2 animation-slide-up');
  const bubble  = createEl('div', 'stream-bubble p-4 rounded-2xl bg-white/5 border border-white/10 text-[13px] text-slate-200 leading-relaxed w-full relative group');
  const content = createEl('div', 'prose-content');
  content.id = 'stream-content';

  // Blinking cursor
  cursorEl = createEl('span', 'stream-cursor');
  content.appendChild(cursorEl);

  bubble.appendChild(content);
  wrapper.appendChild(bubble);
  wrapper.id = 'stream-message';
  messagesEl.appendChild(wrapper);
  scrollToBottom();

  streamTarget = content;
}

/** @param {string} content */
function handleToken(content) {
  if (!streamTarget) return;

  streamBuffer += content;

  if (cursorEl && streamTarget.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
  }

  streamTarget.innerHTML = safeRender(streamBuffer);

  // Re-attach cursor at end
  if (cursorEl) {
    streamTarget.appendChild(cursorEl);
  }

  scheduleScroll();
}

/**
 * @param {boolean} aborted
 * @param {any} [metadata]
 */
function handleDone(aborted = false, metadata = null) {
  isStreaming = false;
  
  // Record this completed exchange for rollback (skip if user aborted)
  const streamMsgEl = document.getElementById('stream-message');
  const rollbackIndex = messageHistory.length; // capture BEFORE push
  if (streamMsgEl && !aborted) {
    messageHistory.push({
      userText: lastUserText,
      wrapperEl: streamMsgEl,
      userEl: lastUserWrapper,
    });
    messageIndex = messageHistory.length;
  }
  
  streamAbortController = null;

  if (sendBtn) sendBtn.disabled = false;
  stopBtn?.classList.add('hidden');

  if (cursorEl && streamTarget?.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
  }
  cursorEl = null;

  if (streamTarget) {
    streamTarget.innerHTML = safeRender(streamBuffer);
    // Attach copy buttons to code blocks
    attachCodeCopyButtons(streamTarget);
  }

  // Add copy, edit, and rollback buttons to the bubble
  const streamMsg = document.getElementById('stream-message');
  if (streamMsg) {
    const bubble = streamMsg.querySelector('.stream-bubble');
    if (bubble) {
      const copyBtn     = createCopyMessageButton(streamBuffer);
      const editBtn     = createEditButton(lastUserText);
      const rollbackBtn = createRollbackButton(rollbackIndex);
      bubble.appendChild(rollbackBtn);
      bubble.appendChild(editBtn);
      bubble.appendChild(copyBtn);
    }
    streamMsg.id = '';
  }

  if (aborted) {
    appendSystemMessage('Generation stopped.');
  } else if (metadata) {
    appendAgentMeta(metadata);
  }

  streamBuffer = '';
  streamTarget = null;

  scrollToBottom();
}

/** @param {string} message */
function handleError(message) {
  isStreaming = false;
  streamAbortController = null;

  if (sendBtn) sendBtn.disabled = false;
  stopBtn?.classList.add('hidden');

  document.getElementById('stream-message')?.remove();
  streamTarget = null;
  cursorEl     = null;

  const wrapper = createEl('div', 'flex flex-col items-start w-full gap-2');
  const bubble  = createEl('div', 'p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[12px] text-red-400 w-full');
  bubble.innerHTML =
    `<div class="flex items-center gap-2 mb-1 font-bold">` +
    `<span class="material-symbols-outlined text-sm">error</span>Error</div>` +
    `<div class="text-red-300/80 text-[11px]">${escapeHtml(message)}</div>`;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

// ─── Message renderers ────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
function appendUserMessage(text) {
  const wrapper = createEl('div', 'flex flex-col items-end w-full gap-1 animation-slide-up');
  const bubble  = createEl('div',
    'px-4 py-3 rounded-2xl bg-primary text-slate-900 text-[13px] font-medium ' +
    'shadow-lg shadow-primary/10 max-w-[85%] break-words');
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  // Render pending attachment previews
  if (pendingImages.length > 0) {
    const previews = createEl('div', 'flex flex-wrap gap-2 mt-1');
    pendingImages.forEach(src => {
      if (src.startsWith('data:image/')) {
        // Real image — show thumbnail
        const img = /** @type {HTMLImageElement} */ (document.createElement('img'));
        img.src = src;
        img.className = 'w-16 h-16 object-cover rounded-lg border border-white/10';
        previews.appendChild(img);
      } else {
        // File attachment — show filename pill instead of broken <img>
        const namePart = src.split(';').find(p => p.startsWith('name='));
        const fileName = namePart
          ? decodeURIComponent(namePart.replace('name=', ''))
          : 'file';
        const pill = createEl('div',
          'flex items-center gap-1.5 px-2 py-1 rounded-lg ' +
          'bg-white/8 border border-white/10 text-[10px] text-slate-300');
        pill.innerHTML =
          '<span class="material-symbols-outlined text-[13px] text-primary">attach_file</span>' +
          escapeHtml(fileName);
        previews.appendChild(pill);
      }
    });
    wrapper.appendChild(previews);
  }

  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

/** @param {string} text */
function appendSystemMessage(text) {
  removeEmptyState();
  const wrapper = createEl('div', 'flex justify-center w-full py-1');
  const pill    = createEl('div',
    'px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] text-slate-500');
  pill.innerHTML = text;
  wrapper.appendChild(pill);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

// ─── Session Replay Renderers ─────────────────────────────────────────────────

/**
 * Renders a past user message during session replay.
 * Slightly dimmed to distinguish replayed messages from the live conversation.
 * @param {string} text
 */
function replayUserMessage(text) {
  if (!text) return;
  removeEmptyState();

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;width:100%;gap:4px;opacity:0.82;';

  const bubble = document.createElement('div');
  bubble.style.cssText =
    'background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;' +
    'padding:10px 16px;border-radius:16px 4px 16px 16px;' +
    'font-size:13px;max-width:85%;word-break:break-word;line-height:1.6;';
  bubble.textContent = text;

  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

/**
 * Renders a past assistant message during session replay.
 * @param {string} text
 */
function replayAssistantMessage(text) {
  if (!text) return;
  removeEmptyState();

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;width:100%;gap:4px;opacity:0.82;';

  const bubble = document.createElement('div');
  bubble.style.cssText =
    'background:rgba(26,28,46,0.7);border:1px solid rgba(255,255,255,0.07);' +
    'border-radius:4px 16px 16px 16px;padding:14px 16px;width:100%;position:relative;';

  const content = document.createElement('div');
  content.style.cssText = 'font-size:13px;line-height:1.75;color:var(--text);';
  content.innerHTML = safeRender(text);
  attachCodeCopyButtons(content);

  const copyBtn = createCopyMessageButton(text);
  bubble.appendChild(content);
  bubble.appendChild(copyBtn);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

// ─── Agent metadata pill ──────────────────────────────────────────────────────

/** @param {any} meta */
function appendAgentMeta(meta) {
  if (!meta) return;
  const agentColors = { Planner: 'indigo', Coder: 'emerald', Debugger: 'rose' };
  const color = agentColors[meta.agent] || 'slate';
  const confColors = { HIGH: 'emerald', MEDIUM: 'amber', LOW: 'rose' };
  const confColor = confColors[meta.confidence] || 'slate';

  const pill = createEl('div',
    `flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/3 border border-white/5 ` +
    `text-[10px] text-slate-500 w-fit`);
  pill.innerHTML =
    `<span class="text-${color}-400 font-bold uppercase">${meta.agent}</span>` +
    `<span class="text-slate-600">·</span>` +
    `<span class="font-mono">${escapeHtml(meta.modelLabel || '')}</span>` +
    `<span class="text-slate-600">·</span>` +
    `<span class="text-${confColor}-400">${meta.confidence}</span>`;

  const wrapper = createEl('div', 'flex justify-start w-full pl-1 pb-1');
  wrapper.appendChild(pill);
  messagesEl.appendChild(wrapper);
}


// ─── Copy helpers ─────────────────────────────────────────────────────────────

/** @param {string} rawMarkdown */
function createCopyMessageButton(rawMarkdown) {
  const btn = createEl('button',
    'copy-msg-btn absolute top-2 right-2 p-1.5 rounded-lg bg-white/0 hover:bg-white/10 ' +
    'text-slate-600 hover:text-slate-300 transition-all opacity-0 group-hover:opacity-100');
  btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">content_copy</span>';
  btn.title = 'Copy message';
  btn.addEventListener('click', () => {
    navigator.clipboard?.writeText(rawMarkdown).then(() => {
      btn.innerHTML = '<span class="material-symbols-outlined text-[14px] text-emerald-400">check</span>';
      setTimeout(() => {
        btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">content_copy</span>';
      }, 1800);
    });
  });
  return btn;
}

/** @param {string} userText */
function createEditButton(userText) {
  const btn = createEl('button',
    'edit-msg-btn absolute top-2 right-10 p-1.5 rounded-lg bg-white/0 hover:bg-white/10 ' +
    'text-slate-600 hover:text-slate-300 transition-all opacity-0 group-hover:opacity-100');
  btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">edit</span>';
  btn.title = 'Edit & resend';
  btn.addEventListener('click', () => {
    if (!inputEl) return;
    // Restore the user's message for this specific turn
    inputEl.value = userText;
    inputEl.focus();
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
    updateTokenEstimate();
    // Scroll input into view
    inputEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  return btn;
}

/** @param {number} index */
function createRollbackButton(index) {
  const btn = createEl('button',
    'rollback-msg-btn absolute top-2 right-[4.5rem] p-1.5 rounded-lg bg-white/0 hover:bg-white/10 ' +
    'text-slate-600 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100');
  btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">history</span>';
  btn.title = 'Rollback to before this response';
  btn.addEventListener('click', () => {
    if (!confirm('Remove this response and everything after it?')) return;
    // Remove all message wrappers from this index onward
    for (let i = index; i < messageHistory.length; i++) {
      messageHistory[i]?.wrapperEl?.remove();
      messageHistory[i]?.userEl?.remove();
    }
    messageHistory = messageHistory.slice(0, index);
    messageIndex   = messageHistory.length;
    // Tell the host to rollback history too
    if (vscode) vscode.postMessage({ type: 'clearChat' });
    appendSystemMessage('↩ Rolled back. History cleared — start fresh.');
  });
  return btn;
}

/** @param {HTMLElement} container */
function attachCodeCopyButtons(container) {
  container.querySelectorAll('.code-block-wrapper').forEach((wrapper) => {
    if (wrapper.querySelector('.code-copy-btn')) return; // Already attached
    const pre = wrapper.querySelector('pre');
    if (!pre) return;

    const btn = createEl('button',
      'code-copy-btn absolute top-2 right-2 px-2 py-1 rounded-md text-[10px] font-bold ' +
      'bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white transition-all flex items-center gap-1');
    btn.innerHTML = '<span class="material-symbols-outlined text-[12px]">content_copy</span> Copy';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard?.writeText(code?.textContent || '').then(() => {
        btn.innerHTML = '<span class="material-symbols-outlined text-[12px] text-emerald-400">check</span> Copied!';
        setTimeout(() => {
          btn.innerHTML = '<span class="material-symbols-outlined text-[12px]">content_copy</span> Copy';
        }, 1800);
      });
    });
    /** @type {HTMLElement} */ (wrapper).style.position = 'relative';
    wrapper.appendChild(btn);
  });
}


// ─── Messages state ───────────────────────────────────────────────────────────

function clearMessages() {
  messagesEl.innerHTML = '';

  // Reset all stateful tracking so next session starts clean
  messageHistory  = [];
  messageIndex    = 0;
  lastUserText    = '';
  lastUserWrapper = null;
  streamBuffer    = '';
  streamTarget    = null;
  cursorEl        = null;
  isStreaming     = false;
  streamAbortController = null;
  pendingImages   = [];

  if (sendBtn)  sendBtn.disabled = false;
  stopBtn?.classList.add('hidden');

  renderEmptyState();
}

function renderEmptyState() {
  const hints = [
    { icon: 'terminal',    text: 'Explain my current file structure' },
    { icon: 'bug_report',  text: 'Find bugs in the selected code'    },
    { icon: 'auto_fix_high', text: 'Refactor this function'           },
    { icon: 'science',     text: 'Write tests for this module'        },
  ];

  messagesEl.innerHTML = `
    <div id="empty-state"
         class="h-full flex flex-col items-center justify-center text-center max-w-[280px] mx-auto space-y-5 py-8">
      <div class="relative">
        <div class="w-16 h-16 rounded-3xl bg-primary/10 border border-primary/20 flex items-center
                    justify-center text-primary shadow-2xl shadow-primary/20 animate-pulse-slow">
          <span class="material-symbols-outlined text-[32px]">auto_awesome</span>
        </div>
        <div class="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500
                    border-2 border-[#090b14] flex items-center justify-center">
          <span class="material-symbols-outlined text-[10px] text-white">check</span>
        </div>
      </div>
      <div class="space-y-1">
        <h2 class="text-white font-bold text-[15px]">How can I help today?</h2>
        <p class="text-[11px] text-slate-500 leading-relaxed">
          I'm your Kairos AI agent — I can build, test, debug, and refactor using the latest open-source models.
        </p>
      </div>
      <div class="flex flex-col gap-2 w-full">
        ${hints.map(h => `
          <button class="hint-chip group flex items-center gap-3 p-2.5 rounded-xl
                         bg-white/3 border border-white/5 text-left
                         hover:bg-white/6 hover:border-primary/20 transition-all">
            <span class="material-symbols-outlined text-sm text-slate-600
                         group-hover:text-primary transition-colors">${h.icon}</span>
            <span class="text-[11px] text-slate-400 group-hover:text-slate-200">${h.text}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function removeEmptyState() {
  document.getElementById('empty-state')?.remove();
}

/** @param {string} text */
function fillInput(text) {
  if (!inputEl) return;
  removeEmptyState();
  inputEl.value = text;
  inputEl.focus();
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  updateTokenEstimate();
}

// ─── File review ──────────────────────────────────────────────────────────────

/**
 * @param {string} path
 * @param {string} content
 */
function appendFileReview(path, content) {
  removeEmptyState();
  const wrapper   = createEl('div', 'flex flex-col items-start w-full gap-3 my-2 animation-slide-up');
  const container = createEl('div', 'w-full rounded-2xl bg-white/5 border border-white/10 overflow-hidden shadow-xl');

  const header = createEl('div', 'px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between');
  header.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-primary text-[18px]">edit_document</span>
      <span class="text-[12px] font-bold text-white tracking-tight">${escapeHtml(path)}</span>
    </div>
    <span class="pending-badge text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold uppercase">Pending Review</span>
  `;

  const lines = content.split('\n');
  const displayCode = lines.length > 60
    ? lines.slice(0, 60).join('\n') + '\n\n... (truncated — full content will be written)'
    : content;

  const preview = createEl('div', 'p-4 bg-slate-900/80 overflow-x-auto max-h-[200px] border-b border-white/5');
  preview.innerHTML = `<pre class="text-[11px] font-mono text-slate-400 leading-relaxed"><code>${escapeHtml(displayCode)}</code></pre>`;

  const actions  = createEl('div', 'px-4 py-3 flex gap-2');
  const acceptBtn = createEl('button',
    'flex-1 py-2 rounded-xl bg-primary text-slate-900 text-[11px] font-bold hover:opacity-90 ' +
    'transition-all flex items-center justify-center gap-1.5');
  acceptBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">check</span> Accept & Write';

  const declineBtn = createEl('button',
    'flex-1 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-[11px] ' +
    'font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-1.5');
  declineBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">close</span> Decline';

  acceptBtn.onclick = () => {
    vscode.postMessage({ type: 'acceptFile', path, content });
    container.classList.add('opacity-50', 'pointer-events-none');
    const badge = header.querySelector('.pending-badge');
    if (badge) {
      badge.textContent = '✓ Applied';
      badge.className = 'pending-badge text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold uppercase';
    }
  };

  declineBtn.onclick = () => {
    container.remove();
    appendSystemMessage(`❌ Change declined: ${escapeHtml(path)}`);
  };

  actions.appendChild(declineBtn);
  actions.appendChild(acceptBtn);
  container.appendChild(header);
  container.appendChild(preview);
  container.appendChild(actions);
  wrapper.appendChild(container);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

// ─── History ──────────────────────────────────────────────────────────────────

/** @param {Array<{id:string,title:string,updatedAt:number}>} sessions */
function renderHistory(sessions) {
  if (!historyListContainer) return;

  if (!sessions || sessions.length === 0) {
    historyListContainer.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  padding-top:60px;gap:8px;color:var(--text-faint);text-align:center;">
        <span class="material-symbols-outlined" style="font-size:32px;opacity:0.3;">history_toggle_off</span>
        <span style="font-size:11px;">No conversations yet</span>
        <span style="font-size:10px;max-width:180px;line-height:1.5;opacity:0.7;">
          Complete a conversation to see it here.
        </span>
      </div>`;
    return;
  }

  historyListContainer.innerHTML = sessions.map(s => {
    const d    = new Date(s.updatedAt);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day  = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `
      <div data-session-id="${escapeHtml(s.id)}"
           style="padding:10px 12px;border-radius:10px;cursor:pointer;transition:background 0.15s;
                  border:1px solid transparent;margin-bottom:2px;"
           onmouseover="this.style.background='rgba(255,255,255,0.05)';this.style.borderColor='rgba(255,255,255,0.07)';"
           onmouseout="this.style.background='';this.style.borderColor='transparent';">
        <div style="font-size:12px;color:var(--text-dim);font-weight:500;white-space:nowrap;
                    overflow:hidden;text-overflow:ellipsis;max-width:220px;">
          ${escapeHtml(s.title)}
        </div>
        <div style="font-size:10px;color:var(--text-faint);margin-top:2px;">${day} · ${time}</div>
      </div>`;
  }).join('');

  historyListContainer.querySelectorAll('[data-session-id]').forEach(item => {
    item.addEventListener('click', () => {
      vscode.postMessage({ type: 'loadSession', id: item.getAttribute('data-session-id') });
      // Fix: use .open class (matches CSS) instead of Tailwind -translate-x-full
      historySidebar?.classList.remove('open');
    });
  });
}

// ─── File / image upload ──────────────────────────────────────────────────────

/** @param {Event} event */
function handleFileSelect(event) {
  const target = /** @type {HTMLInputElement} */ (event.target);
  if (!target.files || target.files.length === 0) return;

  const names = Array.from(target.files).map(f => f.name).join(', ');
  appendSystemMessage(
    `<span class="flex items-center gap-1.5">` +
    `<span class="material-symbols-outlined text-[13px]">attach_file</span>` +
    `Reading ${target.files.length} file(s): ${escapeHtml(names)}…</span>`
  );

  Array.from(target.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result?.toString() || '';
      // Store as a structured context block that the model can read
      pendingImages.push(
        `data:text/plain;name=${encodeURIComponent(file.name)};base64,` +
        btoa(unescape(encodeURIComponent(content)))
      );
      appendSystemMessage(
        `<span class="flex items-center gap-1.5 text-emerald-400">` +
        `<span class="material-symbols-outlined text-[13px]">check_circle</span>` +
        `${escapeHtml(file.name)} ready to send</span>`
      );
    };
    reader.onerror = () => {
      appendSystemMessage(
        `<span class="text-red-400">❌ Failed to read ${escapeHtml(file.name)}</span>`
      );
    };
    reader.readAsText(file);
  });

  target.value = '';
}

/** @param {Event} event */
function handleImageSelect(event) {
  const target = /** @type {HTMLInputElement} */ (event.target);
  if (target.files && target.files.length > 0) {
    const names = Array.from(target.files).map(f => f.name).join(', ');
    appendSystemMessage(
      `<span class="flex items-center gap-1.5">` +
      `<span class="material-symbols-outlined text-[13px] text-blue-400">image</span>` +
      `${target.files.length} image(s) attached: ${escapeHtml(names)}</span>`
    );
    for (const file of Array.from(target.files)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) pendingImages.push(e.target.result.toString());
      };
      reader.readAsDataURL(file);
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** @param {unknown} str */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/**
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function createEl(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function scrollToBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ─── Permission Dialog ────────────────────────────────────────────────────────

/**
 * Shows an inline permission prompt when the AI wants to run a terminal
 * command or write a file. The user can grant for once or the whole session.
 * @param {'terminal'|'fileWrite'} scope
 * @param {string} detail
 */
function showPermissionDialog(scope, detail) {
  removeEmptyState();
  const icon   = scope === 'terminal' ? 'terminal' : 'edit_document';
  const title  = scope === 'terminal' ? 'Terminal Access' : 'File Write Access';
  const wrapper = createEl('div', 'flex justify-start w-full py-1 permission-dialog');
  wrapper.innerHTML = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                border-radius:12px;padding:12px 14px;max-width:92%;width:100%;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--primary);">${icon}</span>
        <span style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;">${title}</span>
      </div>
      <div style="font-size:11px;color:#cbd5e1;margin-bottom:10px;font-family:monospace;
                  background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:6px;word-break:break-all;">
        ${escapeHtml(detail)}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button data-perm="once" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(251,191,36,0.4);
          background:rgba(251,191,36,0.15);color:#fbbf24;font-size:10px;font-weight:700;cursor:pointer;">
          Allow Once
        </button>
        <button data-perm="session" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(251,191,36,0.6);
          background:rgba(251,191,36,0.25);color:#f59e0b;font-size:10px;font-weight:700;cursor:pointer;">
          Allow This Session
        </button>
        <button data-perm="deny" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(239,68,68,0.3);
          background:rgba(239,68,68,0.1);color:#f87171;font-size:10px;font-weight:700;cursor:pointer;">
          Deny
        </button>
      </div>
    </div>
  `;

  // Attach handlers
  wrapper.querySelectorAll('[data-perm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const level = /** @type {HTMLElement} */ (btn).getAttribute('data-perm');
      wrapper.remove();
      if (level === 'deny') {
        appendSystemMessage('Permission denied.');
        return;
      }
      vscode.postMessage({
        type: 'permissionGrant',
        scope,
        level: level === 'session' ? 'session' : 'once',
      });
      appendSystemMessage(level === 'session'
        ? `Permission granted for this session.`
        : `Permission granted once.`);
    });
  });

  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

// ─── Final Init ───────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  buildDropdowns();
  syncControls();
  renderEmptyState();
  if (inputEl) inputEl.focus();
  if (vscode) vscode.postMessage({ type: 'ready' });
  appendSystemMessage('🛡️ Kairos UI Security Layer Active');
});
