(function () {
  if (typeof window.__wordbookCleanup === 'function') {
    try {
      window.__wordbookCleanup();
    } catch {
      // Ignore cleanup errors from previous instance
    }
  }

  const STORAGE_SETTINGS_KEY = 'wordbook_settings';
  const TYPE_LABELS = { word: '单词', phrase: '短语', sentence: '句子' };

  let settings = {
    showFloatingBtn: true
  };

  let hostEl = null;
  let shadowRoot = null;
  let containerEl = null;
  let currentSelectionData = null;
  let hideTimer = null;
  let selectionDebounce = null;
  let isCardPinned = false;
  let lastMousePos = null;

  function syncSettings() {
    try {
      chrome.storage.local.get(STORAGE_SETTINGS_KEY, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res[STORAGE_SETTINGS_KEY]) {
          settings = { ...settings, ...res[STORAGE_SETTINGS_KEY] };
        }
      });
    } catch {
      // Ignore extension context invalidated errors
    }
  }

  syncSettings();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_SETTINGS_KEY]?.newValue) {
        settings = { ...settings, ...changes[STORAGE_SETTINGS_KEY].newValue };
        if (settings.showFloatingBtn === false && !isCardPinned) {
          hideFloatingUI();
        }
      }
    });
  } catch {
    // Ignore extension context invalidated errors
  }

  function ensureShadowHost() {
    if (hostEl && document.contains(hostEl)) return;

    hostEl = document.createElement('div');
    hostEl.id = 'wordbook-extension-host';
    hostEl.style.cssText =
      'all:initial !important;position:fixed !important;top:0 !important;left:0 !important;width:0 !important;height:0 !important;z-index:2147483647 !important;pointer-events:none !important;display:block !important;visibility:visible !important;opacity:1 !important;';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 0 !important;
        height: 0 !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      }
      .wb-root {
        position: fixed;
        pointer-events: auto;
        z-index: 2147483647;
        opacity: 0;
        transform: translateY(4px) scale(0.98);
        transition: opacity 0.14s ease, transform 0.14s ease;
      }
      .wb-root.wb-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .wb-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #1e1b4b;
        color: #fffbeb;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        padding: 7px 13px;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28), 0 2px 6px rgba(15, 23, 42, 0.14);
        user-select: none;
        line-height: 1;
        white-space: nowrap;
      }
      .wb-pill:hover {
        background: #312e81;
      }
      .wb-pill svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }
      .wb-card {
        width: 330px;
        max-width: calc(100vw - 24px);
        background: #fffdf7;
        color: #1e293b;
        border: 1px solid #e2dcc8;
        border-radius: 12px;
        box-shadow: 0 16px 38px rgba(15, 23, 42, 0.24), 0 4px 12px rgba(15, 23, 42, 0.1);
        overflow: hidden;
        font-size: 13px;
        line-height: 1.5;
      }
      .wb-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 12px;
        background: #f5f0e1;
        border-bottom: 1px solid #e7e0cb;
      }
      .wb-header-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .wb-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 7px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        background: #e0e7ff;
        color: #3730a3;
        flex-shrink: 0;
      }
      .wb-status {
        font-size: 11.5px;
        font-weight: 600;
        color: #15803d;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wb-status.wb-err {
        color: #b91c1c;
      }
      .wb-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .wb-icon-btn {
        appearance: none;
        border: none;
        background: transparent;
        color: #64748b;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 15px;
        padding: 0;
      }
      .wb-icon-btn:hover {
        background: rgba(15, 23, 42, 0.08);
        color: #1e293b;
      }
      .wb-card-body {
        padding: 12px;
        max-height: 280px;
        overflow-y: auto;
      }
      .wb-orig-text {
        font-size: 14.5px;
        font-weight: 700;
        color: #0f172a;
        word-break: break-word;
      }
      .wb-phonetic {
        font-size: 12px;
        color: #64748b;
        margin-top: 2px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .wb-divider {
        height: 1px;
        background: #ede7d5;
        margin: 9px 0;
      }
      .wb-translation {
        font-size: 14px;
        color: #312e81;
        font-weight: 600;
        word-break: break-word;
      }
      .wb-dict {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .wb-dict-row {
        font-size: 12px;
        color: #475569;
        line-height: 1.4;
      }
      .wb-pos {
        display: inline-block;
        font-style: italic;
        color: #6366f1;
        margin-right: 5px;
        font-weight: 600;
      }
      .wb-loading {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #475569;
        padding: 6px 0;
      }
      .wb-spinner {
        width: 15px;
        height: 15px;
        border: 2px solid #cbd5e1;
        border-top-color: #4338ca;
        border-radius: 50%;
        animation: wb-spin 0.7s linear infinite;
      }
      @keyframes wb-spin {
        to { transform: rotate(360deg); }
      }
      .wb-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: #faf6ea;
        border-top: 1px solid #ede7d5;
        font-size: 12px;
      }
      .wb-link-btn {
        appearance: none;
        border: none;
        background: transparent;
        color: #4338ca;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        padding: 3px 6px;
        border-radius: 5px;
      }
      .wb-link-btn:hover {
        background: #e0e7ff;
      }
      .wb-link-btn.wb-muted {
        color: #64748b;
        font-weight: 500;
      }
      .wb-link-btn.wb-muted:hover {
        background: rgba(15, 23, 42, 0.06);
        color: #dc2626;
      }
    `;

    containerEl = document.createElement('div');
    containerEl.className = 'wb-root';

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(containerEl);

    (document.documentElement || document.body).appendChild(hostEl);
  }

  function isEventInsideHost(e) {
    if (!hostEl) return false;
    if (e.target === hostEl || hostEl.contains(e.target)) return true;
    if (typeof e.composedPath === 'function') {
      return e.composedPath().includes(hostEl);
    }
    return false;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  function isEditableTarget(node) {
    if (!node) return false;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
  }

  function extractContextSentence(selection) {
    try {
      if (!selection || selection.rangeCount === 0) return '';
      const range = selection.getRangeAt(0);
      const selected = normalizeText(selection.toString());
      if (!selected) return '';

      if (selected.length >= 90) return '';

      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
      }
      const block =
        node?.closest?.('p, li, td, th, blockquote, figcaption, dd, dt, h1, h2, h3, h4, h5, h6, article, section, div') ||
        node;

      const blockText = normalizeText(block?.innerText || block?.textContent || '');
      if (!blockText || blockText.length <= selected.length) return '';

      const idx = blockText.indexOf(selected);
      if (idx === -1) {
        return blockText.length <= 240 ? blockText : '';
      }

      const leftPart = blockText.slice(0, idx);
      const rightPart = blockText.slice(idx + selected.length);

      const leftBoundaryMatch = leftPart.match(/.*[.!?。！？;；\n]\s*/);
      const sentStart = leftBoundaryMatch ? leftBoundaryMatch[0].length : Math.max(0, idx - 120);

      const rightBoundaryMatch = rightPart.match(/[.!?。！？;；\n]/);
      const sentEndOffset = rightBoundaryMatch
        ? rightBoundaryMatch.index + 1
        : Math.min(rightPart.length, 140);

      const sentence = normalizeText(blockText.slice(sentStart, idx + selected.length + sentEndOffset));
      if (sentence.length > 320) {
        const start = Math.max(0, idx - 100);
        const end = Math.min(blockText.length, idx + selected.length + 120);
        return normalizeText(blockText.slice(start, end));
      }
      return sentence;
    } catch {
      return '';
    }
  }

  function getSelectionRect(range) {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0)) {
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    }

    const clientRects = range.getClientRects();
    for (const r of clientRects) {
      if (r.width > 0 || r.height > 0) {
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height
        };
      }
    }

    if (lastMousePos) {
      return {
        left: lastMousePos.x,
        right: lastMousePos.x,
        top: lastMousePos.y,
        bottom: lastMousePos.y,
        width: 0,
        height: 0
      };
    }
    return null;
  }

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    if (isEditableTarget(sel.anchorNode) || isEditableTarget(sel.focusNode)) {
      return null;
    }

    const text = normalizeText(sel.toString());
    if (!text || text.length > 1500) return null;

    const range = sel.getRangeAt(0);
    const rect = getSelectionRect(range);
    if (!rect) return null;

    return {
      text,
      contextSentence: extractContextSentence(sel),
      pageTitle: document.title || '',
      pageUrl: location.href,
      rect
    };
  }

  function positionContainer(rect, estimatedW = 110, estimatedH = 38) {
    if (!containerEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 10;

    let left = rect ? rect.left + Math.min(rect.width / 2, 40) - estimatedW / 2 : vw - estimatedW - 24;
    let top = rect ? rect.bottom + 8 : 24;

    if (left + estimatedW > vw - pad) {
      left = vw - estimatedW - pad;
    }
    if (left < pad) left = pad;

    if (top + estimatedH > vh - pad) {
      top = rect ? Math.max(pad, rect.top - estimatedH - 8) : pad;
    }

    containerEl.style.left = `${Math.round(left)}px`;
    containerEl.style.top = `${Math.round(top)}px`;
  }

  function hideFloatingUI() {
    clearTimeout(hideTimer);
    isCardPinned = false;
    if (!containerEl) return;
    containerEl.classList.remove('wb-visible');
    hideTimer = setTimeout(() => {
      if (containerEl && !containerEl.classList.contains('wb-visible')) {
        containerEl.innerHTML = '';
      }
    }, 150);
  }

  function showActionPill(selInfo) {
    ensureShadowHost();
    clearTimeout(hideTimer);
    isCardPinned = false;
    currentSelectionData = selInfo;

    containerEl.innerHTML = `
      <button class="wb-pill" type="button" title="自动翻译为简体中文并加入 WordBook 生词错题本">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          <path d="M12 6v6"></path>
          <path d="M9 9h6"></path>
        </svg>
        <span>译并记</span>
      </button>
    `;

    positionContainer(selInfo.rect, 96, 34);
    requestAnimationFrame(() => containerEl.classList.add('wb-visible'));

    const pillBtn = containerEl.querySelector('.wb-pill');
    pillBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    pillBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveSelectionWithCard(selInfo);
    });
  }

  function showLoadingCard(selInfo) {
    ensureShadowHost();
    clearTimeout(hideTimer);
    isCardPinned = true;

    containerEl.innerHTML = `
      <div class="wb-card">
        <div class="wb-card-header">
          <div class="wb-header-left">
            <span class="wb-badge">WordBook</span>
            <span class="wb-status" style="color:#475569;">正在翻译并收录...</span>
          </div>
          <div class="wb-header-actions">
            <button class="wb-icon-btn wb-close" type="button" title="关闭">×</button>
          </div>
        </div>
        <div class="wb-card-body">
          <div class="wb-orig-text">${escapeHtml(selInfo.text)}</div>
          <div class="wb-loading">
            <div class="wb-spinner"></div>
            <span>正在自动翻译为简体中文...</span>
          </div>
        </div>
      </div>
    `;

    positionContainer(selInfo.rect, 330, 150);
    requestAnimationFrame(() => containerEl.classList.add('wb-visible'));
    containerEl.querySelector('.wb-close')?.addEventListener('click', hideFloatingUI);
  }

  function showResultCard(entry, isDuplicate, rect, errorMessage) {
    ensureShadowHost();
    clearTimeout(hideTimer);
    isCardPinned = true;

    if (errorMessage) {
      containerEl.innerHTML = `
        <div class="wb-card">
          <div class="wb-card-header">
            <div class="wb-header-left">
              <span class="wb-badge">WordBook</span>
              <span class="wb-status wb-err">收录失败</span>
            </div>
            <button class="wb-icon-btn wb-close" type="button">×</button>
          </div>
          <div class="wb-card-body">
            <div style="color:#b91c1c;font-size:13px;">${escapeHtml(errorMessage)}</div>
          </div>
        </div>
      `;
      positionContainer(rect, 330, 130);
      requestAnimationFrame(() => containerEl.classList.add('wb-visible'));
      containerEl.querySelector('.wb-close')?.addEventListener('click', hideFloatingUI);
      return;
    }

    const typeLabel = TYPE_LABELS[entry.type] || '词条';
    const statusText = isDuplicate
      ? `✓ 再次遇到（第 ${entry.encounterCount} 次）`
      : '✓ 已加入错题本';

    const dictHtml =
      Array.isArray(entry.dictMeanings) && entry.dictMeanings.length > 0
        ? `<div class="wb-dict">${entry.dictMeanings
            .slice(0, 3)
            .map(
              (m) =>
                `<div class="wb-dict-row"><span class="wb-pos">${escapeHtml(m.pos)}</span>${escapeHtml(
                  (m.terms || []).join('；')
                )}</div>`
            )
            .join('')}</div>`
        : '';

    containerEl.innerHTML = `
      <div class="wb-card">
        <div class="wb-card-header">
          <div class="wb-header-left">
            <span class="wb-badge">${escapeHtml(typeLabel)}</span>
            <span class="wb-status">${escapeHtml(statusText)}</span>
          </div>
          <div class="wb-header-actions">
            <button class="wb-icon-btn wb-close" type="button" title="关闭">×</button>
          </div>
        </div>
        <div class="wb-card-body">
          <div class="wb-orig-text">${escapeHtml(entry.text)}</div>
          ${entry.phonetic ? `<div class="wb-phonetic">[${escapeHtml(entry.phonetic)}]</div>` : ''}
          <div class="wb-divider"></div>
          <div class="wb-translation">${escapeHtml(entry.translation)}</div>
          ${dictHtml}
        </div>
        <div class="wb-card-footer">
          <button class="wb-link-btn wb-muted wb-undo" type="button">${
            isDuplicate ? '关闭' : '撤销收录'
          }</button>
          <button class="wb-link-btn wb-open-nb" type="button">打开错题本 ↗</button>
        </div>
      </div>
    `;

    positionContainer(rect, 330, 220);
    requestAnimationFrame(() => containerEl.classList.add('wb-visible'));

    containerEl.querySelector('.wb-close')?.addEventListener('click', hideFloatingUI);
    containerEl.querySelector('.wb-open-nb')?.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'OPEN_NOTEBOOK' });
      hideFloatingUI();
    });
    containerEl.querySelector('.wb-undo')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isDuplicate) {
        chrome.runtime.sendMessage({ type: 'DELETE_ENTRY', id: entry.id }, () => {
          hideFloatingUI();
        });
      } else {
        hideFloatingUI();
      }
    });
  }

  function saveSelectionWithCard(selInfo) {
    if (!selInfo?.text) return;
    showLoadingCard(selInfo);

    chrome.runtime.sendMessage(
      {
        type: 'TRANSLATE_AND_SAVE',
        payload: {
          text: selInfo.text,
          contextSentence: selInfo.contextSentence,
          pageTitle: selInfo.pageTitle,
          pageUrl: selInfo.pageUrl
        }
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          showResultCard(null, false, selInfo.rect, chrome.runtime.lastError.message);
          return;
        }
        if (!resp?.ok) {
          showResultCard(null, false, selInfo.rect, resp?.error || '翻译服务暂时不可用');
          return;
        }
        showResultCard(resp.entry, resp.isDuplicate, selInfo.rect, null);
      }
    );
  }

  function scheduleSelectionCheck(delay = 80) {
    clearTimeout(selectionDebounce);
    selectionDebounce = setTimeout(() => {
      const selInfo = getSelectionInfo();
      if (!selInfo) {
        if (!isCardPinned) hideFloatingUI();
        return;
      }
      currentSelectionData = selInfo;
      if (settings.showFloatingBtn !== false) {
        showActionPill(selInfo);
      }
    }, delay);
  }

  function onMouseUp(e) {
    lastMousePos = { x: e.clientX, y: e.clientY };
    if (isEventInsideHost(e)) return;
    scheduleSelectionCheck(80);
  }

  function onKeyUp(e) {
    if (e.key === 'Escape') {
      hideFloatingUI();
      return;
    }
    if (e.shiftKey) {
      scheduleSelectionCheck(120);
    }
  }

  function onMouseDown(e) {
    lastMousePos = { x: e.clientX, y: e.clientY };
    if (isEventInsideHost(e)) return;
    hideFloatingUI();
  }

  // Capture-phase listeners so page stopPropagation() cannot block selection capture
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('mousedown', onMouseDown, true);

  function onMessage(message, _sender, sendResponse) {
    if (message?.type === 'GET_SELECTION_CONTEXT') {
      const selInfo = getSelectionInfo();
      currentSelectionData = selInfo || currentSelectionData;
      sendResponse(
        selInfo || {
          text: normalizeText(window.getSelection()?.toString() || ''),
          contextSentence: '',
          pageTitle: document.title || '',
          pageUrl: location.href
        }
      );
      return false;
    }

    if (message?.type === 'TRIGGER_SAVE_SELECTION') {
      const selInfo = getSelectionInfo();
      if (selInfo) {
        saveSelectionWithCard(selInfo);
      }
      sendResponse({ ok: Boolean(selInfo) });
      return false;
    }

    if (message?.type === 'SHOW_SAVED_RESULT') {
      const selInfo = getSelectionInfo() || currentSelectionData;
      showResultCard(message.entry, message.isDuplicate, selInfo?.rect || null, null);
      sendResponse({ ok: true });
      return false;
    }
  }

  // Listen for background messages (context menu / keyboard shortcut)
  chrome.runtime.onMessage.addListener(onMessage);

  window.__wordbookCleanup = function () {
    clearTimeout(hideTimer);
    clearTimeout(selectionDebounce);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Ignore if context already invalidated
    }
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    shadowRoot = null;
    containerEl = null;
  };
})();
