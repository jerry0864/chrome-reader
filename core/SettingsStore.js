const DEFAULTS = {
  fontSize: 18,
  fontFamily: 'Georgia',
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
