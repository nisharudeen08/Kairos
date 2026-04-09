// @ts-check
/// <reference lib="dom" />

// @ts-ignore
const vscode = acquireVsCodeApi();

const modeOptions = [
  { value: 'agent', label: 'Agent', color: 'rose' },
  { value: 'fast', label: 'Fast', color: 'indigo' },
  { value: 'ask', label: 'Ask', color: 'emerald' },
  { value: 'plan', label: 'Plan', color: 'amber' },
];

const modelOptions = [
  { value: 'qwen3-coder', label: 'Qwen 3 Coder' },
  { value: 'gpt-oss-120b', label: 'GPT OSS 120B' },
  { value: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
  { value: 'hermes-405b', label: 'Hermes 405B' },
  { value: 'stepfun-flash', label: 'StepFun Flash' },
];

const reasoningLabels = ['Low', 'Med', 'High'];

let isStreaming = false;
let streamBuffer = '';
/** @type {HTMLElement | null} */
let streamTarget = null;
/** @type {HTMLElement | null} */
let cursorEl = null;

let currentModeIndex = 0;
let currentModelIndex = 0;
let currentReasoningLevel = 1;

const messagesEl = /** @type {HTMLElement} */ (document.getElementById('messages'));
const inputEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('user-input'));
const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-send'));
const clearBtn = document.getElementById('btn-clear');
const settingsBtn = document.getElementById('btn-settings');
const modeBtn = document.getElementById('mode-selector-btn');
const modelBtn = document.getElementById('model-selector-btn');
const reasoningBtn = document.getElementById('reasoning-selector-btn');
const modeTextEl = document.getElementById('mode-text');
const modelTextEl = document.getElementById('model-text');
const reasoningTextEl = document.getElementById('reasoning-text');
const fileUploadBtn = document.getElementById('btn-file-upload');
const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));

// Dropdowns
const modeDropdown = document.getElementById('mode-dropdown');
const modelDropdown = document.getElementById('model-dropdown');
const modeList = document.getElementById('mode-list');
const modelList = document.getElementById('model-list');

// Initialize
syncControls();
renderDropdowns();
inputEl.focus();

// Handlers
sendBtn.addEventListener('click', handleSend);

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
});

settingsBtn?.addEventListener('click', () => {
  vscode.postMessage({ type: 'openSettings' });
});

clearBtn?.addEventListener('click', () => {
  vscode.postMessage({ type: 'clearChat' });
});

fileUploadBtn?.addEventListener('click', () => {
  fileInput?.click();
});

fileInput?.addEventListener('change', handleFileSelect);

// Dropdown Toggling
modeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdown?.classList.toggle('hidden');
    modelDropdown?.classList.add('hidden');
});

modelBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    modelDropdown?.classList.toggle('hidden');
    modeDropdown?.classList.add('hidden');
});

// Close dropdowns on outside click
document.addEventListener('click', () => {
    modeDropdown?.classList.add('hidden');
    modelDropdown?.classList.add('hidden');
});

reasoningBtn?.addEventListener('click', () => {
  currentReasoningLevel = (currentReasoningLevel % 3) + 1;
  syncControls();
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'token':
      handleToken(msg.content);
      break;
    case 'done':
      handleDone();
      break;
    case 'error':
      handleError(msg.message);
      break;
    case 'systemMessage':
      appendSystemMessage(msg.text);
      break;
    case 'clear':
      clearMessages();
      break;
  }
});

// Event Delegation for dropdowns
modeList?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-index]');
    if (item) {
        const index = parseInt(item.getAttribute('data-index'));
        setMode(index);
    }
});

modelList?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-index]');
    if (item) {
        const index = parseInt(item.getAttribute('data-index'));
        setModel(index);
    }
});

function renderDropdowns() {
    if (modeList) {
        modeList.innerHTML = modeOptions.map((opt, i) => `
            <div data-index="${i}" class="flex items-center gap-2 p-2 hover:bg-white/5 cursor-pointer rounded-lg transition-colors text-[11px] text-slate-300 hover:text-white">
                <span class="material-symbols-outlined text-sm ${opt.color ? 'text-' + opt.color + '-400' : ''}">bolt</span>
                ${opt.label}
            </div>
        `).join('');
    }
    if (modelList) {
        modelList.innerHTML = modelOptions.map((opt, i) => `
            <div data-index="${i}" class="flex items-center gap-2 p-2 hover:bg-white/5 cursor-pointer rounded-lg transition-colors text-[11px] text-slate-300 hover:text-white">
                <span class="material-symbols-outlined text-sm text-slate-500">neurology</span>
                ${opt.label}
            </div>
        `).join('');
    }
}

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
  const mode = modeOptions[currentModeIndex];
  const model = modelOptions[currentModelIndex];
  
  if (modeTextEl) modeTextEl.textContent = mode.label;
  if (modelTextEl) modelTextEl.textContent = model.label;
  if (reasoningTextEl) reasoningTextEl.textContent = reasoningLabels[currentReasoningLevel - 1];

  // Update mode button colors dynamically
  if (modeBtn) {
    modeBtn.className = `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all uppercase tracking-wider border `;
    
    let colorClass = '';
    switch (mode.color) {
        case 'emerald': colorClass = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'; break;
        case 'amber': colorClass = 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'; break;
        case 'rose': colorClass = 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20'; break;
        default: colorClass = 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20';
    }
    modeBtn.className += colorClass;
  }
}

function handleSend() {
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;

  removeEmptyState();
  appendUserMessage(text);

  inputEl.value = '';
  inputEl.style.height = 'auto';

  beginStream();
  vscode.postMessage({
    type: 'userMessage',
    text,
    mode: modeOptions[currentModeIndex].value,
    model: modelOptions[currentModelIndex].value,
    reasoningLevel: currentReasoningLevel,
  });
}

function beginStream() {
  isStreaming = true;
  streamBuffer = '';
  sendBtn.disabled = true;
  
  const wrapper = createEl('div', 'flex flex-col items-start w-full gap-2 animation-slide-up');
  const bubble = createEl('div', 'p-4 rounded-2xl bg-white/5 border border-white/10 text-[13px] text-slate-200 leading-relaxed max-w-[90%]');
  const content = createEl('div', 'prose prose-invert max-w-none');
  content.id = 'stream-content';

  cursorEl = createEl('span', 'inline-block w-1.5 h-4 bg-primary ml-1 rounded-sm animate-pulse');
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

  // Very basic markdown rendering for tokens to keep it fast
  streamTarget.innerHTML = renderMarkdown(streamBuffer);
  
  if (cursorEl) {
    streamTarget.appendChild(cursorEl);
  }

  scrollToBottom();
}

function handleDone() {
  isStreaming = false;
  sendBtn.disabled = false;

  if (cursorEl && streamTarget?.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
  }

  cursorEl = null;
  if (streamTarget) {
    streamTarget.innerHTML = renderMarkdown(streamBuffer);
  }

  streamBuffer = '';
  streamTarget = null;

  const msgEl = document.getElementById('stream-message');
  if (msgEl) msgEl.id = '';

  scrollToBottom();
}

/** @param {string} message */
function handleError(message) {
  isStreaming = false;
  sendBtn.disabled = false;

  document.getElementById('stream-message')?.remove();
  streamTarget = null;
  cursorEl = null;

  const wrapper = createEl('div', 'flex flex-col items-start w-full gap-2');
  const bubble = createEl('div', 'p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[12px] text-red-400');
  bubble.innerHTML = `<div class="flex items-center gap-2 mb-1"><span class="material-symbols-outlined text-sm">error</span><strong>Error</strong></div>${escapeHtml(message)}`;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

/** @param {string} text */
function appendUserMessage(text) {
  const wrapper = createEl('div', 'flex flex-col items-end w-full gap-2 animation-slide-up');
  const bubble = createEl('div', 'px-5 py-3 rounded-2xl bg-primary text-slate-900 text-[13px] font-medium shadow-lg shadow-primary/10 max-w-[85%]');
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

/** @param {string} text */
function appendSystemMessage(text) {
  removeEmptyState();
  const wrapper = createEl('div', 'flex justify-center w-full py-2');
  const pill = createEl('div', 'px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-400');
  pill.innerHTML = text;
  wrapper.appendChild(pill);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function clearMessages() {
  messagesEl.innerHTML = '';
  renderEmptyState();
}

function renderEmptyState() {
   // Already in HTML, handled by showing/hiding if needed or just letting it be if messages are empty.
   // But we re-add it if all messages are cleared.
    messagesEl.innerHTML = `
      <div id="empty-state" class="h-full flex flex-col items-center justify-center text-center max-w-[280px] mx-auto space-y-4">
        <div class="w-16 h-16 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-2xl shadow-primary/10">
          <span class="material-symbols-outlined text-[32px]">auto_awesome</span>
        </div>
        <div class="space-y-1">
          <h2 class="text-white font-bold">How can I help today?</h2>
          <p class="text-[12px] text-slate-400 leading-relaxed">I can help you build, test, or debug your codebase using the latest AI models.</p>
        </div>
        <div class="grid grid-cols-1 gap-2 w-full pt-4">
            <div class="p-3 rounded-xl bg-white/2 border border-white/5 text-left flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors group">
                <span class="material-symbols-outlined text-sm text-slate-500 group-hover:text-primary transition-colors">terminal</span>
                <span class="text-[11px] text-slate-400">Explain this file structure</span>
            </div>
             <div class="p-3 rounded-xl bg-white/2 border border-white/5 text-left flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors group">
                <span class="material-symbols-outlined text-sm text-slate-500 group-hover:text-primary transition-colors">bug_report</span>
                <span class="text-[11px] text-slate-400">Find security vulnerabilities</span>
            </div>
        </div>
      </div>
    `;
}

function removeEmptyState() {
  document.getElementById('empty-state')?.remove();
}

/** @param {string} text */
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<div class="my-4 rounded-xl overflow-hidden bg-slate-900 border border-white/10">
      <div class="px-4 py-1.5 bg-white/5 border-b border-white/5 flex items-center justify-between">
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${lang || 'code'}</span>
      </div>
      <pre class="p-4 overflow-x-auto text-[12px] font-mono leading-relaxed text-slate-300"><code>${escapeHtml(code.trim())}</code></pre>
    </div>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-white/10 text-primary-light font-mono text-[0.9em]">$1</code>');
  
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-white font-bold text-base mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-white font-bold text-lg mt-6 mb-3 border-b border-white/5 pb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-white font-bold text-xl mt-8 mb-4">$1</h1>');
  
  // Bold/Italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em class="text-slate-400">$1</em>');
  
  // Lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="ml-4 list-disc text-slate-300">$1</li>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary hover:underline" target="_blank">$1</a>');
  
  // Paragraphs
  html = html.replace(/\n{2,}/g, '</p><p class="mb-3">');
  html = html.replace(/\n/g, '<br>');

  return `<p class="mb-3">${html}</p>`;
}

/** @param {unknown} str */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} tag
 * @param {string} className
 */
function createEl(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** @param {Event} event */
function handleFileSelect(event) {
  const target = /** @type {HTMLInputElement} */ (event.target);
  const files = target.files;
  if (files && files.length > 0) {
    const fileNames = Array.from(files).map(f => f.name).join(', ');
    appendSystemMessage(`<span class="flex items-center gap-2"><span class="material-symbols-outlined text-[14px]">attach_file</span> ${files.length} file(s) selected: ${fileNames}</span>`);
    target.value = '';
  }
}
