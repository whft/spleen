import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createUnknownCheatsStore } from './store.js';
import { createUnknownCheatsClient } from './client.js';
import { registerUnknownCheatsRoutes } from './routes.js';

const servers = [];

const startTestApp = async (fetchImpl) => {
  const store = createUnknownCheatsStore();
  const client = createUnknownCheatsClient({ store, fetchImpl });
  const app = express();
  registerUnknownCheatsRoutes(app, { client, store, requireAuthorized: async () => true });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
};

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    await new Promise((resolve) => s.close(resolve));
  }
});

describe('unknowncheats routes', () => {
  it('handles home, thread history, bookmarks, cookies, and verification gates cleanly', async () => {
    const seenCookies = [];
    const base = await startTestApp(async (url, opts) => {
      seenCookies.push(opts?.headers?.Cookie || '');
      if (String(url).includes('search.php')) {
        return new Response('<html><title>Just a moment...</title></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' },
        });
      }
      if (String(url).includes('showthread.php')) {
        return new Response(`
          <html><head><title>Safe Reader Thread</title></head><body>
          <div id="post10"><a class="bigusername" href="member.php?u=1">Dev</a>
          <div id="post_message_10">Hello<pre class="alt2">const x = 1;</pre></div></div></body></html>
        `, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('<html><title>UnknownCheats</title><body><a href="forumdisplay.php?f=4">Programming</a></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    const cookieRes = await fetch(`${base}/api/unknowncheats/cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookieHeader: 'cf_clearance=abc123; uc_sid=xyz' }),
    });
    expect(cookieRes.status).toBe(200);
    expect((await cookieRes.json()).hasCookies).toBe(true);

    const homeRes = await fetch(`${base}/api/unknowncheats/home`);
    const home = await homeRes.json();
    expect(home.gated).toBe(false);
    expect(home.forums[0].title).toBe('Programming');
    expect(seenCookies[0]).toContain('cf_clearance=abc123');

    const threadRes = await fetch(`${base}/api/unknowncheats/thread?tid=10`);
    const thread = await threadRes.json();
    expect(thread.gated).toBe(false);
    expect(thread.posts[0].codeCount).toBe(1);

    const historyRes = await fetch(`${base}/api/unknowncheats/history`);
    expect((await historyRes.json()).history).toHaveLength(1);

    const bookmarkRes = await fetch(`${base}/api/unknowncheats/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '10', title: 'Safe Reader Thread', url: 'https://www.unknowncheats.me/forum/showthread.php?t=10' }),
    });
    expect(bookmarkRes.status).toBe(201);
    expect((await bookmarkRes.json()).bookmarks).toHaveLength(1);

    const gatedRes = await fetch(`${base}/api/unknowncheats/search?query=test`);
    const gated = await gatedRes.json();
    expect(gated.gated).toBe(true);
    expect(gated.gate.reason).toBe('cloudflare');
  });
});
