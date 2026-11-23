import fs from 'node:fs/promises';
import path from 'node:path';
import { asNonEmptyString } from '../shared/guards.js';

const DEFAULT_STATE = () => ({
  version: 1,
  token: '',
  tokenType: 'user',
  applicationId: null,
  publicKey: null,
  rememberedGuildId: null,
  mutedChannelIds: [],
  user: null,
  safetyPolicy: null,
  oauth: null,
});

export const maskToken = (token) => {
  if (typeof token !== 'string' || !token.trim()) return null;
  const t = token.trim();
  if (t.length <= 8) return '••••••••';
  return `${t.slice(0, 4)}••••${t.slice(-4)}`;
};

export const createDiscordStore = ({ filePath, fsImpl = fs } = {}) => {
  let cache = null;
  let queue = Promise.resolve();

  const readRaw = async () => {
    if (cache) return { ...cache };
    if (!filePath) {
      cache = DEFAULT_STATE();
      return { ...cache };
    }
    try {
      const parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
      cache = {
        version: 1,
        token: typeof parsed?.token === 'string' ? parsed.token : '',
        tokenType: parsed?.tokenType === 'bot' ? 'bot' : 'user',
        applicationId: asNonEmptyString(parsed?.applicationId),
        publicKey: asNonEmptyString(parsed?.publicKey),
        rememberedGuildId: typeof parsed?.rememberedGuildId === 'string' ? parsed.rememberedGuildId : null,
        mutedChannelIds: Array.isArray(parsed?.mutedChannelIds) ? parsed.mutedChannelIds : [],
        user: parsed?.user ?? null,
        safetyPolicy: parsed?.safetyPolicy ?? null,
        oauth: parsed?.oauth ?? null,
      };
    } catch {
      cache = DEFAULT_STATE();
    }
    return { ...cache };
  };

  const writeRaw = async (next) => {
    cache = { ...DEFAULT_STATE(), ...next, version: 1 };
    if (!filePath) return { ...cache };
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsImpl.writeFile(temp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    await fsImpl.rename(temp, filePath);
    return { ...cache };
  };

  const update = (fn) => {
    const run = queue.then(async () => {
      const cur = await readRaw();
      const next = await fn(cur);
      return writeRaw(next ?? cur);
    });
    queue = run.catch(() => {});
    return run;
  };

  const getPublicStatus = async () => {
    const state = await queue.then(() => readRaw());
    return {
      connected: Boolean(state.token),
      tokenType: state.tokenType,
      tokenHint: maskToken(state.token),
      applicationId: state.applicationId ?? null,
      hasPublicKey: Boolean(state.publicKey),
      oauthAuthorized: Boolean(state.oauth?.accessToken),
      oauthScopes: Array.isArray(state.oauth?.scopes) ? state.oauth.scopes : [],
      safetyPolicy: state.safetyPolicy ?? null,
      rememberedGuildId: state.rememberedGuildId,
      mutedChannelIds: state.mutedChannelIds,
      user: state.user,
    };
  };

  return {
    read: () => queue.then(() => readRaw()),
    saveConfig: (patch) => update((cur) => ({ ...cur, ...patch })),
    clearAuth: () => update(() => DEFAULT_STATE()),
    getPublicStatus,
  };
};
