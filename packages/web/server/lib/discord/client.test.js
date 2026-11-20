import { describe, expect, it, vi } from 'vitest';
import { createDiscordClient } from './client.js';
import { createDiscordStore } from './store.js';

describe('discord client', () => {
  it('connects without exposing raw token, handles 429 retry, normalizes embeds/messages, and sends multipart uploads', async () => {
    const store = createDiscordStore();
    let messageAttempt = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/users/@me')) {
        return new Response(JSON.stringify({ id: '123', username: 'alice', global_name: 'Alice', discriminator: '0' }), { status: 200 });
      }
      if (url.includes('/channels/c1/messages') && method === 'GET') {
        messageAttempt += 1;
        if (messageAttempt === 1) {
          return new Response(JSON.stringify({ retry_after: 0.05 }), { status: 429 });
        }
        return new Response(JSON.stringify([{
          id: 'm1',
          channel_id: 'c1',
          content: 'Hello **Spleen**',
          author: { id: '123', username: 'alice' },
          timestamp: '2026-10-20T10:00:00.000Z',
          embeds: [{ title: 'Card', description: 'Details', color: 0xd9503f }],
          attachments: [],
        }]), { status: 200 });
      }
      if (url.endsWith('/channels/c1/messages') && init.method === 'POST') {
        expect(init.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({
          id: 'm2',
          channel_id: 'c1',
          content: 'with image',
          author: { id: '123', username: 'alice' },
          attachments: [{ id: 'a1', filename: 'pic.png', url: 'https://cdn.discordapp.com/pic.png', size: 3 }],
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const client = createDiscordClient({ store, fetchImpl });
    const status = await client.connect({ token: 'secret-user-token-xyz123', tokenType: 'user' });
    expect(status.connected).toBe(true);
    expect(status.token).toBeUndefined();
    expect(status.tokenHint).toBe('secr••••z123');
    expect(status.user.username).toBe('alice');

    const msgs = await client.getMessages('c1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].embeds[0].title).toBe('Card');

    const uploaded = await client.sendMessage('c1', {
      content: 'with image',
      files: [{ name: 'pic.png', contentType: 'image/png', dataBase64: Buffer.from('png').toString('base64') }],
    });
    expect(uploaded.attachments[0].filename).toBe('pic.png');
  });
});
