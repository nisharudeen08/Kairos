// @ts-check
/// <reference lib="dom" />

///  ─── VS Code API ────────────────────────────────────────────────────────────
// @ts-ignore
const vscode = acquireVsCodeApi();

// ─── State ────────────────────────────────────────────────────────────────────
let isStreaming = false;
/** Accumulates raw text of the current streaming message */
let streamBuffer = '';
/** The <div class="msg-content"> element being streamed into */
/** @type {any} */
let streamTarget = null;
/** The blinking cursor element */
/** @type {any} */
let cursorEl = null;

let currentMode = 'agent';
let currentReasoningLevel = 2;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const messagesEl  = /** @type {HTMLElement} */ (document.getElementById('messages'));
const inputEl     = /** @type {HTMLTextAreaElement} */ (document.getElementById('user-input'));
const sendBtn     = /** @type {HTMLButtonElement} */ (document.getElementById('btn-send'));
const reviewBtn   = document.getElementById('btn-review');

// ─── Init ─────────────────────────────────────────────────────────────────────
renderEmptyState();
vscode.postMessage({ type: 'ready' });
inputEl.focus();

// ─── Event listeners ──────────────────────────────────────────────────────────
sendBtn.addEventListener('click', handleSend);

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Auto-resize textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});

reviewBtn?.addEventListener('click', () => {
    // Placeholder for review changes logic
    console.log('Reviewing changes...');
});

// ─── Message from extension ───────────────────────────────────────────────────
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'token':
      handleToken(msg.content);
      break;
    case 'done':
      handleDone(msg.metadata);
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

// ─── Send ─────────────────────────────────────────────────────────────────────
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
    mode: currentMode, 
    reasoningLevel: currentReasoningLevel 
  });
}

// ─── Streaming lifecycle ──────────────────────────────────────────────────────
function beginStream() {
  isStreaming = true;
  streamBuffer = '';
  sendBtn.disabled = true;

  // Create the agent message container
  const wrapper = createEl('div', 'message agent');
  const bubble  = createEl('div', 'bubble-agent');

  // Placeholder header (filled in by handleDone)
  const header  = createEl('div', 'agent-header placeholder-header');
  header.id     = 'stream-header';

  // Content area
  const content = createEl('div', 'msg-content');
  content.id    = 'stream-content';

  // Blinking cursor
  cursorEl = createEl('span', 'cursor');
  content.appendChild(cursorEl);

  bubble.appendChild(header);
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

  // Remove cursor, re-render raw text inline, re-add cursor
  if (cursorEl && streamTarget.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
  }
  streamTarget.textContent = streamBuffer;
  streamTarget.appendChild(cursorEl);
  scrollToBottom();
}

/** @param {any} metadata */
function handleDone(metadata) {
  isStreaming = false;
  sendBtn.disabled = false;

  // Remove cursor
  if (cursorEl && streamTarget?.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
    cursorEl = null;
  }

  // Render markdown now that streaming is complete
  if (streamTarget) {
    streamTarget.innerHTML = renderMarkdown(streamBuffer);
    streamBuffer = '';
    streamTarget = null;
  }

  // Populate agent header
  const header = document.getElementById('stream-header');
  if (header && metadata) {
    header.id = '';
    header.innerHTML = buildAgentHeader(metadata);
  }

  const msgEl = document.getElementById('stream-message');
  if (msgEl) msgEl.id = '';

  scrollToBottom();
}

/** @param {string} message */
function handleError(message) {
  isStreaming = false;
  sendBtn.disabled = false;

  // Remove in-progress stream message
  const streamMsg = document.getElementById('stream-message');
  if (streamMsg) streamMsg.remove();
  streamTarget = null;
  cursorEl = null;

  const wrapper = createEl('div', 'message agent');
  const bubble  = createEl('div', 'bubble-error');
  bubble.innerHTML = `<strong>⚠ Error</strong><br>${escapeHtml(message)}`;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
/** @param {string} text */
function appendUserMessage(text) {
  const wrapper = createEl('div', 'message user');
  const bubble  = createEl('div', 'bubble-user');
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

/** @param {string} text */
function appendSystemMessage(text) {
  const wrapper = createEl('div', 'message system message-system');
  const bubble  = createEl('div', 'bubble-system');
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
  const el = createEl('div', '');
  el.id = 'empty-state';
  el.innerHTML = `
    <div class="empty-icon">⚡</div>
    <div class="empty-title">KAIROS AI</div>
    <div class="empty-subtitle">Simple · Elegant · Powerful</div>
    <div class="empty-hints">
      <button class="hint-chip" data-prompt="/fix Fix the error in the active file">🔧 Fix this file</button>
      <button class="hint-chip" data-prompt="/explain Explain the selected code">💡 Explain code</button>
    </div>
  `;
  // Wire up hint chips
  el.querySelectorAll('.hint-chip').forEach((chipArg) => {
    const chip = /** @type {HTMLElement} */(chipArg);
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt) {
        inputEl.value = prompt;
        handleSend();
      }
    });
  });
  messagesEl.appendChild(el);
}

function removeEmptyState() {
  document.getElementById('empty-state')?.remove();
}

// ─── Badge & header builders ──────────────────────────────────────────────────
/** @param {any} metadata */
function buildAgentHeader(metadata) {
  const agentClass = (metadata.agent || 'Agent').toLowerCase();
  const agentIcon = agentClass === 'planner' ? '🧠' : agentClass === 'coder' ? '💻' : '🔍';

  return `
    <span class="badge badge-agent ${agentClass}">${agentIcon} ${escapeHtml(metadata.agent || 'Agent')}</span>
    <span class="badge badge-model">⚙ ${escapeHtml(metadata.modelLabel || 'AI')}</span>
  `;
}

// ─── Markdown renderer (dependency-free) ──────────────────────────────────────
/** @param {string} text */
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Fenced code blocks (``` lang\n...\n```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const highlighted = highlightCode(code.trim(), lang);
    return `<pre><code>${highlighted}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`);

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = `<p>${html}</p>`;

  return html;
}

/** 
 * Minimal syntax highlighter
 * @param {string} code 
 * @param {string} lang 
 */
function highlightCode(code, lang) {
  let h = code;
  if (['js', 'javascript', 'ts', 'typescript'].includes(lang)) {
    h = h.replace(/\b(const|let|var|function|return|if|else|for|while)\b/g, '<span class="token-keyword">$1</span>');
  }
  return h;
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
/** @param {any} str */
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
