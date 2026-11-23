import { asNonEmptyString } from '../shared/guards.js';
import { DiscordApiError } from './client.js';

const VOICE_HANDSHAKE_TIMEOUT_MS = 10_000;

export const createDiscordVoiceManager = ({
  store,
  gateway = null,
  WebSocketImpl = globalThis.WebSocket,
} = {}) => {
  const sessions = new Map();
  const pendingHandshakes = new Map();

  const cleanupSession = (guildId) => {
    const existing = sessions.get(guildId);
    if (!existing) return;
    if (existing.heartbeatTimer) clearInterval(existing.heartbeatTimer);
    if (existing.ws) {
      try { existing.ws.close(1000, 'Voice session closed'); } catch {}
    }
    sessions.delete(guildId);
  };

  const tryFinishHandshake = (guildId) => {
    const pending = pendingHandshakes.get(guildId);
    if (!pending || !pending.sessionId || !pending.token || !pending.endpoint) return;
    clearTimeout(pending.timer);
    pendingHandshakes.delete(guildId);
    pending.resolve({
      sessionId: pending.sessionId,
      token: pending.token,
      endpoint: pending.endpoint,
    });
  };

  if (gateway?.subscribeRawDispatch) {
    gateway.subscribeRawDispatch((eventType, data) => {
      const guildId = data?.guild_id ? String(data.guild_id) : null;
      if (!guildId) return;
      if (eventType === 'VOICE_STATE_UPDATE') {
        const pending = pendingHandshakes.get(guildId);
        if (pending && (!pending.botUserId || String(data?.user_id ?? '') === pending.botUserId)) {
          pending.sessionId = asNonEmptyString(data?.session_id);
          tryFinishHandshake(guildId);
        }
        const active = sessions.get(guildId);
        if (active && active.botUserId && String(data?.user_id ?? '') === active.botUserId) {
          if (!data?.channel_id) {
            cleanupSession(guildId);
          } else {
            active.channelId = String(data.channel_id);
            active.selfMute = Boolean(data.self_mute);
            active.selfDeaf = Boolean(data.self_deaf);
          }
        }
      } else if (eventType === 'VOICE_SERVER_UPDATE') {
        const pending = pendingHandshakes.get(guildId);
        if (pending) {
          pending.token = asNonEmptyString(data?.token);
          pending.endpoint = asNonEmptyString(data?.endpoint);
          tryFinishHandshake(guildId);
        }
      }
    });
  }

  const connectVoiceWebSocket = ({ guildId, channelId, userId, sessionId, token, endpoint, selfMute, selfDeaf }) => (
    new Promise((resolve, reject) => {
      if (!WebSocketImpl) {
        reject(new DiscordApiError('WebSocket implementation is unavailable for Discord Voice Gateway', 503, 'WEBSOCKET_UNAVAILABLE'));
        return;
      }
      const cleanHost = endpoint.replace(/^wss?:\/\//i, '').replace(/\/+$/, '');
      const ws = new WebSocketImpl(`wss://${cleanHost}/?v=4`);
      const session = {
        guildId,
        channelId,
        botUserId: userId,
        sessionId,
        endpoint: cleanHost,
        selfMute,
        selfDeaf,
        state: 'connecting',
        ssrc: null,
        ip: null,
        port: null,
        modes: [],
        ws,
        heartbeatTimer: null,
        connectedAt: null,
      };
      sessions.set(guildId, session);

      let settled = false;
      const failTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupSession(guildId);
        reject(new DiscordApiError('Timed out connecting to Discord Voice Gateway', 504, 'VOICE_TIMEOUT'));
      }, VOICE_HANDSHAKE_TIMEOUT_MS);
      failTimer.unref?.();

      const sendVoice = (op, d) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ op, d }));
      };

      const onOpen = () => {
        sendVoice(0, {
          server_id: guildId,
          user_id: userId,
          session_id: sessionId,
          token,
        });
      };

      const onMessage = (rawData) => {
        let packet;
        try {
          const text = asNonEmptyString(rawData) ?? String(rawData?.data ?? rawData ?? '');
          packet = JSON.parse(text);
        } catch {
          return;
        }
        if (packet.op === 8) {
          const interval = Math.max(5_000, Number(packet.d?.heartbeat_interval) || 13_750);
          if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
          session.heartbeatTimer = setInterval(() => {
            sendVoice(3, Date.now());
          }, interval);
          session.heartbeatTimer.unref?.();
        } else if (packet.op === 2) {
          session.state = 'ready';
          session.ssrc = Number(packet.d?.ssrc ?? 0);
          session.ip = asNonEmptyString(packet.d?.ip);
          session.port = Number(packet.d?.port ?? 0);
          session.modes = Array.isArray(packet.d?.modes) ? packet.d.modes.map(String) : [];
          session.connectedAt = new Date().toISOString();
          if (!settled) {
            settled = true;
            clearTimeout(failTimer);
            resolve({
              guildId: session.guildId,
              channelId: session.channelId,
              state: session.state,
              endpoint: session.endpoint,
              ssrc: session.ssrc,
              ip: session.ip,
              port: session.port,
              modes: session.modes,
              connectedAt: session.connectedAt,
            });
          }
        }
      };

      const onClose = () => {
        if (!settled) {
          settled = true;
          clearTimeout(failTimer);
          cleanupSession(guildId);
          reject(new DiscordApiError('Discord Voice Gateway closed during handshake', 503, 'VOICE_CLOSED'));
          return;
        }
        cleanupSession(guildId);
      };

      if (ws.addEventListener) {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
        ws.addEventListener('error', () => {});
      } else {
        ws.onopen = onOpen;
        ws.onmessage = onMessage;
        ws.onclose = onClose;
        ws.onerror = () => {};
      }
    })
  );

  const joinVoiceChannel = async ({ guildId, channelId, selfMute = false, selfDeaf = false } = {}) => {
    const gid = asNonEmptyString(guildId);
    const cid = asNonEmptyString(channelId);
    if (!gid || !cid) throw new DiscordApiError('guildId and channelId are required to join voice', 400, 'VOICE_PARAMS_REQUIRED');
    const state = store ? await store.read() : null;
    if (state?.tokenType !== 'bot') {
      throw new DiscordApiError('Joining Discord voice channels via Voice Gateway requires an official bot token', 403, 'BOT_ONLY_OPERATION');
    }
    if (!gateway) throw new DiscordApiError('Discord Gateway is unavailable for voice signaling', 503, 'GATEWAY_UNAVAILABLE');
    const botUserId = asNonEmptyString(state?.user?.id ? String(state.user.id) : null);
    if (!botUserId) throw new DiscordApiError('Connected bot user ID is unknown', 400, 'BOT_USER_UNKNOWN');

    cleanupSession(gid);
    const handshakePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingHandshakes.delete(gid);
        reject(new DiscordApiError('Timed out awaiting VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE from Discord Gateway', 504, 'VOICE_SIGNAL_TIMEOUT'));
      }, VOICE_HANDSHAKE_TIMEOUT_MS);
      timer.unref?.();
      pendingHandshakes.set(gid, { botUserId, sessionId: null, token: null, endpoint: null, timer, resolve, reject });
    });

    gateway.sendVoiceStateUpdate({ guildId: gid, channelId: cid, selfMute, selfDeaf });
    const creds = await handshakePromise;
    return connectVoiceWebSocket({
      guildId: gid,
      channelId: cid,
      userId: botUserId,
      sessionId: creds.sessionId,
      token: creds.token,
      endpoint: creds.endpoint,
      selfMute: Boolean(selfMute),
      selfDeaf: Boolean(selfDeaf),
    });
  };

  const leaveVoiceChannel = async ({ guildId } = {}) => {
    const gid = asNonEmptyString(guildId);
    if (!gid) throw new DiscordApiError('guildId is required to leave voice', 400, 'GUILD_ID_REQUIRED');
    cleanupSession(gid);
    if (gateway?.isConnected?.()) {
      gateway.sendVoiceStateUpdate({ guildId: gid, channelId: null, selfMute: false, selfDeaf: false });
    }
    return { ok: true, guildId: gid, disconnected: true };
  };

  const getVoiceStatus = ({ guildId = null } = {}) => {
    const gid = asNonEmptyString(guildId);
    const list = gid ? [sessions.get(gid)].filter(Boolean) : [...sessions.values()];
    return {
      sessions: list.map((s) => ({
        guildId: s.guildId,
        channelId: s.channelId,
        state: s.state,
        endpoint: s.endpoint,
        ssrc: s.ssrc,
        ip: s.ip,
        port: s.port,
        modes: s.modes,
        selfMute: s.selfMute,
        selfDeaf: s.selfDeaf,
        connectedAt: s.connectedAt,
      })),
      trackedMembers: gateway?.getVoiceStates ? gateway.getVoiceStates(gid) : [],
    };
  };

  const listVoiceMembers = ({ guildId = null, channelId = null } = {}) => ({
    members: gateway?.getVoiceStates ? gateway.getVoiceStates(guildId, channelId) : [],
  });

  return {
    joinVoiceChannel,
    leaveVoiceChannel,
    getVoiceStatus,
    listVoiceMembers,
    disconnectAll: () => {
      for (const gid of [...sessions.keys()]) cleanupSession(gid);
    },
  };
};
