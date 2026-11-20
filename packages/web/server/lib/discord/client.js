const DISCORD_API_BASE = 'https://discord.com/api/v10';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DiscordApiError extends Error {
  constructor(message, status = 500, code = null, retryAfterMs = null) {
    super(message);
    this.name = 'DiscordApiError';
    this.status = status;
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
    referencedMessage: m.referenced_message ? {
      id: String(m.referenced_message.id),
      content: m.referenced_message.content ?? '',
      author: normalizeUser(m.referenced_message.author),
    } : null,
    thread: m.thread ? {
      id: String(m.thread.id),
      name: m.thread.name ?? 'Thread',
      messageCount: m.thread.message_count ?? null,
    } : null,
    poll: m.poll ?? null,
    messageSnapshots: Array.isArray(m.message_snapshots) ? m.message_snapshots : [],
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
  recipients: Array.isArray(c.recipients) ? c.recipients.map(normalizeUser) : [],
});

export const createDiscordClient = ({ store, fetchImpl = fetch, apiBase = DISCORD_API_BASE } = {}) => {
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

    if (response.status === 204) return null;
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (!response.ok) {
      const msg = json?.message || text || `Discord API error (${response.status})`;
      throw new DiscordApiError(msg, response.status, json?.code ?? null);
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

  const getGuildMembers = async (guildId, limit = 100) => {
    const members = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/members?limit=${Math.min(1000, Math.max(1, Number(limit) || 100))}`);
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
      .map((r) => ({ id: String(r.id), name: r.name, color: r.color ?? 0, position: Number(r.position ?? 0), permissions: r.permissions }))
      .sort((a, b) => b.position - a.position);
  };

  const getMessages = async (channelId, { limit = 50, before, after, around } = {}) => {
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(limit) || 50))) });
    if (before) params.set('before', String(before));
    if (after) params.set('after', String(after));
    if (around) params.set('around', String(around));
    const list = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages?${params.toString()}`);
    return (Array.isArray(list) ? list : []).map(normalizeMessage).reverse();
  };

  const searchMessages = async (guildId, { content, authorId, channelId, offset = 0 } = {}) => {
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

  const sendMessage = async (channelId, { content = '', replyToMessageId, files = [] } = {}) => {
    const text = typeof content === 'string' ? content : '';
    const fileList = Array.isArray(files) ? files : [];
    const payload = {
      content: text,
      ...(replyToMessageId ? { message_reference: { message_id: String(replyToMessageId) } } : {}),
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

    if (!text.trim()) throw new DiscordApiError('Message content or files required', 400, 'EMPTY_MESSAGE');
    const created = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizeMessage(created);
  };

  const editMessage = async (channelId, messageId, { content }) => {
    const edited = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
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

  const removeReaction = (channelId, messageId, emoji) => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}/@me`,
    { method: 'DELETE' },
  );

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

  const joinThread = (threadId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members/@me`, { method: 'PUT' });

  const createChannel = async (guildId, { name, type = 0, topic, parentId } = {}) => {
    const ch = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name, type, ...(topic ? { topic } : {}), ...(parentId ? { parent_id: parentId } : {}) }),
    });
    return normalizeChannel(ch);
  };

  const updateChannel = async (channelId, patch = {}) => {
    const body = {};
    if (typeof patch.name === 'string') body.name = patch.name;
    if (typeof patch.topic === 'string') body.topic = patch.topic;
    if (patch.rateLimitPerUser !== undefined) body.rate_limit_per_user = Number(patch.rateLimitPerUser);
    const ch = await apiFetch(`/channels/${encodeURIComponent(channelId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return normalizeChannel(ch);
  };

  const updatePreferences = (patch) => store.saveConfig(patch).then(() => store.getPublicStatus());

  return {
    getStatus,
    connect,
    disconnect,
    listGuilds,
    listGuildChannels,
    listDms,
    createDm,
    getGuildMembers,
    getGuildRoles,
    getMessages,
    searchMessages,
    sendMessage,
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
    createChannel,
    updateChannel,
    updatePreferences,
  };
};
