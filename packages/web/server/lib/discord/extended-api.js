import { DiscordApiError, normalizeChannel, normalizeMessage, normalizeUser } from './client.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const createExtendedDiscordApi = ({ apiFetch, encodeEmoji }) => {
  const rawApi = async ({ method = 'GET', path = '/', query = null, body = undefined, reason = null } = {}) => {
    const upper = String(method || 'GET').trim().toUpperCase();
    if (!ALLOWED_METHODS.has(upper)) {
      throw new DiscordApiError(`Unsupported HTTP method: ${upper}`, 400, 'INVALID_METHOD');
    }
    const cleanPath = String(path || '').trim();
    if (!cleanPath.startsWith('/') || cleanPath.startsWith('//') || cleanPath.includes('://')) {
      throw new DiscordApiError('Discord API path must be a relative path starting with /', 400, 'INVALID_PATH');
    }
    let endpoint = cleanPath;
    if (query && typeof query === 'object' && !Array.isArray(query)) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && String(v) !== '') params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) endpoint += (endpoint.includes('?') ? '&' : '?') + qs;
    }
    const headers = reason ? { 'X-Audit-Log-Reason': encodeURIComponent(String(reason)) } : undefined;
    return apiFetch(endpoint, {
      method: upper,
      ...(headers ? { headers } : {}),
      ...(body !== undefined && upper !== 'GET' && upper !== 'DELETE' ? { body: JSON.stringify(body) } : {}),
    });
  };

  const getMe = async () => normalizeUser(await apiFetch('/users/@me'));
  const listRelationships = () => apiFetch('/users/@me/relationships');

  const getGuild = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}?with_counts=true`);

  const getGuildMember = async (guildId, userId) => {
    const m = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`);
    return {
      user: normalizeUser(m.user),
      nick: m.nick ?? null,
      roles: Array.isArray(m.roles) ? m.roles.map(String) : [],
      joinedAt: m.joined_at ?? null,
      communicationDisabledUntil: m.communication_disabled_until ?? null,
      mute: Boolean(m.mute),
      deaf: Boolean(m.deaf),
    };
  };

  const searchGuildMembers = async (guildId, query, limit = 25) => {
    const params = new URLSearchParams({ query: String(query || ''), limit: String(Math.min(1000, Math.max(1, Number(limit) || 25))) });
    const list = await apiFetch(`/guilds/${encodeURIComponent(guildId)}/members/search?${params.toString()}`);
    return (Array.isArray(list) ? list : []).map((m) => ({
      user: normalizeUser(m.user),
      nick: m.nick ?? null,
      roles: Array.isArray(m.roles) ? m.roles.map(String) : [],
      joinedAt: m.joined_at ?? null,
    }));
  };

  const updateGuildMember = (guildId, userId, patch = {}, reason = null) => {
    const body = {};
    if (patch.nick !== undefined) body.nick = patch.nick;
    if (Array.isArray(patch.roles)) body.roles = patch.roles.map(String);
    if (patch.mute !== undefined) body.mute = Boolean(patch.mute);
    if (patch.deaf !== undefined) body.deaf = Boolean(patch.deaf);
    if (patch.channelId !== undefined) body.channel_id = patch.channelId;
    if (patch.communicationDisabledUntil !== undefined) body.communication_disabled_until = patch.communicationDisabledUntil;
    return rawApi({
      method: 'PATCH',
      path: `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
      body,
      reason,
    });
  };

  const setMyNickname = (guildId, nick) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/members/@me`, {
    method: 'PATCH',
    body: JSON.stringify({ nick: nick ?? null }),
  });

  const addMemberRole = (guildId, userId, roleId, reason = null) => rawApi({
    method: 'PUT',
    path: `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    reason,
  });

  const removeMemberRole = (guildId, userId, roleId, reason = null) => rawApi({
    method: 'DELETE',
    path: `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    reason,
  });

  const createRole = (guildId, { name, color, hoist, mentionable, permissions } = {}, reason = null) => rawApi({
    method: 'POST',
    path: `/guilds/${encodeURIComponent(guildId)}/roles`,
    body: {
      ...(name !== undefined ? { name } : {}),
      ...(color !== undefined ? { color: Number(color) } : {}),
      ...(hoist !== undefined ? { hoist: Boolean(hoist) } : {}),
      ...(mentionable !== undefined ? { mentionable: Boolean(mentionable) } : {}),
      ...(permissions !== undefined ? { permissions: String(permissions) } : {}),
    },
    reason,
  });

  const updateRole = (guildId, roleId, patch = {}, reason = null) => rawApi({
    method: 'PATCH',
    path: `/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`,
    body: patch,
    reason,
  });

  const deleteRole = (guildId, roleId, reason = null) => rawApi({
    method: 'DELETE',
    path: `/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`,
    reason,
  });

  const kickMember = (guildId, userId, reason = null) => rawApi({
    method: 'DELETE',
    path: `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    reason,
  });

  const listBans = (guildId, limit = 100) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/bans?limit=${Math.min(1000, Math.max(1, Number(limit) || 100))}`);

  const banMember = (guildId, userId, { deleteMessageSeconds = 0, reason = null } = {}) => rawApi({
    method: 'PUT',
    path: `/guilds/${encodeURIComponent(guildId)}/bans/${encodeURIComponent(userId)}`,
    body: { delete_message_seconds: Math.max(0, Math.min(604800, Number(deleteMessageSeconds) || 0)) },
    reason,
  });

  const unbanMember = (guildId, userId, reason = null) => rawApi({
    method: 'DELETE',
    path: `/guilds/${encodeURIComponent(guildId)}/bans/${encodeURIComponent(userId)}`,
    reason,
  });

  const getAuditLogs = (guildId, { userId, actionType, limit = 25 } = {}) => rawApi({
    method: 'GET',
    path: `/guilds/${encodeURIComponent(guildId)}/audit-logs`,
    query: {
      user_id: userId,
      action_type: actionType,
      limit: Math.min(100, Math.max(1, Number(limit) || 25)),
    },
  });

  const setChannelPermission = (channelId, overwriteId, { type = 0, allow = '0', deny = '0', reason = null } = {}) => rawApi({
    method: 'PUT',
    path: `/channels/${encodeURIComponent(channelId)}/permissions/${encodeURIComponent(overwriteId)}`,
    body: { type: Number(type), allow: String(allow), deny: String(deny) },
    reason,
  });

  const deleteChannelPermission = (channelId, overwriteId, reason = null) => rawApi({
    method: 'DELETE',
    path: `/channels/${encodeURIComponent(channelId)}/permissions/${encodeURIComponent(overwriteId)}`,
    reason,
  });

  const bulkDeleteMessages = (channelId, messageIds, reason = null) => rawApi({
    method: 'POST',
    path: `/channels/${encodeURIComponent(channelId)}/messages/bulk-delete`,
    body: { messages: (Array.isArray(messageIds) ? messageIds : []).map(String) },
    reason,
  });

  const crosspostMessage = async (channelId, messageId) => normalizeMessage(
    await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/crosspost`, { method: 'POST' }),
  );

  const getReactions = async (channelId, messageId, emoji, limit = 50) => {
    const users = await apiFetch(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}?limit=${Math.min(100, Math.max(1, Number(limit) || 50))}`,
    );
    return (Array.isArray(users) ? users : []).map(normalizeUser);
  };

  const clearReactions = (channelId, messageId, emoji = null) => apiFetch(
    emoji
      ? `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}`
      : `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    { method: 'DELETE' },
  );

  const createPoll = async (channelId, { question, answers = [], durationHours = 24, allowMultiselect = false, content = '' } = {}) => {
    const created = await apiFetch(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...(content ? { content } : {}),
        poll: {
          question: { text: String(question || '') },
          answers: (Array.isArray(answers) ? answers : []).map((a) => (
            typeof a === 'string'
              ? { poll_media: { text: a } }
              : { poll_media: { text: String(a.text || ''), ...(a.emoji ? { emoji: a.emoji } : {}) } }
          )),
          duration: Math.max(1, Math.min(768, Number(durationHours) || 24)),
          allow_multiselect: Boolean(allowMultiselect),
        },
      }),
    });
    return normalizeMessage(created);
  };

  const endPoll = async (channelId, messageId) => normalizeMessage(
    await apiFetch(`/channels/${encodeURIComponent(channelId)}/polls/${encodeURIComponent(messageId)}/expire`, { method: 'POST' }),
  );

  const getPollVoters = async (channelId, messageId, answerId, limit = 50) => {
    const res = await apiFetch(
      `/channels/${encodeURIComponent(channelId)}/polls/${encodeURIComponent(messageId)}/answers/${encodeURIComponent(answerId)}?limit=${Math.min(100, Math.max(1, Number(limit) || 50))}`,
    );
    return { users: (Array.isArray(res?.users) ? res.users : []).map(normalizeUser) };
  };

  const listArchivedThreads = async (channelId, { type = 'public', limit = 25, before = null } = {}) => {
    const kind = type === 'private' ? 'private' : 'public';
    const res = await rawApi({
      method: 'GET',
      path: `/channels/${encodeURIComponent(channelId)}/threads/archived/${kind}`,
      query: { limit, before },
    });
    return {
      threads: (Array.isArray(res?.threads) ? res.threads : []).map(normalizeChannel),
      hasMore: Boolean(res?.has_more),
    };
  };

  const listThreadMembers = (threadId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members`);
  const addThreadMember = (threadId, userId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members/${encodeURIComponent(userId)}`, { method: 'PUT' });
  const removeThreadMember = (threadId, userId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

  const listForumPosts = async (channelId, {
    guildId = null,
    archived = false,
    limit = 25,
    before = null,
    sortBy = 'last_message_time',
    sortOrder = 'desc',
    tagIds = [],
  } = {}) => {
    const capped = Math.min(50, Math.max(1, Number(limit) || 25));
    const searchQuery = {
      archived: archived ? 'true' : 'false',
      sort_by: sortBy,
      sort_order: sortOrder,
      limit: capped,
    };
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      searchQuery.tag = tagIds.map(String).join(',');
    }
    const searchRes = await rawApi({
      method: 'GET',
      path: `/channels/${encodeURIComponent(channelId)}/threads/search`,
      query: searchQuery,
    }).catch(() => null);

    const firstByThread = new Map();
    if (Array.isArray(searchRes?.first_messages)) {
      for (const msg of searchRes.first_messages) {
        const normalized = normalizeMessage(msg);
        if (normalized?.channelId) firstByThread.set(normalized.channelId, normalized);
      }
    }

    const byId = new Map();
    if (Array.isArray(searchRes?.threads)) {
      for (const rawThread of searchRes.threads) {
        const post = normalizeChannel(rawThread);
        byId.set(post.id, { ...post, firstMessage: firstByThread.get(post.id) ?? null });
      }
    }

    let hasMore = Boolean(searchRes?.has_more);
    if (byId.size === 0) {
      if (archived) {
        const archivedRes = await listArchivedThreads(channelId, { type: 'public', limit: capped, before }).catch(() => ({ threads: [], hasMore: false }));
        hasMore = archivedRes.hasMore;
        for (const post of archivedRes.threads) {
          byId.set(post.id, { ...post, firstMessage: null });
        }
      } else {
        const [activeRes, archivedRes] = await Promise.all([
          guildId
            ? apiFetch(`/guilds/${encodeURIComponent(guildId)}/threads/active`).catch(() => ({ threads: [] }))
            : Promise.resolve({ threads: [] }),
          listArchivedThreads(channelId, { type: 'public', limit: capped, before }).catch(() => ({ threads: [], hasMore: false })),
        ]);
        const activeThreads = Array.isArray(activeRes?.threads) ? activeRes.threads : [];
        for (const rawThread of activeThreads) {
          if (String(rawThread.parent_id ?? '') !== String(channelId)) continue;
          const post = normalizeChannel(rawThread);
          byId.set(post.id, { ...post, firstMessage: null });
        }
        if (byId.size === 0) {
          hasMore = archivedRes.hasMore;
          for (const post of archivedRes.threads) {
            byId.set(post.id, { ...post, firstMessage: null });
          }
        }
      }
    }

    const filterTags = Array.isArray(tagIds) ? tagIds.map(String).filter(Boolean) : [];
    const posts = [...byId.values()]
      .filter((post) => filterTags.length === 0 || filterTags.every((tag) => post.appliedTags.includes(tag)))
      .sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        const aId = /^\d+$/.test(String(a.lastMessageId || a.id)) ? BigInt(a.lastMessageId || a.id) : 0n;
        const bId = /^\d+$/.test(String(b.lastMessageId || b.id)) ? BigInt(b.lastMessageId || b.id) : 0n;
        return bId > aId ? 1 : (bId < aId ? -1 : 0);
      });

    return { posts, hasMore };
  };

  const createForumPost = async (channelId, { name, content, embeds, appliedTags, autoArchiveDuration = 1440 } = {}) => {
    const res = await apiFetch(`/channels/${encodeURIComponent(channelId)}/threads`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        auto_archive_duration: autoArchiveDuration,
        ...(Array.isArray(appliedTags) ? { applied_tags: appliedTags.map(String) } : {}),
        message: {
          ...(content ? { content } : {}),
          ...(Array.isArray(embeds) ? { embeds } : {}),
        },
      }),
    });
    return normalizeChannel(res);
  };

  const listInvites = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/invites`);
  const createInvite = (channelId, { maxAge = 86400, maxUses = 0, temporary = false, unique = false } = {}) => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/invites`,
    {
      method: 'POST',
      body: JSON.stringify({ max_age: Number(maxAge), max_uses: Number(maxUses), temporary: Boolean(temporary), unique: Boolean(unique) }),
    },
  );
  const deleteInvite = (inviteCode) => apiFetch(`/invites/${encodeURIComponent(inviteCode)}`, { method: 'DELETE' });

  const listWebhooks = (channelId) => apiFetch(`/channels/${encodeURIComponent(channelId)}/webhooks`);
  const createWebhook = (channelId, { name } = {}) => apiFetch(`/channels/${encodeURIComponent(channelId)}/webhooks`, {
    method: 'POST',
    body: JSON.stringify({ name: String(name || 'Spleen Webhook') }),
  });
  const deleteWebhook = (webhookId) => apiFetch(`/webhooks/${encodeURIComponent(webhookId)}`, { method: 'DELETE' });
  const executeWebhook = (webhookId, webhookToken, payload = {}) => apiFetch(
    `/webhooks/${encodeURIComponent(webhookId)}/${encodeURIComponent(webhookToken)}?wait=true`,
    { method: 'POST', body: JSON.stringify(payload) },
  );

  const listScheduledEvents = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/scheduled-events?with_user_count=true`);
  const createScheduledEvent = (guildId, payload = {}) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/scheduled-events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const updateScheduledEvent = (guildId, eventId, patch = {}) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/scheduled-events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  const deleteScheduledEvent = (guildId, eventId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/scheduled-events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });

  const listEmojis = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/emojis`);
  const listStickers = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/stickers`);

  const listAutoModRules = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/auto-moderation/rules`);
  const createAutoModRule = (guildId, payload = {}) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/auto-moderation/rules`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const deleteAutoModRule = (guildId, ruleId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/auto-moderation/rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
  });

  return {
    rawApi,
    getMe,
    listRelationships,
    getGuild,
    getGuildMember,
    searchGuildMembers,
    updateGuildMember,
    setMyNickname,
    addMemberRole,
    removeMemberRole,
    createRole,
    updateRole,
    deleteRole,
    kickMember,
    listBans,
    banMember,
    unbanMember,
    getAuditLogs,
    setChannelPermission,
    deleteChannelPermission,
    bulkDeleteMessages,
    crosspostMessage,
    getReactions,
    clearReactions,
    createPoll,
    endPoll,
    getPollVoters,
    listArchivedThreads,
    listForumPosts,
    listThreadMembers,
    addThreadMember,
    removeThreadMember,
    createForumPost,
    listInvites,
    createInvite,
    deleteInvite,
    listWebhooks,
    createWebhook,
    deleteWebhook,
    executeWebhook,
    listScheduledEvents,
    createScheduledEvent,
    updateScheduledEvent,
    deleteScheduledEvent,
    listEmojis,
    listStickers,
    listAutoModRules,
    createAutoModRule,
    deleteAutoModRule,
  };
};
