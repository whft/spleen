import express from 'express';
import { TeamServiceError } from './service.js';

const sendError = (res, error) => {
  if (error instanceof TeamServiceError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error('[teams] route error:', error);
  res.status(500).json({ error: error instanceof Error ? error.message : 'Team operation failed' });
};

export const registerTeamsRoutes = (app, { service, requireAuthorized }) => {
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

  app.get('/api/teams/presets', wrap(async (_req, res) => {
    res.json({ presets: service.presets });
  }));

  app.get('/api/teams', wrap(async (_req, res) => {
    res.json({ teams: await service.listTeams() });
  }));

  app.post('/api/teams', express.json({ limit: '256kb' }), wrap(async (req, res) => {
    res.status(201).json(await service.createTeam(req.body ?? {}));
  }));

  app.get('/api/teams/:id', wrap(async (req, res) => {
    res.json(await service.getTeam(req.params.id));
  }));

  app.patch('/api/teams/:id', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.json(await service.updateTeam(req.params.id, req.body ?? {}));
  }));

  app.delete('/api/teams/:id', wrap(async (req, res) => {
    res.json(await service.deleteTeam(req.params.id));
  }));

  app.post('/api/teams/:id/stop', wrap(async (req, res) => {
    res.json(await service.stopTeam(req.params.id));
  }));

  app.post('/api/teams/:id/members', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.status(201).json(await service.addMember(req.params.id, req.body ?? {}));
  }));

  app.delete('/api/teams/:id/members/:memberId', wrap(async (req, res) => {
    res.json(await service.removeMember(req.params.id, req.params.memberId));
  }));

  app.get('/api/teams/:id/board', wrap(async (req, res) => {
    const team = await service.getTeam(req.params.id);
    res.json({ messages: team.messages });
  }));

  app.post('/api/teams/:id/board', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    const msg = await service.postBoardMessage({ teamId: req.params.id, ...(req.body ?? {}) });
    res.status(201).json(msg);
  }));

  app.get('/api/teams/:id/tasks', wrap(async (req, res) => {
    const team = await service.getTeam(req.params.id);
    res.json({ tasks: team.tasks, dagSummary: team.dagSummary });
  }));

  app.post('/api/teams/:id/tasks', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    res.status(201).json(await service.addTask(req.params.id, req.body ?? {}));
  }));

  app.patch('/api/teams/:id/tasks/:taskId', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    res.json(await service.updateTask(req.params.id, req.params.taskId, req.body ?? {}));
  }));

  app.post('/api/teams/:id/tasks/:taskId/retry', wrap(async (req, res) => {
    res.json(await service.retryTask(req.params.id, req.params.taskId));
  }));

  app.post('/api/teams/:id/tasks/:taskId/cancel', wrap(async (req, res) => {
    res.json(await service.cancelTask(req.params.id, req.params.taskId));
  }));

  app.get('/api/session-links', wrap(async (req, res) => {
    res.json({ links: await service.listLinks(req.query?.sessionId) });
  }));

  app.post('/api/session-links', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.status(201).json(await service.linkSessions(req.body ?? {}));
  }));

  app.delete('/api/session-links/:id', wrap(async (req, res) => {
    res.json(await service.unlinkSessions(req.params.id));
  }));
};
