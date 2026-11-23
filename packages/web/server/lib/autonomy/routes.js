import express from 'express';
import { asNonEmptyString } from '../shared/guards.js';

export const registerAutonomyRoutes = (app, { supervisor, listSessions = null, requireAuthorized = null }) => {
  const wrap = (handler) => async (req, res) => {
    if (requireAuthorized) {
      const ok = await requireAuthorized(req, res);
      if (!ok) return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      const status = Number(error?.statusCode ?? error?.status) || 400;
      res.status(status).json({ error: error instanceof Error ? error.message : 'Autonomy request failed' });
    }
  };

  app.get('/api/autonomy/status', wrap(async (_req, res) => {
    res.json(supervisor.getStatus());
  }));

  app.get('/api/autonomy/sessions', wrap(async (req, res) => {
    const sessions = listSessions ? await listSessions(req.query?.limit) : [];
    res.json({ sessions });
  }));

  app.get('/api/autonomy/objectives', wrap(async (req, res) => {
    const objectives = supervisor.listObjectives({
      status: asNonEmptyString(req.query?.status),
      directory: asNonEmptyString(req.query?.directory),
      limit: req.query?.limit,
    });
    res.json({ objectives });
  }));

  app.post('/api/autonomy/objectives', express.json({ limit: '256kb' }), wrap(async (req, res) => {
    const created = supervisor.createObjective(req.body ?? {});
    if (req.body?.runImmediately !== false) {
      void supervisor.tick();
    }
    res.status(201).json(created);
  }));

  app.get('/api/autonomy/objectives/:id', wrap(async (req, res) => {
    const detail = supervisor.getObjective(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Objective not found' });
    res.json(detail);
  }));

  app.post('/api/autonomy/objectives/:id/tasks', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    res.status(201).json(supervisor.addTask(req.params.id, req.body ?? {}));
  }));

  app.post('/api/autonomy/objectives/:id/replan', express.json({ limit: '256kb' }), wrap(async (req, res) => {
    res.json(supervisor.replanObjective(req.params.id, req.body ?? {}));
  }));

  app.post('/api/autonomy/objectives/:id/pause', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    const updated = supervisor.pauseObjective(req.params.id, asNonEmptyString(req.body?.reason) || 'Paused by user');
    if (!updated) return res.status(404).json({ error: 'Objective not found' });
    res.json(updated);
  }));

  app.post('/api/autonomy/objectives/:id/resume', wrap(async (req, res) => {
    const updated = supervisor.resumeObjective(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Objective not found' });
    void supervisor.tick();
    res.json(updated);
  }));

  app.post('/api/autonomy/objectives/:id/attach-session', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    const updated = supervisor.attachSession(req.params.id, req.body?.sessionId ?? null);
    if (!updated) return res.status(404).json({ error: 'Objective not found' });
    res.json(updated);
  }));

  app.post('/api/autonomy/objectives/:id/run-now', wrap(async (req, res) => {
    const existing = supervisor.getObjective(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Objective not found' });
    void supervisor.tick();
    res.json({ ok: true, id: existing.id });
  }));

  app.post('/api/autonomy/objectives/:id/cancel', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    const updated = supervisor.cancelObjective(req.params.id, asNonEmptyString(req.body?.reason) || 'Cancelled by user');
    if (!updated) return res.status(404).json({ error: 'Objective not found' });
    res.json(updated);
  }));

  app.post('/api/autonomy/objectives/:id/verify', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await supervisor.verifyObjective(req.params.id, { autoDetect: req.body?.autoDetect === true }));
  }));

  app.post('/api/autonomy/emergency-stop', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(supervisor.emergencyStopAll(asNonEmptyString(req.body?.reason) || 'Emergency stop triggered'));
  }));
};
