import crypto from 'node:crypto';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { DiscordApiError } from './client.js';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export const COMPONENTS_V2_FLAG = 1 << 15;
const COMPONENTS_V2_TYPES = new Set([9, 10, 11, 12, 13, 14, 17]);

export const hasComponentsV2 = (components) => {
  if (!Array.isArray(components)) return false;
  for (const item of components) {
    if (!isRecord(item)) continue;
    if (COMPONENTS_V2_TYPES.has(Number(item.type))) return true;
    if (Array.isArray(item.components) && hasComponentsV2(item.components)) return true;
  }
  return false;
};

export const ensureComponentsV2Flags = (components, flags) => {
  const base = Number.isFinite(Number(flags)) ? Number(flags) : 0;
  if (!hasComponentsV2(components)) return flags;
  return base | COMPONENTS_V2_FLAG;
};

export const verifyDiscordSignature = ({ publicKeyHex, signatureHex, timestamp, rawBody }) => {
  const pkHex = asNonEmptyString(publicKeyHex);
  const sigHex = asNonEmptyString(signatureHex);
  const ts = asNonEmptyString(timestamp);
  if (!pkHex || !sigHex || !ts) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(pkHex) || !/^[0-9a-fA-F]{128}$/.test(sigHex)) return false;
  try {
    const keyDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pkHex, 'hex')]);
    const publicKey = crypto.createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
    const message = Buffer.concat([Buffer.from(ts, 'utf8'), bodyBuf]);
    const signature = Buffer.from(sigHex, 'hex');
    return crypto.verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
};

export const createDiscordInteractionsManager = ({ apiFetch, store, maxInbox = 200 } = {}) => {
  const inbox = [];
  let cachedApplicationId = null;

  const resolveApplicationId = async (explicitAppId = null) => {
    const explicit = asNonEmptyString(explicitAppId);
    if (explicit) return explicit;
    const state = store ? await store.read() : null;
    const storedAppId = asNonEmptyString(state?.applicationId);
    if (storedAppId) return storedAppId;
    if (cachedApplicationId) return cachedApplicationId;
    const app = await apiFetch('/applications/@me');
    const fetchedId = asNonEmptyString(app?.id ? String(app.id) : null);
    if (!fetchedId) throw new DiscordApiError('Could not resolve Discord applicationId', 400, 'APPLICATION_ID_REQUIRED');
    cachedApplicationId = fetchedId;
    return fetchedId;
  };

  const commandBasePath = (appId, guildId) => (
    asNonEmptyString(guildId)
      ? `/applications/${encodeURIComponent(appId)}/guilds/${encodeURIComponent(guildId)}/commands`
      : `/applications/${encodeURIComponent(appId)}/commands`
  );

  const listCommands = async ({ applicationId = null, guildId = null } = {}) => {
    const appId = await resolveApplicationId(applicationId);
    return apiFetch(commandBasePath(appId, guildId));
  };

  const upsertCommand = async ({ applicationId = null, guildId = null, commandId = null, command = {} } = {}) => {
    const appId = await resolveApplicationId(applicationId);
    const base = commandBasePath(appId, guildId);
    const cmdId = asNonEmptyString(commandId);
    if (cmdId) {
      return apiFetch(`${base}/${encodeURIComponent(cmdId)}`, {
        method: 'PATCH',
        body: JSON.stringify(command),
      });
    }
    return apiFetch(base, {
      method: 'POST',
      body: JSON.stringify(command),
    });
  };

  const bulkOverwriteCommands = async ({ applicationId = null, guildId = null, commands = [] } = {}) => {
    const appId = await resolveApplicationId(applicationId);
    return apiFetch(commandBasePath(appId, guildId), {
      method: 'PUT',
      body: JSON.stringify(Array.isArray(commands) ? commands : []),
    });
  };

  const deleteCommand = async ({ applicationId = null, guildId = null, commandId }) => {
    const appId = await resolveApplicationId(applicationId);
    const cmdId = asNonEmptyString(commandId);
    if (!cmdId) throw new DiscordApiError('commandId is required', 400, 'COMMAND_ID_REQUIRED');
    await apiFetch(`${commandBasePath(appId, guildId)}/${encodeURIComponent(cmdId)}`, { method: 'DELETE' });
    return { ok: true, applicationId: appId, guildId: asNonEmptyString(guildId), commandId: cmdId };
  };

  const recordInboundInteraction = (payload = {}) => {
    const id = String(payload?.id ?? '');
    if (!id) return null;
    const existing = inbox.find((item) => item.id === id);
    if (existing) return existing;
    const now = Date.now();
    const entry = {
      id,
      applicationId: payload?.application_id ? String(payload.application_id) : null,
      type: Number(payload?.type ?? 0),
      token: asNonEmptyString(payload?.token),
      guildId: payload?.guild_id ? String(payload.guild_id) : null,
      channelId: payload?.channel_id ? String(payload.channel_id) : null,
      user: payload?.member?.user ?? payload?.user ?? null,
      data: payload?.data ?? null,
      message: payload?.message ? { id: String(payload.message.id), content: payload.message.content ?? '' } : null,
      receivedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 15 * 60_000).toISOString(),
      acknowledged: false,
    };
    inbox.push(entry);
    if (inbox.length > maxInbox) inbox.splice(0, inbox.length - maxInbox);
    return entry;
  };

  const handleHttpInteraction = async ({ rawBody, signature, timestamp, publicKeyHex = null, autoDefer = true } = {}) => {
    const state = store ? await store.read() : null;
    const key = asNonEmptyString(publicKeyHex) || asNonEmptyString(state?.publicKey);
    if (!key) {
      throw new DiscordApiError('Discord application publicKey is not configured for interaction verification', 503, 'PUBLIC_KEY_REQUIRED');
    }
    if (!verifyDiscordSignature({ publicKeyHex: key, signatureHex: signature, timestamp, rawBody })) {
      throw new DiscordApiError('Invalid Discord Ed25519 interaction signature', 401, 'INVALID_SIGNATURE');
    }
    let payload;
    try {
      const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
      payload = JSON.parse(text);
    } catch {
      throw new DiscordApiError('Invalid JSON interaction payload', 400, 'INVALID_PAYLOAD');
    }
    const kind = Number(payload?.type ?? 0);
    if (kind === 1) {
      return { status: 200, body: { type: 1 }, interaction: null };
    }
    const entry = recordInboundInteraction(payload);
    if (!autoDefer) {
      return { status: 200, body: { type: 5 }, interaction: entry };
    }
    if (kind === 3) {
      if (entry) entry.acknowledged = true;
      return { status: 200, body: { type: 6 }, interaction: entry };
    }
    if (kind === 4) {
      if (entry) entry.acknowledged = true;
      return { status: 200, body: { type: 8, data: { choices: [] } }, interaction: entry };
    }
    if (entry) entry.acknowledged = true;
    return { status: 200, body: { type: 5 }, interaction: entry };
  };

  const listInteractions = ({ limit = 25, unhandledOnly = false } = {}) => {
    const capped = Math.min(maxInbox, Math.max(1, Number(limit) || 25));
    const filtered = unhandledOnly ? inbox.filter((item) => !item.acknowledged) : inbox;
    return filtered.slice(-capped).reverse().map((item) => ({
      id: item.id,
      applicationId: item.applicationId,
      type: item.type,
      interactionToken: item.token,
      guildId: item.guildId,
      channelId: item.channelId,
      user: item.user,
      data: item.data,
      message: item.message,
      receivedAt: item.receivedAt,
      expiresAt: item.expiresAt,
      acknowledged: item.acknowledged,
    }));
  };

  const respondInteraction = async ({ interactionId, interactionToken, type = 4, data = undefined } = {}) => {
    const id = asNonEmptyString(interactionId);
    const token = asNonEmptyString(interactionToken);
    if (!id || !token) throw new DiscordApiError('interactionId and interactionToken are required', 400, 'INTERACTION_PARAMS_REQUIRED');
    const body = { type: Number(type) };
    if (isRecord(data)) {
      const nextData = { ...data };
      if (Array.isArray(nextData.components)) {
        nextData.flags = ensureComponentsV2Flags(nextData.components, nextData.flags);
      }
      body.data = nextData;
    }
    const res = await apiFetch(`/interactions/${encodeURIComponent(id)}/${encodeURIComponent(token)}/callback`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const entry = inbox.find((item) => item.id === id);
    if (entry) entry.acknowledged = true;
    return res ?? { ok: true, interactionId: id, type: body.type };
  };

  const editInteractionResponse = async ({ applicationId = null, interactionToken, messageId = '@original', payload = {} } = {}) => {
    const appId = await resolveApplicationId(applicationId);
    const token = asNonEmptyString(interactionToken);
    if (!token) throw new DiscordApiError('interactionToken is required', 400, 'INTERACTION_TOKEN_REQUIRED');
    const targetMsg = asNonEmptyString(messageId) || '@original';
    const nextPayload = isRecord(payload) ? { ...payload } : {};
    if (Array.isArray(nextPayload.components)) {
      nextPayload.flags = ensureComponentsV2Flags(nextPayload.components, nextPayload.flags);
    }
    return apiFetch(
      `/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(token)}/messages/${encodeURIComponent(targetMsg)}`,
      { method: 'PATCH', body: JSON.stringify(nextPayload) },
    );
  };

  const followupInteraction = async ({ applicationId = null, interactionToken, payload = {} } = {}) => {
    const appId = await resolveApplicationId(applicationId);
    const token = asNonEmptyString(interactionToken);
    if (!token) throw new DiscordApiError('interactionToken is required', 400, 'INTERACTION_TOKEN_REQUIRED');
    const nextPayload = isRecord(payload) ? { ...payload } : {};
    if (Array.isArray(nextPayload.components)) {
      nextPayload.flags = ensureComponentsV2Flags(nextPayload.components, nextPayload.flags);
    }
    return apiFetch(`/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(token)}?wait=true`, {
      method: 'POST',
      body: JSON.stringify(nextPayload),
    });
  };

  const deleteInteractionResponse = async ({ applicationId = null, interactionToken, messageId = '@original' } = {}) => {
    const appId = await resolveApplicationId(applicationId);
    const token = asNonEmptyString(interactionToken);
    if (!token) throw new DiscordApiError('interactionToken is required', 400, 'INTERACTION_TOKEN_REQUIRED');
    const targetMsg = asNonEmptyString(messageId) || '@original';
    await apiFetch(
      `/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(token)}/messages/${encodeURIComponent(targetMsg)}`,
      { method: 'DELETE' },
    );
    return { ok: true, applicationId: appId, messageId: targetMsg };
  };

  return {
    resolveApplicationId,
    listCommands,
    upsertCommand,
    bulkOverwriteCommands,
    deleteCommand,
    recordInboundInteraction,
    handleHttpInteraction,
    listInteractions,
    respondInteraction,
    editInteractionResponse,
    followupInteraction,
    deleteInteractionResponse,
  };
};
