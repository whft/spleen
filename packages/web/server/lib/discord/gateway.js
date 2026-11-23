import { asNonEmptyString } from '../shared/guards.js';
import { DiscordApiError, normalizeChannel, normalizeMessage, normalizeUser } from './client.js';

const DEFAULT_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DEFAULT_INTENTS = 53606125;
const VALID_PRESENCE_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);

const GATEWAY_EVENT_MAP = Object.freeze({
  GUILD_CREATE: 'guild:create',
  GUILD_UPDATE: 'guild:update',
  GUILD_DELETE: 'guild:delete',
  CHANNEL_DELETE: 'channel:delete',
  CHANNEL_PINS_UPDATE: 'channel:pins_update',
  MESSAGE_DELETE_BULK: 'message:delete_bulk',
  MESSAGE_REACTION_REMOVE_ALL: 'reaction:remove_all',
  MESSAGE_REACTION_REMOVE_EMOJI: 'reaction:remove_emoji',
  MESSAGE_POLL_VOTE_ADD: 'poll:vote_add',
  MESSAGE_POLL_VOTE_REMOVE: 'poll:vote_remove',
  THREAD_DELETE: 'thread:delete',
  THREAD_LIST_SYNC: 'thread:list_sync',
  THREAD_MEMBER_UPDATE: 'thread:member_update',
  THREAD_MEMBERS_UPDATE: 'thread:members_update',
  GUILD_MEMBER_ADD: 'member:add',
  GUILD_MEMBER_REMOVE: 'member:remove',
  GUILD_MEMBER_UPDATE: 'member:update',
  GUILD_MEMBERS_CHUNK: 'member:chunk',
  GUILD_ROLE_CREATE: 'role:create',
  GUILD_ROLE_UPDATE: 'role:update',
  GUILD_ROLE_DELETE: 'role:delete',
  GUILD_BAN_ADD: 'ban:add',
  GUILD_BAN_REMOVE: 'ban:remove',
  INVITE_CREATE: 'invite:create',
  INVITE_DELETE: 'invite:delete',
  INTEGRATION_CREATE: 'integration:create',
  INTEGRATION_UPDATE: 'integration:update',
  INTEGRATION_DELETE: 'integration:delete',
  WEBHOOKS_UPDATE: 'webhook:update',
  GUILD_SCHEDULED_EVENT_CREATE: 'event:create',
  GUILD_SCHEDULED_EVENT_UPDATE: 'event:update',
  GUILD_SCHEDULED_EVENT_DELETE: 'event:delete',
  GUILD_SCHEDULED_EVENT_USER_ADD: 'event:user_add',
  GUILD_SCHEDULED_EVENT_USER_REMOVE: 'event:user_remove',
  AUTO_MODERATION_RULE_CREATE: 'automod:rule_create',
  AUTO_MODERATION_RULE_UPDATE: 'automod:rule_update',
  AUTO_MODERATION_RULE_DELETE: 'automod:rule_delete',
  AUTO_MODERATION_ACTION_EXECUTION: 'automod:action',
  INTERACTION_CREATE: 'interaction:create',
  PRESENCE_UPDATE: 'presence:update',
  VOICE_STATE_UPDATE: 'voice:state_update',
  VOICE_SERVER_UPDATE: 'voice:server_update',
  VOICE_CHANNEL_STATUS_UPDATE: 'voice:channel_status',
  VOICE_CHANNEL_EFFECT_SEND: 'voice:effect',
  GUILD_SOUNDBOARD_SOUND_CREATE: 'soundboard:create',
  GUILD_SOUNDBOARD_SOUND_UPDATE: 'soundboard:update',
  GUILD_SOUNDBOARD_SOUND_DELETE: 'soundboard:delete',
  GUILD_SOUNDBOARD_SOUNDS_UPDATE: 'soundboard:list_update',
  STAGE_INSTANCE_CREATE: 'stage:create',
  STAGE_INSTANCE_UPDATE: 'stage:update',
  STAGE_INSTANCE_DELETE: 'stage:delete',
  GUILD_EMOJIS_UPDATE: 'emoji:update',
  GUILD_STICKERS_UPDATE: 'sticker:update',
  APPLICATION_COMMAND_PERMISSIONS_UPDATE: 'command:permissions_update',
  GUILD_AUDIT_LOG_ENTRY_CREATE: 'audit:entry_create',
  ENTITLEMENT_CREATE: 'entitlement:create',
  ENTITLEMENT_UPDATE: 'entitlement:update',
  ENTITLEMENT_DELETE: 'entitlement:delete',
  SUBSCRIPTION_CREATE: 'subscription:create',
  SUBSCRIPTION_UPDATE: 'subscription:update',
  SUBSCRIPTION_DELETE: 'subscription:delete',
});

export const createDiscordGateway = ({
  store,
  WebSocketImpl = globalThis.WebSocket,
  gatewayUrl = DEFAULT_GATEWAY_URL,
  idleGraceMs = 60_000,
  maxBufferedEvents = 500,
} = {}) => {
  const subscribers = new Set();
  const rawDispatchSubscribers = new Set();
  const eventBuffer = [];
  const voiceStatesByGuild = new Map();
  let ws = null;
  let heartbeatTimer = null;
  let idleTimer = null;
  let reconnectTimer = null;
  let seq = null;
  let sessionId = null;
  let resumeGatewayUrl = null;
  let ackPending = false;
  let connected = false;
  let activeGeneration = 0;
  let lastHeartbeatSentAt = null;
  let lastHeartbeatAckAt = null;
  let latencyMs = null;
  let reconnectCount = 0;
  let eventsReceived = 0;
  let interactionHandler = null;

  const recordBufferedEvent = (rawType, mappedType, payload) => {
    eventsReceived += 1;
    eventBuffer.push({
      seq,
      rawType,
      type: mappedType,
      guildId: payload?.guild_id ? String(payload.guild_id) : (payload?.guildId ? String(payload.guildId) : null),
      channelId: payload?.channel_id ? String(payload.channel_id) : (payload?.channelId ? String(payload.channelId) : null),
      timestamp: new Date().toISOString(),
      data: payload,
    });
    if (eventBuffer.length > maxBufferedEvents) {
      eventBuffer.splice(0, eventBuffer.length - maxBufferedEvents);
    }
  };

  const trackVoiceState = (vs) => {
    const guildId = vs?.guild_id ? String(vs.guild_id) : null;
    const userId = vs?.user_id ? String(vs.user_id) : null;
    if (!guildId || !userId) return;
    let map = voiceStatesByGuild.get(guildId);
    if (!map) {
      map = new Map();
      voiceStatesByGuild.set(guildId, map);
    }
    if (!vs.channel_id) {
      map.delete(userId);
      return;
    }
    map.set(userId, {
      guildId,
      userId,
      channelId: String(vs.channel_id),
      sessionId: vs.session_id ? String(vs.session_id) : null,
      deaf: Boolean(vs.deaf),
      mute: Boolean(vs.mute),
      selfDeaf: Boolean(vs.self_deaf),
      selfMute: Boolean(vs.self_mute),
      selfStream: Boolean(vs.self_stream),
      selfVideo: Boolean(vs.self_video),
      suppress: Boolean(vs.suppress),
      requestToSpeakTimestamp: vs.request_to_speak_timestamp ?? null,
    });
  };

  const emit = (event) => {
    for (const listener of subscribers) {
      try {
        listener(event);
      } catch {
        // isolate subscriber failures
      }
    }
  };

  const clearTimers = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeatTimer = null;
    reconnectTimer = null;
  };

  const sendPayload = (op, d) => {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ op, d }));
    return true;
  };

  const sendHeartbeat = () => {
    if (!ws || ws.readyState !== 1) return;
    if (ackPending) {
      try { ws.close(4000, 'Heartbeat ACK timeout'); } catch { /* ignore */ }
      return;
    }
    ackPending = true;
    lastHeartbeatSentAt = Date.now();
    sendPayload(1, seq);
  };

  const handleDispatch = (t, d) => {
    for (const listener of rawDispatchSubscribers) {
      try { listener(t, d); } catch {}
    }
    switch (t) {
      case 'READY':
        sessionId = d?.session_id ?? sessionId;
        resumeGatewayUrl = d?.resume_gateway_url ?? resumeGatewayUrl;
        connected = true;
        recordBufferedEvent(t, 'gateway:ready', { user: normalizeUser(d?.user), sessionId });
        emit({ type: 'gateway:ready', data: { user: normalizeUser(d?.user), sessionId } });
        break;
      case 'RESUMED':
        connected = true;
        recordBufferedEvent(t, 'gateway:resumed', {});
        emit({ type: 'gateway:resumed', data: {} });
        break;
      case 'MESSAGE_CREATE': {
        const msg = normalizeMessage(d);
        recordBufferedEvent(t, 'message:create', msg);
        emit({ type: 'message:create', data: msg });
        break;
      }
      case 'MESSAGE_UPDATE': {
        const msg = normalizeMessage(d);
        recordBufferedEvent(t, 'message:update', msg);
        emit({ type: 'message:update', data: msg });
        break;
      }
      case 'MESSAGE_DELETE': {
        const payload = { id: String(d?.id ?? ''), channelId: String(d?.channel_id ?? ''), guildId: d?.guild_id ? String(d.guild_id) : null };
        recordBufferedEvent(t, 'message:delete', payload);
        emit({ type: 'message:delete', data: payload });
        break;
      }
      case 'MESSAGE_REACTION_ADD':
      case 'MESSAGE_REACTION_REMOVE': {
        const mapped = t === 'MESSAGE_REACTION_ADD' ? 'reaction:add' : 'reaction:remove';
        const payload = {
          channelId: String(d?.channel_id ?? ''),
          guildId: d?.guild_id ? String(d.guild_id) : null,
          messageId: String(d?.message_id ?? ''),
          userId: String(d?.user_id ?? ''),
          emoji: d?.emoji,
        };
        recordBufferedEvent(t, mapped, payload);
        emit({ type: mapped, data: payload });
        break;
      }
      case 'TYPING_START': {
        const payload = {
          channelId: String(d?.channel_id ?? ''),
          guildId: d?.guild_id ? String(d.guild_id) : null,
          userId: String(d?.user_id ?? ''),
          timestamp: Number(d?.timestamp ?? Math.floor(Date.now() / 1000)),
        };
        recordBufferedEvent(t, 'typing:start', payload);
        emit({ type: 'typing:start', data: payload });
        break;
      }
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
      case 'THREAD_CREATE':
      case 'THREAD_UPDATE': {
        const ch = normalizeChannel(d);
        recordBufferedEvent(t, 'channel:update', ch);
        emit({ type: 'channel:update', data: ch });
        break;
      }
      case 'GUILD_CREATE': {
        if (Array.isArray(d?.voice_states)) {
          for (const vs of d.voice_states) {
            trackVoiceState({ ...vs, guild_id: d.id });
          }
        }
        recordBufferedEvent(t, 'guild:create', d);
        emit({ type: 'guild:create', data: { id: String(d?.id ?? ''), name: d?.name ?? '' } });
        break;
      }
      case 'VOICE_STATE_UPDATE': {
        trackVoiceState(d);
        recordBufferedEvent(t, 'voice:state_update', d);
        emit({ type: 'voice:state_update', data: d });
        break;
      }
      case 'INTERACTION_CREATE': {
        if (interactionHandler) {
          try { interactionHandler(d); } catch {}
        }
        recordBufferedEvent(t, 'interaction:create', d);
        emit({ type: 'interaction:create', data: d });
        break;
      }
      default: {
        const mapped = GATEWAY_EVENT_MAP[t];
        if (mapped) {
          recordBufferedEvent(t, mapped, d);
          emit({ type: mapped, data: d });
        }
        break;
      }
    }
  };

  const scheduleReconnect = (delayMs = 2_000) => {
    if (subscribers.size === 0 || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected();
    }, delayMs);
    reconnectTimer.unref?.();
  };

  const disconnect = () => {
    activeGeneration += 1;
    clearTimers();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    connected = false;
    ackPending = false;
    if (ws) {
      try { ws.close(1000, 'Idle disconnect'); } catch { /* ignore */ }
      ws = null;
    }
  };

  const ensureConnected = async () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (ws || subscribers.size === 0 || typeof WebSocketImpl !== 'function') return false;
    const state = await store.read();
    if (!state?.token) return false;

    const gen = ++activeGeneration;
    const url = sessionId && resumeGatewayUrl
      ? `${resumeGatewayUrl.replace(/\/$/, '')}/?v=10&encoding=json`
      : gatewayUrl;
    const socket = new WebSocketImpl(url);
    ws = socket;
    ackPending = false;

    const sendIdentifyOrResume = () => {
      if (sessionId && seq !== null) {
        sendPayload(6, { token: state.token, session_id: sessionId, seq });
      } else {
        sendPayload(2, {
          token: state.token,
          ...(state.tokenType === 'bot' ? { intents: DEFAULT_INTENTS } : {}),
          properties: { os: 'windows', browser: 'Spleen', device: 'Spleen' },
        });
      }
    };

    const onMessage = (rawData) => {
      if (gen !== activeGeneration) return;
      let packet;
      try {
        const text = typeof rawData === 'string' ? rawData : String(rawData?.data ?? rawData ?? '');
        packet = JSON.parse(text);
      } catch {
        return;
      }
      if (Number.isInteger(packet.s)) seq = packet.s;
      switch (packet.op) {
        case 10: {
          const interval = Math.max(5_000, Number(packet.d?.heartbeat_interval) || 41_250);
          clearTimers();
          heartbeatTimer = setInterval(sendHeartbeat, interval);
          heartbeatTimer.unref?.();
          sendIdentifyOrResume();
          break;
        }
        case 11:
          ackPending = false;
          lastHeartbeatAckAt = Date.now();
          if (lastHeartbeatSentAt) latencyMs = Math.max(0, lastHeartbeatAckAt - lastHeartbeatSentAt);
          break;
        case 1:
          sendHeartbeat();
          break;
        case 7:
          try { socket.close(4001, 'Reconnect requested'); } catch { /* ignore */ }
          break;
        case 9:
          if (!packet.d) {
            sessionId = null;
            seq = null;
          }
          try { socket.close(4002, 'Invalid session'); } catch { /* ignore */ }
          break;
        case 0:
          handleDispatch(packet.t, packet.d);
          break;
        default:
          break;
      }
    };

    const onClose = () => {
      if (gen !== activeGeneration) return;
      clearTimers();
      connected = false;
      ws = null;
      if (subscribers.size > 0) scheduleReconnect();
    };

    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', () => {});
    } else {
      socket.onmessage = onMessage;
      socket.onclose = onClose;
      socket.onerror = () => {};
    }
    return true;
  };

  const subscribe = (listener) => {
    subscribers.add(listener);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    void ensureConnected();
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0 && !idleTimer) {
        idleTimer = setTimeout(() => {
          idleTimer = null;
          if (subscribers.size === 0) disconnect();
        }, idleGraceMs);
        idleTimer.unref?.();
      }
    };
  };

  const setPresence = async ({ status = 'online', activities = [], since = null, afk = false } = {}) => {
    const state = store ? await store.read() : null;
    if (state?.tokenType !== 'bot') {
      throw new DiscordApiError('Presence updates via OP 3 are restricted to official bot tokens', 403, 'BOT_ONLY_OPERATION');
    }
    const cleanStatus = asNonEmptyString(status) || 'online';
    if (!VALID_PRESENCE_STATUSES.has(cleanStatus)) {
      throw new DiscordApiError(`Unsupported presence status: ${cleanStatus}`, 400, 'INVALID_STATUS');
    }
    const cleanActivities = (Array.isArray(activities) ? activities : []).map((act) => {
      const entry = { name: String(act?.name ?? ''), type: Number(act?.type ?? 0) };
      if (asNonEmptyString(act?.url)) entry.url = String(act.url).trim();
      return entry;
    });
    const sent = sendPayload(3, {
      since: since === null || since === undefined ? null : Number(since),
      activities: cleanActivities,
      status: cleanStatus,
      afk: Boolean(afk),
    });
    if (!sent) {
      throw new DiscordApiError('Discord Gateway is not currently connected', 503, 'GATEWAY_DISCONNECTED');
    }
    return { ok: true, status: cleanStatus, activities: cleanActivities, afk: Boolean(afk) };
  };

  const sendVoiceStateUpdate = ({ guildId, channelId = null, selfMute = false, selfDeaf = false }) => {
    const gid = asNonEmptyString(guildId);
    if (!gid) throw new DiscordApiError('guildId is required for voice state update', 400, 'GUILD_ID_REQUIRED');
    const sent = sendPayload(4, {
      guild_id: gid,
      channel_id: asNonEmptyString(channelId),
      self_mute: Boolean(selfMute),
      self_deaf: Boolean(selfDeaf),
    });
    if (!sent) {
      throw new DiscordApiError('Discord Gateway is not currently connected', 503, 'GATEWAY_DISCONNECTED');
    }
    return true;
  };

  const listEvents = ({ eventType = null, guildId = null, channelId = null, limit = 50 } = {}) => {
    const capped = Math.min(maxBufferedEvents, Math.max(1, Number(limit) || 50));
    const typeNeedle = asNonEmptyString(eventType);
    const gid = asNonEmptyString(guildId);
    const cid = asNonEmptyString(channelId);
    const filtered = eventBuffer.filter((evt) => {
      if (typeNeedle && evt.type !== typeNeedle && evt.rawType !== typeNeedle) return false;
      if (gid && evt.guildId !== gid) return false;
      if (cid && evt.channelId !== cid) return false;
      return true;
    });
    return filtered.slice(-capped).reverse();
  };

  const getVoiceStates = (guildId = null, channelId = null) => {
    const gid = asNonEmptyString(guildId);
    const cid = asNonEmptyString(channelId);
    const out = [];
    const targetGuilds = gid ? [voiceStatesByGuild.get(gid)].filter(Boolean) : [...voiceStatesByGuild.values()];
    for (const map of targetGuilds) {
      for (const vs of map.values()) {
        if (cid && vs.channelId !== cid) continue;
        out.push(vs);
      }
    }
    return out;
  };

  const subscribeRawDispatch = (listener) => {
    rawDispatchSubscribers.add(listener);
    return () => rawDispatchSubscribers.delete(listener);
  };

  const setInteractionHandler = (handler) => {
    interactionHandler = handler;
  };

  const getHealth = () => ({
    connected,
    sessionId,
    seq,
    latencyMs,
    lastHeartbeatSentAt: lastHeartbeatSentAt ? new Date(lastHeartbeatSentAt).toISOString() : null,
    lastHeartbeatAckAt: lastHeartbeatAckAt ? new Date(lastHeartbeatAckAt).toISOString() : null,
    reconnectCount,
    eventsReceived,
    bufferedEvents: eventBuffer.length,
    trackedVoiceStates: getVoiceStates().length,
  });

  return {
    subscribe,
    subscribeRawDispatch,
    setInteractionHandler,
    ensureConnected,
    disconnect,
    reconnect: () => {
      reconnectCount += 1;
      disconnect();
      return ensureConnected();
    },
    isConnected: () => connected,
    setPresence,
    sendVoiceStateUpdate,
    listEvents,
    getVoiceStates,
    getHealth,
  };
};
