import crypto from 'node:crypto';
import { asNonEmptyString, isRecord } from '../shared/guards.js';
import { DiscordApiError } from './client.js';

const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const PENDING_STATE_TTL_MS = 10 * 60_000;

export const createPkcePair = () => {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
};

export const createDiscordOAuthManager = ({ store, fetchImpl = fetch, apiBase = DISCORD_API_BASE } = {}) => {
  const pendingStates = new Map();

  const pruneStates = () => {
    const now = Date.now();
    for (const [key, entry] of pendingStates.entries()) {
      if (now - entry.createdAt > PENDING_STATE_TTL_MS) pendingStates.delete(key);
    }
  };

  const buildAuthorizeUrl = async ({
    clientId = null,
    redirectUri = null,
    scopes = ['identify', 'guilds'],
    permissions = null,
    guildId = null,
    integrationType = null,
    usePkce = true,
    prompt = 'consent',
  } = {}) => {
    pruneStates();
    const stateDoc = store ? await store.read() : null;
    const resolvedClientId = asNonEmptyString(clientId) || asNonEmptyString(stateDoc?.applicationId);
    if (!resolvedClientId) {
      throw new DiscordApiError('clientId (or stored applicationId) is required to generate an OAuth2 URL', 400, 'CLIENT_ID_REQUIRED');
    }
    const scopeList = Array.isArray(scopes)
      ? scopes.map((s) => String(s).trim()).filter(Boolean)
      : (asNonEmptyString(scopes) ? String(scopes).split(/[\s,]+/).filter(Boolean) : ['identify']);
    const state = crypto.randomBytes(24).toString('base64url');
    const pkce = usePkce ? createPkcePair() : null;

    const params = new URLSearchParams({
      client_id: resolvedClientId,
      response_type: 'code',
      scope: scopeList.join(' '),
      state,
    });
    if (asNonEmptyString(redirectUri)) params.set('redirect_uri', String(redirectUri).trim());
    if (permissions !== undefined && permissions !== null && String(permissions).trim() !== '') {
      params.set('permissions', String(permissions).trim());
    }
    if (asNonEmptyString(guildId)) params.set('guild_id', String(guildId).trim());
    if (integrationType !== undefined && integrationType !== null) params.set('integration_type', String(integrationType));
    if (asNonEmptyString(prompt)) params.set('prompt', String(prompt).trim());
    if (pkce) {
      params.set('code_challenge', pkce.codeChallenge);
      params.set('code_challenge_method', pkce.codeChallengeMethod);
    }

    pendingStates.set(state, {
      createdAt: Date.now(),
      clientId: resolvedClientId,
      redirectUri: asNonEmptyString(redirectUri),
      codeVerifier: pkce?.codeVerifier ?? null,
      scopes: scopeList,
    });

    return {
      url: `${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
      state,
      scopes: scopeList,
      pkceEnabled: Boolean(pkce),
      expiresInSeconds: Math.floor(PENDING_STATE_TTL_MS / 1000),
    };
  };

  const formPost = async (endpoint, bodyParams) => {
    const response = await fetchImpl(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(bodyParams).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!response.ok) {
      const msg = asNonEmptyString(json?.error_description)
        || asNonEmptyString(json?.error)
        || asNonEmptyString(json?.message)
        || asNonEmptyString(text)
        || `Discord OAuth2 request failed (${response.status})`;
      throw new DiscordApiError(msg, response.status, json?.error ?? null);
    }
    return json ?? {};
  };

  const persistOAuthTokens = async (tokenPayload, meta = {}) => {
    const expiresInSec = Number(tokenPayload?.expires_in ?? 0);
    const expiresAt = expiresInSec > 0 ? new Date(Date.now() + expiresInSec * 1000).toISOString() : null;
    const scopes = asNonEmptyString(tokenPayload?.scope)
      ? tokenPayload.scope.split(/\s+/).filter(Boolean)
      : (Array.isArray(meta.scopes) ? meta.scopes : []);
    const oauthRecord = {
      clientId: asNonEmptyString(meta.clientId),
      accessToken: asNonEmptyString(tokenPayload?.access_token) ?? '',
      refreshToken: asNonEmptyString(tokenPayload?.refresh_token) ?? '',
      tokenType: asNonEmptyString(tokenPayload?.token_type) ?? 'Bearer',
      scopes,
      expiresAt,
      updatedAt: new Date().toISOString(),
    };
    if (store) {
      await store.saveConfig({ oauth: oauthRecord });
    }
    return {
      authorized: Boolean(oauthRecord.accessToken),
      clientId: oauthRecord.clientId,
      scopes: oauthRecord.scopes,
      expiresAt: oauthRecord.expiresAt,
      hasRefreshToken: Boolean(oauthRecord.refreshToken),
    };
  };

  const exchangeCode = async ({ clientId = null, clientSecret = null, code, redirectUri = null, state = null, codeVerifier = null } = {}) => {
    pruneStates();
    const authCode = asNonEmptyString(code);
    if (!authCode) throw new DiscordApiError('Authorization code is required', 400, 'CODE_REQUIRED');
    const pending = asNonEmptyString(state) ? pendingStates.get(String(state).trim()) : null;
    if (asNonEmptyString(state) && !pending) {
      throw new DiscordApiError('Invalid or expired OAuth2 state parameter', 400, 'INVALID_OAUTH_STATE');
    }
    if (pending) pendingStates.delete(String(state).trim());

    const stateDoc = store ? await store.read() : null;
    const resolvedClientId = asNonEmptyString(clientId) || pending?.clientId || asNonEmptyString(stateDoc?.applicationId);
    const resolvedRedirect = asNonEmptyString(redirectUri) || pending?.redirectUri;
    const resolvedVerifier = asNonEmptyString(codeVerifier) || pending?.codeVerifier;
    if (!resolvedClientId) throw new DiscordApiError('clientId is required', 400, 'CLIENT_ID_REQUIRED');

    const params = {
      client_id: resolvedClientId,
      grant_type: 'authorization_code',
      code: authCode,
    };
    if (asNonEmptyString(clientSecret)) params.client_secret = String(clientSecret).trim();
    if (resolvedRedirect) params.redirect_uri = resolvedRedirect;
    if (resolvedVerifier) params.code_verifier = resolvedVerifier;

    const payload = await formPost('/oauth2/token', params);
    return persistOAuthTokens(payload, { clientId: resolvedClientId, scopes: pending?.scopes });
  };

  const refreshAccessToken = async ({ clientId = null, clientSecret = null, refreshToken = null } = {}) => {
    const stateDoc = store ? await store.read() : null;
    const oauth = isRecord(stateDoc?.oauth) ? stateDoc.oauth : {};
    const resolvedClientId = asNonEmptyString(clientId) || asNonEmptyString(oauth.clientId) || asNonEmptyString(stateDoc?.applicationId);
    const resolvedRefresh = asNonEmptyString(refreshToken) || asNonEmptyString(oauth.refreshToken);
    if (!resolvedClientId || !resolvedRefresh) {
      throw new DiscordApiError('clientId and refreshToken are required to refresh OAuth2 access', 400, 'OAUTH_REFRESH_UNAVAILABLE');
    }
    const params = {
      client_id: resolvedClientId,
      grant_type: 'refresh_token',
      refresh_token: resolvedRefresh,
    };
    if (asNonEmptyString(clientSecret)) params.client_secret = String(clientSecret).trim();
    const payload = await formPost('/oauth2/token', params);
    return persistOAuthTokens(payload, { clientId: resolvedClientId, scopes: oauth.scopes });
  };

  const revokeToken = async ({ clientId = null, clientSecret = null, tokenTypeHint = 'access_token' } = {}) => {
    const stateDoc = store ? await store.read() : null;
    const oauth = isRecord(stateDoc?.oauth) ? stateDoc.oauth : {};
    const resolvedClientId = asNonEmptyString(clientId) || asNonEmptyString(oauth.clientId) || asNonEmptyString(stateDoc?.applicationId);
    const targetToken = tokenTypeHint === 'refresh_token'
      ? asNonEmptyString(oauth.refreshToken)
      : (asNonEmptyString(oauth.accessToken) || asNonEmptyString(oauth.refreshToken));
    if (!resolvedClientId || !targetToken) {
      throw new DiscordApiError('No stored OAuth2 token available to revoke', 400, 'OAUTH_TOKEN_MISSING');
    }
    const params = {
      client_id: resolvedClientId,
      token: targetToken,
      token_type_hint: tokenTypeHint === 'refresh_token' ? 'refresh_token' : 'access_token',
    };
    if (asNonEmptyString(clientSecret)) params.client_secret = String(clientSecret).trim();
    await formPost('/oauth2/token/revoke', params);
    if (store) await store.saveConfig({ oauth: null });
    return { revoked: true };
  };

  const getOAuthStatus = async () => {
    const stateDoc = store ? await store.read() : null;
    const oauth = isRecord(stateDoc?.oauth) ? stateDoc.oauth : null;
    const expiresAt = asNonEmptyString(oauth?.expiresAt);
    const expired = Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
    return {
      authorized: Boolean(asNonEmptyString(oauth?.accessToken)),
      expired,
      clientId: asNonEmptyString(oauth?.clientId) || asNonEmptyString(stateDoc?.applicationId),
      scopes: Array.isArray(oauth?.scopes) ? oauth.scopes : [],
      expiresAt,
      hasRefreshToken: Boolean(asNonEmptyString(oauth?.refreshToken)),
    };
  };

  const oauthGet = async (endpoint) => {
    const stateDoc = store ? await store.read() : null;
    const accessToken = asNonEmptyString(stateDoc?.oauth?.accessToken);
    if (!accessToken) throw new DiscordApiError('No OAuth2 access token stored', 401, 'OAUTH_NOT_AUTHORIZED');
    const response = await fetchImpl(`${apiBase}${endpoint}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!response.ok) {
      throw new DiscordApiError(asNonEmptyString(json?.message) || `OAuth2 API error (${response.status})`, response.status, json?.code ?? null);
    }
    return json;
  };

  return {
    buildAuthorizeUrl,
    exchangeCode,
    refreshAccessToken,
    revokeToken,
    getOAuthStatus,
    getOAuthMe: () => oauthGet('/oauth2/@me'),
    getOAuthConnections: () => oauthGet('/users/@me/connections'),
  };
};
