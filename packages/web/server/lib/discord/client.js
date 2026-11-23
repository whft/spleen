import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { createExtendedDiscordApi } from './extended-api.js';
import { calculateEffectivePermissions, createDiscordSafetyGuard } from './safety.js';
import { createDiscordInteractionsManager, ensureComponentsV2Flags } from './interactions.js';
import { createDiscordOAuthManager } from './oauth.js';
import { createDiscordVoiceManager } from './voice.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_CDN_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
]);
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toSnowflake = (value) => (/^\d+$/.test(String(value || '')) ? BigInt(value) : 0n);

export class DiscordApiError extends Error {
  constructor(message, status = 500, code = null, retryAfterMs = null) {
    super(message);
    this.name = 'DiscordApiError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export const cdnAvatarUrl = (user) => {
  if (!user?.id) return null;
  if (user.avatar) {
    const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
  }
  const idx = user.discriminator && user.discriminator !== '0'
    ? Number.parseInt(user.discriminator, 10) % 5
    : (/^\d+$/.test(String(user.id)) ? Number((BigInt(user.id) >> 22n) % 6n) : 0);
  return `https://cdn.discordapp.com/embed/avatars/${Number.isFinite(idx) ? idx : 0}.png`;
};

export const normalizeUser = (u) => (!u ? null : ({
  id: String(u.id),
  username: u.username ?? 'unknown',
  globalName: u.global_name ?? u.globalName ?? null,
  discriminator: u.discriminator ?? '0',
  avatar: u.avatar ?? null,
  avatarUrl: cdnAvatarUrl(u),
  bot: Boolean(u.bot),
}));

export const normalizeMessage = (m) => {
  if (!m || typeof m !== 'object') return null;
  return {
    id: String(m.id),
    channelId: String(m.channel_id ?? m.channelId ?? ''),
    guildId: m.guild_id ? String(m.guild_id) : null,
    content: typeof m.content === 'string' ? m.content : '',
    author: normalizeUser(m.author),
    timestamp: m.timestamp ?? new Date().toISOString(),
    editedTimestamp: m.edited_timestamp ?? m.editedTimestamp ?? null,
    pinned: Boolean(m.pinned),
    type: Number(m.type ?? 0),
    tts: Boolean(m.tts),
    attachments: Array.isArray(m.attachments) ? m.attachments.map((a) => ({
      id: String(a.id),
      filename: a.filename ?? 'file',
      url: a.url,
      proxyUrl: a.proxy_url ?? a.proxyUrl ?? a.url,
      size: Number(a.size ?? 0),
      contentType: a.content_type ?? a.contentType ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
    })) : [],
    embeds: Array.isArray(m.embeds) ? m.embeds : [],
    stickers: Array.isArray(m.sticker_items) ? m.sticker_items : (Array.isArray(m.stickers) ? m.stickers : []),
    reactions: Array.isArray(m.reactions) ? m.reactions.map((r) => ({
      emoji: r.emoji,
      count: Number(r.count ?? 0),
      me: Boolean(r.me),
    })) : [],
    mentions: Array.isArray(m.mentions) ? m.mentions.map(normalizeUser) : [],
    mentionRoles: Array.isArray(m.mention_roles) ? m.mention_roles.map(String) : [],
    mentionChannels: Array.isArray(m.mention_channels) ? m.mention_channels : [],
    components: Array.isArray(m.components) ? m.components : [],
    flags: Number(m.flags ?? 0),
    messageReference: m.message_reference ? {
      type: Number(m.message_reference.type ?? 0),
      messageId: m.message_reference.message_id ? String(m.message_reference.message_id) : null,
      channelId: m.message_reference.channel_id ? String(m.message_reference.channel_id) : null,
      guildId: m.message_reference.guild_id ? String(m.message_reference.guild_id) : null,
    } : null,
    referencedMessage: m.referenced_message ? {
      id: String(m.referenced_message.id),
      content: m.referenced_message.content ?? '',
      author: normalizeUser(m.referenced_message.author),
    } : null,
    interactionMetadata: m.interaction_metadata ?? null,
    thread: m.thread ? {
      id: String(m.thread.id),
      name: m.thread.name ?? 'Thread',
      messageCount: m.thread.message_count ?? null,
    } : null,
    poll: m.poll ?? null,
    messageSnapshots: Array.isArray(m.message_snapshots) ? m.message_snapshots : [],
    jumpUrl: `https://discord.com/channels/${m.guild_id ? String(m.guild_id) : '@me'}/${String(m.channel_id ?? m.channelId ?? '')}/${String(m.id)}`,
  };
};

export const normalizeChannel = (c) => ({
  id: String(c.id),
  guildId: c.guild_id ? String(c.guild_id) : null,
  name: c.name ?? (Array.isArray(c.recipients) ? c.recipients.map((r) => r.global_name || r.username).join(', ') : 'channel'),
  type: Number(c.type ?? 0),
  topic: c.topic ?? null,
  position: Number(c.position ?? 0),
  parentId: c.parent_id ? String(c.parent_id) : null,
  nsfw: Boolean(c.nsfw),
  rateLimitPerUser: Number(c.rate_limit_per_user ?? 0),
  lastMessageId: c.last_message_id ? String(c.last_message_id) : null,
  ownerId: c.owner_id ? String(c.owner_id) : null,
  messageCount: Number.isFinite(Number(c.message_count ?? c.total_message_sent))
    ? Number(c.message_count ?? c.total_message_sent)
    : null,
  memberCount: Number.isFinite(Number(c.member_count)) ? Number(c.member_count) : null,
  archived: Boolean(c.thread_metadata?.archived),
  locked: Boolean(c.thread_metadata?.locked),
  archiveTimestamp: c.thread_metadata?.archive_timestamp ?? null,
  createTimestamp: c.thread_metadata?.create_timestamp ?? null,
  appliedTags: Array.isArray(c.applied_tags) ? c.applied_tags.map(String) : [],
  availableTags: Array.isArray(c.available_tags)
    ? c.available_tags.map((tag) => ({
        id: String(tag.id),
        name: tag.name ?? '',
        emojiName: tag.emoji_name ?? null,
        moderated: Boolean(tag.moderated),
      }))
    : [],
  recipients: Array.isArray(c.recipients) ? c.recipients.map(normalizeUser) : [],
});

export const createDiscordClient = ({ store, gateway = null, fetchImpl = fetch, apiBase = DISCORD_API_BASE, WebSocketImpl = globalThis.WebSocket } = {}) => {
  const authHeaderFor = (token, tokenType) => (tokenType === 'bot' ? `Bot ${token}` : token);

  const apiFetch = async (endpoint, options = {}, retry = 0, explicitAuth = null) => {
    const state = explicitAuth ?? await store.read();
    if (!state?.token) throw new DiscordApiError('Discord account is not connected', 401, 'NOT_CONNECTED');

    const url = endpoint.startsWith('http') ? endpoint : `${apiBase}${endpoint}`;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = {
      Authorization: authHeaderFor(state.token, state.tokenType),
      ...(options.body && !isFormData && !options.headers?.['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    };

    const response = await fetchImpl(url, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });

    if (response.status === 429 && retry < 2) {
      const data = await response.json().catch(() => ({}));
      const retrySec = Number(data?.retry_after ?? response.headers.get('retry-after') ?? 1);
      const waitMs = Math.min(5_000, Math.max(200, Math.ceil(retrySec * 1000)));
      await sleep(waitMs);
      return apiFetch(endpoint, options, retry + 1, explicitAuth);
    }

    const method = (asNonEmptyString(options.method) || 'GET').toUpperCase();
    if ((response.status === 502 || response.status === 503 || response.status === 504) && method === 'GET' && retry < 2) {
      await sleep(300 * (retry + 1));
      return apiFetch(endpoint, options, retry + 1, explicitAuth);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (!response.ok) {
      const apiMsg = asNonEmptyString(json?.message) || asNonEmptyString(text) || `Discord API error (${response.status})`;
      const codeSuffix = json?.code !== undefined && json?.code !== null ? ` [Discord code ${json.code}]` : '';
      throw new DiscordApiError(`${apiMsg}${codeSuffix}`, response.status, json?.code ?? null);
    }
    return json;
  };

  const connect = async ({ token, tokenType = 'user' } = {}) => {
    const rawToken = typeof token === 'string' ? token.trim() : '';
    if (!rawToken) throw new DiscordApiError('Token is required', 400, 'TOKEN_REQUIRED');
    const chosenType = tokenType === 'bot' ? 'bot' : 'user';
    const userRaw = await apiFetch('/users/@me', { method: 'GET' }, 0, { token: rawToken, tokenType: chosenType });
    const user = normalizeUser(userRaw);
    await store.saveConfig({ token: rawToken, tokenType: chosenType, user });
    return store.getPublicStatus();
  };

  const disconnect = async () => {
    await store.clearAuth();
    return store.getPublicStatus();
  };

  const getStatus = () => store.getPublicStatus();

  const listGuilds = async () => {
    const guilds = await apiFetch('/users/@me/guilds');
    return (Array.isArray(guilds) ? guilds : []).map((g) => ({
      id: String(g.id),
      name: g.name,
      icon: g.icon ?? null,
      iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
      owner: Boolean(g.owner),
      permissions: g.permissions ?? null,
    }));
  };

  const listGuildChannels = async (guildId) => {
    const [channels, threadsPayload] = await Promise.all([
      apiFetch(`/guilds/${encodeURIComponent(guildId)}/channels`),
      apiFetch(`/guilds/${encodeURIComponent(guildId)}/threads/active`).catch(() => ({ threads: [] })),
    ]);
    const list = (Array.isArray(channels) ? channels : []).map(normalizeChannel);
    const threads = (Array.isArray(threadsPayload?.threads) ? threadsPayload.threads : []).map(normalizeChannel);
    return { channels: list.sort((a, b) => a.position - b.position), threads };
  };

  const listDms = async () => {
    const dms = await apiFetch('/users/@me/channels');
    const numericId = (v) => (/^\d+$/.test(String(v || '')) ? BigInt(v) : 0n);
    return (Array.isArray(dms) ? dms : [])
      .map(normalizeChannel)
      .sort((a, b) => (numericId(b.lastMessageId) > numericId(a.lastMessageId) ? 1 : -1));
  };

  const createDm = async (recipientId) => {
    const ch = await apiFetch('/users/@me/channels', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: String(recipientId) }),
    });
    return normalizeChannel(ch);
  };

  const getGuildMembers = async (guildId, limit = 100, after = null) => {
    const params = new URLSearchParams({ limit: String(Math.min(1000, Math.max(1, Number(limit) || 100))) });
    if (asNonEmptyString(after)) params.set('after', String(after).trim());
    const members = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/members?${params.toString()}`);
    return (Array.isArray(members) ? members : []).map((m) => ({
      user: normalizeUser(m.user),
      nick: m.nick ?? null,
      roles: Array.isArray(m.roles) ? m.roles.map(String) : [],
      joinedAt: m.joined_at ?? null,
    }));
  };

  const getGuildRoles = async (guildId) => {
    const roles = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/roles`);
    return (Array.isArray(roles) ? roles : [])
      .map((r) => ({ id: String(r.id), name: r.name, color: r.color ?? 0, position: Number(r.position ?? 0), permissions: r.permissions, managed: Boolean(r.managed), hoist: Boolean(r.hoist), mentionable: Boolean(r.mentionable) }))
      .sort((a, b) => b.position - a.position);
  };

  const getMessages = async (channelId, { limit = 50, before, after, around } = {}) => {
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(limit) || 50))) });
    if (before !== undefined && before !== null && String(before).trim() !== '') params.set('before', String(before).trim());
    if (after !== undefined && after !== null && String(after).trim() !== '') params.set('after', String(after).trim());
    if (around !== undefined && around !== null && String(around).trim() !== '') params.set('around', String(around).trim());
    const list = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages?${params.toString()}`);
    return (Array.isArray(list) ? list : [])
      .map(normalizeMessage)
      .filter(Boolean)
      .sort((a, b) => {
        const diff = toSnowflake(a.id) - toSnowflake(b.id);
        return diff < 0n ? -1 : (diff > 0n ? 1 : 0);
      });
  };

  const searchMessages = async (guildId, { content, authorId, channelId, offset = 0 } = {}) => {
    if (!guildId) {
      if (!channelId) throw new DiscordApiError('guildId or channelId is required to search messages', 400, 'MISSING_SCOPE');
      const recent = await getMessages(channelId, { limit: 100 });
      const needle = typeof content === 'string' ? content.trim().toLowerCase() : '';
      const filtered = recent.filter((m) => {
        if (authorId && m.author?.id !== String(authorId)) return false;
        if (needle && !m.content.toLowerCase().includes(needle)) return false;
        return true;
      });
      return { totalResults: filtered.length, messages: filtered };
    }
    const params = new URLSearchParams();
    if (content) params.set('content', content);
    if (authorId) params.set('author_id', authorId);
    if (channelId) params.set('channel_id', channelId);
    if (offset > 0) params.set('offset', String(offset));
    try {
      const res = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/messages/search?${params.toString()}`);
      const flat = Array.isArray(res?.messages) ? res.messages.flat() : [];
      return {
        totalResults: Number(res?.total_results ?? flat.length),
        messages: flat.map(normalizeMessage).filter(Boolean),
      };
    } catch (err) {
      if (channelId && content) {
        const recent = await getMessages(channelId, { limit: 100 });
        const needle = content.toLowerCase();
        const filtered = recent.filter((m) => m.content.toLowerCase().includes(needle));
        return { totalResults: filtered.length, messages: filtered };
      }
      throw err;
    }
  };

  const sendMessage = async (
    channelId,
    { content = '', replyToMessageId, files = [], embeds, components, poll, tts, stickerIds, flags, allowedMentions } = {},
  ) => {
    const text = typeof content === 'string' ? content : '';
    const fileList = Array.isArray(files) ? files : [];
    const resolvedFlags = Array.isArray(components) && components.length > 0
      ? ensureComponentsV2Flags(components, flags)
      : flags;
    const payload = {
      ...(text ? { content: text } : {}),
      ...(replyToMessageId ? { message_reference: { message_id: String(replyToMessageId) } } : {}),
      ...(Array.isArray(embeds) && embeds.length > 0 ? { embeds } : {}),
      ...(Array.isArray(components) && components.length > 0 ? { components } : {}),
      ...(poll && typeof poll === 'object' ? { poll } : {}),
      ...(tts ? { tts: true } : {}),
      ...(Array.isArray(stickerIds) && stickerIds.length > 0 ? { sticker_ids: stickerIds.map(String) } : {}),
      ...(resolvedFlags !== undefined ? { flags: Number(resolvedFlags) } : {}),
      ...(allowedMentions && typeof allowedMentions === 'object' ? { allowed_mentions: allowedMentions } : {}),
    };

    if (fileList.length > 0 && typeof FormData !== 'undefined') {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      fileList.forEach((f, idx) => {
        const raw = typeof f.dataBase64 === 'string'
          ? Buffer.from(f.dataBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
          : Buffer.from(f.bytes ?? '');
        const blob = new Blob([raw], { type: f.contentType || 'application/octet-stream' });
        form.append(`files[${idx}]`, blob, f.name || `upload-${idx}`);
      });
      const created = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages`, {
        method: 'POST',
        body: form,
      });
      return normalizeMessage(created);
    }

    const hasStructured = Boolean(payload.embeds || payload.components || payload.poll || payload.sticker_ids);
    if (!text.trim() && !hasStructured) throw new DiscordApiError('Message content, embeds, poll, or files required', 400, 'EMPTY_MESSAGE');
    const created = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizeMessage(created);
  };

  const editMessage = async (channelId, messageId, patch = {}) => {
    const body = {};
    if (patch.content !== undefined) body.content = patch.content;
    if (Array.isArray(patch.embeds)) body.embeds = patch.embeds;
    if (Array.isArray(patch.components)) {
      body.components = patch.components;
      const v2Flags = ensureComponentsV2Flags(patch.components, patch.flags);
      if (v2Flags !== undefined) body.flags = Number(v2Flags);
    }
    if (patch.flags !== undefined && body.flags === undefined) body.flags = Number(patch.flags);
    if (isRecord(patch.allowedMentions)) body.allowed_mentions = patch.allowedMentions;
    if (Array.isArray(patch.attachments)) body.attachments = patch.attachments;
    const edited = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return normalizeMessage(edited);
  };

  const deleteMessage = (channelId, messageId) => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  );

  const encodeEmoji = (emoji) => (emoji.includes(':') ? encodeURIComponent(emoji) : encodeURIComponent(emoji));

  const addReaction = (channelId, messageId, emoji) => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}/@me`,
    { method: 'PUT' },
  );

  const removeReaction = (channelId, messageId, emoji, userId = '@me') => {
    const target = asNonEmptyString(userId) || '@me';
    const segment = target === '@me' ? '@me' : encodeURIComponent(target);
    return apiFetch(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}/${segment}`,
      { method: 'DELETE' },
    );
  };

  const getPins = async (channelId) => {
    const list = await apiFetch(`/channels/${encodeURIComponent(channelId)}/pins`);
    return (Array.isArray(list) ? list : []).map(normalizeMessage);
  };

  const pinMessage = (channelId, messageId) => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`,
    { method: 'PUT' },
  );

  const unpinMessage = (channelId, messageId) => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  );

  const triggerTyping = (channelId) => apiFetch(`/channels/${encodeURIComponent(channelId)}/typing`, { method: 'POST' });

  const createThread = async (channelId, { name, messageId, autoArchiveDuration = 1440 } = {}) => {
    const endpoint = messageId
      ? `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/threads`
      : `/channels/${encodeURIComponent(channelId)}/threads`;
    const thread = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ name, auto_archive_duration: autoArchiveDuration, ...(messageId ? {} : { type: 11 }) }),
    });
    return normalizeChannel(thread);
  };

  const getMessage = async (channelId, messageId) => {
    const chId = String(channelId);
    const msgId = String(messageId);
    try {
      const msg = await apiFetch(`/channels/${encodeURIComponent(chId)}/messages/${encodeURIComponent(msgId)}`);
      return normalizeMessage(msg);
    } catch (err) {
      const status = Number(err?.status ?? err?.statusCode ?? 0);
      const isStarterLookup = chId === msgId;
      if (status !== 403 && !(status === 404 && isStarterLookup)) throw err;

      const around = await getMessages(chId, { around: msgId, limit: 5 }).catch(() => []);
      const exact = around.find((m) => m.id === msgId);
      if (exact) return exact;

      if (isStarterLookup) {
        const oldest = await getMessages(chId, { after: '0', limit: 1 }).catch(() => []);
        if (oldest[0]?.id === msgId) return oldest[0];
        if (oldest[0]) {
          throw new DiscordApiError(
            `Starter message ${msgId} was not found in thread ${chId} (it may have been deleted; oldest remaining message is ${oldest[0].id})`,
            404,
            10008,
          );
        }
      }
      throw new DiscordApiError(`Message ${msgId} was not found in channel ${chId}`, 404, 10008);
    }
  };

  const getChannel = async (channelId) => {
    const ch = await apiFetch(`/channels/${encodeURIComponent(channelId)}`);
    return normalizeChannel(ch);
  };

  const getUser = async (userId) => {
    const u = await apiFetch(`/users/${encodeURIComponent(userId)}`);
    return normalizeUser(u);
  };

  const deleteChannel = (channelId) => apiFetch(`/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });

  const joinThread = (threadId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members/@me`, { method: 'PUT' });

  const leaveThread = (threadId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members/@me`, { method: 'DELETE' });

  const resolveLocalPath = (rawPath, baseDir = null) => {
    const trimmed = String(rawPath || '').trim();
    if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
    return baseDir ? path.resolve(String(baseDir), trimmed) : path.resolve(trimmed);
  };

  const sendMessageFromFile = async (
    channelId,
    { content = '', replyToMessageId, filePath, filePaths = [], filename, baseDir = null, embeds, components, poll, tts, flags, allowedMentions } = {},
  ) => {
    const pathsToRead = Array.isArray(filePaths) && filePaths.length > 0
      ? filePaths.filter((p) => asNonEmptyString(p))
      : (asNonEmptyString(filePath) ? [filePath] : []);
    const files = [];
    for (let idx = 0; idx < pathsToRead.length; idx += 1) {
      const resolved = resolveLocalPath(pathsToRead[idx], baseDir);
      const bytes = await fs.readFile(resolved);
      const name = idx === 0 && asNonEmptyString(filename) ? filename : path.basename(resolved);
      files.push({ name, bytes });
    }
    return sendMessage(channelId, {
      content,
      replyToMessageId,
      files,
      embeds,
      components,
      poll,
      tts,
      flags,
      allowedMentions,
    });
  };

  const downloadAttachment = async (attachmentUrl, savePath = null, { baseDir = null } = {}) => {
    let parsed;
    try {
      parsed = new URL(String(attachmentUrl || '').trim());
    } catch {
      throw new DiscordApiError('Valid Discord attachment URL is required', 400, 'INVALID_URL');
    }
    if (parsed.protocol !== 'https:' || !DISCORD_CDN_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new DiscordApiError('Only Discord CDN attachment URLs are allowed', 400, 'UNSUPPORTED_HOST');
    }
    const response = await fetchImpl(parsed.toString(), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new DiscordApiError(`Failed to download attachment (${response.status})`, response.status, 'DOWNLOAD_FAILED');
    }
    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new DiscordApiError('Attachment exceeds 50 MB download limit', 413, 'FILE_TOO_LARGE');
    }
    const rawName = path.basename(parsed.pathname) || 'discord-attachment';
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const rawSavePath = asNonEmptyString(savePath);
    let targetPath;
    if (rawSavePath) {
      const resolved = resolveLocalPath(rawSavePath, baseDir);
      const endsWithSep = rawSavePath.endsWith('/') || rawSavePath.endsWith('\\');
      let isExistingDir = false;
      if (!endsWithSep) {
        const stat = await fs.stat(resolved).catch(() => null);
        isExistingDir = Boolean(stat?.isDirectory());
      }
      targetPath = endsWithSep || isExistingDir ? path.join(resolved, safeName) : resolved;
    } else {
      targetPath = path.join(os.tmpdir(), `spleen-discord-${Date.now()}-${safeName}`);
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, Buffer.from(arrayBuf));
    return {
      path: targetPath,
      requestedSavePath: rawSavePath ?? null,
      filename: safeName,
      bytes: arrayBuf.byteLength,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
    };
  };

  const createChannel = async (guildId, options = {}) => {
    const body = { name: options.name, type: options.type ?? 0 };
    if (asNonEmptyString(options.topic)) body.topic = options.topic;
    if (asNonEmptyString(options.parentId)) body.parent_id = options.parentId;
    if (options.nsfw !== undefined) body.nsfw = Boolean(options.nsfw);
    if (options.rateLimitPerUser !== undefined) body.rate_limit_per_user = Number(options.rateLimitPerUser);
    if (options.bitrate !== undefined) body.bitrate = Number(options.bitrate);
    if (options.userLimit !== undefined) body.user_limit = Number(options.userLimit);
    if (options.defaultAutoArchiveDuration !== undefined) body.default_auto_archive_duration = Number(options.defaultAutoArchiveDuration);
    if (options.defaultSortOrder !== undefined) body.default_sort_order = Number(options.defaultSortOrder);
    if (options.defaultForumLayout !== undefined) body.default_forum_layout = Number(options.defaultForumLayout);
    if (Array.isArray(options.availableTags)) body.available_tags = options.availableTags;
    const ch = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/channels`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return normalizeChannel(ch);
  };

  const updateChannel = async (channelId, patch = {}) => {
    const body = {};
    if (asNonEmptyString(patch.name) !== null || patch.name === '') body.name = patch.name;
    if (asNonEmptyString(patch.topic) !== null || patch.topic === '') body.topic = patch.topic;
    if (patch.rateLimitPerUser !== undefined) body.rate_limit_per_user = Number(patch.rateLimitPerUser);
    if (patch.nsfw !== undefined) body.nsfw = Boolean(patch.nsfw);
    if (patch.position !== undefined) body.position = Number(patch.position);
    if (patch.parentId !== undefined) body.parent_id = patch.parentId;
    if (patch.bitrate !== undefined) body.bitrate = Number(patch.bitrate);
    if (patch.userLimit !== undefined) body.user_limit = Number(patch.userLimit);
    if (patch.rtcRegion !== undefined) body.rtc_region = patch.rtcRegion;
    if (patch.videoQualityMode !== undefined) body.video_quality_mode = Number(patch.videoQualityMode);
    if (patch.defaultAutoArchiveDuration !== undefined) body.default_auto_archive_duration = Number(patch.defaultAutoArchiveDuration);
    if (patch.defaultThreadRateLimitPerUser !== undefined) body.default_thread_rate_limit_per_user = Number(patch.defaultThreadRateLimitPerUser);
    if (patch.defaultSortOrder !== undefined) body.default_sort_order = patch.defaultSortOrder === null ? null : Number(patch.defaultSortOrder);
    if (patch.defaultForumLayout !== undefined) body.default_forum_layout = Number(patch.defaultForumLayout);
    if (patch.defaultReactionEmoji !== undefined) body.default_reaction_emoji = patch.defaultReactionEmoji;
    if (patch.archived !== undefined) body.archived = Boolean(patch.archived);
    if (patch.locked !== undefined) body.locked = Boolean(patch.locked);
    if (patch.autoArchiveDuration !== undefined) body.auto_archive_duration = Number(patch.autoArchiveDuration);
    if (Array.isArray(patch.appliedTags)) body.applied_tags = patch.appliedTags.map(String);
    if (Array.isArray(patch.availableTags)) body.available_tags = patch.availableTags;
    if (patch.flags !== undefined) body.flags = Number(patch.flags);
    const ch = await apiFetch(`/channels/${encodeURIComponent(channelId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return normalizeChannel(ch);
  };

  const updatePreferences = (patch) => store.saveConfig(patch).then(() => store.getPublicStatus());

  const extended = createExtendedDiscordApi({ apiFetch, encodeEmoji });
  const safety = createDiscordSafetyGuard({ store });
  const interactions = createDiscordInteractionsManager({ apiFetch, store });
  const oauth = createDiscordOAuthManager({ store, fetchImpl, apiBase });
  const voice = createDiscordVoiceManager({ store, gateway, WebSocketImpl });

  if (gateway?.setInteractionHandler) {
    gateway.setInteractionHandler((payload) => {
      interactions.recordInboundInteraction(payload);
    });
  }

  const checkPermissions = async ({ guildId, userId = null, channelId = null } = {}) => {
    const state = store ? await store.read() : null;
    const targetUserId = asNonEmptyString(userId) || asNonEmptyString(state?.user?.id ? String(state.user.id) : null);
    if (!targetUserId) throw new DiscordApiError('userId is required to compute permissions', 400, 'USER_ID_REQUIRED');
    const [guild, member, roles, channel] = await Promise.all([
      extended.getGuild(guildId),
      extended.getGuildMember(guildId, targetUserId),
      getGuildRoles(guildId),
      asNonEmptyString(channelId) ? apiFetch(`/channels/${encodeURIComponent(channelId)}`) : Promise.resolve(null),
    ]);
    return {
      guildId: String(guildId),
      userId: targetUserId,
      channelId: asNonEmptyString(channelId),
      ...calculateEffectivePermissions({ guild, member, roles, channel }),
    };
  };

  return {
    ...extended,
    safety,
    interactions,
    oauth,
    voice,
    gateway,
    checkPermissions,
    getStatus,
    connect,
    disconnect,
    listGuilds,
    listGuildChannels,
    listDms,
    createDm,
    getGuildMembers,
    getGuildRoles,
    getChannel,
    getUser,
    getMessage,
    getMessages,
    searchMessages,
    sendMessage,
    sendMessageFromFile,
    downloadAttachment,
    editMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    getPins,
    pinMessage,
    unpinMessage,
    triggerTyping,
    createThread,
    joinThread,
    leaveThread,
    createChannel,
    updateChannel,
    deleteChannel,
    updatePreferences,
  };
};
