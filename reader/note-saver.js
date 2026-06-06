// note-saver.js — saves selected text to YYYY-MM-DD.md
// Matches Obsidian daily-note format in the existing notes.

import { BookStore } from '../core/BookStore.js';

const NOTE_HANDLE_KEY = 'noteDirHandle';
const NOTE_TAGS_KEY   = 'noteTags';

// ── Tag history (stored in IndexedDB meta, same mechanism as the dir handle) ───
async function getTagHistory() {
  return (await BookStore.getMeta(NOTE_TAGS_KEY)) || [];
}

async function saveTagHistory(tags) {
  await BookStore.setMeta(NOTE_TAGS_KEY, tags);
}

// Normalize a user-entered tag: trim, prepend '#' if missing.
// A single-level tag (no '/') is allowed.
function normalizeTag(raw) {
  let t = (raw || '').trim();
  if (!t) return '';
  if (!t.startsWith('#')) t = '#' + t;
  return t;
}

// ── Directory handle ──────────────────────────────────────────────────────────
async function getNoteDirHandle() {
  const handle = await BookStore.getMeta(NOTE_HANDLE_KEY);
  if (!handle) return null;
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return handle;
  const req = await handle.requestPermission({ mode: 'readwrite' });
  return req === 'granted' ? handle : null;
}

async function pickNoteDirHandle() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await BookStore.setMeta(NOTE_HANDLE_KEY, handle);
  return handle;
}

// ── Append to today's md file ─────────────────────────────────────────────────
async function appendToNote(content) {
  let dirHandle = await getNoteDirHandle();
  if (!dirHandle) dirHandle = await pickNoteDirHandle();

  const today      = new Date().toLocaleDateString('sv').slice(0, 10); // YYYY-MM-DD
  const fileHandle = await dirHandle.getFileHandle(today + '.md', { create: true });
  const file       = await fileHandle.getFile();
  const existing   = await file.text();
  const writable   = await fileHandle.createWritable();
  await writable.write(existing + (existing.length > 0 ? '\n' : '') + content);
  await writable.close();
}

// ── Extract pure book title ───────────────────────────────────────────────────
// Strip subtitles and parenthetical info, e.g.:
//   "认知驱动：做成一件…（…）" → "认知驱动"
//   "The Lean Startup: How…"  → "The Lean Startup"
function pureTitle(raw) {
  return raw
    .replace(/[（(【].*/, '')  // drop parenthetical suffix
    .replace(/[：:].*/,  '')  // drop subtitle after colon
    .trim();
}

// ── Build note content ────────────────────────────────────────────────────────
// Format (matches existing Obsidian daily-note style):
// - HH:mm
// \t摘录行
// \t
// \t---
// \t【评】
// \t评语行          ← only when comment is non-empty
// \t
// \t《书名》 #摘录/阅读 #关键词/满足 …   ← extra tags appended after the default
function buildNoteContent(selectedText, bookTitle, comment, tags = []) {
  const time = new Date().toTimeString().slice(0, 5); // HH:mm
  const title = pureTitle(bookTitle);

  const indent  = (text) => text.trim().split('\n').map(l => '\t' + l).join('\n');
  const quote   = (text) => text.trim().split('\n').map(l => '\t> ' + l).join('\n');

  let parts = [`- ${time} `, quote(selectedText), '\t'];

  if (comment && comment.trim()) {
    parts.push('\t---');
    parts.push(indent(comment));
    parts.push('\t');
  }

  const extraTags = tags.length ? ' ' + tags.join(' ') : '';
  parts.push(`\t《${title}》 #摘录/阅读${extraTags}`);
  return parts.join('\n');
}

// ── Floating panel (button + comment textarea) ────────────────────────────────
export function initNoteSaver(getBookTitle) {
  // Panel container
  const panel = document.createElement('div');
  panel.id = 'note-saver-panel';
  panel.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'background:#fff',
    'border:1px solid #e4e4e7',
    'border-radius:12px',
    'box-shadow:0 4px 16px rgba(0,0,0,.15)',
    'padding:10px',
    'display:none',
    'flex-direction:column',
    'gap:8px',
    'width:260px',
  ].join(';');

  // Drag handle (header strip) — press here to move the whole panel
  const dragHandle = document.createElement('div');
  dragHandle.textContent = '⋮⋮';
  dragHandle.title = '拖动移动弹窗';
  dragHandle.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'height:14px',
    'margin:-4px -4px 0',
    'color:#d4d4d8',
    'font-size:12px',
    'letter-spacing:2px',
    'cursor:move',
    'user-select:none',
    'flex:none',
  ].join(';');

  // Comment textarea
  const textarea = document.createElement('textarea');
  textarea.placeholder = '写评语（可空）';
  textarea.style.cssText = [
    'width:100%',
    'height:72px',
    'border:1px solid #e4e4e7',
    'border-radius:8px',
    'padding:6px 8px',
    'font-size:13px',
    'font-family:inherit',
    'resize:none',
    'outline:none',
    'box-sizing:border-box',
    'color:#18181b',
  ].join(';');

  // ── Tag selector (text control + dropdown) ─────────────────────────────────
  let tagHistory  = [];   // all known tags, persisted
  let selectedTags = [];  // committed selection shown on the control
  let listChecked = [];   // working selection while the dropdown is open

  getTagHistory().then((t) => { tagHistory = t; });

  const tagWrap = document.createElement('div');
  tagWrap.style.cssText = 'position:relative;width:100%;';

  // The text control that shows the placeholder / selected tags
  const tagControl = document.createElement('div');
  tagControl.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'border:1px solid #e4e4e7',
    'border-radius:8px',
    'padding:6px 8px',
    'font-size:13px',
    'cursor:pointer',
    'box-sizing:border-box',
    'background:#fff',
  ].join(';');

  const tagLabel = document.createElement('span');
  tagLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const tagArrow = document.createElement('span');
  tagArrow.textContent = '▾';
  tagArrow.style.cssText = 'color:#a1a1aa;font-size:11px;';
  tagControl.append(tagLabel, tagArrow);

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.style.cssText = [
    'position:absolute',
    'left:0',
    'right:0',
    'top:calc(100% + 4px)',
    'background:#fff',
    'border:1px solid #e4e4e7',
    'border-radius:8px',
    'box-shadow:0 4px 16px rgba(0,0,0,.15)',
    'padding:4px',
    'display:none',
    'flex-direction:column',
    'gap:2px',
    'z-index:1',
  ].join(';');

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:2px;max-height:160px;overflow-y:auto;';

  // New-tag row: input + confirm (✓)
  const newRow = document.createElement('div');
  newRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 4px 2px;border-top:1px solid #f4f4f5;margin-top:2px;';
  const newInput = document.createElement('input');
  newInput.type = 'text';
  newInput.placeholder = '输入新增标签…';
  newInput.style.cssText = [
    'flex:1',
    'border:1px solid #e4e4e7',
    'border-radius:6px',
    'padding:4px 6px',
    'font-size:13px',
    'font-family:inherit',
    'outline:none',
    'box-sizing:border-box',
  ].join(';');
  const okBtn = document.createElement('span');
  okBtn.textContent = '✓';
  okBtn.title = '确认';
  okBtn.style.cssText = 'cursor:pointer;color:#16a34a;font-size:15px;font-weight:700;padding:0 4px;';
  newRow.append(newInput, okBtn);

  dropdown.append(list, newRow);
  tagWrap.append(tagControl, dropdown);

  function updateTagLabel() {
    if (selectedTags.length) {
      tagLabel.textContent = selectedTags.join(' ');
      tagLabel.style.color = '#18181b';
    } else {
      tagLabel.textContent = '选择标签';
      tagLabel.style.color = '#a1a1aa';
    }
  }
  updateTagLabel();

  function renderList() {
    list.innerHTML = '';
    if (!tagHistory.length) {
      const empty = document.createElement('div');
      empty.textContent = '暂无历史标签';
      empty.style.cssText = 'padding:6px 8px;font-size:12px;color:#a1a1aa;';
      list.appendChild(empty);
      return;
    }
    tagHistory.forEach((tag) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:13px;';
      const check = document.createElement('span');
      check.textContent = listChecked.includes(tag) ? '☑' : '☐';
      check.style.cssText = 'color:#6366f1;';
      const name = document.createElement('span');
      name.textContent = tag;
      name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#18181b;';
      const del = document.createElement('span');
      del.textContent = '🗑';
      del.title = '删除该标签';
      del.style.cssText = 'cursor:pointer;opacity:.55;font-size:12px;';

      item.addEventListener('click', () => {
        if (listChecked.includes(tag)) listChecked = listChecked.filter((t) => t !== tag);
        else listChecked.push(tag);
        check.textContent = listChecked.includes(tag) ? '☑' : '☐';
      });
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        tagHistory   = tagHistory.filter((t) => t !== tag);
        listChecked  = listChecked.filter((t) => t !== tag);
        selectedTags = selectedTags.filter((t) => t !== tag);
        await saveTagHistory(tagHistory);
        renderList();
        updateTagLabel();
      });

      item.append(check, name, del);
      list.appendChild(item);
    });
  }

  function openDropdown() {
    listChecked = [...selectedTags];
    renderList();
    newInput.value = '';
    dropdown.style.display = 'flex';
    tagArrow.textContent = '▴';
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
    tagArrow.textContent = '▾';
  }

  tagControl.addEventListener('click', () => {
    if (dropdown.style.display === 'none') openDropdown();
    else closeDropdown();
  });

  // Confirm: commit the new tag (if any) + checked tags to the control
  async function confirmTags() {
    const fresh = normalizeTag(newInput.value);
    if (fresh) {
      if (!tagHistory.includes(fresh)) {
        tagHistory.push(fresh);
        await saveTagHistory(tagHistory);
      }
      if (!listChecked.includes(fresh)) listChecked.push(fresh);
    }
    selectedTags = [...listChecked];
    newInput.value = '';
    updateTagLabel();
    closeDropdown();
  }
  okBtn.addEventListener('click', confirmTags);
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmTags(); }
  });

  function resetTags() {
    selectedTags = [];
    listChecked  = [];
    newInput.value = '';
    updateTagLabel();
    closeDropdown();
  }

  // Save button
  const btn = document.createElement('button');
  btn.id = 'btn-save-note';
  btn.textContent = '保存笔记';
  btn.style.cssText = [
    'padding:7px 0',
    'background:#6366f1',
    'color:#fff',
    'border:none',
    'border-radius:8px',
    'font-size:13px',
    'font-weight:600',
    'cursor:pointer',
    'width:100%',
  ].join(';');

  panel.appendChild(dragHandle);
  panel.appendChild(textarea);
  panel.appendChild(tagWrap);
  panel.appendChild(btn);
  document.body.appendChild(panel);

  // ── Drag to reposition ──────────────────────────────────────────────────────
  let dragging = false;
  let dragDX = 0, dragDY = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragDX = e.clientX - rect.left;
    dragDY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const margin = 8;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    let left = e.clientX - dragDX;
    let top  = e.clientY - dragDY;
    left = Math.max(margin, Math.min(left, window.innerWidth  - w - margin));
    top  = Math.max(margin, Math.min(top,  window.innerHeight - h - margin));
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  });

  // Reset after other mouseup handlers have run, so the selection handler
  // (registered later) still sees dragging === true and skips repositioning.
  document.addEventListener('mouseup', () => {
    if (dragging) setTimeout(() => { dragging = false; }, 0);
  });

  // Prevent panel clicks from clearing the text selection.
  // mousedown on most panel elements calls preventDefault so the browser
  // doesn't deselect; the textarea is excluded so it can still receive focus.
  panel.addEventListener('mousedown', (e) => {
    const tag = e.target.tagName;
    if (tag !== 'TEXTAREA' && tag !== 'INPUT') e.preventDefault();
  });

  // Toast
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed',
    'bottom:60px',
    'left:50%',
    'transform:translateX(-50%)',
    'background:rgba(0,0,0,.75)',
    'color:#fff',
    'padding:8px 20px',
    'border-radius:20px',
    'font-size:13px',
    'z-index:10000',
    'display:none',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(toast);

  function showToast(msg, ms = 2000) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, ms);
  }

  function hidePanel() {
    panel.style.display = 'none';
    textarea.value = '';
    resetTags();
    savedRange = null;
    clearHighlight();
    window.getSelection()?.removeAllRanges();
  }

  // Position panel near selection, always within viewport
  function positionPanel(x, y) {
    const margin = 8;
    const pw = 260, ph = 175; // approx panel size
    let left = Math.max(margin, Math.min(x, window.innerWidth  - pw - margin));
    let top  = y + margin;
    if (top + ph + margin > window.innerHeight) top = Math.max(margin, y - ph - margin);
    top  = Math.max(margin, Math.min(top, window.innerHeight - ph - margin));
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  }

  let lastSelection = '';
  let savedRange    = null;

  // ── CSS Custom Highlight API — persistent visual highlight ────────────────
  // Unlike window.getSelection(), a CSS Highlight is not affected by focus
  // changes, so the text stays visually highlighted while the user types.
  const HIGHLIGHT_NAME = 'note-saver-sel';
  let activeHighlight  = null;

  function applyHighlight(range) {
    clearHighlight();
    if (!CSS?.highlights) return; // fallback: no custom highlight support
    activeHighlight = new Highlight(range);
    CSS.highlights.set(HIGHLIGHT_NAME, activeHighlight);
  }

  function clearHighlight() {
    if (CSS?.highlights) CSS.highlights.delete(HIGHLIGHT_NAME);
    activeHighlight = null;
  }

  // Inject the highlight colour once
  if (!document.getElementById('note-saver-highlight-style')) {
    const style = document.createElement('style');
    style.id = 'note-saver-highlight-style';
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: #93c5fd; color: inherit; }`;
    document.head.appendChild(style);
  }

  // Restore native selection when textarea loses focus (optional UX polish)
  textarea.addEventListener('blur', () => {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  });

  // Show panel when text is selected
  document.addEventListener('mouseup', (e) => {
    if (dragging) return;                 // finishing a drag — don't reposition
    if (panel.contains(e.target)) return; // click inside panel — ignore
    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length > 0) {
        lastSelection = text;
        const range  = sel.getRangeAt(0);
        savedRange   = range.cloneRange();
        applyHighlight(range.cloneRange()); // set persistent CSS highlight
        const rect   = range.getBoundingClientRect();
        positionPanel(rect.right, rect.bottom);
        panel.style.display = 'flex';
      } else if (!panel.contains(document.activeElement)) {
        hidePanel();
      }
    }, 50);
  });

  // Hide panel when clicking outside
  document.addEventListener('mousedown', (e) => {
    if (!panel.contains(e.target)) hidePanel();
  });

  // Escape to hide
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePanel();
  });

  // Save on button click
  btn.addEventListener('click', async () => {
    if (!lastSelection) return;
    const comment = textarea.value;
    const tags    = [...selectedTags];
    hidePanel();

    const title   = getBookTitle();
    const content = buildNoteContent(lastSelection, title, comment, tags);
    try {
      await appendToNote(content);
      showToast('✅ 已保存到笔记');
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('save note:', e);
      showToast('❌ 保存失败：' + e.message, 3000);
    }

    lastSelection = '';
    clearHighlight();
    window.getSelection()?.removeAllRanges();
  });
}
