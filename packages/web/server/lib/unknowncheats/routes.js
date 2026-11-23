import express from 'express';
import { UnknownCheatsError } from './client.js';

const sendError = (res, error) => {
  if (error instanceof UnknownCheatsError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error('[unknowncheats] route error:', error);
  res.status(500).json({ error: error instanceof Error ? error.message : 'UnknownCheats request failed' });
};

export const registerUnknownCheatsRoutes = (app, { client, store, requireAuthorized }) => {
  const wrap = (handler) => async (req, res) => {
    if (requireAuthorized) {
      const ok = await requireAuthorized(req, res);
      if (!ok) return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };

  app.get('/api/unknowncheats/status', wrap(async (_req, res) => {
    res.json(await store.getPublicStatus());
  }));

  app.post('/api/unknowncheats/login', express.json({ limit: '16kb' }), wrap(async (req, res) => {
    const result = await client.login({
      username: typeof req.body?.username === 'string' ? req.body.username : '',
      password: typeof req.body?.password === 'string' ? req.body.password : '',
      userAgent: typeof req.body?.userAgent === 'string' ? req.body.userAgent : req.get('user-agent'),
    });
    res.json(result);
  }));

  app.post('/api/unknowncheats/cookies', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    const cookieHeader = typeof req.body?.cookieHeader === 'string' ? req.body.cookieHeader : '';
    const userAgent = typeof req.body?.userAgent === 'string' && req.body.userAgent.trim()
      ? req.body.userAgent.trim()
      : (req.get('user-agent') || '');
    const username = typeof req.body?.username === 'string' ? req.body.username : undefined;
    await store.setCookieHeader(cookieHeader, { userAgent, username });
    res.json(await store.getPublicStatus());
  }));

  app.delete('/api/unknowncheats/cookies', wrap(async (_req, res) => {
    await store.clearCookies();
    res.json(await store.getPublicStatus());
  }));

  app.get('/api/unknowncheats/home', wrap(async (_req, res) => {
    res.json(await client.getHome());
  }));

  app.get('/api/unknowncheats/recent', wrap(async (req, res) => {
    res.json(await client.getRecent({
      page: req.query?.page ? Number(req.query.page) : 1,
    }));
  }));

  app.get('/api/unknowncheats/forum', wrap(async (req, res) => {
    res.json(await client.getForum({
      url: typeof req.query?.url === 'string' ? req.query.url : undefined,
      fid: typeof req.query?.fid === 'string' ? req.query.fid : undefined,
      page: req.query?.page ? Number(req.query.page) : 1,
    }));
  }));

  app.get('/api/unknowncheats/thread', wrap(async (req, res) => {
    res.json(await client.getThread({
      url: typeof req.query?.url === 'string' ? req.query.url : undefined,
      tid: typeof req.query?.tid === 'string' ? req.query.tid : undefined,
      page: req.query?.page ? Number(req.query.page) : 1,
    }));
  }));

  app.get('/api/unknowncheats/search', wrap(async (req, res) => {
    const query = typeof req.query?.query === 'string'
      ? req.query.query
      : (typeof req.query?.q === 'string' ? req.query.q : '');
    res.json(await client.search({
      query,
      page: req.query?.page ? Number(req.query.page) : 1,
    }));
  }));

  app.get('/api/unknowncheats/bookmarks', wrap(async (_req, res) => {
    res.json({ bookmarks: await store.listBookmarks() });
  }));

  app.post('/api/unknowncheats/bookmarks', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.status(201).json({ bookmarks: await store.addBookmark(req.body ?? {}) });
  }));

  app.delete('/api/unknowncheats/bookmarks/:id', wrap(async (req, res) => {
    res.json({ bookmarks: await store.removeBookmark(req.params.id) });
  }));

  app.get('/api/unknowncheats/history', wrap(async (_req, res) => {
    res.json({ history: await store.listHistory() });
  }));

  app.delete('/api/unknowncheats/history', wrap(async (_req, res) => {
    res.json({ history: await store.clearHistory() });
  }));
};
