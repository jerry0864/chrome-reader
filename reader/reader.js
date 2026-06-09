import { BookStore } from '../core/BookStore.js';
import { SettingsStore } from '../core/SettingsStore.js';
import { createReader } from '../core/ReaderFactory.js';
import { initNoteSaver } from './note-saver.js';

const params = new URLSearchParams(location.search);
const bookId = params.get('id');

const loading = document.getElementById('loading');
const readerArea = document.getElementById('reader-area');
const chapterTitle = document.getElementById('chapter-title');
const btnBack = document.getElementById('btn-back');
const btnToc = document.getElementById('btn-toc');
const btnSettings = document.getElementById('btn-settings');
const tocPanel = document.getElementById('toc-panel');
const tocClose = document.getElementById('toc-close');
const tocList = document.getElementById('toc-list');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const themeSwatches = document.getElementById('theme-swatches');
const fontSizeSlider = document.getElementById('font-size');
const fontSizeVal = document.getElementById('font-size-val');
const lineHeightSlider = document.getElementById('line-height');
const lineHeightVal = document.getElementById('line-height-val');
const letterSpacingSlider = document.getElementById('letter-spacing');
const letterSpacingVal = document.getElementById('letter-spacing-val');
const fontFamilySelect = document.getElementById('font-family');

let reader = null;
let settings = null;
let saveTimer = null;

async function init() {
  if (!bookId) { showError('未指定书籍'); return; }

  const book = await BookStore.getBook(bookId);
  if (!book) { showError('找不到书籍信息'); return; }

  let file;
  if (book.fileBlob) {
    file = new File([book.fileBlob], book.fileName || 'book.epub', { type: 'application/epub+zip' });
  } else if (book.fileHandle) {
    try {
      const perm = await book.fileHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') await book.fileHandle.requestPermission({ mode: 'read' });
      file = await book.fileHandle.getFile();
    } catch (e) {
      showError('无法访问文件，请在书架重新添加此书。');
      return;
    }
  } else {
    showError('找不到文件内容，请在书架重新添加此书。');
    return;
  }

  settings = await SettingsStore.get();
  // Force scroll mode — paginated (epub.js iframe) doesn't work in extension pages
  settings.readingMode = 'scroll';
  applyThemeToPage(settings.theme);

  reader = createReader(book.fileName);
  try {
    const meta = await reader.open(file);
    document.title = meta.title + ' — Epub Reader';
    buildToc(meta.toc);
  } catch (e) {
    showError('书籍解析失败：' + e.message);
    return;
  }

  const readerWrap = document.getElementById('reader-wrap');

  await reader.renderTo(readerArea, 'scroll', readerWrap, () => {
    loading.classList.add('hidden');
    loadSettingsUI();
    setupUI();
  });
  reader.applySettings(settings);

  const pos = await BookStore.getPosition(bookId);
  if (pos) await reader.goTo(pos);

  reader.onLocationChange((loc) => {
    if (!loc) return;
    chapterTitle.textContent = loc.chapterTitle || '';
    const pct = Math.round((loc.scrollPercent || 0) * 100);
    progressFill.style.width = pct + '%';
    progressLabel.textContent = pct + '%';
    scheduleSave(loc);
  });

  readerWrap.addEventListener('scroll', () => {
    const total = readerWrap.scrollHeight - readerWrap.clientHeight;
    if (total <= 0) return;
    const pct = Math.round((readerWrap.scrollTop / total) * 100);
    progressFill.style.width = pct + '%';
    progressLabel.textContent = pct + '%';
  }, { passive: true });
}

function scheduleSave(loc) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    BookStore.savePosition(bookId, {
      cfi: loc.cfi,
      scrollPercent: loc.scrollPercent,
      chapterHref: loc.chapterHref,
      chapterFraction: loc.chapterFraction,
    });
  }, 1000);
}

async function saveNow() {
  clearTimeout(saveTimer);
  const loc = await reader?.getCurrentLocation();
  if (loc) await BookStore.savePosition(bookId, {
    cfi: loc.cfi,
    scrollPercent: loc.scrollPercent,
    chapterHref: loc.chapterHref,
    chapterFraction: loc.chapterFraction,
  });
}

function applyThemeToPage(theme) {
  document.body.className = `theme-${theme}`;
}

function buildToc(toc) {
  tocList.innerHTML = '';
  for (const item of toc) {
    const el = document.createElement('div');
    el.className = `toc-item toc-depth-${Math.min(item.depth, 2)}`;
    el.textContent = item.label;
    el.addEventListener('click', () => {
      reader.goTo({ chapterHref: item.href, cfi: item.href });
      tocPanel.classList.add('hidden');
    });
    tocList.appendChild(el);
  }
}

function loadSettingsUI() {
  fontSizeSlider.value = settings.fontSize;
  fontSizeVal.textContent = settings.fontSize;
  lineHeightSlider.value = settings.lineHeight;
  lineHeightVal.textContent = settings.lineHeight;
  letterSpacingSlider.value = settings.letterSpacing;
  letterSpacingVal.textContent = settings.letterSpacing;
  fontFamilySelect.value = settings.fontFamily;
  document.querySelectorAll('[data-theme]').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === settings.theme);
  });
}

async function updateSettings(patch) {
  Object.assign(settings, patch);
  await SettingsStore.set(patch);
  reader?.applySettings(settings);
  if (patch.theme) applyThemeToPage(patch.theme);
}

function setupUI() {
  initNoteSaver(() => document.title.replace(/ — Epub Reader$/, '').trim());

  btnBack.addEventListener('click', async () => {
    await saveNow();
    window.close();
  });

  btnToc.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
    tocPanel.classList.toggle('hidden');
  });
  tocClose.addEventListener('click', () => tocPanel.classList.add('hidden'));

  btnSettings.addEventListener('click', () => {
    tocPanel.classList.add('hidden');
    settingsPanel.classList.toggle('hidden');
  });
  settingsClose.addEventListener('click', () => settingsPanel.classList.add('hidden'));

  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !btnSettings.contains(e.target))
      settingsPanel.classList.add('hidden');
    if (!tocPanel.contains(e.target) && !btnToc.contains(e.target))
      tocPanel.classList.add('hidden');
  });

  fontSizeSlider.addEventListener('input', () => {
    fontSizeVal.textContent = fontSizeSlider.value;
    updateSettings({ fontSize: parseInt(fontSizeSlider.value, 10) });
  });

  lineHeightSlider.addEventListener('input', () => {
    const lh = parseFloat(lineHeightSlider.value);
    lineHeightVal.textContent = lh.toFixed(1);
    updateSettings({ lineHeight: lh });
  });

  letterSpacingSlider.addEventListener('input', () => {
    const ls = parseFloat(letterSpacingSlider.value);
    letterSpacingVal.textContent = ls;
    updateSettings({ letterSpacing: ls });
  });

  fontFamilySelect.addEventListener('change', () => {
    updateSettings({ fontFamily: fontFamilySelect.value });
  });

  themeSwatches.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    themeSwatches.querySelectorAll('[data-theme]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSettings({ theme: btn.dataset.theme });
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') {
      tocPanel.classList.add('hidden');
      settingsPanel.classList.add('hidden');
    }
  });

  window.addEventListener('beforeunload', () => saveNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
}

function showError(msg) {
  loading.innerHTML = `<p style="color:#ef4444;font-size:15px;">⚠️ ${msg}</p><a href="${chrome.runtime.getURL('bookshelf/bookshelf.html')}" style="margin-top:12px;color:#6366f1;">返回书库</a>`;
}

init();
