import { detectGate, parseForumListing, parseHome, parseSearchResults, parseThread } from './parser.js';

const UC_ORIGIN = 'https://www.unknowncheats.me';
const ALLOWED_HOSTS = new Set(['www.unknowncheats.me', 'unknowncheats.me']);

export class UnknownCheatsError extends Error {
  constructor(message, status = 400, code = 'UC_ERROR') {
    super(message);
    this.name = 'UnknownCheatsError';
    this.status = status;
    this.code = code;
  }
}

export const assertSafeUcUrl = (raw) => {
  const input = typeof raw === 'string' && raw.trim() ? raw.trim() : `${UC_ORIGIN}/forum/index.php`;
  const resolved = input.startsWith('http://') || input.startsWith('https://')
    ? input
    : `${UC_ORIGIN}${input.startsWith('/') ? '' : '/forum/'}${input}`;
  let parsed;
  try {
    parsed = new URL(resolved);
  } catch {
    throw new UnknownCheatsError('Invalid UnknownCheats URL', 400, 'INVALID_URL');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new UnknownCheatsError('Only HTTPS unknowncheats.me URLs are allowed', 400, 'DISALLOWED_HOST');
  }
  return parsed.href;
};

export const createUnknownCheatsClient = ({ store, fetchImpl = fetch } = {}) => {
  const fetchPage = async (targetUrl) => {
    const url = assertSafeUcUrl(targetUrl);
    const cookieHeader = await store.readCookieHeader();
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    const finalUrl = response.url ? assertSafeUcUrl(response.url) : url;
    const html = await response.text();
    const headersObj = {};
    response.headers.forEach((v, k) => { headersObj[k] = v; });

    const gate = detectGate({ status: response.status, headers: headersObj, html, targetUrl: finalUrl });
    if (gate.gated) {
      return { gated: true, gate, url: finalUrl };
    }
    if (!response.ok) {
      throw new UnknownCheatsError(`UnknownCheats returned HTTP ${response.status}`, response.status >= 500 ? 502 : response.status);
    }
    return { gated: false, html, url: finalUrl };
  };

  const getHome = async () => {
    const res = await fetchPage(`${UC_ORIGIN}/forum/index.php`);
    if (res.gated) return res;
    return { gated: false, ...parseHome(res.html) };
  };

  const getForum = async ({ url, fid, page = 1 } = {}) => {
    const target = url
      ? assertSafeUcUrl(url)
      : `${UC_ORIGIN}/forum/forumdisplay.php?f=${encodeURIComponent(String(fid || ''))}&page=${Math.max(1, Number(page) || 1)}`;
    const u = new URL(target);
    if (!url && page > 1) u.searchParams.set('page', String(page));
    else if (url && page > 1 && !u.searchParams.has('page')) u.searchParams.set('page', String(page));
    const res = await fetchPage(u.href);
    if (res.gated) return res;
    return { gated: false, ...parseForumListing(res.html, res.url) };
  };

  const getThread = async ({ url, tid, page = 1 } = {}) => {
    const target = url
      ? assertSafeUcUrl(url)
      : `${UC_ORIGIN}/forum/showthread.php?t=${encodeURIComponent(String(tid || ''))}&page=${Math.max(1, Number(page) || 1)}`;
    const u = new URL(target);
    if (page > 1) u.searchParams.set('page', String(page));
    const res = await fetchPage(u.href);
    if (res.gated) return res;
    const thread = parseThread(res.html, res.url);
    await store.pushHistory({ id: thread.id || res.url, title: thread.title, url: res.url });
    return { gated: false, ...thread };
  };

  const search = async ({ query, page = 1 } = {}) => {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) throw new UnknownCheatsError('Search query is required', 400);
    const target = `${UC_ORIGIN}/forum/search.php?do=process&query=${encodeURIComponent(q)}&page=${Math.max(1, Number(page) || 1)}`;
    const res = await fetchPage(target);
    if (res.gated) return res;
    return { gated: false, ...parseSearchResults(res.html, res.url) };
  };

  return {
    getHome,
    getForum,
    getThread,
    search,
  };
};
