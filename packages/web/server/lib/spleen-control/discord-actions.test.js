import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDiscordClient } from '../discord/client.js';
import { handleDiscordControlAction } from './discord-actions.js';
import { createAgentToolRuntime } from '../agent-tool/runtime.js';

const createMockStore = (tokenType = 'user') => ({
  read: async () => ({ token: 'test-token', tokenType, user: { id: '1', username: 'tester' } }),
  getPublicStatus: async () => ({ connected: true, tokenType }),
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('Discord AI tool regression fixes', () => {
  it('1. discord.channels always returns flat arrays for channels and threads', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/guilds/g1/channels')) {
        return jsonResponse([
          { id: 'c2', guild_id: 'g1', name: 'forum-src', type: 15, position: 2 },
          { id: 'c1', guild_id: 'g1', name: 'general', type: 0, position: 1 },
        ]);
      }
      if (url.endsWith('/guilds/g1/threads/active')) {
        return jsonResponse({ threads: [{ id: 't1', guild_id: 'g1', parent_id: 'c2', name: 'active-post', type: 11 }] });
      }
      if (url.endsWith('/users/@me/channels')) {
        return jsonResponse([{ id: 'dm1', type: 1, recipients: [{ id: 'u2', username: 'bob' }], last_message_id: '50' }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const discord = createDiscordClient({ store: createMockStore(), fetchImpl });

    const guildRes = await handleDiscordControlAction('discord.channels', { guildId: 'g1' }, discord);
    expect(Array.isArray(guildRes.channels)).toBe(true);
    expect(Array.isArray(guildRes.threads)).toBe(true);
    expect(guildRes.channels.filter((c) => c.type === 15).map((c) => c.id)).toEqual(['c2']);
    expect(guildRes.threads.map((t) => t.id)).toEqual(['t1']);

    const dmRes = await handleDiscordControlAction('discord.channels', {}, discord);
    expect(Array.isArray(dmRes.channels)).toBe(true);
    expect(Array.isArray(dmRes.threads)).toBe(true);
    expect(dmRes.channels[0].id).toBe('dm1');
  });

  it('2. discord.downloadAttachment honors savePath relative to session directory, creates parents, and overwrites', async () => {
    const tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'spleen-discord-dl-'));
    const fetchImpl = vi.fn(async () => new Response('int main() { return 0; }', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    const discord = createDiscordClient({ store: createMockStore(), fetchImpl });

    try {
      const relSave = 'rbx-ext/refs/vault/test/Freecam.cpp';
      const first = await handleDiscordControlAction(
        'discord.downloadAttachment',
        { url: 'https://cdn.discordapp.com/attachments/1/2/Freecam.cpp', savePath: relSave },
        discord,
        { contextDirectory: tempWorkspace },
      );
      const expectedPath = path.resolve(tempWorkspace, relSave);
      expect(first.path).toBe(expectedPath);
      expect(first.requestedSavePath).toBe(relSave);
      expect(await fs.readFile(expectedPath, 'utf8')).toBe('int main() { return 0; }');

      const absTarget = path.join(tempWorkspace, 'nested', 'triggerbot.cpp');
      await fs.mkdir(path.dirname(absTarget), { recursive: true });
      await fs.writeFile(absTarget, 'old-content', 'utf8');
      const second = await handleDiscordControlAction(
        'discord.downloadAttachment',
        { url: 'https://cdn.discordapp.com/attachments/1/2/triggerbot.cpp', savePath: absTarget },
        discord,
        { contextDirectory: tempWorkspace },
      );
      expect(second.path).toBe(absTarget);
      expect(await fs.readFile(absTarget, 'utf8')).toBe('int main() { return 0; }');
    } finally {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    }
  });

  it('3. discord.api preserves querystrings in path, object query, string query, and JSON-stringified query', async () => {
    const requestedUrls = [];
    const fetchImpl = vi.fn(async (url) => {
      requestedUrls.push(url);
      return jsonResponse({ threads: [{ id: '101' }], has_more: true });
    });
    const discord = createDiscordClient({ store: createMockStore(), fetchImpl });

    await handleDiscordControlAction('discord.api', {
      method: 'GET',
      path: '/channels/99/threads/archived/public',
      query: { limit: 100, before: '2026-11-01T00:00:00Z' },
    }, discord);
    await handleDiscordControlAction('discord.api', {
      method: 'GET',
      path: '/channels/99/threads/archived/public',
      query: 'limit=5&before=2026-11-01T00:00:00Z',
    }, discord);
    await handleDiscordControlAction('discord.api', {
      method: 'GET',
      path: '/channels/99/threads/archived/public?limit=7',
    }, discord);
    await handleDiscordControlAction('discord.api', {
      method: 'GET',
      path: '/channels/99/threads/archived/public',
      query: '{"limit":12}',
    }, discord);

    expect(requestedUrls[0]).toContain('limit=100');
    expect(requestedUrls[0]).toContain('before=2026-11-01T00%3A00%3A00Z');
    expect(requestedUrls[1]).toContain('limit=5');
    expect(requestedUrls[1]).toContain('before=2026-11-01T00%3A00%3A00Z');
    expect(requestedUrls[2]).toContain('limit=7');
    expect(requestedUrls[3]).toContain('limit=12');
  });

  it('4. discord.messages passes after/around/before, sorts chronologically, and hints on forum channels', async () => {
    const requestedUrls = [];
    const fetchImpl = vi.fn(async (url) => {
      requestedUrls.push(url);
      if (url.includes('/channels/forum1/messages')) {
        return jsonResponse({ message: 'Cannot execute action on this channel type', code: 50024 }, 400);
      }
      return jsonResponse([
        { id: '200', channel_id: 'th1', content: 'second', author: { id: '1', username: 'a' } },
        { id: '100', channel_id: 'th1', content: 'opening post', author: { id: '1', username: 'a' } },
      ]);
    });
    const discord = createDiscordClient({ store: createMockStore(), fetchImpl });

    const opening = await handleDiscordControlAction('discord.messages', {
      channelId: 'th1',
      after: '0',
      limit: 5,
    }, discord);
    expect(requestedUrls[0]).toContain('after=0');
    expect(requestedUrls[0]).toContain('limit=5');
    expect(opening.messages.map((m) => m.id)).toEqual(['100', '200']);
    expect(opening.messages[0].jumpUrl).toBe('https://discord.com/channels/@me/th1/100');

    await handleDiscordControlAction('discord.messages', {
      channelId: 'th1',
      around: '150',
      limit: 10,
    }, discord);
    expect(requestedUrls[1]).toContain('around=150');

    await expect(
      handleDiscordControlAction('discord.messages', { channelId: 'th1', before: '200', after: '0' }, discord),
    ).rejects.toThrow(/at most one/i);

    await expect(
      handleDiscordControlAction('discord.messages', { channelId: 'forum1' }, discord),
    ).rejects.toThrow(/listForumPosts/);
  });

  it('5. forum pagination exposes nextBefore and nextOffset beyond 50 posts', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/threads/archived/public')) {
        return jsonResponse({
          threads: [
            { id: '900', parent_id: 'f1', name: 'Older post', type: 11, thread_metadata: { archived: true, archive_timestamp: '2026-10-15T12:00:00Z' } },
          ],
          has_more: true,
        });
      }
      if (url.includes('/threads/search')) {
        return jsonResponse({
          threads: [
            { id: '950', parent_id: 'f1', name: 'Active post', type: 11, thread_metadata: { archived: false, archive_timestamp: '2026-11-20T00:00:00Z' } },
          ],
          first_messages: [
            { id: '950', channel_id: '950', content: 'starter body', author: { id: '7', username: 'dev' } },
          ],
          has_more: true,
          total_results: 180,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const discord = createDiscordClient({ store: createMockStore(), fetchImpl });

    const page1 = await handleDiscordControlAction('discord.listForumPosts', {
      channelId: 'f1',
      archived: false,
      limit: 25,
      offset: 0,
    }, discord);
    expect(page1.posts[0].id).toBe('950');
    expect(page1.posts[0].firstMessage?.content).toBe('starter body');
    expect(page1.hasMore).toBe(true);
    expect(page1.nextOffset).toBe(1);
    expect(page1.totalResults).toBe(180);

    const archivedPage = await handleDiscordControlAction('discord.archivedThreads', {
      channelId: 'f1',
      limit: 100,
      before: '2026-11-01T00:00:00Z',
    }, discord);
    expect(archivedPage.threads).toHaveLength(1);
    expect(archivedPage.hasMore).toBe(true);
    expect(archivedPage.nextBefore).toBe('2026-10-15T12:00:00Z');
  });

  it('6. discord.message recovers on user-token 403 and forum starter lookup, and reports clear errors on missing messages', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/channels/555/messages/555')) {
        return jsonResponse({ message: 'Only bots can use this endpoint', code: 20002 }, 403);
      }
      if (url.includes('/channels/555/messages?limit=5&around=555')) {
        return jsonResponse([{ id: '555', channel_id: '555', content: 'forum opening post', author: { id: '3', username: 'op' } }]);
      }
      if (url.endsWith('/channels/666/messages/666')) {
        return jsonResponse({ message: 'Unknown Message', code: 10008 }, 404);
      }
      if (url.includes('/channels/666/messages?limit=5&around=666')) {
        return jsonResponse([]);
      }
      if (url.includes('/channels/666/messages?limit=1&after=0')) {
        return jsonResponse([{ id: '667', channel_id: '666', content: 'first reply', author: { id: '4', username: 'replier' } }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const discord = createDiscordClient({ store: createMockStore(), fetchImpl });

    const starter = await handleDiscordControlAction('discord.message', {
      channelId: '555',
      messageId: '555',
    }, discord);
    expect(starter.id).toBe('555');
    expect(starter.content).toBe('forum opening post');

    await expect(
      handleDiscordControlAction('discord.message', { channelId: '666', messageId: '666' }, discord),
    ).rejects.toThrow(/Starter message 666 was not found.*667/);
  });

  it('exposes savePath, after, around, method, query(object|string), and forum actions in materialized spleen tool schema', async () => {
    const instanceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spleen-tool-schema-'));
    try {
      const runtime = createAgentToolRuntime({
        crypto,
        fsPromises: fs,
        path,
        instanceDir,
        getActivePort: () => 3901,
        executeAction: async () => ({}),
      });
      await runtime.materializePlugin({ includeControl: true, includeWeb: false, includeMemory: false });
      const pluginPath = path.join(instanceDir, 'agent-tool', 'spleen-agent-tool', 'index.js');
      const mod = await import(`file://${pluginPath.replace(/\\/g, '/')}?t=${Date.now()}`);
      const added = {};
      await mod.default.setup({
        tool: {
          transform: async (fn) => {
            fn({
              namespace: () => {},
              remove: () => {},
              add: (entry) => { added[entry.name] = entry; },
            });
          },
        },
      });
      const schema = added.spleen.input.properties;
      expect(schema.action.enum).toContain('discord.listForumPosts');
      expect(schema.action.enum).toContain('discord.updateThread');
      expect(schema.action.enum).toContain('discord.application');
      expect(schema.parameters.additionalProperties).toBe(true);
      expect(schema.parameters.properties).toHaveProperty('savePath');
      expect(schema.parameters.properties).toHaveProperty('after');
      expect(schema.parameters.properties).toHaveProperty('around');
      expect(schema.parameters.properties).toHaveProperty('method');
      expect(schema.parameters.properties.query.type).toEqual(['string', 'object']);
      expect(added.spleen.description.length).toBeLessThanOrEqual(2048);
    } finally {
      await fs.rm(instanceDir, { recursive: true, force: true });
    }
  });
});
