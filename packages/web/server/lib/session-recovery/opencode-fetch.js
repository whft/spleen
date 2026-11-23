import { unwrapOpenCodeResponse } from '../opencode/response-envelope.js';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * OpenCode HTTP access for the recovery coordinator: the same envelope and
 * auth as the rest of the server, plus the retry hint a provider limit carries.
 */
export const createRecoveryOpenCodeFetch = ({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) => async (fetchPath, { directory = null, method = 'GET', body = null, query = null } = {}) => {
  const base = buildOpenCodeUrl(fetchPath, '');
  const params = new URLSearchParams(query || {});
  if (directory && directory !== 'global') params.set('directory', directory);
  const search = params.toString();
  const response = await fetchImpl(search ? `${base}?${search}` : base, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...getOpenCodeAuthHeaders(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const retryAfterSeconds = Number(response.headers?.get?.('retry-after'));
    throw Object.assign(
      new Error(`OpenCode ${method} ${fetchPath} failed with ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`),
      {
        status: response.status,
        body: text,
        retryAfterMs: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined,
      },
    );
  }
  return unwrapOpenCodeResponse(await response.json().catch(() => null));
};
