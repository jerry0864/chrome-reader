import { BookStore } from '../core/BookStore.js';

const grid        = document.getElementById('book-grid');
const emptyState  = document.getElementById('empty-state');
const btnAdd      = document.getElementById('btn-add');
const fileInput   = document.getElementById('file-input');
const dropOverlay = document.getElementById('drop-overlay');

async function init() {
  // Auto-import when opened via ?serve= (epub-server.js path)
  const served = await handleServeParam();
  if (served) return;

  await renderShelf();
  setupDragDrop();
}

// Called when Windows file association opens Chrome with ?serve=...&name=...
async function handleServeParam() {
  const params   = new URLSearchParams(location.search);
  const serveUrl = params.get('serve');
  const fileName = params.get('name');
  if (!serveUrl || !fileName) return false;

  history.replaceState({}, '', location.pathname);

  // If book already in library, open it directly (server may have shut down)
  const all = await BookStore.getAllBooks();
  const existing = all.find(b => b.fileName === fileName);
  if (existing) {
    location.href = chrome.runtime.getURL(`reader/reader.html?id=${existing.id}`);
    return true;
  }

  // Fetch from local server and import
  try {
    const resp = await fetch(serveUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const file = new File([blob], fileName, { type: 'application/epub+zip' });

    await importEpub(file, null);
    const books = await BookStore.getAllBooks();
    books.sort((a, b) => b.addedAt - a.addedAt);
    const bookId = books[0]?.id;
    if (bookId) {
      location.href = chrome.runtime.getURL(`reader/reader.html?id=${bookId}`);
    }
    return true;
  } catch (e) {
    console.error('serve import failed:', e);
    return false;
  }
}

async function renderShelf() {
  const books = await BookStore.getAllBooks();
  books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
  grid.innerHTML = '';

  if (books.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  for (const book of books) {
    const pos = await BookStore.getPosition(book.id);
    grid.appendChild(createCard(book, pos?.scrollPercent ?? 0));
  }
}

function createCard(book, progress) {
  const card = document.createElement('div');
  card.className = 'book-card';
  card.dataset.id = book.id;

  const coverHtml = book.coverDataUrl
    ? `<img class="book-cover" src="${book.coverDataUrl}" alt="">`
    : `<div class="book-cover-placeholder">📖</div>`;

  card.innerHTML = `
    ${coverHtml}
    <div class="book-info">
      <div class="book-title" title="${escHtml(book.title)}">${escHtml(book.title)}</div>
      <div class="book-author">${escHtml(book.author)}</div>
      <div class="book-progress"><div class="book-progress-bar" style="width:${Math.round(progress * 100)}%"></div></div>
    </div>
    <div class="book-actions">
      <button class="btn-delete" title="删除" data-id="${book.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;

  card.querySelector('.btn-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`删除《${book.title}》？`)) {
      await BookStore.deleteBook(book.id);
      await renderShelf();
    }
  });

  card.addEventListener('click', () => openBook(book.id));
  return card;
}

async function openBook(id) {
  const book = await BookStore.getBook(id);
  if (!book) return;

  if (!book.fileBlob && !book.fileHandle) {
    alert('找不到文件内容，请重新添加此书。');
    return;
  }

  await BookStore.updateLastRead(id);
  const url = chrome.runtime.getURL(`reader/reader.html?id=${id}`);
  chrome.tabs.create({ url });
}

async function addFiles(files) {
  for (const file of files) {
    if (!/\.(epub|mobi|azw3?)$/i.test(file.name)) continue;
    await importBook(file, null);
  }
  await renderShelf();
}

async function addHandles(handles) {
  for (const handle of handles) {
    if (!/\.(epub|mobi|azw3?)$/i.test(handle.name)) continue;
    const file = await handle.getFile();
    await importBook(file, handle);
  }
  await renderShelf();
}

async function importBook(file, fileHandle) {
  const existing = await BookStore.getAllBooks();
  if (existing.some(b => b.fileName === file.name)) return;

  let title = file.name.replace(/\.(epub|mobi|azw3?)$/i, '');
  let author = '';
  let coverDataUrl = null;
  let buffer;

  if (/\.(mobi|azw3?)$/i.test(file.name)) {
    try {
      buffer = await file.arrayBuffer();
      const { MOBI } = await import('../lib/mobi.js');
      const unzlib = window.fflate?.unzlibSync;
      const mobi = new MOBI({ unzlib });
      const format = await mobi.open(new Blob([buffer]));
      const meta = format.metadata || {};
      title  = meta.title || title;
      author = Array.isArray(meta.author) ? meta.author[0] || '' : meta.author || '';
      try {
        const coverBlob = await format.getCover();
        if (coverBlob) coverDataUrl = await blobToDataUrl(coverBlob);
      } catch (_) {}
    } catch (e) {
      console.error('mobi 解析失败:', e);
      buffer = buffer || await file.arrayBuffer();
    }
  } else {
    try {
      buffer = await file.arrayBuffer();
      const book = ePub(buffer);
      await book.ready;
      await book.loaded.metadata;

      const meta = book.package.metadata;
      title  = meta.title   || title;
      author = meta.creator || '';

      try {
        const coverUrl = await book.coverUrl();
        if (coverUrl) {
          const resp = await fetch(coverUrl);
          const blob = await resp.blob();
          coverDataUrl = await blobToDataUrl(blob);
        }
      } catch (_) {}

      book.destroy();
    } catch (e) {
      console.error('epub 解析失败:', e);
      buffer = buffer || await file.arrayBuffer();
    }
  }

  await BookStore.addBook({
    id: crypto.randomUUID(),
    title,
    author,
    coverDataUrl,
    fileHandle: fileHandle || null,
    fileBlob: buffer,
    fileName: file.name,
    addedAt: Date.now(),
    lastReadAt: null,
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// File picker button — uses File System Access API for persistent handles
btnAdd.addEventListener('click', async () => {
  try {
    const handles = await window.showOpenFilePicker({
      types: [{ description: 'EPUB / MOBI 电子书', accept: {
        'application/epub+zip': ['.epub'],
        'application/x-mobipocket-ebook': ['.mobi', '.azw', '.azw3'],
      }}],
      multiple: true,
    });
    await addHandles(handles);
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
});

// Fallback file input
fileInput.addEventListener('change', async () => {
  await addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

// Drag and drop — prefer FileSystemFileHandle via getAsFileSystemHandle() for persistence
function setupDragDrop() {
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add('hidden'); }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add('hidden');

    const items = Array.from(e.dataTransfer.items || []);
    if (items.length && items[0].getAsFileSystemHandle) {
      const handles = await Promise.all(items.map(i => i.getAsFileSystemHandle()));
      await addHandles(handles.filter(h => h?.kind === 'file' && h.name.endsWith('.epub')));
    } else {
      await addFiles(Array.from(e.dataTransfer.files));
    }
  });
}

// PWA File Handling API (future: when extension is installed as PWA)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams.files?.length) return;
    const handles = launchParams.files.filter(h => h.name.endsWith('.epub'));
    if (handles.length) { await addHandles(handles); await renderShelf(); }
  });
}

init();
