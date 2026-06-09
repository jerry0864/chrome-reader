import { BookReader } from './BookReader.js';

export class MobiReader extends BookReader {
  constructor() {
    super();
    this._format      = null;
    this._container   = null;
    this._scrollEl    = null;
    this._sections    = [];   // [{ index, el }]
    this._locationCb  = null;
    this._allLoaded   = false;
    this._pendingGoTo = null;
    this._currentIndex   = 0;
    this._currentFraction = 0;
  }

  async open(file) {
    const { MOBI } = await import('../lib/mobi.js');
    const unzlib = window.fflate?.unzlibSync;
    const mobi = new MOBI({ unzlib });
    // MOBI.open() needs a Blob/File with .slice() support
    this._format = await mobi.open(file);

    const meta = this._format.metadata || {};
    let coverDataUrl = null;
    try {
      const coverBlob = await this._format.getCover();
      if (coverBlob) coverDataUrl = URL.createObjectURL(coverBlob);
    } catch (_) {}

    const toc = this._flattenToc(this._format.toc || []);

    return {
      title:    meta.title || file.name.replace(/\.(mobi|azw3?)$/i, ''),
      author:   Array.isArray(meta.author) ? meta.author[0] || '' : meta.author || '',
      coverUrl: coverDataUrl,
      toc,
    };
  }

  _flattenToc(items, depth = 0) {
    const result = [];
    for (const item of items || []) {
      result.push({ label: item.label?.trim() || '', href: item.href, depth });
      if (item.subitems?.length) result.push(...this._flattenToc(item.subitems, depth + 1));
    }
    return result;
  }

  async renderTo(element, _mode, scrollEl, onFirstChapter) {
    this._scrollEl = scrollEl;

    this._container = document.createElement('div');
    this._container.className = 'scroll-renderer-container';
    this._container.style.cssText =
      'max-width:760px;margin:0 auto;padding:2em 2em 6em;box-sizing:border-box;' +
      'word-wrap:break-word;line-height:1.8;text-align:left;';
    element.appendChild(this._container);

    // Filter out non-linear placeholder sections (KF8 skeletons with no frags)
    const sections = this._format.sections.filter(s => s.linear !== 'no' && s.load);

    if (sections.length > 0) {
      await this._renderSection(sections[0], 0);
      onFirstChapter?.();
    }

    if (sections.length > 1) {
      (async () => {
        for (let i = 1; i < sections.length; i++) {
          await this._renderSection(sections[i], i);
        }
        this._allLoaded = true;
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

  async _renderSection(section, index) {
    let html;
    try {
      // section.load() handles image replacement for both MOBI6 and KF8
      const blobUrl = await section.load();
      html = await fetch(blobUrl).then(r => r.text());
    } catch (e) {
      console.warn('MobiReader: skip section', index, e.message);
      return;
    }

    const parser = new DOMParser();
    let doc = parser.parseFromString(html, 'application/xhtml+xml');
    if (doc.querySelector('parsererror') || !doc.body) {
      doc = parser.parseFromString(html, 'text/html');
    }

    const sec = document.createElement('div');
    sec.className = 'epub-chapter-section';
    sec.dataset.index = index;

    for (const styleEl of doc.querySelectorAll('style')) {
      const s = document.createElement('style');
      s.textContent = styleEl.textContent;
      sec.appendChild(s);
    }

    const tmp = document.createElement('div');
    tmp.innerHTML = doc.body?.innerHTML || '';

    // Fix max-width on images
    tmp.querySelectorAll('img').forEach(img => {
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    });

    while (tmp.firstChild) sec.appendChild(tmp.firstChild);

    this._interceptLinks(sec);

    if (this._sections.length > 0) {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px;background:#e4e4e7;margin:2em 0;';
      this._container.appendChild(hr);
    }
    this._container.appendChild(sec);
    this._sections.push({ index, el: sec });

    if (this._pendingGoTo?.sectionIndex === index) {
      const pending = this._pendingGoTo;
      this._pendingGoTo = null;
      setTimeout(() => this.goTo(pending), 100);
    }
  }

  _interceptLinks(sec) {
    sec.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || this._format.isExternal?.(href)) return;

      a.addEventListener('click', async (e) => {
        e.preventDefault();

        if (href.startsWith('#')) {
          const target = this._container.querySelector(`[id="${href.slice(1)}"]`);
          if (target) { target.scrollIntoView({ behavior: 'smooth' }); return; }
        }

        try {
          const resolved = await this._format.resolveHref(href);
          if (resolved?.index !== undefined) {
            const sec = this._sections.find(s => s.index === resolved.index);
            if (sec) {
              this._scrollEl.scrollTop = sec.el.offsetTop;
              if (resolved.anchor) {
                setTimeout(() => {
                  const el = resolved.anchor(document);
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 100);
              }
            } else if (!this._allLoaded) {
              this._pendingGoTo = { sectionIndex: resolved.index };
            }
          }
        } catch (err) {
          console.warn('MobiReader: resolveHref failed', href, err);
        }
      });
    });
  }

  async goTo({ scrollPercent, sectionIndex, chapterHref, chapterFraction } = {}) {
    await new Promise(r => setTimeout(r, 50));

    // Restore by section index (chapterHref encoded as "section:N")
    const indexFromHref = chapterHref?.startsWith('section:')
      ? parseInt(chapterHref.slice(8)) : undefined;
    const targetIndex = sectionIndex ?? indexFromHref;

    if (targetIndex !== undefined) {
      const sec = this._sections.find(s => s.index === targetIndex);
      if (sec) {
        const offset = chapterFraction ? sec.el.offsetHeight * chapterFraction : 0;
        this._scrollEl.scrollTop = sec.el.offsetTop + offset;
        return;
      }
      if (!this._allLoaded) {
        this._pendingGoTo = { sectionIndex: targetIndex, chapterFraction };
        return;
      }
    }

    // Navigate by format href (filepos: or kindle:pos: links)
    if (chapterHref && !chapterHref.startsWith('section:')) {
      try {
        const resolved = await this._format.resolveHref(chapterHref);
        if (resolved?.index !== undefined) {
          const sec = this._sections.find(s => s.index === resolved.index);
          if (sec) {
            this._scrollEl.scrollTop = sec.el.offsetTop;
            if (resolved.anchor) {
              setTimeout(() => {
                const el = resolved.anchor(document);
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }, 100);
            }
            return;
          }
          if (!this._allLoaded) {
            this._pendingGoTo = { sectionIndex: resolved.index, chapterHref };
            return;
          }
        }
      } catch (_) {}
    }

    if (scrollPercent != null) {
      const max = this._scrollEl.scrollHeight - this._scrollEl.clientHeight;
      this._scrollEl.scrollTop = max * scrollPercent;
    }
  }

  _onScroll() {
    const scrollEl = this._scrollEl;
    const total    = scrollEl.scrollHeight - scrollEl.clientHeight;
    const scrollPercent = total > 0 ? scrollEl.scrollTop / total : 0;

    const viewTop = scrollEl.scrollTop + 80;
    let current = this._sections[0] || null;
    for (const sec of this._sections) {
      if (sec.el.offsetTop <= viewTop) current = sec;
      else break;
    }

    const secH = current?.el.offsetHeight || 1;
    this._currentIndex    = current?.index ?? 0;
    this._currentFraction = current
      ? Math.max(0, (viewTop - current.el.offsetTop) / secH) : 0;

    if (this._locationCb) {
      this._locationCb({
        cfi:            null,
        scrollPercent,
        chapterHref:    `section:${this._currentIndex}`,
        chapterFraction: this._currentFraction,
        chapterTitle:   '',
      });
    }
  }

  getCurrentLocation() {
    if (!this._scrollEl) return null;
    const total = this._scrollEl.scrollHeight - this._scrollEl.clientHeight;
    const scrollPercent = total > 0 ? this._scrollEl.scrollTop / total : 0;
    return {
      cfi:            null,
      scrollPercent,
      chapterHref:    `section:${this._currentIndex}`,
      chapterFraction: this._currentFraction,
    };
  }

  applySettings({ fontSize, fontFamily, lineHeight, letterSpacing, theme } = {}) {
    const THEME = {
      light: { bg: '#ffffff', fg: '#1a1a1a' },
      dark:  { bg: '#1a1a1a', fg: '#d4d4d4' },
      sepia: { bg: '#f5f0e8', fg: '#3b2f1e' },
      green: { bg: '#1a2e1a', fg: '#c8dfc8' },
      ink:   { bg: '#0d0d0f', fg: '#b0b0b8' },
    };
    const c = THEME[theme] || THEME.light;
    const el = this._container?.parentElement;
    if (el) { el.style.background = c.bg; el.style.color = c.fg; }
    if (this._container) {
      if (fontSize)   this._container.style.fontSize   = fontSize + 'px';
      if (fontFamily) this._container.style.fontFamily = fontFamily + ', serif';
      if (lineHeight) this._container.style.lineHeight = lineHeight;
      if (letterSpacing != null) this._container.style.letterSpacing = letterSpacing + 'px';
      this._container.style.color = c.fg;
    }
  }

  onLocationChange(cb) { this._locationCb = cb; }

  destroy() {
    this._format?.destroy?.();
    this._format = null;
    if (this._container) { this._container.remove(); this._container = null; }
    this._sections = [];
  }
}
