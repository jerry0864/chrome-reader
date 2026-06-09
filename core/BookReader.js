// Abstract interface for book readers. Implement this for each format.
export class BookReader {
  // Opens a File object and parses metadata
  async open(file) { throw new Error('Not implemented'); }

  // Renders content into the given DOM element
  // mode: 'paginated' | 'scroll'
  async renderTo(element, mode) { throw new Error('Not implemented'); }

  // Navigates to a saved location (CFI string or scroll percent)
  async goTo(location) { throw new Error('Not implemented'); }

  // Returns current location: { cfi, scrollPercent, chapter, chapterTitle }
  async getCurrentLocation() { throw new Error('Not implemented'); }

  // Applies display settings: { fontSize, fontFamily, lineHeight, letterSpacing, theme }
  applySettings(settings) { throw new Error('Not implemented'); }

  // Go to previous page/section
  async prev() { throw new Error('Not implemented'); }

  // Go to next page/section
  async next() { throw new Error('Not implemented'); }

  // Returns book metadata: { title, author, coverUrl, toc }
  getMetadata() { throw new Error('Not implemented'); }

  // Registers a callback called whenever the location changes
  onLocationChange(callback) { throw new Error('Not implemented'); }

  // Cleans up resources
  destroy() {}
}
