// Renders all epub chapters as one continuous scrollable page.
// Uses JSZip (global) to read files directly from the epub archive,
// bypassing epub.js's iframe-based rendering which breaks in extension pages.

const THEME = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark:  { bg: '#1a1a1a', fg: '#d4d4d4' },
  sepia: { bg: '#f5f0e8', fg: '#3b2f1e' },
  green: { bg: '#1a2e1a', fg: '#c8dfc8' },
  ink:   { bg: '#0d0d0f', fg: '#b0b0b8' },
};

export class ScrollRenderer {
  constructor(book) {
    this._book            = book;
    this._zip             = null;
    this._epubRoot        = '';
    this._element         = null;
    this._scrollEl        = null;
    this._container       = null;
    this._sections        = [];     // [{ href, el }]
    this._locationCb      = null;
    this._objectUrls      = [];
    this._currentHref     = '';
    this._currentFraction = 0;
    this._currentPercent  = 0;
    this._allLoaded       = false;
    this._pendingGoTo     = null;
  }

  // onFirstChapter: called after first chapter renders so caller can hide loading
  async renderTo(element, scrollEl, settings, onFirstChapter) {
    this._element  = element;
    this._scrollEl = scrollEl;
    this._zip      = this._book.archive?.zip;
    this._epubRoot = this._book.path?.directory || '';

    if (!this._zip) {
      console.error('ScrollRenderer: JSZip archive not found on book.archive.zip');
      return;
    }

    this._container = document.createElement('div');
    this._container.className = 'scroll-renderer-container';
    this._container.style.cssText =
      'max-width:760px;margin:0 auto;padding:2em 2em 6em;box-sizing:border-box;' +
      'word-wrap:break-word;line-height:1.8;text-align:left;';
    element.appendChild(this._container);
    this._applyTheme(settings);

    const items = this._book.spine.items;

    // Render first chapter synchronously so caller can unhide the UI
    if (items.length > 0) {
      await this._renderSection(items[0]);
      if (onFirstChapter) onFirstChapter();
    }

    // Render remaining chapters in the background (non-blocking)
    if (items.length > 1) {
      (async () => {
        for (let i = 1; i < items.length; i++) {
          await this._renderSection(items[i]);
        }
        this._allLoaded = true;
        // Fire any navigation that was requested before all chapters were loaded
        if (this._pendingGoTo) {
          await this.goTo(this._pendingGoTo);
          this._pendingGoTo = null;
        }
      })();
    } else {
      this._allLoaded = true;
    }

    scrollEl.addEventListener('scroll', () => this._onScroll(), { passive: true });
  }

  // Resolve a path relative to an epub item into a zip-root path
  _resolve(base, relative) {
    if (!relative) return '';
    if (relative.startsWith('/')) return relative.slice(1);
    // base is e.g. "OEBPS/Text/chapter01.xhtml"
    const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
    const parts = (dir + relative).split('/');
    const stack = [];
    for (const p of parts) {
      if (p === '..') stack.pop();
      else if (p && p !== '.') stack.push(p);
    }
    return stack.join('/');
  }

  _zipFile(path) {
    // JSZip is case-sensitive; normalise leading slash
    const p = path.replace(/^\//, '');
    return this._zip.file(p) || this._zip.file(this._epubRoot + p) || null;
  }

  async _getZipText(path) {
    const f = this._zipFile(path);
    if (!f) throw new Error('not in zip: ' + path);
    return f.async('text');
  }

  async _getZipBlob(path) {
    const f = this._zipFile(path);
    if (!f) throw new Error('not in zip: ' + path);
    return f.async('blob');
  }

  // Replace url(...) in CSS text with blob: URLs from the zip
  async _fixCssUrls(css, basePath) {
    const urlPattern = /url\(['"]?([^'")]+)['"]?\)/g;
    const matches = [...css.matchAll(urlPattern)];
    for (const m of matches) {
      const ref = m[1].trim();
      if (ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('http')) continue;
      const refPath = this._resolve(basePath, ref);
      try {
        const blob = await this._getZipBlob(refPath);
        const blobUrl = URL.createObjectURL(blob);
        this._objectUrls.push(blobUrl);
        css = css.replace(m[0], `url("${blobUrl}")`);
      } catch (_) {
        // Remove broken url() references so browser won't 404
        css = css.replace(m[0], 'none');
      }
    }
    return css;
  }

  async _renderSection(item) {
    // item.href is relative to epub root (e.g. "OEBPS/Text/chapter01.xhtml")
    const itemPath = this._epubRoot
      ? (this._epubRoot + item.href).replace(/\/\//g, '/')
      : item.href;

    let html;
    try {
      html = await this._getZipText(itemPath);
    } catch (e) {
      console.warn('ScrollRenderer: skip', itemPath, e.message);
      return;
    }

    const parser = new DOMParser();
    let doc = parser.parseFromString(html, 'application/xhtml+xml');
    // Fallback to text/html if xhtml parse failed or body is missing
    if (doc.querySelector('parsererror') || !doc.body) {
      doc = parser.parseFromString(html, 'text/html');
    }

    const sec = document.createElement('div');
    sec.className  = 'epub-chapter-section';
    sec.dataset.href = item.href;

    // ── Inline chapter CSS (with url() refs replaced to avoid 404s) ──
    for (const styleEl of doc.querySelectorAll('style')) {
      const s = document.createElement('style');
      s.textContent = await this._fixCssUrls(styleEl.textContent, itemPath);
      sec.appendChild(s);
    }
    for (const linkEl of doc.querySelectorAll('link[rel="stylesheet"]')) {
      const cssHref = linkEl.getAttribute('href');
      if (!cssHref) continue;
      const cssPath = this._resolve(itemPath, cssHref);
      try {
        const cssText = await this._getZipText(cssPath);
        const s = document.createElement('style');
        s.textContent = await this._fixCssUrls(cssText, cssPath);
        sec.appendChild(s);
      } catch (_) {}
    }

    // ── Pre-process raw HTML string BEFORE any innerHTML assignment ──
    // Chrome's speculative preloader fires requests on src/href even on
    // detached elements. Replace all relative URLs in the string first.
    let bodyHtml = doc.body ? doc.body.innerHTML : '';

    // Strip <link>, <script>, <base> to avoid extension-URL requests
    bodyHtml = bodyHtml.replace(/<(link|script|base)(\s[^>]*)?\/?>/gi, '');

    // Replace all image src/href attrs with blob: URLs before innerHTML is set
    // Patterns: <img src>, <image xlink:href>, <image href> (SVG cover pages)
    const resourceAttrs = [
      { pattern: /(<img\b[^>]*?\s)src="([^"#][^"]*)"/gi,           attr: 'src' },
      { pattern: /(<image\b[^>]*?\s)xlink:href="([^"#][^"]*)"/gi,  attr: 'xlink:href' },
      { pattern: /(<image\b[^>]*?\s)href="([^"#][^"]*)"/gi,        attr: 'href' },
    ];
    for (const { pattern } of resourceAttrs) {
      const matches = [...bodyHtml.matchAll(pattern)];
      for (const m of matches) {
        const relSrc = m[2];
        if (relSrc.startsWith('data:') || relSrc.startsWith('blob:') || relSrc.startsWith('http')) continue;
        const resolved = this._resolve(itemPath, relSrc);
        try {
          const blob    = await this._getZipBlob(resolved);
          const blobUrl = URL.createObjectURL(blob);
          this._objectUrls.push(blobUrl);
          bodyHtml = bodyHtml.replace(`"${relSrc}"`, `"${blobUrl}"`);
        } catch (_) { /* leave as-is — SVG image missing just won't render */ }
      }
    }

    // Fix inline style url() references in the string
    if (bodyHtml.includes('url(')) {
      bodyHtml = await this._fixCssUrls(bodyHtml, itemPath);
    }

    // Safe to set innerHTML now — no relative resource URLs remain
    const tmp = document.createElement('div');
    tmp.innerHTML = bodyHtml;

    while (tmp.firstChild) sec.appendChild(tmp.firstChild);

    // Intercept internal links so they scroll within the reader instead of
    // triggering browser navigation (which fails in extension context).
    this._interceptLinks(sec, itemPath);

    // Separator between chapters
    if (this._sections.length > 0) {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px;background:#e4e4e7;margin:2em 0;';
      this._container.appendChild(hr);
    }
    this._container.appendChild(sec);
    this._sections.push({ href: item.href, el: sec });

    // If a goTo was deferred because this chapter wasn't loaded yet, fire it now
    if (this._pendingGoTo) {
      const p = this._pendingGoTo;
      if (p.chapterHref && (
        item.href === p.chapterHref ||
        p.chapterHref.includes(item.href.split('#')[0])
      )) {
        this._pendingGoTo = null;
        // Delay to let browser compute layout (offsetTop) after DOM insertion
        setTimeout(() => this.goTo(p), 100);
      }
    }
  }

  _interceptLinks(sec, itemPath) {
    sec.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('data:')) return;

      a.addEventListener('click', async (e) => {
        e.preventDefault();

        if (href.startsWith('#')) {
          // Same-section anchor — scroll to element by id
          const target = this._container.querySelector(`[id="${href.slice(1)}"]`);
          if (target) target.scrollIntoView({ behavior: 'smooth' });
          return;
        }

        const resolved  = this._resolve(itemPath, href);
        const fragIdx   = resolved.indexOf('#');
        const chapterPath = fragIdx >= 0 ? resolved.slice(0, fragIdx) : resolved;
        const fragment    = fragIdx >= 0 ? resolved.slice(fragIdx + 1) : null;

        await this.goTo({ chapterHref: chapterPath });

        if (fragment) {
          setTimeout(() => {
            const target = this._container.querySelector(`[id="${fragment}"]`);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
          }, 150);
        }
      });
    });
  }

  _onScroll() {
    const scrollEl = this._scrollEl;
    const total    = scrollEl.scrollHeight - scrollEl.clientHeight;
    const scrollPercent = total > 0 ? scrollEl.scrollTop / total : 0;

    const viewTop = scrollEl.scrollTop + 80;
    let currentSection = this._sections[0] || null;
    for (const sec of this._sections) {
      if (sec.el.offsetTop <= viewTop) currentSection = sec;
      else break;
    }
    const currentHref = currentSection?.href || '';

    // Chapter-relative fraction — stable even while background loading
    let chapterFraction = 0;
    if (currentSection) {
      const secH = currentSection.el.offsetHeight || 1;
      chapterFraction = Math.max(0, (viewTop - currentSection.el.offsetTop) / secH);
    }

    const toc     = this._book.navigation?.toc || [];
    const flat    = this._flatToc(toc);
    const tocItem = flat.find(t => t.href && (
      currentHref === t.href || currentHref.endsWith(t.href.split('#')[0])
    ));

    this._currentHref     = currentHref;
    this._currentFraction = chapterFraction;
    this._currentPercent  = scrollPercent;

    if (this._locationCb) {
      this._locationCb({
        cfi: null,
        scrollPercent,
        chapterHref: currentHref,
        chapterFraction,
        chapterTitle: tocItem?.label?.trim() || '',
      });
    }
  }

  _flatToc(items, result = []) {
    for (const t of items || []) { result.push(t); this._flatToc(t.subitems, result); }
    return result;
  }

  onLocationChange(cb) { this._locationCb = cb; }

  applySettings({ fontSize, fontFamily, lineHeight, letterSpacing, theme } = {}) {
    this._applyTheme({ theme, fontSize, fontFamily, lineHeight, letterSpacing });
  }

  _applyTheme({ theme, fontSize, fontFamily, lineHeight, letterSpacing } = {}) {
    const colors = THEME[theme] || THEME.light;
    if (this._element) {
      this._element.style.background = colors.bg;
      this._element.style.color      = colors.fg;
    }
    if (this._container) {
      if (fontSize)   this._container.style.fontSize   = fontSize + 'px';
      if (fontFamily) this._container.style.fontFamily = fontFamily + ', serif';
      if (lineHeight) this._container.style.lineHeight = lineHeight;
      if (letterSpacing != null) this._container.style.letterSpacing = letterSpacing + 'px';
      this._container.style.color = colors.fg;
    }
  }

  async goTo({ scrollPercent, chapterHref, chapterFraction } = {}) {
    await new Promise(r => setTimeout(r, 50));
    if (chapterHref) {
      const sec = this._sections.find(s =>
        s.href === chapterHref || chapterHref.includes(s.href.split('#')[0])
      );
      if (sec) {
        const offset = chapterFraction ? sec.el.offsetHeight * chapterFraction : 0;
        this._scrollEl.scrollTop = sec.el.offsetTop + offset;
        return;
      }
      if (!this._allLoaded) {
        this._pendingGoTo = { scrollPercent, chapterHref, chapterFraction };
        return;
      }
    }
    if (scrollPercent != null) {
      const max = this._scrollEl.scrollHeight - this._scrollEl.clientHeight;
      this._scrollEl.scrollTop = max * scrollPercent;
    }
  }

  getCurrentLocation() {
    if (!this._scrollEl) return null;
    const total = this._scrollEl.scrollHeight - this._scrollEl.clientHeight;
    const scrollPercent = total > 0 ? this._scrollEl.scrollTop / total : 0;
    return {
      cfi: null,
      scrollPercent,
      chapterHref: this._currentHref,
      chapterFraction: this._currentFraction,
    };
  }

  destroy() {
    this._objectUrls.forEach(u => URL.revokeObjectURL(u));
    this._objectUrls = [];
    if (this._container) { this._container.remove(); this._container = null; }
    this._sections = [];
  }
}
