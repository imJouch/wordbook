import {
  TYPE_LABELS,
  STATUS_LABELS,
  formatDate,
  escapeHtml
} from './shared/constants.js';

let entries = [];
let settings = null;

// Review state
let reviewQueue = [];
let reviewIdx = 0;
let reviewRevealed = false;
let reviewStats = { ok: 0, wrong: 0 };

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

// ---------------- Navigation ----------------

function switchView(viewName) {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `view-${viewName}`);
  });
  if (viewName === 'review') {
    buildReviewQueue();
  }
}

// ---------------- Notebook View ----------------

function highlightInContext(context, target) {
  const safeCtx = escapeHtml(context);
  const safeTarget = escapeHtml(target);
  if (!safeTarget) return safeCtx;
  const escapedRegex = safeTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeCtx.replace(new RegExp(escapedRegex, 'gi'), (m) => `<mark>${m}</mark>`);
}

function updateDashboardStats() {
  const total = entries.length;
  const mastered = entries.filter((e) => e.status === 'mastered').length;
  const pending = total - mastered;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayCount = entries.filter((e) => (e.createdAt || 0) >= startOfDay.getTime()).length;

  document.getElementById('statTotal').textContent = String(total);
  document.getElementById('statPending').textContent = String(pending);
  document.getElementById('statMastered').textContent = String(mastered);
  document.getElementById('statToday').textContent = String(todayCount);
}

function getFilteredEntries() {
  const q = document.getElementById('nbSearchInput').value.trim().toLowerCase();
  const typeFilter = document.getElementById('nbTypeFilter').value;
  const statusFilter = document.getElementById('nbStatusFilter').value;
  const sortOrder = document.getElementById('nbSortOrder').value;

  const list = entries.filter((e) => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (statusFilter === 'wrong' && e.status === 'mastered') return false;
    if (['new', 'learning', 'mastered'].includes(statusFilter) && e.status !== statusFilter) {
      return false;
    }
    if (!q) return true;
    return (
      e.text.toLowerCase().includes(q) ||
      e.translation.toLowerCase().includes(q) ||
      (e.contextSentence || '').toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      (e.pageTitle || '').toLowerCase().includes(q) ||
      (e.pageUrl || '').toLowerCase().includes(q)
    );
  });

  list.sort((a, b) => {
    if (sortOrder === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
    if (sortOrder === 'encounters') return (b.encounterCount || 1) - (a.encounterCount || 1);
    if (sortOrder === 'wrongCount') return (b.wrongCount || 0) - (a.wrongCount || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return list;
}

function renderNotebook() {
  updateDashboardStats();
  const listEl = document.getElementById('nbList');
  const filtered = getFilteredEntries();

  if (filtered.length === 0) {
    listEl.innerHTML =
      entries.length === 0
        ? `<div class="empty-box">
             错题本还是空的！<br/>
             浏览任意外语网页时，用鼠标划选不认识的单词、短语或句子并点击「译并记」，就会自动生成双语错题卡片。
           </div>`
        : `<div class="empty-box">没有符合当前筛选条件的词条</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((entry) => {
      const isMastered = entry.status === 'mastered';
      const statusClass =
        entry.status === 'mastered'
          ? 'badge-mastered'
          : entry.status === 'learning'
            ? 'badge-learning'
            : 'badge-new';

      const dictHtml =
        Array.isArray(entry.dictMeanings) && entry.dictMeanings.length > 0
          ? `<div class="dict-list">${entry.dictMeanings
              .map(
                (m) =>
                  `<div><span class="dict-pos">${escapeHtml(m.pos)}</span>${escapeHtml(
                    (m.terms || []).join('；')
                  )}</div>`
              )
              .join('')}</div>`
          : '';

      const ctxHtml = entry.contextSentence
        ? `<div class="context-box">
             <div>${highlightInContext(entry.contextSentence, entry.text)}</div>
             ${
               entry.contextTranslation
                 ? `<div class="context-trans">${escapeHtml(entry.contextTranslation)}</div>`
                 : ''
             }
           </div>`
        : '';

      const sourceHtml = entry.pageUrl
        ? `<a class="source-link" href="${escapeHtml(entry.pageUrl)}" target="_blank" rel="noopener" title="${escapeHtml(
            entry.pageUrl
          )}">来源：${escapeHtml(entry.pageTitle || entry.pageUrl)}</a>`
        : `<span>手动录入</span>`;

      return `
        <article class="nb-card ${isMastered ? 'mastered' : ''}" data-id="${escapeHtml(entry.id)}">
          <div class="nb-card-head">
            <div class="badge-group">
              <span class="badge badge-type">${escapeHtml(TYPE_LABELS[entry.type] || '词条')}</span>
              <span class="badge ${statusClass}">${escapeHtml(STATUS_LABELS[entry.status] || '未掌握')}</span>
              ${
                (entry.encounterCount || 1) > 1
                  ? `<span class="badge badge-count">遇到 ${entry.encounterCount} 次</span>`
                  : ''
              }
              ${
                (entry.wrongCount || 0) > 0
                  ? `<span class="badge badge-count">遗忘 ${entry.wrongCount} 次</span>`
                  : ''
              }
            </div>
            <div class="card-tools">
              <button class="tool-btn btn-retrans" type="button" title="重新翻译为简体中文">↻ 重译</button>
              <button class="tool-btn btn-edit-trans" type="button" title="修改译文">✎</button>
              <button class="tool-btn del btn-del" type="button" title="删除">🗑</button>
            </div>
          </div>

          <div class="bilingual-box">
            <div class="orig-text">${escapeHtml(entry.text)}</div>
            ${entry.phonetic ? `<div class="phonetic">[${escapeHtml(entry.phonetic)}]</div>` : ''}
            <div class="trans-row">
              <div class="trans-text">${escapeHtml(entry.translation)}</div>
            </div>
            ${dictHtml}
          </div>

          ${ctxHtml}

          <div class="note-box">
            <textarea class="note-input" placeholder="添加错题笔记、易混词对比或记忆方法（失焦自动保存）...">${escapeHtml(
              entry.note || ''
            )}</textarea>
          </div>

          <div class="nb-card-foot">
            <div>
              ${sourceHtml} · <span>${escapeHtml(formatDate(entry.createdAt))}</span>
            </div>
            <button class="btn ${isMastered ? 'btn-amber' : 'btn-success'} btn-mastery" type="button" style="padding:4px 10px;font-size:12px;">
              ${isMastered ? '放回错题本' : '✓ 标为已掌握'}
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

// ---------------- Flashcard Review ----------------

function buildReviewQueue() {
  const scope = document.getElementById('reviewScope').value;
  let pool = entries.filter((e) => {
    if (scope === 'wrong') return e.status !== 'mastered';
    if (scope === 'word') return e.type === 'word';
    if (scope === 'phrase_sentence') return e.type === 'phrase' || e.type === 'sentence';
    return true;
  });

  pool = [...pool].sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0) || Math.random() - 0.5);

  reviewQueue = pool;
  reviewIdx = 0;
  reviewRevealed = false;
  reviewStats = { ok: 0, wrong: 0 };
  renderReviewCard();
}

function renderReviewCard() {
  const stage = document.getElementById('reviewStage');
  const direction = document.getElementById('reviewDirection').value;

  if (reviewQueue.length === 0) {
    stage.innerHTML = `
      <div class="flashcard" style="text-align:center;">
        <h3>太棒了，当前范围没有需要抽查的词条！</h3>
        <p style="color:var(--text-muted);">您可以切换「复习范围」为全部收录词条，或者去网页继续收录新的生词。</p>
      </div>
    `;
    return;
  }

  if (reviewIdx >= reviewQueue.length) {
    stage.innerHTML = `
      <div class="flashcard" style="text-align:center;">
        <h2>本轮错题抽查完成！</h2>
        <p>共复习 <strong>${reviewQueue.length}</strong> 条 · 记住 <strong style="color:var(--green-text);">${reviewStats.ok}</strong> 条 · 需继续巩固 <strong style="color:var(--amber-text);">${reviewStats.wrong}</strong> 条</p>
        <div class="fc-actions">
          <button id="fcRestartBtn" class="btn btn-primary" type="button">再来一轮</button>
        </div>
      </div>
    `;
    document.getElementById('fcRestartBtn')?.addEventListener('click', buildReviewQueue);
    return;
  }

  const item = reviewQueue[reviewIdx];
  const pct = Math.round(((reviewIdx + 1) / reviewQueue.length) * 100);
  const promptText = direction === 'orig_to_native' ? item.text : item.translation;
  const answerText = direction === 'orig_to_native' ? item.translation : item.text;

  stage.innerHTML = `
    <div class="flashcard">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-muted);">
        <span>第 ${reviewIdx + 1} / ${reviewQueue.length} 条 · ${escapeHtml(TYPE_LABELS[item.type] || '词条')}</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>

      <div class="fc-prompt">${escapeHtml(promptText)}</div>
      ${
        direction === 'orig_to_native' && item.phonetic
          ? `<div class="phonetic" style="text-align:center;">[${escapeHtml(item.phonetic)}]</div>`
          : ''
      }

      ${
        !reviewRevealed
          ? `<div class="fc-actions">
               <button id="fcRevealBtn" class="btn btn-primary" type="button">显示双语对照答案</button>
             </div>`
          : `<div class="fc-answer">
               <div class="fc-answer-main">${escapeHtml(answerText)}</div>
               ${
                 item.contextSentence
                   ? `<div class="context-box" style="margin-top:12px;text-align:left;">
                        <div>${highlightInContext(item.contextSentence, item.text)}</div>
                        ${
                          item.contextTranslation
                            ? `<div class="context-trans">${escapeHtml(item.contextTranslation)}</div>`
                            : ''
                        }
                      </div>`
                   : ''
               }
               ${
                 item.note
                   ? `<div style="margin-top:8px;font-size:12.5px;color:var(--text-muted);">笔记：${escapeHtml(
                       item.note
                     )}</div>`
                   : ''
               }
               <div class="fc-actions" style="margin-top:16px;">
                 <button id="fcForgotBtn" class="btn btn-amber" type="button">没记住（留在错题本）</button>
                 <button id="fcKnownBtn" class="btn btn-success" type="button">✓ 记住了（已掌握）</button>
               </div>
             </div>`
      }
    </div>
  `;

  document.getElementById('fcRevealBtn')?.addEventListener('click', () => {
    reviewRevealed = true;
    renderReviewCard();
  });

  document.getElementById('fcForgotBtn')?.addEventListener('click', async () => {
    reviewStats.wrong++;
    const patch = {
      status: 'learning',
      reviewCount: (item.reviewCount || 0) + 1,
      wrongCount: (item.wrongCount || 0) + 1
    };
    const res = await sendMsg({ type: 'UPDATE_ENTRY', id: item.id, patch });
    const idx = entries.findIndex((e) => e.id === item.id);
    if (idx !== -1) entries[idx] = res.entry;
    reviewIdx++;
    reviewRevealed = false;
    renderReviewCard();
    renderNotebook();
  });

  document.getElementById('fcKnownBtn')?.addEventListener('click', async () => {
    reviewStats.ok++;
    const patch = {
      status: 'mastered',
      reviewCount: (item.reviewCount || 0) + 1
    };
    const res = await sendMsg({ type: 'UPDATE_ENTRY', id: item.id, patch });
    const idx = entries.findIndex((e) => e.id === item.id);
    if (idx !== -1) entries[idx] = res.entry;
    reviewIdx++;
    reviewRevealed = false;
    renderReviewCard();
    renderNotebook();
  });
}

// ---------------- Export & Import ----------------

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(val) {
  const s = String(val ?? '').replace(/"/g, '""');
  return `"${s}"`;
}

function exportCsv() {
  const headers = [
    '原文',
    '简体中文译文',
    '类型',
    '音标',
    '状态',
    '语境例句',
    '笔记',
    '来源标题',
    '来源网址',
    '收录时间'
  ];
  const rows = entries.map((e) =>
    [
      e.text,
      e.translation,
      TYPE_LABELS[e.type] || e.type,
      e.phonetic || '',
      STATUS_LABELS[e.status] || e.status,
      e.contextSentence || '',
      e.note || '',
      e.pageTitle || '',
      e.pageUrl || '',
      formatDate(e.createdAt)
    ]
      .map(csvCell)
      .join(',')
  );

  const csv = '\uFEFF' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
  const dateTag = new Date().toISOString().slice(0, 10);
  downloadFile(`wordbook-${dateTag}.csv`, csv, 'text/csv;charset=utf-8;');
}

function exportJson() {
  const payload = {
    app: 'WordBook',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries
  };
  const dateTag = new Date().toISOString().slice(0, 10);
  downloadFile(`wordbook-backup-${dateTag}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

// ---------------- Settings ----------------

function renderSettings() {
  document.getElementById('cfgShowFloating').checked = settings.showFloatingBtn !== false;

  const isLlm = settings.translatorEngine === 'custom_llm';
  document.getElementById('engineAuto').checked = !isLlm;
  document.getElementById('engineLlm').checked = isLlm;
  document.getElementById('llmConfigBox').classList.toggle('hidden', !isLlm);

  document.getElementById('cfgApiUrl').value = settings.customApiUrl || '';
  document.getElementById('cfgApiKey').value = settings.customApiKey || '';
  document.getElementById('cfgModel').value = settings.customModel || '';
}

// ---------------- Init & Events ----------------

async function init() {
  const [settingsRes, entriesRes] = await Promise.all([
    sendMsg({ type: 'GET_SETTINGS' }),
    sendMsg({ type: 'GET_ENTRIES' })
  ]);
  settings = settingsRes.settings;
  entries = entriesRes.entries || [];

  renderSettings();
  renderNotebook();

  const hash = location.hash.replace('#', '');
  if (['notebook', 'review', 'backup', 'settings'].includes(hash)) {
    switchView(hash);
  }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view);
  });
});

async function handleNbQuickAdd() {
  const input = document.getElementById('nbQuickInput');
  const btn = document.getElementById('nbQuickAddBtn');
  const text = input.value.trim();
  if (!text) return;

  btn.disabled = true;
  btn.textContent = '翻译中...';
  try {
    await sendMsg({ type: 'TRANSLATE_AND_SAVE', payload: { text } });
    input.value = '';
    const res = await sendMsg({ type: 'GET_ENTRIES' });
    entries = res.entries || [];
    renderNotebook();
  } catch (err) {
    alert(`收录失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '翻译并收录';
  }
}

document.getElementById('nbQuickAddBtn').addEventListener('click', handleNbQuickAdd);
document.getElementById('nbQuickInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleNbQuickAdd();
});

['nbSearchInput', 'nbTypeFilter', 'nbStatusFilter', 'nbSortOrder'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderNotebook);
  document.getElementById(id).addEventListener('change', renderNotebook);
});

document.getElementById('nbList').addEventListener('click', async (e) => {
  const card = e.target.closest('.nb-card');
  if (!card) return;
  const id = card.dataset.id;
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;

  if (e.target.closest('.btn-mastery')) {
    const nextStatus = entry.status === 'mastered' ? 'learning' : 'mastered';
    const res = await sendMsg({ type: 'UPDATE_ENTRY', id, patch: { status: nextStatus } });
    const idx = entries.findIndex((item) => item.id === id);
    if (idx !== -1) entries[idx] = res.entry;
    renderNotebook();
    return;
  }

  if (e.target.closest('.btn-retrans')) {
    const btn = e.target.closest('.btn-retrans');
    btn.textContent = '...';
    try {
      const res = await sendMsg({ type: 'RETRANSLATE_ENTRY', id });
      const idx = entries.findIndex((item) => item.id === id);
      if (idx !== -1) entries[idx] = res.entry;
      renderNotebook();
    } catch (err) {
      alert(`重新翻译失败：${err.message}`);
      btn.textContent = '↻ 重译';
    }
    return;
  }

  if (e.target.closest('.btn-edit-trans')) {
    const transRow = card.querySelector('.trans-row');
    if (transRow.querySelector('input')) return;
    transRow.innerHTML = `<input class="trans-edit-input" type="text" value="${escapeHtml(
      entry.translation
    )}" />`;
    const input = transRow.querySelector('input');
    input.focus();

    const commitEdit = async () => {
      const nextVal = input.value.trim();
      if (nextVal && nextVal !== entry.translation) {
        const res = await sendMsg({
          type: 'UPDATE_ENTRY',
          id,
          patch: { translation: nextVal }
        });
        const idx = entries.findIndex((item) => item.id === id);
        if (idx !== -1) entries[idx] = res.entry;
      }
      renderNotebook();
    };

    input.addEventListener('blur', commitEdit, { once: true });
    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') input.blur();
      if (ke.key === 'Escape') renderNotebook();
    });
    return;
  }

  if (e.target.closest('.btn-del')) {
    await sendMsg({ type: 'DELETE_ENTRY', id });
    entries = entries.filter((item) => item.id !== id);
    renderNotebook();
  }
});

document.getElementById('nbList').addEventListener(
  'blur',
  async (e) => {
    if (!e.target.classList.contains('note-input')) return;
    const card = e.target.closest('.nb-card');
    if (!card) return;
    const id = card.dataset.id;
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    const nextNote = e.target.value;
    if (nextNote === (entry.note || '')) return;

    const res = await sendMsg({ type: 'UPDATE_ENTRY', id, patch: { note: nextNote } });
    const idx = entries.findIndex((item) => item.id === id);
    if (idx !== -1) entries[idx] = res.entry;
  },
  true
);

document.getElementById('reviewScope').addEventListener('change', buildReviewQueue);
document.getElementById('reviewDirection').addEventListener('change', renderReviewCard);
document.getElementById('restartReviewBtn').addEventListener('click', buildReviewQueue);

document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
document.getElementById('importJsonBtn').addEventListener('click', () => {
  document.getElementById('importJsonInput').click();
});
document.getElementById('importJsonInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed.entries;
    if (!Array.isArray(list)) throw new Error('无效的备份文件格式');
    const res = await sendMsg({ type: 'IMPORT_ENTRIES', entries: list });
    const fresh = await sendMsg({ type: 'GET_ENTRIES' });
    entries = fresh.entries || [];
    renderNotebook();
    alert(`导入完成！新增 ${res.added} 条，当前共 ${res.total} 条词条。`);
  } catch (err) {
    alert(`导入失败：${err.message}`);
  } finally {
    e.target.value = '';
  }
});

document.querySelectorAll('input[name="engine"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const isLlm = document.getElementById('engineLlm').checked;
    document.getElementById('llmConfigBox').classList.toggle('hidden', !isLlm);
  });
});

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const nextSettings = {
    showFloatingBtn: document.getElementById('cfgShowFloating').checked,
    translatorEngine: document.getElementById('engineLlm').checked ? 'custom_llm' : 'auto',
    customApiUrl: document.getElementById('cfgApiUrl').value.trim(),
    customApiKey: document.getElementById('cfgApiKey').value.trim(),
    customModel: document.getElementById('cfgModel').value.trim() || 'gpt-4o-mini'
  };

  const res = await sendMsg({ type: 'SAVE_SETTINGS', settings: nextSettings });
  settings = res.settings;
  renderSettings();

  const toast = document.getElementById('saveSettingsToast');
  toast.textContent = '✓ 设置已保存';
  setTimeout(() => {
    toast.textContent = '';
  }, 2500);
});

init().catch((err) => {
  console.error(err);
});
