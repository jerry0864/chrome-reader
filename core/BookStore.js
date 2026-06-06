// IndexedDB storage for books and reading positions
const DB_NAME = 'epub-reader';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains('positions')) {
        db.createObjectStore('positions', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    t.onerror = () => reject(t.error);
    resolve(fn(t));
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const BookStore = {
  async getAllBooks() {
    const db = await openDB();
    return tx(db, ['books'], 'readonly', (t) => {
      return reqToPromise(t.objectStore('books').getAll());
    });
  },

  async addBook(book) {
    const db = await openDB();
    return tx(db, ['books'], 'readwrite', (t) => {
      return reqToPromise(t.objectStore('books').put(book));
    });
  },

  async deleteBook(id) {
    const db = await openDB();
    await tx(db, ['books'], 'readwrite', (t) => {
      return reqToPromise(t.objectStore('books').delete(id));
    });
    await tx(db, ['positions'], 'readwrite', (t) => {
      return reqToPromise(t.objectStore('positions').delete(id));
    });
  },

  async getBook(id) {
    const db = await openDB();
    return tx(db, ['books'], 'readonly', (t) => {
      return reqToPromise(t.objectStore('books').get(id));
    });
  },

  async updateLastRead(id) {
    const db = await openDB();
    const book = await this.getBook(id);
    if (book) {
      book.lastReadAt = Date.now();
      return tx(db, ['books'], 'readwrite', (t) => {
        return reqToPromise(t.objectStore('books').put(book));
      });
    }
  },

  async savePosition(bookId, position) {
    const db = await openDB();
    return tx(db, ['positions'], 'readwrite', (t) => {
      return reqToPromise(t.objectStore('positions').put({ bookId, ...position, updatedAt: Date.now() }));
    });
  },

  async getPosition(bookId) {
    const db = await openDB();
    return tx(db, ['positions'], 'readonly', (t) => {
      return reqToPromise(t.objectStore('positions').get(bookId));
    });
  },

  async getMeta(key) {
    const db = await openDB();
    const row = await tx(db, ['meta'], 'readonly', (t) => {
      return reqToPromise(t.objectStore('meta').get(key));
    });
    return row?.value;
  },

  async setMeta(key, value) {
    const db = await openDB();
    return tx(db, ['meta'], 'readwrite', (t) => {
      return reqToPromise(t.objectStore('meta').put({ key, value }));
    });
  },
};
