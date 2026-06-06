// Open bookshelf when toolbar icon clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('bookshelf/bookshelf.html') });
});

