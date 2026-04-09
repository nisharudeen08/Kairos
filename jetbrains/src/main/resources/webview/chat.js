const ide = typeof acquireVsCodeApi !== 'undefined'
  ? acquireVsCodeApi()
  : {
      postMessage: (msg) => {
        if (window.cefQuery) {
          window.cefQuery({
            request: JSON.stringify(msg),
            onSuccess: () => {},
            onFailure: (error) => console.error('JBCef Query Error:', error),
          });
        } else {
          console.warn('No IDE bridge found');
        }
      },
    };

window.antigravityReceiveMessage = (data) => {
  window.dispatchEvent(new MessageEvent('message', {
    data: typeof data === 'string' ? JSON.parse(data) : data,
  }));
};

const modeOptions = [
  { value: 'fast', label: 'Fast' },
  { value: 'ask', label: 'Ask' },
  { value: 'plan', label: 'Plan' },
  { value: 'agent', label: 'Agent' },
  { value: 'full', label: 'Full' },
];

const modelOptions = [
  { value: 'qwen3-coder', label: 'Qwen3-Coder' },
  { value: 'gpt-oss-120b', label: 'GPT-OSS-120B' },
  { value: 'llama-3.3-70b', label: 'Llama-3.3-70B' },
  { value: 'hermes-405b', label: 'Hermes-405B' },
];

const reasoningLabels = ['Low thinking', 'Medium thinking', 'High thinking'];

let isStreaming = false;
let streamBuffer = '';
let streamTarget = null;
let cursorEl = null;
let currentModeIndex = 0;
let currentModelIndex = 0;
let currentReasoningLevel = 2;

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('btn-send');
const modeBtn = document.getElementById('mode-selector-btn');
const modelBtn = document.getElementById('model-selector-btn');
const reasoningBtn = document.getElementById('reasoning-selector-btn');
const modeTextEl = document.getElementById('mode-text');
const modelTextEl = document.getElementById('model-text');
const reasoningTextEl = document.getElementById('reasoning-text');

// Selectors
const modeDropdown = document.getElementById('mode-dropdown');
const modelDropdown = document.getElementById('model-dropdown');
const modeList = document.getElementById('mode-list');
const modelList = document.getElementById('model-list');
const fileUploadBtn = document.getElementById('btn-file-upload');
const fileInput = document.getElementById('file-input');

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
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

fileUploadBtn?.addEventListener('click', () => {
  fileInput?.click();
});

fileInput?.addEventListener('change', (e) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    appendSystemMessage(`📎 ${files.length} file(s) selected: ${Array.from(files).map(f => f.name).join(', ')}`);
  }
});

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

// Close on outside click
document.addEventListener('click', () => {
  modeDropdown?.classList.add('hidden');
  modelDropdown?.classList.add('hidden');
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
        <span class="material-symbols-outlined text-sm">bolt</span>
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

function syncControls() {
  const mode = modeOptions[currentModeIndex];
  const model = modelOptions[currentModelIndex];
  
  if (modeTextEl) modeTextEl.textContent = mode.label;
  if (modelTextEl) modelTextEl.textContent = model.label;
  if (reasoningTextEl) {
     const level = (currentReasoningLevel || 1);
     reasoningTextEl.textContent = reasoningLabels[level - 1];
  }
}

function handleSend() {
  const text = inputEl.value.trim();
  if (!text || isStreaming) {
    return;
  }

  removeEmptyState();
  appendUserMessage(text);

  inputEl.value = '';
  inputEl.style.height = 'auto';

  beginStream();
  ide.postMessage({
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
  sendBtn.classList.add('opacity-60');

  const wrapper = createEl('div', 'message agent');
  const bubble = createEl('div', 'bubble-agent');
  const content = createEl('div', 'msg-content');
  content.id = 'stream-content';

  cursorEl = createEl('span', 'cursor');
  content.appendChild(cursorEl);

  bubble.appendChild(content);
  wrapper.appendChild(bubble);
  wrapper.id = 'stream-message';
  messagesEl.appendChild(wrapper);
  scrollToBottom();

  streamTarget = content;
}

function handleToken(content) {
  if (!streamTarget) {
    return;
  }

  streamBuffer += content;

  if (cursorEl && streamTarget.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
  }

  streamTarget.textContent = streamBuffer;
  if (cursorEl) {
    streamTarget.appendChild(cursorEl);
  }

  scrollToBottom();
}

function handleDone() {
  isStreaming = false;
  sendBtn.disabled = false;
  sendBtn.classList.remove('opacity-60');

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
  if (msgEl) {
    msgEl.id = '';
  }

  scrollToBottom();
}

function handleError(message) {
  isStreaming = false;
  sendBtn.disabled = false;
  sendBtn.classList.remove('opacity-60');

  document.getElementById('stream-message')?.remove();
  streamTarget = null;
  cursorEl = null;
  streamBuffer = '';

  const wrapper = createEl('div', 'message agent');
  const bubble = createEl('div', 'bubble-error bg-error-container/10 border border-error/20 p-3 rounded-lg text-error text-xs');
  bubble.innerHTML = `<strong>Error</strong><br>${escapeHtml(message)}`;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function appendUserMessage(text) {
  const wrapper = createEl('div', 'message user');
  const bubble = createEl('div', 'bubble-user');
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function appendSystemMessage(text) {
  removeEmptyState();
  const wrapper = createEl('div', 'message system w-full text-center');
  const bubble = createEl('div', 'text-[11px] text-[#666] bg-[#1a1a1a] px-3 py-1 rounded-full inline-block');
  bubble.innerHTML = renderMarkdown(text);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function clearMessages() {
  messagesEl.innerHTML = '';
  renderEmptyState();
}

function renderEmptyState() {
  const el = createEl('div', 'flex-grow flex flex-col items-center justify-center p-8 text-center');
  el.id = 'empty-state';
  el.innerHTML = `
    <div class="w-12 h-12 rounded-full border border-outline-variant/30 flex items-center justify-center mb-4">
      <span class="material-symbols-outlined text-outline/50">rocket_launch</span>
    </div>
    <p class="text-[#c8c8c8] font-body text-[13px] leading-relaxed max-w-[180px] font-light">
      Ask anything, @ to mention, / for workflows
    </p>
  `;
  messagesEl.appendChild(el);
}

function removeEmptyState() {
  document.getElementById('empty-state')?.remove();
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => `<pre><code>${escapeHtml(code.trim())}</code></pre>`);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createEl(tag, className) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
