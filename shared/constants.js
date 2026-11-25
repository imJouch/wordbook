export const STORAGE_KEYS = {
  ENTRIES: 'wordbook_entries',
  SETTINGS: 'wordbook_settings'
};

export const NATIVE_LANG = 'zh-CN';

export const DEFAULT_SETTINGS = {
  showFloatingBtn: true,
  translatorEngine: 'auto', // 'auto' (Google + MyMemory fallback) | 'custom_llm'
  customApiUrl: 'https://api.openai.com/v1/chat/completions',
  customApiKey: '',
  customModel: 'gpt-4o-mini'
};

export const TYPE_LABELS = {
  word: '单词',
  phrase: '短语',
  sentence: '句子'
};

export const STATUS_LABELS = {
  new: '未掌握',
  learning: '复习中',
  mastered: '已掌握'
};

/**
 * Classify selected text into 'word', 'phrase', or 'sentence'.
 */
export function classifyText(raw) {
  const text = (raw || '').trim();
  if (!text) return 'word';

  const hasSentencePunct = /[.!?。！？;；]\s*$/.test(text) || /[.!?。！？]\s+\S/.test(text);
  const words = text.split(/\s+/).filter(Boolean);

  if (hasSentencePunct || words.length >= 8 || text.length >= 65) {
    return 'sentence';
  }
  if (words.length >= 2) {
    return 'phrase';
  }
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  if (cjkChars > 0 && words.length === 1) {
    if (cjkChars <= 4) return 'word';
    if (cjkChars <= 14) return 'phrase';
    return 'sentence';
  }
  return 'word';
}

export function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(ts).slice(0, 10);
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
