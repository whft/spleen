import express from 'express';
import { asNonEmptyString } from '../shared/guards.js';

export const registerResearchRoutes = (app, { store, ingestor, requireAuthorized = null }) => {
  const wrap = (handler) => async (req, res) => {
    if (requireAuthorized) {
      const ok = await requireAuthorized(req, res);
      if (!ok) return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Research request failed' });
    }
  };

  app.get('/api/research/sources', wrap(async (_req, res) => {
    res.json({ sources: store.listSources() });
  }));

  app.post('/api/research/sources', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    const source = store.registerSource(req.body ?? {});
    if (req.body?.indexNow !== false && (source.kind === 'directory' || source.kind === 'git' || source.kind === 'file')) {
      const stats = await ingestor.indexSource(source.id);
      return res.status(201).json({ source: store.getSource(source.id), stats });
    }
    return res.status(201).json({ source });
  }));

  app.post('/api/research/sources/:id/refresh', wrap(async (req, res) => {
    const stats = await ingestor.indexSource(req.params.id);
    res.json({ source: store.getSource(req.params.id), stats });
  }));

  app.delete('/api/research/sources/:id', wrap(async (req, res) => {
    const deleted = store.deleteSource(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Source not found' });
    res.json({ deleted: true });
  }));

  app.get('/api/research/search', wrap(async (req, res) => {
    const results = store.search({
      query: asNonEmptyString(req.query?.query) || '',
      sourceId: asNonEmptyString(req.query?.sourceId),
      buildHash: asNonEmptyString(req.query?.buildHash),
      includeStale: req.query?.includeStale === 'true',
      includeQuarantined: req.query?.includeQuarantined === 'true',
      limit: req.query?.limit,
    });
    res.json({ results });
  }));

  app.get('/api/research/findings', wrap(async (req, res) => {
    res.json({ findings: store.listFindings({ buildHash: asNonEmptyString(req.query?.buildHash), limit: req.query?.limit }) });
  }));

  app.post('/api/research/findings', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    res.status(201).json(store.recordFinding(req.body ?? {}));
  }));

  app.post('/api/research/analysis/import', express.json({ limit: '10mb' }), wrap(async (req, res) => {
    res.status(201).json(ingestor.importAnalysisArtifacts(req.body ?? {}));
  }));

  app.post('/api/research/analysis/compare', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(ingestor.compareBuilds(req.body?.buildHashA, req.body?.buildHashB));
  }));

  app.get('/api/research/export', wrap(async (_req, res) => {
    res.json(store.exportBackup());
  }));
};
