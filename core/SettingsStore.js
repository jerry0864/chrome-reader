const DEFAULTS = {
  fontSize: 18,
  fontFamily: 'Georgia',
  lineHeight: 1.7,
  letterSpacing: 0,
  theme: 'light',
  readingMode: 'scroll',
};

export const SettingsStore = {
  async get() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULTS, resolve);
    });
  },

  async set(updates) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(updates, resolve);
    });
  },
};
