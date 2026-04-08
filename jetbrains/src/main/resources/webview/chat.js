// ─── IDE Bridge (VS Code + JetBrains parity) ──────────────────────────────
const ide = (typeof acquireVsCodeApi !== 'undefined')
  ? acquireVsCodeApi()
  : {
      postMessage: (msg) => {
        if (window.cefQuery) {
          // JetBrains JBCef uses cefQuery for JS -> Kotlin communication
          window.cefQuery({
            request: JSON.stringify(msg),
            onSuccess: (response) => {},
            onFailure: (error) => {
              console.error('JBCef Query Error:', error);
            }
          });
        } else {
          console.warn('No IDE bridge found (window.cefQuery missing)');
        }
      }
    };

// Enable JetBrains -> JS communication via a global receiver
window.KAIROSReceiveMessage = (data) => {
  window.dispatchEvent(new MessageEvent('message', {
    data: typeof data === 'string' ? JSON.parse(data) : data
  }));
};

// ─── State ────────────────────────────────────────────────────────────────────
let isStreaming = false;
let streamBuffer = '';
let streamTarget = null;
let cursorEl = null;

let currentMode = 'agent';
let currentReasoningLevel = 2;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const messagesEl  = document.getElementById('messages');
const inputEl     = document.getElementById('user-input');
const sendBtn     = document.getElementById('btn-send');
const clearBtn    = document.getElementById('btn-clear');
const settingsBtn = document.getElementById('btn-settings');
const statusBar   = document.getElementById('status-bar');
const statusText  = document.getElementById('status-text');

const modeBtns        = document.querySelectorAll('.mode-btn');
const reasoningSlider = document.getElementById('reasoning-slider');
const reasoningVal    = document.getElementById('reasoning-val');

// ─── Init ─────────────────────────────────────────────────────────────────────
renderEmptyState();
ide.postMessage({ type: 'ready' });
inputEl.focus();

// ─── Event listeners ──────────────────────────────────────────────────────────
sendBtn.addEventListener('click', handleSend);

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.getAttribute('data-mode') || 'agent';
    inputEl.focus();
  });
});

reasoningSlider?.addEventListener('input', () => {
  const val = parseInt(reasoningSlider.value);
  currentReasoningLevel = val;
  const labels = { 1: 'Low', 2: 'Med', 3: 'High' };
  if (reasoningVal) reasoningVal.textContent = labels[val];
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});

clearBtn?.addEventListener('click', () => {
  ide.postMessage({ type: 'clearChat' });
});

settingsBtn?.addEventListener('click', () => {
  ide.postMessage({ type: 'openSettings' });
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
  ide.postMessage({ 
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
  setStatus('streaming', 'Thinking…');

  const wrapper = createEl('div', 'message agent');
  const bubble  = createEl('div', 'bubble-agent');

  const header  = createEl('div', 'agent-header placeholder-header');
  header.id     = 'stream-header';

  const content = createEl('div', 'msg-content');
  content.id    = 'stream-content';

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

function handleToken(content) {
  if (!streamTarget) return;
  streamBuffer += content;

  if (cursorEl && streamTarget.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
  }
  streamTarget.textContent = streamBuffer;
  streamTarget.appendChild(cursorEl);
  scrollToBottom();
}

function handleDone(metadata) {
  isStreaming = false;
  sendBtn.disabled = false;
  setStatus('ready', 'Ready');

  if (cursorEl && streamTarget?.contains(cursorEl)) {
    streamTarget.removeChild(cursorEl);
    cursorEl = null;
  }

  if (streamTarget) {
    streamTarget.innerHTML = renderMarkdown(streamBuffer);
    streamBuffer = '';
    streamTarget = null;
  }

  const header = document.getElementById('stream-header');
  if (header && metadata) {
    header.id = '';
    header.innerHTML = buildAgentHeader(metadata);
  }

  if (metadata?.risks?.length > 0) {
    const msgEl = document.getElementById('stream-message');
    if (msgEl) {
      const bubble = msgEl.querySelector('.bubble-agent');
      if (bubble) {
        const banner = buildRiskBanner(metadata.risks);
        const h = bubble.querySelector('.agent-header');
        if (h) h.insertAdjacentHTML('afterend', banner);
      }
    }
  }

  const msgEl = document.getElementById('stream-message');
  if (msgEl) msgEl.id = '';

  scrollToBottom();
}

function handleError(message) {
  isStreaming = false;
  sendBtn.disabled = false;
  setStatus('ready', 'Error');

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
function appendUserMessage(text) {
  const wrapper = createEl('div', 'message user');
  const bubble  = createEl('div', 'bubble-user');
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

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
    <div class="empty-subtitle">Multi-agent · LiteLLM-routed · Cost-optimised</div>
    <div class="empty-hints">
      <button class="hint-chip" data-prompt="Fix the error in the active file">🔧 Fix the error in the active file</button>
      <button class="hint-chip" data-prompt="Explain the selected code">💡 Explain the selected code</button>
      <button class="hint-chip" data-prompt="Generate unit tests for this function">🧪 Generate unit tests for this function</button>
      <button class="hint-chip" data-prompt="Optimize this code for performance">🚀 Optimize for performance</button>
    </div>
  `;
  el.querySelectorAll('.hint-chip').forEach((chip) => {
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

function buildAgentHeader(metadata) {
  const agentClass = metadata.agent.toLowerCase();
  const agentIcon = agentClass === 'planner' ? '🧠' : agentClass === 'coder' ? '💻' : '🔍';
  const confClass = metadata.confidence.toLowerCase();

  return `
    <span class="badge badge-agent ${agentClass}">${agentIcon} ${escapeHtml(metadata.agent)}</span>
    <span class="badge badge-model" title="${escapeHtml(metadata.modelReason)}">⚙ ${escapeHtml(metadata.modelLabel)}</span>
    <span class="badge badge-confidence ${confClass}" title="Confidence">🔒 ${escapeHtml(metadata.confidence)}</span>
  `;
}

function buildRiskBanner(risks) {
  const items = risks.map(r => `<li>${escapeHtml(r)}</li>`).join('');
  return `<div class="risk-banner">⚠ <strong>Risks detected:</strong><ul>${items}</ul></div>`;
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const highlighted = highlightCode(code.trim(), lang);
    const langLabel = lang ? `<span style="font-size:10px;color:var(--text-faint);float:right">${escapeHtml(lang)}</span>` : '';
    return `<pre>${langLabel}<code>${highlighted}</code></pre>`;
  });
  html = html.replace(/`([^` \n]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>(\n|$))+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\[ \] /g, '☐ ');
  html = html.replace(/\[x\] /gi, '☑ ');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = `<p>${html}</p>`;
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<(?:h[1-3]|ul|ol|pre|hr|blockquote)[^>]*>)/g, '$1');
  html = html.replace(/(<\/(?:h[1-3]|ul|ol|pre|hr|blockquote)>)<\/p>/g, '$1');
  html = html.replace(/([^>])\n([^<])/g, '$1<br>$2');
  return html;
}

function highlightCode(code, lang) {
  let h = code;
  if (['js', 'javascript', 'ts', 'typescript'].includes(lang)) {
    h = h.replace(/\b(const|let|var|function|async|await|return|import|export|class|if|else|for|while|null|undefined|true|false)\b/g, '<span class="token-keyword">$1</span>')
         .replace(/(["'`])(.*?)\1/g, '<span class="token-string">$1$2$1</span>')
         .replace(/\/\/.*/g, '<span class="token-comment">$&</span>');
  }
  return h;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function createEl(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(state, text) {
  statusBar.className = state === 'streaming' ? 'streaming' : '';
  statusText.textContent = text;
}
