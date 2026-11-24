import express from 'express';
import { asNonEmptyString } from '../shared/guards.js';

export const registerMemFsRoutes = (app, { memfsStore, curator, requireAuthorized = null }) => {
  const wrap = (handler) => async (req, res) => {
    if (requireAuthorized) {
      const ok = await requireAuthorized(req, res);
      if (!ok) return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Memory request failed' });
    }
  };

  app.get('/api/memory-v2', wrap(async (req, res) => {
    const query = asNonEmptyString(req.query?.query);
    const params = {
      tier: asNonEmptyString(req.query?.tier),
      scope: asNonEmptyString(req.query?.scope),
      scopeId: req.query?.scopeId !== undefined ? String(req.query.scopeId) : null,
      minConfidence: Number(req.query?.minConfidence) || 0,
      includeStale: req.query?.includeStale === 'true',
      includeFlagged: req.query?.includeFlagged === 'true',
      limit: req.query?.limit,
    };
    const entries = query ? memfsStore.searchMemories({ ...params, query }) : memfsStore.listMemories(params);
    res.json({ entries });
  }));

  app.post('/api/memory-v2', express.json({ limit: '256kb' }), wrap(async (req, res) => {
    res.status(201).json(memfsStore.saveMemory(req.body ?? {}));
  }));

  app.get('/api/memory-v2/:id/history', wrap(async (req, res) => {
    res.json({ history: memfsStore.listHistory(req.params.id) });
  }));

  app.post('/api/memory-v2/:id/rollback', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(memfsStore.rollbackMemory(req.params.id, req.body?.version));
  }));

  app.delete('/api/memory-v2/:id', wrap(async (req, res) => {
    const deleted = memfsStore.deleteMemory(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Memory not found' });
    res.json({ deleted: true });
  }));

  app.post('/api/memory-v2/curate', express.json({ limit: '256kb' }), wrap(async (req, res) => {
    res.json(curator.curateFromEpisode(req.body ?? {}));
  }));

  app.post('/api/memory-v2/consolidate', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.json(curator.consolidateMemories(req.body ?? {}));
  }));

  app.post('/api/memory-v2/propose-skill', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    res.json(await curator.proposeProceduralSkill(req.body ?? {}));
  }));
};
