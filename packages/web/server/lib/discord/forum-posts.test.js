import { describe, expect, it } from 'vitest';
import { createDiscordClient } from './client.js';
import { handleDiscordControlAction } from '../spleen-control/discord-actions.js';

const mockStore = () => ({
  read: async () => ({ token: 'tok_test', tokenType: 'user' }),
  saveConfig: async () => {},
  clearAuth: async () => {},
  getPublicStatus: async () => ({ connected: true, tokenType: 'user', tokenHint: 'tok_', user: null }),
});

describe('Discord Forum & Media support', () => {
  it('lists forum posts from /threads/search with starter messages and tag metadata', async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(String(url));
      if (String(url).includes('/channels/f1/threads/search')) {
        return new Response(JSON.stringify({
          threads: [
            {
              id: 'p2',
              guild_id: 'g1',
              parent_id: 'f1',
              name: 'Second post',
              type: 11,
              last_message_id: '200',
              message_count: 5,
              applied_tags: ['tag_bug'],
              thread_metadata: { archived: false, locked: false, create_timestamp: '2026-11-23T00:00:00Z' },
            },
          ],
          first_messages: [
            {
              id: 'm1',
              channel_id: 'p2',
              content: 'Here is the repro',
              author: { id: 'u1', username: 'alice' },
              timestamp: '2026-11-23T00:00:00Z',
            },
          ],
          has_more: false,
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const client = createDiscordClient({ store: mockStore(), fetchImpl });
    const res = await handleDiscordControlAction('discord.listForumPosts', { channelId: 'f1', guildId: 'g1', tagIds: ['tag_bug'] }, client);
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0].id).toBe('p2');
    expect(res.posts[0].appliedTags).toEqual(['tag_bug']);
    expect(res.posts[0].messageCount).toBe(5);
    expect(res.posts[0].firstMessage?.content).toBe('Here is the repro');
    expect(seen[0]).toContain('/channels/f1/threads/search');
  });

  it('falls back to active guild threads and archived public threads when /threads/search is unavailable', async () => {
    const fetchImpl = async (url) => {
      const s = String(url);
      if (s.includes('/threads/search')) return new Response('Forbidden', { status: 403 });
      if (s.includes('/guilds/g1/threads/active')) {
        return new Response(JSON.stringify({
          threads: [
            { id: 'p1', guild_id: 'g1', parent_id: 'f1', name: 'Active forum post', type: 11, last_message_id: '500' },
            { id: 'other', guild_id: 'g1', parent_id: 'f9', name: 'Other channel thread', type: 11, last_message_id: '900' },
          ],
        }), { status: 200 });
      }
      if (s.includes('/threads/archived/public')) {
        return new Response(JSON.stringify({ threads: [], has_more: false }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const client = createDiscordClient({ store: mockStore(), fetchImpl });
    const res = await client.listForumPosts('f1', { guildId: 'g1' });
    expect(res.posts.map((p) => p.id)).toEqual(['p1']);
  });

  it('supports discord.updateThread for archiving, locking, and applying forum tags', async () => {
    let sentBody = null;
    const fetchImpl = async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: 'p1',
        name: 'Solved issue',
        type: 11,
        applied_tags: ['tag_done'],
        thread_metadata: { archived: true, locked: true },
      }), { status: 200 });
    };

    const client = createDiscordClient({ store: mockStore(), fetchImpl });
    const updated = await handleDiscordControlAction('discord.updateThread', {
      threadId: 'p1',
      name: 'Solved issue',
      archived: true,
      locked: true,
      appliedTags: ['tag_done'],
    }, client);
    expect(sentBody).toEqual({ name: 'Solved issue', archived: true, locked: true, applied_tags: ['tag_done'] });
    expect(updated.archived).toBe(true);
    expect(updated.locked).toBe(true);
    expect(updated.appliedTags).toEqual(['tag_done']);
  });
});
