import crypto from 'node:crypto';
import { detectGate, parseForumListing, parseHome, parseLoggedInUser, parseSearchResults, parseThread } from './parser.js';

const UC_ORIGIN = 'https://www.unknowncheats.me';
const ALLOWED_HOSTS = new Set(['www.unknowncheats.me', 'unknowncheats.me']);
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0';

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

const parseCookieHeaderMap = (header) => {
  const map = new Map();
  for (const part of String(header || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) map.set(key, val);
  }
  return map;
};

const extractSetCookieHeaders = (headers) => {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = headers.get?.('set-cookie');
  return single ? [single] : [];
};

const mergeCookieHeader = (existingHeader, setCookieHeaders) => {
  const map = parseCookieHeaderMap(existingHeader);
  let mutated = false;
  for (const raw of setCookieHeaders) {
    const firstSegment = String(raw || '').split(';')[0]?.trim() || '';
    const eq = firstSegment.indexOf('=');
    if (eq <= 0) continue;
    const key = firstSegment.slice(0, eq).trim();
    const val = firstSegment.slice(eq + 1).trim();
    if (!key) continue;
    if (val === 'deleted' || val === '') {
      if (map.delete(key)) mutated = true;
    } else if (map.get(key) !== val) {
      map.set(key, val);
      mutated = true;
    }
  }
  if (!mutated) return null;
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
};

export const createUnknownCheatsClient = ({ store, fetchImpl = fetch } = {}) => {
  const readMeta = async () => {
    if (typeof store?.readSessionMeta === 'function') {
      return await store.readSessionMeta();
    }
    const cookieHeader = typeof store?.readCookieHeader === 'function' ? await store.readCookieHeader() : '';
    return { cookieHeader, userAgent: '', username: null };
  };

  const fetchPage = async (targetUrl, init = {}) => {
    const url = assertSafeUcUrl(targetUrl);
    const meta = await readMeta();
    const effectiveUa = meta.userAgent || DEFAULT_UA;
    const response = await fetchImpl(url, {
      method: init.method || 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': effectiveUa,
        ...(meta.cookieHeader ? { Cookie: meta.cookieHeader } : {}),
        ...(init.headers || {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: AbortSignal.timeout(15_000),
    });

    const setCookies = extractSetCookieHeaders(response.headers);
    if (setCookies.length > 0 && typeof store?.setCookieHeader === 'function') {
      const merged = mergeCookieHeader(meta.cookieHeader, setCookies);
      if (merged) {
        await store.setCookieHeader(merged, { userAgent: effectiveUa });
      }
    }

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

    const detectedUser = parseLoggedInUser(html);
    if (detectedUser?.username && detectedUser.username !== meta.username && typeof store?.setUsername === 'function') {
      await store.setUsername(detectedUser.username);
    }

    return { gated: false, html, url: finalUrl, currentUser: detectedUser };
  };

  const login = async ({ username, password, userAgent } = {}) => {
    const user = typeof username === 'string' ? username.trim() : '';
    const pass = typeof password === 'string' ? password : '';
    if (!user || !pass) {
      throw new UnknownCheatsError('Username and password are required', 400, 'MISSING_CREDENTIALS');
    }

    const meta = await readMeta();
    const effectiveUa = (typeof userAgent === 'string' && userAgent.trim()) || meta.userAgent || DEFAULT_UA;
    const md5 = crypto.createHash('md5').update(pass, 'utf8').digest('hex');

    const body = new URLSearchParams({
      do: 'login',
      s: '',
      securitytoken: 'guest',
      vb_login_username: user,
      vb_login_password: '',
      vb_login_md5password: md5,
      vb_login_md5password_utf: md5,
      cookieuser: '1',
      url: `${UC_ORIGIN}/forum/index.php`,
    });

    const response = await fetchImpl(`${UC_ORIGIN}/forum/login.php?do=login`, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: UC_ORIGIN,
        Referer: `${UC_ORIGIN}/forum/login.php`,
        'User-Agent': effectiveUa,
        ...(meta.cookieHeader ? { Cookie: meta.cookieHeader } : {}),
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const html = await response.text();
    const headersObj = {};
    response.headers.forEach((v, k) => { headersObj[k] = v; });
    const gate = detectGate({ status: response.status, headers: headersObj, html, targetUrl: `${UC_ORIGIN}/forum/login.php` });
    if (gate.gated && gate.reason === 'cloudflare') {
      return {
        ok: false,
        gated: true,
        gate,
        url: `${UC_ORIGIN}/forum/login.php`,
      };
    }

    const lower = html.toLowerCase();
    if (
      lower.includes('invalid username or password')
      || lower.includes('wrong username or password')
      || lower.includes('you have used up your failed login quota')
      || lower.includes('two-factor')
      || lower.includes('2fa')
    ) {
      const needs2fa = lower.includes('two-factor') || lower.includes('2fa');
      throw new UnknownCheatsError(
        needs2fa
          ? 'Two-factor authentication is required. Use Interactive Login Window to sign in cleanly.'
          : 'Invalid UnknownCheats username or password.',
        401,
        needs2fa ? 'UC_2FA_REQUIRED' : 'INVALID_CREDENTIALS',
      );
    }

    const setCookies = extractSetCookieHeaders(response.headers);
    const merged = mergeCookieHeader(meta.cookieHeader, setCookies) ?? meta.cookieHeader;
    const detected = parseLoggedInUser(html);
    const resolvedName = detected?.username || (/\bbb_userid=|\bbb_password=/i.test(merged) || lower.includes('thank you for logging in') ? user : null);

    if (!resolvedName) {
      return {
        ok: false,
        gated: true,
        gate: {
          gated: true,
          reason: 'login',
          targetUrl: `${UC_ORIGIN}/forum/login.php`,
          message: 'Interactive login or verification is required by unknowncheats.me. Use the Login Window inside Spleen.',
        },
        url: `${UC_ORIGIN}/forum/login.php`,
      };
    }

    await store.setCookieHeader(merged, { userAgent: effectiveUa, username: resolvedName });
    const status = await store.getPublicStatus();
    return { ok: true, gated: false, username: resolvedName, status };
  };

  const getHome = async () => {
    const res = await fetchPage(`${UC_ORIGIN}/forum/index.php`);
    if (res.gated) return res;
    return { gated: false, ...parseHome(res.html) };
  };

  const getRecent = async ({ page = 1 } = {}) => {
    const target = `${UC_ORIGIN}/forum/search.php?do=getdaily&page=${Math.max(1, Number(page) || 1)}`;
    const res = await fetchPage(target);
    if (res.gated) return res;
    return { gated: false, ...parseForumListing(res.html, res.url) };
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
    return { gated: false, currentUser: res.currentUser ?? null, ...thread };
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
    login,
    getHome,
    getRecent,
    getForum,
    getThread,
    search,
  };
};
