import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createDiscordClient } from './client.js';
import { createDiscordStore } from './store.js';
import { registerDiscordRoutes } from './routes.js';

describe('discord routes', () => {
  it('requires authorization and serves connect, guilds, messages, and disconnect safely', async () => {
    const store = createDiscordStore();
    const fetchImpl = async (url) => {
      if (url.endsWith('/users/@me')) {
        return new Response(JSON.stringify({ id: 'u1', username: 'spleenuser' }), { status: 200 });
      }
      if (url.endsWith('/users/@me/guilds')) {
        return new Response(JSON.stringify([{ id: 'g1', name: 'Dev Server', owner: true }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    };
    const client = createDiscordClient({ store, fetchImpl });

    let allow = false;
    const authApp = express();
    registerDiscordRoutes(authApp, {
      client,
      requireAuthorized: async (_req, res) => {
        if (!allow) { res.status(401).json({ error: 'Unauthorized' }); return false; }
        return true;
      },
    });
    await request(authApp).get('/api/discord/status').expect(401);

    allow = true;
    const conn = await request(authApp).post('/api/discord/connect').send({ token: 'secret-token-9999' }).expect(200);
    expect(conn.body.connected).toBe(true);
    expect(conn.body.token).toBeUndefined();

    const guilds = await request(authApp).get('/api/discord/guilds').expect(200);
    expect(guilds.body.guilds[0].name).toBe('Dev Server');

    const off = await request(authApp).post('/api/discord/disconnect').expect(200);
    expect(off.body.connected).toBe(false);
  });
});
