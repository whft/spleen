import { runtimeFetch } from '@/lib/runtime-fetch';

export type UcStatus = {
  hasCookies: boolean;
  loggedIn?: boolean;
  username?: string | null;
  hasUserAgent?: boolean;
  cookiesUpdatedAt: number | null;
  bookmarkCount: number;
  historyCount: number;
};

export type UcGate = {
  gated: true;
  reason: 'cloudflare' | 'login' | string;
  targetUrl?: string;
  message: string;
};

export type UcForumItem = {
  id: string;
  title: string;
  url: string;
};

export type UcThreadSummary = {
  id: string;
  title: string;
  url: string;
  sticky?: boolean;
  prefix?: string | null;
  author: string | null;
  replies: string | null;
  views: string | null;
};

export type UcPostBlock =
  | { type: 'code'; language: string; code: string }
  | { type: 'spoiler'; title: string; text: string }
  | { type: 'quote'; author: string | null; text: string }
  | { type: 'image'; src: string }
  | { type: 'text'; text: string };

export type UcPost = {
  id: string;
  number: number;
  author: string;
  timestamp: string | null;
  blocks: UcPostBlock[];
  codeCount: number;
  rawText: string;
};

export type UcBookmark = {
  id: string;
  title: string;
  url: string;
  forum: string | null;
  savedAt: number;
};

export type UcHistoryEntry = {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
};

export type UcLoginResponse =
  | { ok: true; gated: false; username: string; status: UcStatus }
  | { ok: false; gated: true; gate: UcGate; url?: string };

export type UcHomeResponse =
  | { gated: true; gate: UcGate; url?: string }
  | { gated: false; title: string; currentUser?: { userId: string; username: string } | null; forums: UcForumItem[]; url?: string };

export type UcForumResponse =
  | { gated: true; gate: UcGate; url?: string }
  | { gated: false; title: string; url: string; page: number; totalPages: number; currentUser?: { userId: string; username: string } | null; threads: UcThreadSummary[] };

export type UcThreadResponse =
  | { gated: true; gate: UcGate; url?: string }
  | { gated: false; id: string; title: string; url: string; page: number; totalPages: number; currentUser?: { userId: string; username: string } | null; posts: UcPost[] };

export type UcSearchResponse =
  | { gated: true; gate: UcGate; url?: string }
  | { gated: false; title: string; page: number; totalPages: number; results: UcThreadSummary[] };

const jsonHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await runtimeFetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? jsonHeaders : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `UnknownCheats error (${response.status})`);
  }
  return data as T;
};

const currentUserAgent = (): string => (typeof navigator !== 'undefined' ? navigator.userAgent : '');

export const unknownCheatsApi = {
  status: () => requestJson<UcStatus>('/api/unknowncheats/status'),
  login: (username: string, password: string) =>
    requestJson<UcLoginResponse>('/api/unknowncheats/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, userAgent: currentUserAgent() }),
    }),
  setCookies: (cookieHeader: string, userAgent = currentUserAgent()) =>
    requestJson<UcStatus>('/api/unknowncheats/cookies', {
      method: 'POST',
      body: JSON.stringify({ cookieHeader, userAgent }),
    }),
  clearCookies: () => requestJson<UcStatus>('/api/unknowncheats/cookies', { method: 'DELETE' }),
  home: () => requestJson<UcHomeResponse>('/api/unknowncheats/home'),
  recent: (page = 1) => requestJson<UcForumResponse>(`/api/unknowncheats/recent?page=${Math.max(1, page)}`),
  forum: (params: { fid?: string; url?: string; page?: number }) => {
    const qs = new URLSearchParams();
    if (params.fid) qs.set('fid', params.fid);
    if (params.url) qs.set('url', params.url);
    if (params.page && params.page > 1) qs.set('page', String(params.page));
    return requestJson<UcForumResponse>(`/api/unknowncheats/forum?${qs.toString()}`);
  },
  thread: (params: { tid?: string; url?: string; page?: number }) => {
    const qs = new URLSearchParams();
    if (params.tid) qs.set('tid', params.tid);
    if (params.url) qs.set('url', params.url);
    if (params.page && params.page > 1) qs.set('page', String(params.page));
    return requestJson<UcThreadResponse>(`/api/unknowncheats/thread?${qs.toString()}`);
  },
  search: (query: string, page = 1) => {
    const qs = new URLSearchParams({ query, page: String(page) });
    return requestJson<UcSearchResponse>(`/api/unknowncheats/search?${qs.toString()}`);
  },
  bookmarks: () => requestJson<{ bookmarks: UcBookmark[] }>('/api/unknowncheats/bookmarks').then((r) => r.bookmarks),
  addBookmark: (bookmark: { id: string; title: string; url: string; forum?: string | null }) =>
    requestJson<{ bookmarks: UcBookmark[] }>('/api/unknowncheats/bookmarks', {
      method: 'POST',
      body: JSON.stringify(bookmark),
    }).then((r) => r.bookmarks),
  removeBookmark: (id: string) =>
    requestJson<{ bookmarks: UcBookmark[] }>(`/api/unknowncheats/bookmarks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).then((r) => r.bookmarks),
  history: () => requestJson<{ history: UcHistoryEntry[] }>('/api/unknowncheats/history').then((r) => r.history),
  clearHistory: () =>
    requestJson<{ history: UcHistoryEntry[] }>('/api/unknowncheats/history', {
      method: 'DELETE',
    }).then((r) => r.history),
};
