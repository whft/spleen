import { normalizeChannel, normalizeMessage, normalizeUser } from './client.js';

const DEFAULT_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DEFAULT_INTENTS = 33283; // GUILDS + GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT + REACTIONS + TYPING

export const createDiscordGateway = ({
  store,
  WebSocketImpl = globalThis.WebSocket,
  gatewayUrl = DEFAULT_GATEWAY_URL,
  idleGraceMs = 60_000,
} = {}) => {
  const subscribers = new Set();
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
    sendPayload(1, seq);
  };

  const handleDispatch = (t, d) => {
    switch (t) {
      case 'READY':
        sessionId = d?.session_id ?? sessionId;
        resumeGatewayUrl = d?.resume_gateway_url ?? resumeGatewayUrl;
        connected = true;
        emit({ type: 'gateway:ready', data: { user: normalizeUser(d?.user), sessionId } });
        break;
      case 'RESUMED':
        connected = true;
        emit({ type: 'gateway:resumed', data: {} });
        break;
      case 'MESSAGE_CREATE':
        emit({ type: 'message:create', data: normalizeMessage(d) });
        break;
      case 'MESSAGE_UPDATE':
        emit({ type: 'message:update', data: normalizeMessage(d) });
        break;
      case 'MESSAGE_DELETE':
        emit({ type: 'message:delete', data: { id: String(d?.id ?? ''), channelId: String(d?.channel_id ?? '') } });
        break;
      case 'MESSAGE_REACTION_ADD':
      case 'MESSAGE_REACTION_REMOVE':
        emit({
          type: t === 'MESSAGE_REACTION_ADD' ? 'reaction:add' : 'reaction:remove',
          data: {
            channelId: String(d?.channel_id ?? ''),
            messageId: String(d?.message_id ?? ''),
            userId: String(d?.user_id ?? ''),
            emoji: d?.emoji,
          },
        });
        break;
      case 'TYPING_START':
        emit({
          type: 'typing:start',
          data: {
            channelId: String(d?.channel_id ?? ''),
            userId: String(d?.user_id ?? ''),
            timestamp: Number(d?.timestamp ?? Math.floor(Date.now() / 1000)),
          },
        });
        break;
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
      case 'THREAD_CREATE':
      case 'THREAD_UPDATE':
        emit({ type: 'channel:update', data: normalizeChannel(d) });
        break;
      default:
        break;
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

  return {
    subscribe,
    ensureConnected,
    disconnect,
    reconnect: () => {
      disconnect();
      return ensureConnected();
    },
    isConnected: () => connected,
  };
};
