import { BookReader } from './BookReader.js';
import { ScrollRenderer } from './ScrollRenderer.js';

const THEME_COLORS = {
  light: { background: '#ffffff', color: '#1a1a1a' },
  dark:  { background: '#1a1a1a', color: '#d4d4d4' },
  sepia: { background: '#f5f0e8', color: '#3b2f1e' },
  green: { background: '#1a2e1a', color: '#c8dfc8' },
  ink:   { background: '#0d0d0f', color: '#b0b0b8' },
};

export class EpubReader extends BookReader {
  constructor() {
    super();
    this._book        = null;
    this._rendition   = null;  // epub.js rendition (paginated mode)
    this._scrollRend  = null;  // ScrollRenderer (scroll mode)
    this._metadata    = null;
    this._toc         = [];
    this._locationCb  = null;
    this._mode        = 'paginated';
  }

  async open(file) {
    const buffer = await file.arrayBuffer();
    this._book = ePub(buffer);
    await this._book.ready;
    await this._book.loaded.metadata;
    await this._book.loaded.navigation;

    const meta = this._book.package.metadata;
    let coverUrl = null;
    try { coverUrl = await this._book.coverUrl(); } catch (_) {}

    this._toc = this._flattenToc(this._book.navigation.toc);
    this._metadata = {
      title:    meta.title   || 'Unknown Title',
      author:   meta.creator || 'Unknown Author',
      coverUrl,
      toc: this._toc,
    };
    return this._metadata;
  }

  _flattenToc(items, depth = 0) {
    const result = [];
    for (const item of items || []) {
      result.push({ label: item.label.trim(), href: item.href, depth });
      if (item.subitems?.length) result.push(...this._flattenToc(item.subitems, depth + 1));
    }
    return result;
  }

  async renderTo(element, mode = 'paginated', scrollEl = null, onFirstChapter = null) {
    this._mode = mode;

    if (mode === 'scroll') {
      this._scrollRend = new ScrollRenderer(this._book);
      this._scrollRend.onLocationChange((loc) => {
        if (this._locationCb) this._locationCb(loc);
      });
      await this._scrollRend.renderTo(element, scrollEl, {}, onFirstChapter);
      return;
    }

    // ── Paginated mode ─────────────────────────────────────────────
    const w = element.clientWidth  || element.offsetWidth  || 800;
    const h = element.clientHeight || element.offsetHeight || 600;
    this._rendition = this._book.renderTo(element, {
      flow: 'paginated', width: w, height: h, spread: 'none',
    });
    this._rendition.on('relocated', (loc) => {
      if (this._locationCb) this._locationCb(this._buildLocation(loc));
    });
    await this._rendition.display();
  }

  _buildLocation(loc) {
    if (!loc) return null;
    const cfi          = loc.start?.cfi || '';
    const scrollPercent = loc.start?.percentage ?? 0;
    const chapterHref  = loc.start?.href || '';
    const tocItem      = this._toc.find(t => t.href && chapterHref.includes(t.href.split('#')[0]));
    return { cfi, scrollPercent, chapterTitle: tocItem?.label || '' };
  }

  async goTo(location) {
    if (this._mode === 'scroll' && this._scrollRend) {
      const normalized = { ...location };
      if (!normalized.chapterHref && normalized.cfi) {
        normalized.chapterHref = normalized.cfi;
      }
      await this._scrollRend.goTo(normalized);
      return;
    }
    if (!this._rendition) return;
    if (location?.cfi) {
      await this._rendition.display(location.cfi);
    } else if (location?.scrollPercent != null) {
      const spine  = this._book.spine;
      const target = spine.items[Math.floor(location.scrollPercent * spine.items.length)];
      if (target) await this._rendition.display(target.href);
    }
  }

  async getCurrentLocation() {
    if (this._mode === 'scroll' && this._scrollRend) {
      return this._scrollRend.getCurrentLocation();
    }
    if (!this._rendition) return null;
    return this._buildLocation(this._rendition.currentLocation());
  }

  applySettings(settings) {
    if (this._mode === 'scroll' && this._scrollRend) {
      this._scrollRend.applySettings(settings);
      return;
    }
    if (!this._rendition) return;
    const { fontSize, fontFamily, theme } = settings;
    const colors = THEME_COLORS[theme] || THEME_COLORS.light;
    this._rendition.themes.default({
      body: {
        'font-size':   `${fontSize}px !important`,
        'font-family': `${fontFamily}, serif !important`,
        'background':  `${colors.background} !important`,
        'color':       `${colors.color} !important`,
        'line-height': '1.7 !important',
        'padding':     '0 2em !important',
      }
    });
  }

  async prev() { if (this._rendition) await this._rendition.prev(); }
  async next() { if (this._rendition) await this._rendition.next(); }

  getMetadata() { return this._metadata; }

  onLocationChange(cb) {
    this._locationCb = cb;
    if (this._scrollRend) this._scrollRend.onLocationChange(cb);
  }

  destroy() {
    if (this._scrollRend) { this._scrollRend.destroy(); this._scrollRend = null; }
    if (this._book)       { this._book.destroy();       this._book = null; }
    this._rendition = null;
  }
}
