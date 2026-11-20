import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STATE = () => ({
  version: 1,
  cookieHeader: '',
  cookiesUpdatedAt: null,
  bookmarks: [],
  history: [],
});

const clone = (v) => JSON.parse(JSON.stringify(v));

export const createUnknownCheatsStore = ({ filePath, fsImpl = fs } = {}) => {
  let cache = null;
  let queue = Promise.resolve();

  const readRaw = async () => {
    if (cache) return clone(cache);
    if (!filePath) {
      cache = DEFAULT_STATE();
      return clone(cache);
    }
    try {
      const parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
      cache = {
        version: 1,
        cookieHeader: typeof parsed?.cookieHeader === 'string' ? parsed.cookieHeader : '',
        cookiesUpdatedAt: parsed?.cookiesUpdatedAt ?? null,
        bookmarks: Array.isArray(parsed?.bookmarks) ? parsed.bookmarks : [],
        history: Array.isArray(parsed?.history) ? parsed.history : [],
      };
    } catch {
      cache = DEFAULT_STATE();
    }
    return clone(cache);
  };

  const writeRaw = async (next) => {
    cache = { ...DEFAULT_STATE(), ...next, version: 1 };
    if (!filePath) return clone(cache);
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsImpl.writeFile(temp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    await fsImpl.rename(temp, filePath);
    return clone(cache);
  };

  const update = (fn) => {
    const run = queue.then(async () => {
      const cur = await readRaw();
      const draft = clone(cur);
      const res = await fn(draft);
      await writeRaw(draft);
      return res ?? draft;
    });
    queue = run.catch(() => {});
    return run;
  };

  return {
    getPublicStatus: async () => {
      const s = await queue.then(() => readRaw());
      return {
        hasCookies: Boolean(s.cookieHeader.trim()),
        cookiesUpdatedAt: s.cookiesUpdatedAt,
        bookmarkCount: s.bookmarks.length,
        historyCount: s.history.length,
      };
    },
    readCookieHeader: async () => (await queue.then(() => readRaw())).cookieHeader,
    setCookieHeader: (cookieHeader) => update((draft) => {
      draft.cookieHeader = typeof cookieHeader === 'string' ? cookieHeader.trim() : '';
      draft.cookiesUpdatedAt = draft.cookieHeader ? Date.now() : null;
    }),
    clearCookies: () => update((draft) => {
      draft.cookieHeader = '';
      draft.cookiesUpdatedAt = null;
    }),
    listBookmarks: async () => (await queue.then(() => readRaw())).bookmarks,
    addBookmark: ({ id, title, url, forum }) => update((draft) => {
      const key = String(id || url);
      draft.bookmarks = [{ id: key, title, url, forum: forum ?? null, savedAt: Date.now() }, ...draft.bookmarks.filter((b) => b.id !== key)].slice(0, 100);
      return draft.bookmarks;
    }),
    removeBookmark: (id) => update((draft) => {
      draft.bookmarks = draft.bookmarks.filter((b) => b.id !== String(id));
      return draft.bookmarks;
    }),
    listHistory: async () => (await queue.then(() => readRaw())).history,
    pushHistory: ({ id, title, url }) => update((draft) => {
      const key = String(id || url);
      draft.history = [{ id: key, title, url, visitedAt: Date.now() }, ...draft.history.filter((h) => h.id !== key)].slice(0, 80);
      return draft.history;
    }),
    clearHistory: () => update((draft) => {
      draft.history = [];
      return [];
    }),
  };
};
