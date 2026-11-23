import express from 'express';
import { asNonEmptyString } from '../shared/guards.js';
import { DiscordApiError } from './client.js';

const sendError = (res, error) => {
  if (error instanceof DiscordApiError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error('[discord] route error:', error);
  res.status(500).json({ error: error instanceof Error ? error.message : 'Discord request failed' });
};

export const registerDiscordRoutes = (app, { client, gateway = null, requireAuthorized }) => {
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

  app.get('/api/discord/status', wrap(async (_req, res) => {
    const status = await client.getStatus();
    res.json({
      ...status,
      gatewayConnected: gateway?.isConnected?.() ?? false,
      gatewayHealth: gateway?.getHealth ? gateway.getHealth() : null,
    });
  }));

  app.post('/api/discord/connect', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    const status = await client.connect(req.body ?? {});
    if (gateway) await gateway.reconnect().catch(() => {});
    res.json({ ...status, gatewayConnected: gateway?.isConnected?.() ?? false });
  }));

  app.post('/api/discord/disconnect', wrap(async (_req, res) => {
    gateway?.disconnect?.();
    res.json(await client.disconnect());
  }));

  app.patch('/api/discord/preferences', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    const patch = {};
    if (req.body?.rememberedGuildId !== undefined) patch.rememberedGuildId = req.body.rememberedGuildId;
    if (Array.isArray(req.body?.mutedChannelIds)) patch.mutedChannelIds = req.body.mutedChannelIds;
    if (req.body?.applicationId !== undefined) patch.applicationId = asNonEmptyString(req.body.applicationId);
    if (req.body?.publicKey !== undefined) patch.publicKey = asNonEmptyString(req.body.publicKey);
    if (req.body?.safetyPolicy !== undefined && client.safety) {
      await client.safety.updatePolicy(req.body.safetyPolicy);
    }
    res.json(await client.updatePreferences(patch));
  }));

  app.post('/api/discord/interactions', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    try {
      if (!client.interactions) {
        res.status(503).json({ error: 'Discord interactions manager is unavailable' });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
      const result = await client.interactions.handleHttpInteraction({
        rawBody,
        signature: asNonEmptyString(req.headers['x-signature-ed25519']),
        timestamp: asNonEmptyString(req.headers['x-signature-timestamp']),
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/discord/policy', wrap(async (_req, res) => {
    res.json(await client.safety.getPolicy());
  }));

  app.patch('/api/discord/policy', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await client.safety.updatePolicy(req.body ?? {}));
  }));

  app.get('/api/discord/audit-trail', wrap(async (req, res) => {
    res.json({ entries: client.safety.listAuditTrail(req.query?.limit) });
  }));

  app.get('/api/discord/events', wrap(async (req, res) => {
    res.json({
      events: gateway?.listEvents ? gateway.listEvents({
        eventType: asNonEmptyString(req.query?.eventType),
        guildId: asNonEmptyString(req.query?.guildId),
        channelId: asNonEmptyString(req.query?.channelId),
        limit: req.query?.limit,
      }) : [],
    });
  }));

  app.post('/api/discord/oauth/authorize', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await client.oauth.buildAuthorizeUrl(req.body ?? {}));
  }));

  app.post('/api/discord/oauth/callback', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await client.oauth.exchangeCode(req.body ?? {}));
  }));

  app.post('/api/discord/oauth/refresh', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await client.oauth.refreshAccessToken(req.body ?? {}));
  }));

  app.post('/api/discord/oauth/revoke', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await client.oauth.revokeToken(req.body ?? {}));
  }));

  app.get('/api/discord/oauth/status', wrap(async (_req, res) => {
    res.json(await client.oauth.getOAuthStatus());
  }));

  app.post('/api/discord/voice/join', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await client.voice.joinVoiceChannel(req.body ?? {}));
  }));

  app.post('/api/discord/voice/leave', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.json(await client.voice.leaveVoiceChannel(req.body ?? {}));
  }));

  app.get('/api/discord/voice/status', wrap(async (req, res) => {
    res.json(client.voice.getVoiceStatus({ guildId: asNonEmptyString(req.query?.guildId) }));
  }));

  app.get('/api/discord/stream', async (req, res) => {
    if (requireAuthorized) {
      const ok = await requireAuthorized(req, res);
      if (!ok) return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'stream:ready', data: { connected: gateway?.isConnected?.() ?? false } })}\n\n`);
    const unsubscribe = gateway
      ? gateway.subscribe((evt) => {
          try {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
          } catch {
            // client closed
          }
        })
      : () => {};
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { /* ignore */ }
    }, 25_000);
    keepalive.unref?.();
    req.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });

  app.get('/api/discord/guilds', wrap(async (_req, res) => {
    res.json({ guilds: await client.listGuilds() });
  }));

  app.get('/api/discord/guilds/:guildId/channels', wrap(async (req, res) => {
    res.json(await client.listGuildChannels(req.params.guildId));
  }));

  app.post('/api/discord/guilds/:guildId/channels', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.status(201).json(await client.createChannel(req.params.guildId, req.body ?? {}));
  }));

  app.get('/api/discord/guilds/:guildId/members', wrap(async (req, res) => {
    res.json({ members: await client.getGuildMembers(req.params.guildId, req.query?.limit) });
  }));

  app.get('/api/discord/guilds/:guildId/roles', wrap(async (req, res) => {
    res.json({ roles: await client.getGuildRoles(req.params.guildId) });
  }));

  app.get('/api/discord/guilds/:guildId/search', wrap(async (req, res) => {
    res.json(await client.searchMessages(req.params.guildId, {
      content: typeof req.query?.content === 'string' ? req.query.content : undefined,
      authorId: typeof req.query?.authorId === 'string' ? req.query.authorId : undefined,
      channelId: typeof req.query?.channelId === 'string' ? req.query.channelId : undefined,
      offset: Number(req.query?.offset) || 0,
    }));
  }));

  app.get('/api/discord/dms', wrap(async (_req, res) => {
    res.json({ channels: await client.listDms() });
  }));

  app.post('/api/discord/dms', express.json({ limit: '32kb' }), wrap(async (req, res) => {
    res.status(201).json(await client.createDm(req.body?.recipientId));
  }));

  app.get('/api/discord/channels/:channelId/messages', wrap(async (req, res) => {
    res.json({
      messages: await client.getMessages(req.params.channelId, {
        limit: req.query?.limit,
        before: typeof req.query?.before === 'string' ? req.query.before : undefined,
        after: typeof req.query?.after === 'string' ? req.query.after : undefined,
      }),
    });
  }));

  app.post('/api/discord/channels/:channelId/messages', express.json({ limit: '25mb' }), wrap(async (req, res) => {
    res.status(201).json(await client.sendMessage(req.params.channelId, req.body ?? {}));
  }));

  app.patch('/api/discord/channels/:channelId/messages/:messageId', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.json(await client.editMessage(req.params.channelId, req.params.messageId, req.body ?? {}));
  }));

  app.delete('/api/discord/channels/:channelId/messages/:messageId', wrap(async (req, res) => {
    await client.deleteMessage(req.params.channelId, req.params.messageId);
    res.json({ deleted: true });
  }));

  app.get('/api/discord/channels/:channelId/pins', wrap(async (req, res) => {
    res.json({ messages: await client.getPins(req.params.channelId) });
  }));

  app.put('/api/discord/channels/:channelId/pins/:messageId', wrap(async (req, res) => {
    await client.pinMessage(req.params.channelId, req.params.messageId);
    res.json({ pinned: true });
  }));

  app.delete('/api/discord/channels/:channelId/pins/:messageId', wrap(async (req, res) => {
    await client.unpinMessage(req.params.channelId, req.params.messageId);
    res.json({ pinned: false });
  }));

  app.put('/api/discord/channels/:channelId/messages/:messageId/reactions/:emoji', wrap(async (req, res) => {
    await client.addReaction(req.params.channelId, req.params.messageId, req.params.emoji);
    res.json({ ok: true });
  }));

  app.delete('/api/discord/channels/:channelId/messages/:messageId/reactions/:emoji', wrap(async (req, res) => {
    await client.removeReaction(req.params.channelId, req.params.messageId, req.params.emoji);
    res.json({ ok: true });
  }));

  app.post('/api/discord/channels/:channelId/typing', wrap(async (req, res) => {
    await client.triggerTyping(req.params.channelId);
    res.json({ ok: true });
  }));

  app.post('/api/discord/channels/:channelId/threads', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.status(201).json(await client.createThread(req.params.channelId, req.body ?? {}));
  }));

  app.get('/api/discord/channels/:channelId/forum-posts', wrap(async (req, res) => {
    const tagParam = asNonEmptyString(req.query?.tags) ?? '';
    const tagIds = tagParam ? tagParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
    res.json(await client.listForumPosts(req.params.channelId, {
      guildId: asNonEmptyString(req.query?.guildId),
      archived: req.query?.archived === 'true',
      limit: req.query?.limit,
      before: asNonEmptyString(req.query?.before) ?? undefined,
      tagIds,
    }));
  }));

  app.post('/api/discord/channels/:channelId/forum-posts', express.json({ limit: '128kb' }), wrap(async (req, res) => {
    res.status(201).json(await client.createForumPost(req.params.channelId, req.body ?? {}));
  }));

  app.post('/api/discord/threads/:threadId/join', wrap(async (req, res) => {
    await client.joinThread(req.params.threadId);
    res.json({ joined: true });
  }));

  app.patch('/api/discord/channels/:channelId', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.json(await client.updateChannel(req.params.channelId, req.body ?? {}));
  }));
};
