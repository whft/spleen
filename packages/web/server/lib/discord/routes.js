import express from 'express';
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
    res.json({ ...status, gatewayConnected: gateway?.isConnected?.() ?? false });
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
    res.json(await client.updatePreferences(patch));
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

  app.post('/api/discord/threads/:threadId/join', wrap(async (req, res) => {
    await client.joinThread(req.params.threadId);
    res.json({ joined: true });
  }));

  app.patch('/api/discord/channels/:channelId', express.json({ limit: '64kb' }), wrap(async (req, res) => {
    res.json(await client.updateChannel(req.params.channelId, req.body ?? {}));
  }));
};
