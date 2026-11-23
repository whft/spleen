import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDiscordClient } from './client.js';
import { createDiscordGateway } from './gateway.js';
import { createDiscordStore } from './store.js';
import { calculateEffectivePermissions, DISCORD_PERMISSION_FLAGS } from './safety.js';
import { verifyDiscordSignature, COMPONENTS_V2_FLAG } from './interactions.js';
import { handleDiscordControlAction } from '../spleen-control/discord-actions.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  emit(type, payload) {
    for (const fn of this.listeners.get(type) ?? []) fn(payload);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
}

describe('Discord all-in platform pillars', () => {
  it('Pillar 1: computes effective permissions, enforces policy modes, confirmDestructive, allowlists, and audit trail', async () => {
    const permResult = calculateEffectivePermissions({
      guild: { id: 'g1', owner_id: 'owner1' },
      member: { user: { id: 'u1' }, roles: ['r1'] },
      roles: [
        { id: 'g1', position: 0, permissions: String(DISCORD_PERMISSION_FLAGS.VIEW_CHANNEL | DISCORD_PERMISSION_FLAGS.SEND_MESSAGES) },
        { id: 'r1', position: 5, permissions: String(DISCORD_PERMISSION_FLAGS.MANAGE_MESSAGES) },
      ],
      channel: {
        permission_overwrites: [
          { id: 'r1', allow: '0', deny: String(DISCORD_PERMISSION_FLAGS.SEND_MESSAGES) },
          { id: 'u1', allow: String(DISCORD_PERMISSION_FLAGS.EMBED_LINKS), deny: '0' },
        ],
      },
    });
    expect(permResult.permissions).toContain('VIEW_CHANNEL');
    expect(permResult.permissions).toContain('MANAGE_MESSAGES');
    expect(permResult.permissions).toContain('EMBED_LINKS');
    expect(permResult.permissions).not.toContain('SEND_MESSAGES');
    expect(permResult.highestRolePosition).toBe(5);

    const store = createDiscordStore();
    await store.saveConfig({ token: 'bot-tok', tokenType: 'bot', user: { id: 'bot1', username: 'bot' } });
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'm1', channel_id: 'c1', content: 'ok', author: { id: 'bot1', username: 'bot' } }));
    const discord = createDiscordClient({ store, fetchImpl });

    await handleDiscordControlAction('discord.policy', {
      patch: { policyMode: 'full', confirmDestructive: true, allowedGuildIds: ['g1'] },
    }, discord);

    const preview = await handleDiscordControlAction('discord.banMember', { guildId: 'g1', userId: 'u9' }, discord);
    expect(preview.confirmationRequired).toBe(true);
    expect(preview.destructive).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    const confirmed = await handleDiscordControlAction('discord.banMember', { guildId: 'g1', userId: 'u9', confirm: true }, discord);
    expect(confirmed.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(
      handleDiscordControlAction('discord.guild', { guildId: 'g2' }, discord),
    ).rejects.toThrow(/not in allowedGuildIds/);

    await handleDiscordControlAction('discord.policy', { patch: { policyMode: 'read-only' } }, discord);
    await expect(
      handleDiscordControlAction('discord.send', { channelId: 'c1', content: 'blocked' }, discord),
    ).rejects.toThrow(/read-only/);

    const trail = await handleDiscordControlAction('discord.auditTrail', { limit: 10 }, discord);
    expect(trail.entries.length).toBeGreaterThanOrEqual(3);
  });

  it('Pillar 2: verifies Ed25519 interaction signatures, handles PING/defer, manages commands, and auto-sets Components V2 flags', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
    const rawPubHex = spkiDer.subarray(spkiDer.length - 32).toString('hex');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const pingBody = JSON.stringify({ id: 'i1', type: 1 });
    const sig = crypto.sign(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(pingBody, 'utf8')]), privateKey).toString('hex');

    expect(verifyDiscordSignature({ publicKeyHex: rawPubHex, signatureHex: sig, timestamp, rawBody: pingBody })).toBe(true);
    expect(verifyDiscordSignature({ publicKeyHex: rawPubHex, signatureHex: sig, timestamp, rawBody: '{"type":2}' })).toBe(false);

    const store = createDiscordStore();
    await store.saveConfig({ token: 'bot-tok', tokenType: 'bot', applicationId: 'app1', publicKey: rawPubHex });
    const requests = [];
    const fetchImpl = vi.fn(async (url, init) => {
      requests.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
      return jsonResponse({ id: 'cmd1', name: 'ping' });
    });
    const discord = createDiscordClient({ store, fetchImpl });

    const pingRes = await discord.interactions.handleHttpInteraction({ rawBody: pingBody, signature: sig, timestamp });
    expect(pingRes.body).toEqual({ type: 1 });

    const slashBody = JSON.stringify({ id: 'i2', application_id: 'app1', type: 2, token: 'tok2', guild_id: 'g1', channel_id: 'c1', data: { name: 'ping' } });
    const slashSig = crypto.sign(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(slashBody, 'utf8')]), privateKey).toString('hex');
    const slashRes = await discord.interactions.handleHttpInteraction({ rawBody: slashBody, signature: slashSig, timestamp });
    expect(slashRes.body).toEqual({ type: 5 });

    const listed = await handleDiscordControlAction('discord.listInteractions', {}, discord);
    expect(listed.interactions[0].id).toBe('i2');
    expect(listed.interactions[0].interactionToken).toBe('tok2');

    await handleDiscordControlAction('discord.upsertCommand', {
      guildId: 'g1',
      commandPayload: { name: 'ping', description: 'Health check' },
    }, discord);
    expect(requests[0].url).toContain('/applications/app1/guilds/g1/commands');

    await handleDiscordControlAction('discord.send', {
      channelId: 'c1',
      components: [{ type: 10, content: 'Components V2 TextDisplay' }],
    }, discord);
    expect(requests[1].body.flags & COMPONENTS_V2_FLAG).toBe(COMPONENTS_V2_FLAG);
  });

  it('Pillar 3: generates OAuth2 PKCE S256 URL, exchanges/refreshes/revokes tokens without leaking secrets', async () => {
    const store = createDiscordStore();
    await store.saveConfig({ applicationId: 'app99' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/oauth2/token')) {
        return jsonResponse({ access_token: 'secret-access-1', refresh_token: 'secret-refresh-1', expires_in: 3600, scope: 'identify guilds' });
      }
      if (url.endsWith('/oauth2/token/revoke')) {
        return jsonResponse({});
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const discord = createDiscordClient({ store, fetchImpl });

    const auth = await handleDiscordControlAction('discord.oauthUrl', {
      redirectUri: 'http://127.0.0.1:3901/callback',
      scopes: ['identify', 'guilds'],
    }, discord);
    expect(auth.url).toContain('code_challenge=');
    expect(auth.url).toContain('code_challenge_method=S256');
    expect(auth.pkceEnabled).toBe(true);

    const exchanged = await discord.oauth.exchangeCode({ code: 'abc123', state: auth.state });
    expect(exchanged.authorized).toBe(true);
    expect(exchanged.scopes).toEqual(['identify', 'guilds']);
    expect(JSON.stringify(exchanged)).not.toContain('secret-access-1');

    const status = await handleDiscordControlAction('discord.oauthStatus', {}, discord);
    expect(status.authorized).toBe(true);
    expect(status.hasRefreshToken).toBe(true);
    expect(JSON.stringify(status)).not.toContain('secret-access-1');

    const revoked = await handleDiscordControlAction('discord.oauthRevoke', {}, discord);
    expect(revoked.revoked).toBe(true);
  });

  it('Pillar 3 & 4: Gateway buffers extended events, sets bot presence OP 3, and completes Voice Gateway v4 handshake', async () => {
    FakeWebSocket.instances = [];
    const store = createDiscordStore();
    await store.saveConfig({ token: 'bot-tok', tokenType: 'bot', user: { id: 'bot1', username: 'bot' } });
    const gateway = createDiscordGateway({ store, WebSocketImpl: FakeWebSocket });
    const discord = createDiscordClient({ store, gateway, WebSocketImpl: FakeWebSocket });

    const unsub = gateway.subscribe(() => {});
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(1));
    const mainWs = FakeWebSocket.instances[0];
    mainWs.emit('message', JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }));
    mainWs.emit('message', JSON.stringify({ op: 0, s: 1, t: 'READY', d: { session_id: 'gw-sess', user: { id: 'bot1', username: 'bot' } } }));
    mainWs.emit('message', JSON.stringify({ op: 0, s: 2, t: 'AUTO_MODERATION_ACTION_EXECUTION', d: { guild_id: 'g1', channel_id: 'c1', rule_id: 'r9' } }));
    mainWs.emit('message', JSON.stringify({ op: 0, s: 3, t: 'VOICE_STATE_UPDATE', d: { guild_id: 'g1', channel_id: 'vc1', user_id: 'u42', session_id: 'u42-s', self_mute: false, self_video: true } }));

    const evts = await handleDiscordControlAction('discord.events', { eventType: 'automod:action', guildId: 'g1' }, discord);
    expect(evts.events).toHaveLength(1);
    expect(evts.health.connected).toBe(true);

    const presence = await handleDiscordControlAction('discord.setPresence', {
      presenceStatus: 'dnd',
      activities: [{ name: 'Spleen Studio', type: 0 }],
    }, discord);
    expect(presence.ok).toBe(true);
    expect(mainWs.sent.some((p) => p.op === 3 && p.d.status === 'dnd')).toBe(true);

    const members = await handleDiscordControlAction('discord.voiceMembers', { guildId: 'g1', channelId: 'vc1' }, discord);
    expect(members.members.map((m) => m.userId)).toEqual(['u42']);
    expect(members.members[0].selfVideo).toBe(true);

    const joinPromise = handleDiscordControlAction('discord.voiceJoin', { guildId: 'g1', channelId: 'vc1', selfDeaf: true }, discord);
    await vi.waitFor(() => expect(mainWs.sent.some((p) => p.op === 4 && p.d.channel_id === 'vc1')).toBe(true));

    mainWs.emit('message', JSON.stringify({ op: 0, s: 4, t: 'VOICE_STATE_UPDATE', d: { guild_id: 'g1', channel_id: 'vc1', user_id: 'bot1', session_id: 'bot-vs-1' } }));
    mainWs.emit('message', JSON.stringify({ op: 0, s: 5, t: 'VOICE_SERVER_UPDATE', d: { guild_id: 'g1', token: 'vtok-1', endpoint: 'us-east1.discord.media:443' } }));

    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2));
    const voiceWs = FakeWebSocket.instances[1];
    expect(voiceWs.url).toBe('wss://us-east1.discord.media:443/?v=4');
    voiceWs.emit('open', {});
    voiceWs.emit('message', JSON.stringify({ op: 8, d: { heartbeat_interval: 13_750 } }));
    voiceWs.emit('message', JSON.stringify({ op: 2, d: { ssrc: 12345, ip: '1.2.3.4', port: 50000, modes: ['aead_xchacha20_poly1305_rtpsize'] } }));

    const joined = await joinPromise;
    expect(joined.state).toBe('ready');
    expect(joined.ssrc).toBe(12345);
    expect(joined.modes).toContain('aead_xchacha20_poly1305_rtpsize');

    const left = await handleDiscordControlAction('discord.voiceLeave', { guildId: 'g1' }, discord);
    expect(left.disconnected).toBe(true);
    unsub();
    gateway.disconnect();
  });
});
