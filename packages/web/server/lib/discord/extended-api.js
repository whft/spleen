import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { DiscordApiError, normalizeChannel, normalizeMessage, normalizeUser } from './client.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const buildEndpointWithQuery = (cleanPath, query) => {
  const qIndex = cleanPath.indexOf('?');
  const basePath = qIndex === -1 ? cleanPath : cleanPath.slice(0, qIndex);
  const existingQs = qIndex === -1 ? '' : cleanPath.slice(qIndex + 1);
  const params = new URLSearchParams(existingQs);

  const queryStr = asNonEmptyString(query);
  if (queryStr) {
    let parsedObj = null;
    if (queryStr.startsWith('{') && queryStr.endsWith('}')) {
      try {
        const candidate = JSON.parse(queryStr);
        if (isRecord(candidate)) parsedObj = candidate;
      } catch {
        parsedObj = null;
      }
    }
    if (parsedObj) {
      for (const [k, v] of Object.entries(parsedObj)) {
        if (v !== undefined && v !== null && String(v) !== '') params.set(k, String(v));
      }
    } else {
      const extra = new URLSearchParams(queryStr.replace(/^\?/, ''));
      for (const [k, v] of extra.entries()) params.set(k, v);
    }
  } else if (isRecord(query)) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && String(v) !== '') params.set(k, String(v));
    }
  }

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
};

const serializeRawBody = (body) => {
  const rawStr = asNonEmptyString(body);
  if (rawStr && (rawStr.startsWith('{') || rawStr.startsWith('['))) {
    try {
      return JSON.stringify(JSON.parse(rawStr));
    } catch {
      return JSON.stringify(body);
    }
  }
  return JSON.stringify(body);
};

export const createExtendedDiscordApi = ({ apiFetch, encodeEmoji }) => {
  const rawApi = async ({ method = 'GET', path = '/', query = null, body = undefined, reason = null } = {}) => {
    const upper = String(method || 'GET').trim().toUpperCase();
    if (!ALLOWED_METHODS.has(upper)) {
      throw new DiscordApiError(`Unsupported HTTP method: ${upper}`, 400, 'INVALID_METHOD');
    }
    const cleanPath = String(path || '').trim();
    if (!cleanPath.startsWith('/') || cleanPath.startsWith('//') || cleanPath.includes('://') || /(^|\/)\.\.(\/|$|\?)/.test(cleanPath)) {
      throw new DiscordApiError('Discord API path must be a relative path starting with /', 400, 'INVALID_PATH');
    }
    const endpoint = buildEndpointWithQuery(cleanPath, query);
    const requestInit = { method: upper };
    if (reason) requestInit.headers = { 'X-Audit-Log-Reason': encodeURIComponent(String(reason)) };
    if (body !== undefined && upper !== 'GET' && upper !== 'DELETE') {
      requestInit.body = serializeRawBody(body);
    }
    return apiFetch(endpoint, requestInit);
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

  const getBan = (guildId, userId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/bans/${encodeURIComponent(userId)}`);

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

  const getAuditLogs = (guildId, { userId, actionType, before, limit = 25 } = {}) => rawApi({
    method: 'GET',
    path: `/guilds/${encodeURIComponent(guildId)}/audit-logs`,
    query: {
      user_id: userId,
      action_type: actionType,
      before,
      limit: Math.min(100, Math.max(1, Number(limit) || 25)),
    },
  });

  const getUserVoiceState = (guildId, userId) => apiFetch(
    `/guilds/${encodeURIComponent(guildId)}/voice-states/${encodeURIComponent(userId)}`,
  );

  const setVoiceChannelStatus = (channelId, status = '') => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/voice-status`,
    { method: 'PUT', body: JSON.stringify({ status: String(status ?? '') }) },
  );

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

  const getReactions = async (channelId, messageId, emoji, limit = 50, after = null) => {
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(limit) || 50))) });
    if (asNonEmptyString(after)) params.set('after', String(after).trim());
    const users = await apiFetch(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeEmoji(emoji)}?${params.toString()}`,
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

  const getPollVoters = async (channelId, messageId, answerId, limit = 50, after = null) => {
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(limit) || 50))) });
    if (asNonEmptyString(after)) params.set('after', String(after).trim());
    const res = await apiFetch(
      `/channels/${encodeURIComponent(channelId)}/polls/${encodeURIComponent(messageId)}/answers/${encodeURIComponent(answerId)}?${params.toString()}`,
    );
    return { users: (Array.isArray(res?.users) ? res.users : []).map(normalizeUser) };
  };

  const listArchivedThreads = async (channelId, { type = 'public', limit = 50, before = null } = {}) => {
    const kind = type === 'private' ? 'private' : 'public';
    const capped = Math.min(100, Math.max(1, Number(limit) || 50));
    const res = await rawApi({
      method: 'GET',
      path: `/channels/${encodeURIComponent(channelId)}/threads/archived/${kind}`,
      query: { limit: capped, before },
    });
    const threads = (Array.isArray(res?.threads) ? res.threads : []).map(normalizeChannel);
    const hasMore = Boolean(res?.has_more);
    const lastThread = threads.length > 0 ? threads[threads.length - 1] : null;
    const nextBefore = hasMore ? (lastThread?.archiveTimestamp ?? lastThread?.id ?? null) : null;
    return { threads, hasMore, nextBefore };
  };

  const listThreadMembers = (threadId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members`);
  const addThreadMember = (threadId, userId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members/${encodeURIComponent(userId)}`, { method: 'PUT' });
  const removeThreadMember = (threadId, userId) => apiFetch(`/channels/${encodeURIComponent(threadId)}/thread-members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

  const listForumPosts = async (channelId, {
    guildId = null,
    archived = false,
    limit = 25,
    before = null,
    offset = 0,
    sortBy = 'last_message_time',
    sortOrder = 'desc',
    tagIds = [],
  } = {}) => {
    const filterTags = Array.isArray(tagIds) ? tagIds.map(String).filter(Boolean) : [];
    const safeOffset = Number.isFinite(Number(offset)) ? Math.max(0, Number(offset)) : 0;

    if (asNonEmptyString(before)) {
      const archivedRes = await listArchivedThreads(channelId, {
        type: 'public',
        limit: Math.min(100, Math.max(1, Number(limit) || 50)),
        before: String(before).trim(),
      });
      const posts = archivedRes.threads
        .map((post) => ({ ...post, firstMessage: null }))
        .filter((post) => filterTags.length === 0 || filterTags.every((tag) => post.appliedTags.includes(tag)));
      return {
        posts,
        hasMore: archivedRes.hasMore,
        nextBefore: archivedRes.nextBefore,
        nextOffset: null,
      };
    }

    const cappedSearch = Math.min(50, Math.max(1, Number(limit) || 25));
    const buildSearchQuery = (queryLimit) => {
      const q = {
        archived: archived ? 'true' : 'false',
        sort_by: sortBy,
        sort_order: sortOrder,
        limit: queryLimit,
      };
      if (safeOffset > 0) q.offset = safeOffset;
      if (filterTags.length > 0) q.tag = filterTags.join(',');
      return q;
    };

    let searchRes = await rawApi({
      method: 'GET',
      path: `/channels/${encodeURIComponent(channelId)}/threads/search`,
      query: buildSearchQuery(cappedSearch),
    }).catch(() => null);

    if (!searchRes && cappedSearch > 25) {
      searchRes = await rawApi({
        method: 'GET',
        path: `/channels/${encodeURIComponent(channelId)}/threads/search`,
        query: buildSearchQuery(25),
      }).catch(() => null);
    }

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
    let nextBefore = null;
    let nextOffset = null;
    const rawSearchCount = Array.isArray(searchRes?.threads) ? searchRes.threads.length : 0;

    if (searchRes && (byId.size > 0 || safeOffset > 0)) {
      if (hasMore && rawSearchCount > 0) {
        nextOffset = safeOffset + rawSearchCount;
        const lastRaw = searchRes.threads[rawSearchCount - 1];
        nextBefore = lastRaw?.thread_metadata?.archive_timestamp ?? (lastRaw?.id ? String(lastRaw.id) : null);
      }
    } else if (byId.size === 0) {
      const fallbackLimit = Math.min(100, Math.max(1, Number(limit) || 50));
      if (archived) {
        const archivedRes = await listArchivedThreads(channelId, { type: 'public', limit: fallbackLimit, before }).catch(() => ({ threads: [], hasMore: false, nextBefore: null }));
        hasMore = archivedRes.hasMore;
        nextBefore = archivedRes.nextBefore;
        for (const post of archivedRes.threads) {
          byId.set(post.id, { ...post, firstMessage: null });
        }
      } else {
        let resolvedGuildId = asNonEmptyString(guildId);
        if (!resolvedGuildId) {
          const chInfo = await apiFetch(`/channels/${encodeURIComponent(channelId)}`).catch(() => null);
          resolvedGuildId = asNonEmptyString(chInfo?.guild_id ? String(chInfo.guild_id) : null);
        }
        const [activeRes, archivedRes] = await Promise.all([
          resolvedGuildId
            ? apiFetch(`/guilds/${encodeURIComponent(resolvedGuildId)}/threads/active`).catch(() => ({ threads: [] }))
            : Promise.resolve({ threads: [] }),
          listArchivedThreads(channelId, { type: 'public', limit: fallbackLimit, before }).catch(() => ({ threads: [], hasMore: false, nextBefore: null })),
        ]);
        const activeThreads = Array.isArray(activeRes?.threads) ? activeRes.threads : [];
        for (const rawThread of activeThreads) {
          if (String(rawThread.parent_id ?? '') !== String(channelId)) continue;
          const post = normalizeChannel(rawThread);
          byId.set(post.id, { ...post, firstMessage: null });
        }
        if (byId.size === 0) {
          hasMore = archivedRes.hasMore;
          nextBefore = archivedRes.nextBefore;
          for (const post of archivedRes.threads) {
            byId.set(post.id, { ...post, firstMessage: null });
          }
        }
      }
    }

    const posts = [...byId.values()]
      .filter((post) => filterTags.length === 0 || filterTags.every((tag) => post.appliedTags.includes(tag)))
      .sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        const aId = /^\d+$/.test(String(a.lastMessageId || a.id)) ? BigInt(a.lastMessageId || a.id) : 0n;
        const bId = /^\d+$/.test(String(b.lastMessageId || b.id)) ? BigInt(b.lastMessageId || b.id) : 0n;
        return bId > aId ? 1 : (bId < aId ? -1 : 0);
      });

    return {
      posts,
      hasMore,
      nextBefore,
      nextOffset,
      totalResults: Number.isFinite(Number(searchRes?.total_results)) ? Number(searchRes.total_results) : posts.length,
    };
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
  const listChannelInvites = (channelId) => apiFetch(`/channels/${encodeURIComponent(channelId)}/invites`);
  const getInvite = (inviteCode) => apiFetch(`/invites/${encodeURIComponent(inviteCode)}?with_counts=true&with_expiration=true`);
  const createInvite = (channelId, { maxAge = 86400, maxUses = 0, temporary = false, unique = false } = {}) => apiFetch(
    `/channels/${encodeURIComponent(channelId)}/invites`,
    {
      method: 'POST',
      body: JSON.stringify({ max_age: Number(maxAge), max_uses: Number(maxUses), temporary: Boolean(temporary), unique: Boolean(unique) }),
    },
  );
  const deleteInvite = (inviteCode) => apiFetch(`/invites/${encodeURIComponent(inviteCode)}`, { method: 'DELETE' });

  const listWebhooks = (channelId) => apiFetch(`/channels/${encodeURIComponent(channelId)}/webhooks`);
  const listGuildWebhooks = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/webhooks`);
  const createWebhook = (channelId, { name } = {}) => apiFetch(`/channels/${encodeURIComponent(channelId)}/webhooks`, {
    method: 'POST',
    body: JSON.stringify({ name: String(name || 'Spleen Webhook') }),
  });
  const updateWebhook = (webhookId, patch = {}, reason = null) => rawApi({
    method: 'PATCH',
    path: `/webhooks/${encodeURIComponent(webhookId)}`,
    body: patch,
    reason,
  });
  const deleteWebhook = (webhookId) => apiFetch(`/webhooks/${encodeURIComponent(webhookId)}`, { method: 'DELETE' });
  const executeWebhook = (webhookId, webhookToken, payload = {}, { threadId = null } = {}) => {
    const params = new URLSearchParams({ wait: 'true' });
    if (asNonEmptyString(threadId)) params.set('thread_id', String(threadId).trim());
    return apiFetch(
      `/webhooks/${encodeURIComponent(webhookId)}/${encodeURIComponent(webhookToken)}?${params.toString()}`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
  };

  const listScheduledEvents = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/scheduled-events?with_user_count=true`);
  const listEventUsers = (guildId, eventId, { limit = 100, before, after, withMember = false } = {}) => rawApi({
    method: 'GET',
    path: `/guilds/${encodeURIComponent(guildId)}/scheduled-events/${encodeURIComponent(eventId)}/users`,
    query: {
      limit: Math.min(100, Math.max(1, Number(limit) || 100)),
      before,
      after,
      with_member: withMember ? 'true' : undefined,
    },
  });
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
  const createEmoji = (guildId, payload = {}, reason = null) => rawApi({
    method: 'POST',
    path: `/guilds/${encodeURIComponent(guildId)}/emojis`,
    body: payload,
    reason,
  });
  const updateEmoji = (guildId, emojiId, patch = {}, reason = null) => rawApi({
    method: 'PATCH',
    path: `/guilds/${encodeURIComponent(guildId)}/emojis/${encodeURIComponent(emojiId)}`,
    body: patch,
    reason,
  });
  const deleteEmoji = (guildId, emojiId, reason = null) => rawApi({
    method: 'DELETE',
    path: `/guilds/${encodeURIComponent(guildId)}/emojis/${encodeURIComponent(emojiId)}`,
    reason,
  });
  const listStickers = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/stickers`);
  const listSoundboardSounds = (guildId = null) => (
    asNonEmptyString(guildId)
      ? apiFetch(`/guilds/${encodeURIComponent(guildId)}/soundboard-sounds`)
      : apiFetch('/soundboard-default-sounds')
  );

  const getGuildWidget = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/widget`);
  const updateGuildWidget = (guildId, patch = {}, reason = null) => rawApi({
    method: 'PATCH',
    path: `/guilds/${encodeURIComponent(guildId)}/widget`,
    body: patch,
    reason,
  });
  const getGuildOnboarding = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/onboarding`);
  const updateGuildOnboarding = (guildId, patch = {}, reason = null) => rawApi({
    method: 'PUT',
    path: `/guilds/${encodeURIComponent(guildId)}/onboarding`,
    body: patch,
    reason,
  });
  const getGuildWelcomeScreen = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/welcome-screen`);
  const updateGuildWelcomeScreen = (guildId, patch = {}, reason = null) => rawApi({
    method: 'PATCH',
    path: `/guilds/${encodeURIComponent(guildId)}/welcome-screen`,
    body: patch,
    reason,
  });
  const listGuildTemplates = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/templates`);
  const createGuildTemplate = (guildId, { name, description = null } = {}) => rawApi({
    method: 'POST',
    path: `/guilds/${encodeURIComponent(guildId)}/templates`,
    body: { name: String(name || 'Template'), description },
  });
  const syncGuildTemplate = (guildId, code) => rawApi({
    method: 'PUT',
    path: `/guilds/${encodeURIComponent(guildId)}/templates/${encodeURIComponent(code)}`,
  });
  const deleteGuildTemplate = (guildId, code) => rawApi({
    method: 'DELETE',
    path: `/guilds/${encodeURIComponent(guildId)}/templates/${encodeURIComponent(code)}`,
  });
  const getGuildPruneCount = (guildId, { days = 7, includeRoles = [] } = {}) => rawApi({
    method: 'GET',
    path: `/guilds/${encodeURIComponent(guildId)}/prune`,
    query: {
      days: Math.min(30, Math.max(1, Number(days) || 7)),
      include_roles: Array.isArray(includeRoles) && includeRoles.length > 0 ? includeRoles.map(String).join(',') : undefined,
    },
  });
  const pruneGuild = (guildId, { days = 7, computePruneCount = true, includeRoles = [], reason = null } = {}) => rawApi({
    method: 'POST',
    path: `/guilds/${encodeURIComponent(guildId)}/prune`,
    body: {
      days: Math.min(30, Math.max(1, Number(days) || 7)),
      compute_prune_count: Boolean(computePruneCount),
      include_roles: Array.isArray(includeRoles) ? includeRoles.map(String) : [],
    },
    reason,
  });
  const leaveGuild = (guildId) => apiFetch(`/users/@me/guilds/${encodeURIComponent(guildId)}`, { method: 'DELETE' });

  const listSkus = (applicationId) => apiFetch(`/applications/${encodeURIComponent(applicationId)}/skus`);
  const listEntitlements = (applicationId, query = {}) => rawApi({
    method: 'GET',
    path: `/applications/${encodeURIComponent(applicationId)}/entitlements`,
    query,
  });
  const createTestEntitlement = (applicationId, payload = {}) => rawApi({
    method: 'POST',
    path: `/applications/${encodeURIComponent(applicationId)}/entitlements`,
    body: payload,
  });
  const consumeEntitlement = (applicationId, entitlementId) => rawApi({
    method: 'POST',
    path: `/applications/${encodeURIComponent(applicationId)}/entitlements/${encodeURIComponent(entitlementId)}/consume`,
  });

  const listAutoModRules = (guildId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/auto-moderation/rules`);
  const createAutoModRule = (guildId, payload = {}) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/auto-moderation/rules`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const updateAutoModRule = (guildId, ruleId, patch = {}, reason = null) => rawApi({
    method: 'PATCH',
    path: `/guilds/${encodeURIComponent(guildId)}/auto-moderation/rules/${encodeURIComponent(ruleId)}`,
    body: patch,
    reason,
  });
  const deleteAutoModRule = (guildId, ruleId) => apiFetch(`/guilds/${encodeURIComponent(guildId)}/auto-moderation/rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
  });

  const getApplication = () => apiFetch('/applications/@me');

  return {
    rawApi,
    getMe,
    getApplication,
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
    getBan,
    banMember,
    unbanMember,
    getAuditLogs,
    getUserVoiceState,
    setVoiceChannelStatus,
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
    listChannelInvites,
    getInvite,
    createInvite,
    deleteInvite,
    listWebhooks,
    listGuildWebhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    executeWebhook,
    listScheduledEvents,
    listEventUsers,
    createScheduledEvent,
    updateScheduledEvent,
    deleteScheduledEvent,
    listEmojis,
    createEmoji,
    updateEmoji,
    deleteEmoji,
    listStickers,
    listSoundboardSounds,
    getGuildWidget,
    updateGuildWidget,
    getGuildOnboarding,
    updateGuildOnboarding,
    getGuildWelcomeScreen,
    updateGuildWelcomeScreen,
    listGuildTemplates,
    createGuildTemplate,
    syncGuildTemplate,
    deleteGuildTemplate,
    getGuildPruneCount,
    pruneGuild,
    leaveGuild,
    listSkus,
    listEntitlements,
    createTestEntitlement,
    consumeEntitlement,
    listAutoModRules,
    createAutoModRule,
    updateAutoModRule,
    deleteAutoModRule,
  };
};
