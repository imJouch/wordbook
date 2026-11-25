import {
  TYPE_LABELS,
  STATUS_LABELS,
  formatRelativeTime,
  escapeHtml
} from './shared/constants.js';

let allEntries = [];
let currentSettings = null;
let activeFilter = 'all';
let searchQuery = '';

const els = {
  toggleSettingsBtn: document.getElementById('toggleSettingsBtn'),
  openNotebookBtn: document.getElementById('openNotebookBtn'),
  openFullSettingsBtn: document.getElementById('openFullSettingsBtn'),
  startReviewBtn: document.getElementById('startReviewBtn'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  floatingToggle: document.getElementById('floatingToggle'),
  quickInput: document.getElementById('quickInput'),
  quickAddBtn: document.getElementById('quickAddBtn'),
  searchInput: document.getElementById('searchInput'),
  entryList: document.getElementById('entryList'),
  countAll: document.getElementById('countAll'),
  countWrong: document.getElementById('countWrong'),
  countMastered: document.getElementById('countMastered')
};

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp?.ok) {
        reject(new Error(resp?.error || 'Request failed'));
        return;
      }
      resolve(resp);
    });
  });
}

function updateCounts() {
  const total = allEntries.length;
  const mastered = allEntries.filter((e) => e.status === 'mastered').length;
  const wrong = total - mastered;

  els.countAll.textContent = String(total);
  els.countWrong.textContent = String(wrong);
  els.countMastered.textContent = String(mastered);
}

function renderEntries() {
  updateCounts();

  const q = searchQuery.trim().toLowerCase();
  const filtered = allEntries.filter((e) => {
    if (activeFilter === 'wrong' && e.status === 'mastered') return false;
    if (activeFilter === 'mastered' && e.status !== 'mastered') return false;
    if (!q) return true;
    return (
      e.text.toLowerCase().includes(q) ||
      e.translation.toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      (e.contextSentence || '').toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    els.entryList.innerHTML =
      allEntries.length === 0
        ? `<div class="empty-state">
             还没有收录生词。<br/>
             在任意网页上选中单词、短语或句子，点击「译并记」，或使用上方输入框快速添加。
           </div>`
        : `<div class="empty-state">当前筛选条件下没有匹配的词条</div>`;
    return;
  }

  els.entryList.innerHTML = filtered
    .slice(0, 80)
    .map((entry) => {
      const isMastered = entry.status === 'mastered';
      const typeLabel = TYPE_LABELS[entry.type] || '词条';
      const statusLabel = STATUS_LABELS[entry.status] || '未掌握';
      const ctxHtml = entry.contextSentence
        ? `<div class="entry-ctx">${escapeHtml(entry.contextSentence)}</div>`
        : '';
      const sourceHtml = entry.pageUrl
        ? `<a class="entry-source" href="${escapeHtml(entry.pageUrl)}" target="_blank" rel="noopener">${escapeHtml(
            entry.pageTitle || entry.pageUrl
          )}</a>`
        : `<span>手动收录</span>`;

      return `
        <article class="entry-card ${isMastered ? 'mastered' : ''}" data-id="${escapeHtml(entry.id)}">
          <div class="entry-top">
            <div class="entry-main">
              <div class="entry-badges">
                <span class="badge badge-type">${escapeHtml(typeLabel)}</span>
                <span class="badge ${isMastered ? 'badge-mastered' : 'badge-wrong'}">${escapeHtml(
                  statusLabel
                )}</span>
                ${
                  entry.encounterCount > 1
                    ? `<span class="badge" style="background:#f1f5f9;color:#475569;">遇到 ${entry.encounterCount} 次</span>`
                    : ''
                }
              </div>
              <div class="entry-text">${escapeHtml(entry.text)}</div>
              ${entry.phonetic ? `<div class="entry-phonetic">[${escapeHtml(entry.phonetic)}]</div>` : ''}
              <div class="entry-trans">${escapeHtml(entry.translation)}</div>
            </div>
            <div class="entry-actions">
              <button class="act-btn btn-toggle" type="button" title="${
                isMastered ? '放回错题本' : '标为已掌握'
              }">${isMastered ? '↺' : '✓'}</button>
              <button class="act-btn del btn-del" type="button" title="删除">✕</button>
            </div>
          </div>
          ${ctxHtml}
          <div class="entry-meta">
            ${sourceHtml}
            <span>${escapeHtml(formatRelativeTime(entry.createdAt))}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadInitialData() {
  const [settingsRes, entriesRes] = await Promise.all([
    sendMsg({ type: 'GET_SETTINGS' }),
    sendMsg({ type: 'GET_ENTRIES' })
  ]);

  currentSettings = settingsRes.settings;
  allEntries = entriesRes.entries || [];

  els.floatingToggle.checked = currentSettings.showFloatingBtn !== false;
  renderEntries();
}

async function handleQuickAdd() {
  const text = els.quickInput.value.trim();
  if (!text) return;

  els.quickAddBtn.disabled = true;
  els.quickAddBtn.textContent = '翻译中...';
  try {
    await sendMsg({
      type: 'TRANSLATE_AND_SAVE',
      payload: { text }
    });
    els.quickInput.value = '';
    const res = await sendMsg({ type: 'GET_ENTRIES' });
    allEntries = res.entries || [];
    renderEntries();
  } catch (err) {
    alert(`翻译收录失败：${err.message}`);
  } finally {
    els.quickAddBtn.disabled = false;
    els.quickAddBtn.textContent = '译并记';
  }
}

function bindEvents() {
  els.toggleSettingsBtn.addEventListener('click', () => {
    els.settingsDrawer.classList.toggle('hidden');
  });

  els.openNotebookBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('notebook.html') });
  });

  els.openFullSettingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('notebook.html#settings') });
  });

  els.startReviewBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('notebook.html#review') });
  });

  els.floatingToggle.addEventListener('change', async () => {
    const res = await sendMsg({
      type: 'SAVE_SETTINGS',
      settings: { showFloatingBtn: els.floatingToggle.checked }
    });
    currentSettings = res.settings;
  });

  els.quickAddBtn.addEventListener('click', handleQuickAdd);
  els.quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleQuickAdd();
  });

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderEntries();
    });
  });

  els.searchInput.addEventListener('input', () => {
    searchQuery = els.searchInput.value;
    renderEntries();
  });

  els.entryList.addEventListener('click', async (e) => {
    const card = e.target.closest('.entry-card');
    if (!card) return;
    const id = card.dataset.id;
    const entry = allEntries.find((item) => item.id === id);
    if (!entry) return;

    if (e.target.closest('.btn-toggle')) {
      const nextStatus = entry.status === 'mastered' ? 'learning' : 'mastered';
      const res = await sendMsg({
        type: 'UPDATE_ENTRY',
        id,
        patch: { status: nextStatus }
      });
      const idx = allEntries.findIndex((item) => item.id === id);
      if (idx !== -1) allEntries[idx] = res.entry;
      renderEntries();
      return;
    }

    if (e.target.closest('.btn-del')) {
      await sendMsg({ type: 'DELETE_ENTRY', id });
      allEntries = allEntries.filter((item) => item.id !== id);
      renderEntries();
    }
  });
}

bindEvents();
loadInitialData().catch((err) => {
  els.entryList.innerHTML = `<div class="empty-state">加载失败：${escapeHtml(err.message)}</div>`;
});
