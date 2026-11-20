const UC_BASE_URL = 'https://www.unknowncheats.me';

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export const decodeHtml = (html) => {
  if (typeof html !== 'string' || !html) return '';
  return html
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(dec, 10) || 32)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(hex, 16) || 32)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => NAMED_ENTITIES[name] ?? full);
};

export const stripTags = (html) => decodeHtml(
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ''),
).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export const resolveUcUrl = (href) => {
  if (!href || typeof href !== 'string') return null;
  try {
    const u = new URL(href.startsWith('http') ? href : (href.startsWith('/') ? `${UC_BASE_URL}${href}` : `${UC_BASE_URL}/forum/${href}`));
    return u.href;
  } catch {
    return null;
  }
};

export const detectCodeLanguage = (code) => {
  const s = String(code || '').trim();
  if (!s) return 'text';
  if (/\b(#include|nullptr|std::|uintptr_t|DWORD|HANDLE|__declspec)\b/.test(s)) return 'cpp';
  if (/\b(namespace\s+[A-Z]|public\s+class|using\s+System|async\s+Task)\b/.test(s)) return 'csharp';
  if (/\b(fn\s+\w+\(|impl\s+|let\s+mut|println!)\b/.test(s)) return 'rust';
  if (/\b(def\s+\w+\(|import\s+\w+|if\s+__name__\s*==)\b/.test(s)) return 'python';
  if (/\b(mov\s+(?:r|e)[a-z]+|jmp\s+|call\s+|ret\b|nop\b)/i.test(s)) return 'asm';
  if (/\b(SELECT|INSERT|UPDATE|CREATE TABLE)\b/i.test(s)) return 'sql';
  if (/\b(function|const|let|=>|async\s+function)\b/.test(s)) return 'javascript';
  return 'code';
};

export const detectGate = ({ status = 200, headers = {}, html = '', targetUrl = `${UC_BASE_URL}/forum/` } = {}) => {
  const lower = String(html || '').toLowerCase();
  const cfMitigated = String(headers['cf-mitigated'] ?? headers['CF-Mitigated'] ?? '').toLowerCase();
  if (
    cfMitigated.includes('challenge')
    || ((status === 403 || status === 503) && (lower.includes('just a moment') || lower.includes('challenge-platform') || lower.includes('__cf_chl')))
    || lower.includes('enable javascript and cookies to continue')
  ) {
    return {
      gated: true,
      reason: 'cloudflare',
      targetUrl,
      message: 'Cloudflare human verification is required by unknowncheats.me. Open the verification window inside Spleen to verify cleanly.',
    };
  }
  if (
    lower.includes('you are not logged in or you do not have permission')
    || (lower.includes('vbulletin_message') && lower.includes('log in') && lower.includes('password'))
  ) {
    return {
      gated: true,
      reason: 'login',
      targetUrl,
      message: 'UnknownCheats login is required to view this section. Sign in inside Spleen’s verification window.',
    };
  }
  return { gated: false };
};

const parsePagination = (html, url = '') => {
  let page = 1;
  let totalPages = 1;
  const pageMatch = String(html).match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (pageMatch) {
    page = Math.max(1, Number.parseInt(pageMatch[1], 10) || 1);
    totalPages = Math.max(page, Number.parseInt(pageMatch[2], 10) || 1);
  } else {
    try {
      const parsed = new URL(url);
      const q = Number.parseInt(parsed.searchParams.get('page') || '1', 10);
      if (q > 1) page = q;
    } catch { /* ignore */ }
    for (const m of String(html).matchAll(/[?&]page=(\d+)/gi)) {
      const p = Number.parseInt(m[1], 10);
      if (Number.isFinite(p) && p > totalPages) totalPages = p;
    }
    totalPages = Math.max(totalPages, page);
  }
  return { page, totalPages };
};

export const parseHome = (html) => {
  const forums = [];
  const seen = new Set();
  const linkRe = /<a[^>]+href=["']([^"']*(?:forumdisplay\.php\?f=\d+|\/forum\/[a-z0-9-]+(?:\/\d*index\d*\.html|\/)?))["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of String(html || '').matchAll(linkRe)) {
    const rawHref = decodeHtml(m[1]);
    const url = resolveUcUrl(rawHref);
    const title = stripTags(m[2]);
    if (!url || !title || title.length < 2 || title.length > 100) continue;
    if (/^(home|forum|register|login|faq|search|mark forums read|today's posts)$/i.test(title)) continue;
    const fidMatch = rawHref.match(/[?&]f=(\d+)/);
    const id = fidMatch ? fidMatch[1] : rawHref.replace(/https?:\/\/[^/]+/, '');
    if (seen.has(id)) continue;
    seen.add(id);
    forums.push({ id, title, url });
  }
  return {
    title: stripTags((String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || 'UnknownCheats'),
    forums: forums.slice(0, 160),
  };
};

export const parseForumListing = (html, url = `${UC_BASE_URL}/forum/`) => {
  const threads = [];
  const seen = new Set();
  const text = String(html || '');
  const title = stripTags((text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || 'Forum');

  const rowRe = /<a[^>]+(?:id=["']thread_title_(\d+)["'][^>]+href=["']([^"']+)["']|href=["']([^"']*(?:showthread\.php\?t=(\d+)|\/forum\/[^"'?#]+\/(\d+)-[^"']+))["'])[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of text.matchAll(rowRe)) {
    const tid = m[1] || m[4] || m[5];
    const href = decodeHtml(m[2] || m[3] || '');
    const threadTitle = stripTags(m[6]);
    if (!tid || !href || !threadTitle || threadTitle.length < 2 || seen.has(tid)) continue;
    if (/^\d+$/.test(threadTitle) || /^(last|next|prev|page)/i.test(threadTitle)) continue;
    seen.add(tid);

    const start = Math.max(0, (m.index ?? 0) - 250);
    const end = Math.min(text.length, (m.index ?? 0) + m[0].length + 650);
    const ctx = text.slice(start, end);
    const sticky = /sticky|pinned/i.test(ctx);
    const authorMatch = ctx.match(/(?:Started by|member\.php\?u=\d+[^>]*>)([^<]+)<\/a>/i);
    const statsMatch = ctx.match(/Replies:\s*([\d,]+)[\s\S]*?Views:\s*([\d,]+)/i);
    threads.push({
      id: String(tid),
      title: threadTitle,
      url: resolveUcUrl(href),
      sticky,
      author: authorMatch ? stripTags(authorMatch[1]) : null,
      replies: statsMatch ? statsMatch[1] : null,
      views: statsMatch ? statsMatch[2] : null,
    });
  }

  const { page, totalPages } = parsePagination(text, url);
  return { title, url, page, totalPages, threads };
};

const extractPostBlocks = (bodyHtml) => {
  const blocks = [];
  let html = String(bodyHtml || '');

  // Extract vBulletin code boxes, quotes, and spoilers using placeholders so text stays ordered cleanly.
  const placeholders = [];
  const stash = (block) => {
    const token = `\u0000UC_BLOCK_${placeholders.length}\u0000`;
    placeholders.push(block);
    return `\n${token}\n`;
  };

  html = html.replace(/<pre[^>]*class=["'][^"']*alt2[^"']*["'][^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
    const code = decodeHtml(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    return code ? stash({ type: 'code', language: detectCodeLanguage(code), code }) : '';
  });

  html = html.replace(/<div[^>]*class=["'][^"']*bbcode_container[^"']*["'][^>]*>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>[\s\S]*?<\/div>/gi, (_m, inner) => {
    const code = decodeHtml(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    return code ? stash({ type: 'code', language: detectCodeLanguage(code), code }) : '';
  });

  html = html.replace(/<div[^>]*class=["'][^"']*spoiler[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, (_m, inner) => {
    const text = stripTags(inner);
    return text ? stash({ type: 'spoiler', title: 'Spoiler', text }) : '';
  });

  html = html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>|<td[^>]*class=["'][^"']*alt2[^"']*["'][^>]*>[\s\S]*?Originally Posted by\s*<strong[^>]*>([\s\S]*?)<\/strong>([\s\S]*?)<\/td>/gi, (_m, bq, origAuthor, origBody) => {
    const author = origAuthor ? stripTags(origAuthor) : null;
    const text = stripTags(bq ?? origBody ?? '');
    return text ? stash({ type: 'quote', author, text }) : '';
  });

  html = html.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, (_m, src) => {
    const full = resolveUcUrl(decodeHtml(src));
    if (!full || /smilies|icons\/|clear\.gif|statusicon/i.test(full)) return '';
    return stash({ type: 'image', src: full });
  });

  const plain = stripTags(html);
  const parts = plain.split(/(\u0000UC_BLOCK_\d+\u0000)/);
  for (const part of parts) {
    const tok = part.match(/^\u0000UC_BLOCK_(\d+)\u0000$/);
    if (tok) {
      blocks.push(placeholders[Number(tok[1])]);
    } else if (part.trim()) {
      blocks.push({ type: 'text', text: part.trim() });
    }
  }
  return blocks;
};

export const parseThread = (html, url = `${UC_BASE_URL}/forum/`) => {
  const text = String(html || '');
  const titleMatch = text.match(/<span[^>]*class=["'][^"']*navbar[^"']*["'][^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong>/i)
    || text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripTags(titleMatch ? titleMatch[1] : 'Thread');
  const tidMatch = String(url).match(/[?&]t=(\d+)|\/(\d+)-[^/]+\.html/i);
  const tid = tidMatch ? (tidMatch[1] || tidMatch[2]) : null;

  const posts = [];
  const postSplit = text.split(/(?=<table[^>]+id=["']post\d+["']|<div[^>]+id=["']post\d+["'])/i);
  for (const chunk of postSplit) {
    const idMatch = chunk.match(/id=["']post(\d+)["']/i);
    if (!idMatch) continue;
    const postId = idMatch[1];
    const msgMatch = chunk.match(/id=["']post_message_\d+["'][^>]*>([\s\S]*?)(?:<\/div>\s*<!--\s*\/ message|<!--\s*sig|<div[^>]+class=["'][^"']*sig)/i)
      || chunk.match(/id=["']post_message_\d+["'][^>]*>([\s\S]*?)<\/td>/i)
      || chunk.match(/id=["']post_message_\d+["'][^>]*>([\s\S]*)$/i);
    const bodyHtml = msgMatch ? msgMatch[1] : '';
    const authorMatch = chunk.match(/class=["'][^"']*bigusername[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
      || chunk.match(/<a[^>]+member\.php\?u=\d+[^>]*>([\s\S]*?)<\/a>/i);
    const numMatch = chunk.match(/id=["']postcount\d+["'][^>]*>\s*<strong>(\d+)<\/strong>/i);
    const dateMatch = chunk.match(/<td[^>]*class=["'][^"']*thead[^"']*["'][^>]*>[\s\S]*?<\/a>([^<]{5,60})/i);
    const blocks = extractPostBlocks(bodyHtml);
    posts.push({
      id: postId,
      number: numMatch ? Number.parseInt(numMatch[1], 10) : posts.length + 1,
      author: authorMatch ? stripTags(authorMatch[1]) : 'Member',
      timestamp: dateMatch ? stripTags(dateMatch[1]) : null,
      blocks,
      codeCount: blocks.filter((b) => b.type === 'code').length,
      rawText: blocks.map((b) => (b.type === 'code' ? `\`\`\`${b.language}\n${b.code}\n\`\`\`` : (b.text || ''))).filter(Boolean).join('\n\n'),
    });
  }

  const { page, totalPages } = parsePagination(text, url);
  return { id: tid, title, url, page, totalPages, posts };
};

export const parseSearchResults = (html, url = `${UC_BASE_URL}/forum/search.php`) => {
  const listing = parseForumListing(html, url);
  return {
    title: 'Search Results',
    page: listing.page,
    totalPages: listing.totalPages,
    results: listing.threads,
  };
};
