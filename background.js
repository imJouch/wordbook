import {
  STORAGE_KEYS,
  NATIVE_LANG,
  DEFAULT_SETTINGS,
  classifyText,
  normalizeText
} from './shared/constants.js';

const MENU_SAVE_ID = 'wordbook-save-selection';

// ---------------- Storage Helpers ----------------

async function getSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(res[STORAGE_KEYS.SETTINGS] || {}) };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

async function getEntries() {
  const res = await chrome.storage.local.get(STORAGE_KEYS.ENTRIES);
  const list = res[STORAGE_KEYS.ENTRIES];
  return Array.isArray(list) ? list : [];
}

async function saveEntries(entries) {
  await chrome.storage.local.set({ [STORAGE_KEYS.ENTRIES]: entries });
  await updateBadge(entries);
  return entries;
}

async function updateBadge(entriesArg) {
  try {
    const entries = entriesArg || (await getEntries());
    const pendingCount = entries.filter((e) => e.status !== 'mastered').length;
    await chrome.action.setBadgeBackgroundColor({ color: '#4338ca' });
    await chrome.action.setBadgeText({
      text: pendingCount > 0 ? (pendingCount > 999 ? '999+' : String(pendingCount)) : ''
    });
  } catch {
    // Ignore badge errors
  }
}

// ---------------- Translation Engines ----------------

function guessSourceLangForFallback(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[а-яА-ЯёЁ]/.test(text)) return 'ru';
  if (/[äöüßÄÖÜ]/.test(text)) return 'de';
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr';
  return 'en';
}

async function translateWithGoogle(text) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(NATIVE_LANG)}` +
    `&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(text)}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Google Translate HTTP ${resp.status}`);
  }
  const data = await resp.json();

  let translation = '';
  let phonetic = '';

  if (Array.isArray(data?.[0])) {
    for (const seg of data[0]) {
      if (Array.isArray(seg)) {
        if (typeof seg[0] === 'string') {
          translation += seg[0];
        }
        if (!phonetic && typeof seg[3] === 'string' && seg[3].trim()) {
          phonetic = seg[3].trim();
        }
      }
    }
  }

  const sourceLang = typeof data?.[2] === 'string' ? data[2] : 'auto';

  const dictMeanings = [];
  if (Array.isArray(data?.[1])) {
    for (const group of data[1].slice(0, 4)) {
      if (Array.isArray(group) && typeof group[0] === 'string' && Array.isArray(group[1])) {
        dictMeanings.push({
          pos: group[0],
          terms: group[1].slice(0, 5)
        });
      }
    }
  }

  if (!translation.trim()) {
    throw new Error('Empty translation from Google');
  }

  return {
    translation: translation.trim(),
    phonetic,
    sourceLang,
    dictMeanings,
    provider: 'google'
  };
}

async function translateWithMyMemory(text) {
  const sourceGuess = guessSourceLangForFallback(text);
  const url =
    'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(sourceGuess)}|${encodeURIComponent(NATIVE_LANG)}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`MyMemory HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const translated = data?.responseData?.translatedText;
  if (!translated) {
    throw new Error('Empty translation from MyMemory');
  }
  return {
    translation: translated.trim(),
    phonetic: '',
    sourceLang: sourceGuess,
    dictMeanings: [],
    provider: 'mymemory'
  };
}

async function translateWithCustomLLM(text, settings, contextSentence = '') {
  const systemPrompt =
    'You are a precise bilingual dictionary and translator. ' +
    'Translate the user\'s selected text into Simplified Chinese (简体中文, zh-CN). ' +
    'Respond ONLY with a valid JSON object with keys: ' +
    '"translation" (string, natural accurate translation in Simplified Chinese), ' +
    '"phonetic" (string, IPA or pronunciation if single word/short phrase, else ""), ' +
    '"sourceLang" (ISO 639-1 code like "en", "ja", "fr"), ' +
    '"dictMeanings" (array of { "pos": string, "terms": string[] } up to 3 items, empty for sentences), ' +
    '"contextTranslation" (string, Simplified Chinese translation of the context sentence if provided, else "").';

  const userPayload =
    contextSentence && contextSentence !== text
      ? `Selected text: ${text}\nContext sentence: ${contextSentence}`
      : `Selected text: ${text}`;

  const resp = await fetch(settings.customApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.customApiKey}`
    },
    body: JSON.stringify({
      model: settings.customModel || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload }
      ]
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Custom API HTTP ${resp.status}: ${errText.slice(0, 120)}`);
  }

  const data = await resp.json();
  const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';
  const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.translation) {
      return {
        translation: String(parsed.translation).trim(),
        phonetic: String(parsed.phonetic || '').trim(),
        sourceLang: String(parsed.sourceLang || 'auto').trim(),
        dictMeanings: Array.isArray(parsed.dictMeanings) ? parsed.dictMeanings : [],
        contextTranslation: String(parsed.contextTranslation || '').trim(),
        provider: 'custom_llm'
      };
    }
  } catch {
    if (rawContent) {
      return {
        translation: rawContent,
        phonetic: '',
        sourceLang: 'auto',
        dictMeanings: [],
        contextTranslation: '',
        provider: 'custom_llm'
      };
    }
  }
  throw new Error('Failed to parse custom LLM response');
}

async function performTranslation(text, settings, contextSentence = '') {
  if (settings.translatorEngine === 'custom_llm' && settings.customApiKey?.trim()) {
    try {
      return await translateWithCustomLLM(text, settings, contextSentence);
    } catch (err) {
      console.warn('[WordBook] Custom LLM failed, falling back to Google:', err);
    }
  }

  try {
    const mainRes = await translateWithGoogle(text);
    let contextTranslation = '';
    if (
      contextSentence &&
      normalizeText(contextSentence) !== normalizeText(text) &&
      contextSentence.length <= 350
    ) {
      try {
        const ctxRes = await translateWithGoogle(contextSentence);
        contextTranslation = ctxRes.translation;
      } catch {
        // Optional context translation failure shouldn't block saving
      }
    }
    return { ...mainRes, contextTranslation };
  } catch (googleErr) {
    console.warn('[WordBook] Google Translate failed, trying MyMemory:', googleErr);
    const fallbackRes = await translateWithMyMemory(text);
    return { ...fallbackRes, contextTranslation: '' };
  }
}

// ---------------- Core WordBook Operations ----------------

async function translateAndSaveEntry(payload) {
  const text = normalizeText(payload.text);
  if (!text) {
    throw new Error('选中文本为空');
  }

  const settings = await getSettings();
  const contextSentence = normalizeText(payload.contextSentence || '');

  const entries = await getEntries();
  const existingIdx = entries.findIndex(
    (item) => item.text.toLowerCase() === text.toLowerCase()
  );

  if (existingIdx !== -1) {
    const existing = entries[existingIdx];
    const now = Date.now();
    const updated = {
      ...existing,
      encounterCount: (existing.encounterCount || 1) + 1,
      updatedAt: now,
      status: existing.status === 'mastered' ? 'learning' : existing.status,
      contextSentence: existing.contextSentence || contextSentence,
      pageTitle: existing.pageTitle || payload.pageTitle || '',
      pageUrl: existing.pageUrl || payload.pageUrl || ''
    };
    entries.splice(existingIdx, 1);
    entries.unshift(updated);
    await saveEntries(entries);
    return { entry: updated, isDuplicate: true, settings };
  }

  const tx = await performTranslation(text, settings, contextSentence);
  const now = Date.now();

  const newEntry = {
    id: crypto.randomUUID(),
    text,
    type: classifyText(text),
    sourceLang: tx.sourceLang || 'auto',
    targetLang: NATIVE_LANG,
    translation: tx.translation,
    phonetic: tx.phonetic || '',
    dictMeanings: tx.dictMeanings || [],
    contextSentence,
    contextTranslation: tx.contextTranslation || '',
    pageTitle: payload.pageTitle || '',
    pageUrl: payload.pageUrl || '',
    provider: tx.provider || 'google',
    status: 'new',
    reviewCount: 0,
    wrongCount: 0,
    encounterCount: 1,
    note: '',
    createdAt: now,
    updatedAt: now
  };

  entries.unshift(newEntry);
  await saveEntries(entries);
  return { entry: newEntry, isDuplicate: false, settings };
}

async function retranslateEntry(id) {
  const settings = await getSettings();
  const entries = await getEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error('未找到该词条');

  const item = entries[idx];
  const tx = await performTranslation(item.text, settings, item.contextSentence || '');
  const updated = {
    ...item,
    targetLang: NATIVE_LANG,
    translation: tx.translation,
    phonetic: tx.phonetic || item.phonetic || '',
    dictMeanings: tx.dictMeanings?.length ? tx.dictMeanings : item.dictMeanings || [],
    sourceLang: tx.sourceLang || item.sourceLang,
    contextTranslation: tx.contextTranslation || item.contextTranslation || '',
    provider: tx.provider,
    updatedAt: Date.now()
  };

  entries[idx] = updated;
  await saveEntries(entries);
  return updated;
}

// ---------------- Content Script Auto-Injection & Menus ----------------

async function injectContentScriptIntoOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content.js']
        })
        .catch(() => {});
    }
  } catch {
    // Ignore tab query errors
  }
}

async function setupContextMenu() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: MENU_SAVE_ID,
      title: '添加到 WordBook 生词错题本',
      contexts: ['selection']
    });
  } catch (err) {
    console.warn('[WordBook] Context menu setup error:', err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (!existing[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
  await setupContextMenu();
  await updateBadge();
  await injectContentScriptIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupContextMenu();
  await updateBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_SAVE_ID) return;

  let selectionPayload = {
    text: info.selectionText || '',
    contextSentence: '',
    pageTitle: tab?.title || '',
    pageUrl: info.pageUrl || tab?.url || ''
  };

  if (tab?.id) {
    try {
      const pageCtx = await chrome.tabs.sendMessage(tab.id, {
        type: 'GET_SELECTION_CONTEXT'
      });
      if (pageCtx?.text) {
        selectionPayload = {
          text: pageCtx.text,
          contextSentence: pageCtx.contextSentence || '',
          pageTitle: pageCtx.pageTitle || tab.title || '',
          pageUrl: pageCtx.pageUrl || info.pageUrl || tab.url || ''
        };
      }
    } catch {
      // Content script might not be available on restricted pages
    }
  }

  if (!normalizeText(selectionPayload.text)) return;

  try {
    const result = await translateAndSaveEntry(selectionPayload);
    if (tab?.id) {
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'SHOW_SAVED_RESULT',
          entry: result.entry,
          isDuplicate: result.isDuplicate
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error('[WordBook] Context menu save failed:', err);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SAVE_SELECTION' });
  } catch {
    // Ignore tabs where content scripts are unavailable
  }
});

// ---------------- Message Bus ----------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'GET_SETTINGS': {
        const settings = await getSettings();
        sendResponse({ ok: true, settings });
        break;
      }
      case 'SAVE_SETTINGS': {
        const settings = await saveSettings(message.settings || {});
        sendResponse({ ok: true, settings });
        break;
      }
      case 'GET_ENTRIES': {
        const entries = await getEntries();
        sendResponse({ ok: true, entries });
        break;
      }
      case 'TRANSLATE_AND_SAVE': {
        const res = await translateAndSaveEntry(message.payload || {});
        sendResponse({ ok: true, ...res });
        break;
      }
      case 'UPDATE_ENTRY': {
        const entries = await getEntries();
        const idx = entries.findIndex((e) => e.id === message.id);
        if (idx === -1) throw new Error('Entry not found');
        entries[idx] = {
          ...entries[idx],
          ...(message.patch || {}),
          updatedAt: Date.now()
        };
        await saveEntries(entries);
        sendResponse({ ok: true, entry: entries[idx] });
        break;
      }
      case 'DELETE_ENTRY': {
        const entries = await getEntries();
        const next = entries.filter((e) => e.id !== message.id);
        await saveEntries(next);
        sendResponse({ ok: true, count: next.length });
        break;
      }
      case 'IMPORT_ENTRIES': {
        const incoming = Array.isArray(message.entries) ? message.entries : [];
        const entries = await getEntries();
        const existingKeys = new Set(entries.map((e) => e.text.toLowerCase()));
        let added = 0;
        const merged = [...entries];
        for (const item of incoming) {
          if (!item?.text || !item?.translation) continue;
          const norm = normalizeText(item.text);
          if (existingKeys.has(norm.toLowerCase())) continue;
          existingKeys.add(norm.toLowerCase());
          merged.push({
            id: item.id || crypto.randomUUID(),
            text: norm,
            type: item.type || classifyText(norm),
            sourceLang: item.sourceLang || 'auto',
            targetLang: NATIVE_LANG,
            translation: String(item.translation),
            phonetic: item.phonetic || '',
            dictMeanings: Array.isArray(item.dictMeanings) ? item.dictMeanings : [],
            contextSentence: item.contextSentence || '',
            contextTranslation: item.contextTranslation || '',
            pageTitle: item.pageTitle || '',
            pageUrl: item.pageUrl || '',
            provider: item.provider || 'import',
            status: item.status || 'new',
            reviewCount: Number(item.reviewCount) || 0,
            wrongCount: Number(item.wrongCount) || 0,
            encounterCount: Number(item.encounterCount) || 1,
            note: item.note || '',
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now()
          });
          added++;
        }
        merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        await saveEntries(merged);
        sendResponse({ ok: true, added, total: merged.length });
        break;
      }
      case 'RETRANSLATE_ENTRY': {
        const entry = await retranslateEntry(message.id);
        sendResponse({ ok: true, entry });
        break;
      }
      case 'OPEN_NOTEBOOK': {
        const url = chrome.runtime.getURL(
          message.hash ? `notebook.html#${message.hash}` : 'notebook.html'
        );
        await chrome.tabs.create({ url });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })().catch((err) => {
    console.error('[WordBook] Message error:', err);
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});
