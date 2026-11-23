import { z } from 'zod';

import { asNonEmptyString } from '../shared/guards.js';

const LONG_WAIT_MS = 60_000;

export const DEFAULT_EXHAUSTION_MS = 60 * 60_000;

const LIMIT_ERROR_TYPES = new Set([
  'provider.quota',
  'provider.free-limit',
  'provider.budget-limit',
  'provider.model-budget-limit',
  'provider.go-limit',
  'provider.chatgpt-limit',
  'provider.rate-limit',
]);

const MAX_NL_RESET_MS = 7 * 24 * 60 * 60_000;
const LIMIT_TYPE_RE = /rate.?limit|quota|budget|usage.?limit|overloaded|resource_exhausted|too_many_requests/i;
const LIMIT_TEXT_RE = /rate.?limit|usage.?limit|usage\s+exceeded|quota\s*(?:exceeded|reached|exhausted)|(?:daily|weekly|monthly|hourly|free|credit|spending|workspace|session)\s+(?:usage\s+)?limit|limit\s+(?:reached|exceeded|exhausted|resets)|out of credits|insufficient\s+credits|too many requests|\b429\b|capacity|overloaded|try again (?:in|at|after)/i;
const AUTH_ERROR_RE = /invalid.?api.?key|authentication|unauthorized/i;

export const DEFAULT_AUTO_CONTINUE_PROVIDERS = Object.freeze(['opencode', 'opencode-zen', 'opencode-go']);

const NON_ZEN_PROVIDER_TEXT_RE = /\b(anthropic|claude\s+(?:pro|max|api)|openai|chatgpt|google\s+ai|gemini|openrouter|github\s+copilot|xai|grok|deepseek|mistral|cohere)\b/i;
const ZEN_PROVIDER_TEXT_RE = /\b(opencode(?:\s+(?:zen|go))?|zen\s+(?:usage|free|limit|quota))\b/i;

export const normalizeProviderId = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const isOpenCodeZenProvider = (providerID, allowedProviders = DEFAULT_AUTO_CONTINUE_PROVIDERS) => {
  const normalized = normalizeProviderId(providerID);
  if (!normalized) return false;
  const allowSet = new Set(
    (Array.isArray(allowedProviders) && allowedProviders.length > 0 ? allowedProviders : DEFAULT_AUTO_CONTINUE_PROVIDERS)
      .map(normalizeProviderId)
      .filter(Boolean),
  );
  if (allowSet.has(normalized)) return true;
  if (allowSet.has('opencode') || allowSet.has('opencode-zen')) {
    return normalized === 'opencode' || normalized === 'opencode-zen' || normalized.startsWith('opencode-zen');
  }
  return false;
};

export const extractProviderIdFromError = (error) => {
  if (!error || typeof error !== 'object') return '';
  for (const candidate of [
    error.providerID,
    error.providerId,
    error.provider,
    error.data?.providerID,
    error.data?.providerId,
    error.data?.provider,
    error.data?.error?.providerID,
    error.response?.providerID,
  ]) {
    const id = normalizeProviderId(candidate);
    if (id) return id;
  }
  return '';
};

export const isUsageAutoContinueAllowed = ({
  providerID = null,
  error = null,
  allowedProviders = DEFAULT_AUTO_CONTINUE_PROVIDERS,
} = {}) => {
  const errType = typeof error?.type === 'string' ? error.type.trim().toLowerCase() : '';
  if (errType === 'provider.chatgpt-limit') return false;
  const resolvedProvider = normalizeProviderId(providerID) || extractProviderIdFromError(error);
  if (resolvedProvider) {
    return isOpenCodeZenProvider(resolvedProvider, allowedProviders);
  }
  if (errType === 'provider.free-limit' || errType === 'provider.go-limit') {
    return true;
  }
  const text = [
    error?.message,
    typeof error?.body === 'string' ? error.body : '',
    error?.data?.message,
    error?.data?.error?.message,
    typeof error?.response?.body === 'string' ? error.response.body : '',
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' ');
  if (text && NON_ZEN_PROVIDER_TEXT_RE.test(text) && !ZEN_PROVIDER_TEXT_RE.test(text)) {
    return false;
  }
  return true;
};

export const isLimitErrorType = (type) => LIMIT_ERROR_TYPES.has(type);

const extractHttpStatus = (error) => {
  for (const candidate of [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.data?.statusCode,
    error?.data?.status,
    error?.data?.error?.status,
    error?.data?.error?.statusCode,
  ]) {
    const code = Number(candidate);
    if (Number.isInteger(code) && code >= 100 && code <= 599) return code;
  }
  return null;
};

export const isLimitError = (error) => {
  if (!error || typeof error !== 'object') return false;
  if (error.type === 'provider.auth') return false;
  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) return false;
  if (LIMIT_ERROR_TYPES.has(error.type)) return true;
  if (status === 429 || status === 529) return true;
  const typeText = [error.name, error.code, error.type, error.data?.code, error.data?.type, error.data?.error?.code, error.data?.error?.type]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' ');
  if (typeText && LIMIT_TYPE_RE.test(typeText)) return true;
  if (typeof error.type === 'string' && error.type.startsWith('provider.') && error.type !== 'provider.error') {
    return false;
  }
  const bodyText = [
    error.message,
    typeof error.body === 'string' ? error.body : '',
    error.data?.message,
    error.data?.error?.message,
    typeof error.data?.responseBody === 'string' ? error.data.responseBody : '',
    typeof error.cause?.message === 'string' ? error.cause.message : '',
    typeof error.response?.body === 'string' ? error.response.body : '',
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' ');
  if (!bodyText) return false;
  if (AUTH_ERROR_RE.test(bodyText) && !/rate.?limit|usage.?limit|quota|limit\s+(?:reached|exceeded)/i.test(bodyText)) return false;
  return LIMIT_TEXT_RE.test(bodyText);
};


const epochMs = (value) => (value < 1e10 ? value * 1000 : value);
const resetAtSchema = z.union([
  z.number().positive().transform(epochMs),
  z.string().regex(/^\d+(\.\d+)?$/).transform(Number).pipe(z.number().positive()).transform(epochMs),
  z.string().transform((text) => Date.parse(text)).pipe(z.number().finite()),
]);
const waitSecondsSchema = z.coerce.number().positive();

const hintFields = {
  resets_at: resetAtSchema.optional().catch(undefined),
  reset_at: resetAtSchema.optional().catch(undefined),
  resetsAt: resetAtSchema.optional().catch(undefined),
  resetAt: resetAtSchema.optional().catch(undefined),
  retry_after: waitSecondsSchema.optional().catch(undefined),
  retryAfter: waitSecondsSchema.optional().catch(undefined),
  resets_in_seconds: waitSecondsSchema.optional().catch(undefined),
  reset_in_seconds: waitSecondsSchema.optional().catch(undefined),
};
const hintsSchema = z.object(hintFields);
const hintsObjectSchema = hintsSchema.extend({ error: hintsSchema.optional().catch(undefined) });
const limitBodySchema = z
  .union([
    hintsObjectSchema,
    z.string().transform((text, context) => {
      try {
        return JSON.parse(text);
      } catch {
        context.addIssue({ code: 'custom', message: 'not JSON' });
        return z.NEVER;
      }
    }).pipe(hintsObjectSchema),
  ]);

const resetFromHints = (hints, now) => {
  const at = hints.resets_at ?? hints.reset_at ?? hints.resetsAt ?? hints.resetAt;
  if (at !== undefined && at > now) return at;
  const seconds = hints.retry_after ?? hints.retryAfter ?? hints.resets_in_seconds ?? hints.reset_in_seconds;
  return seconds === undefined ? null : now + seconds * 1000;
};

const UNIT_MS = {
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
};

const parseNaturalLanguageResetAt = (text, now) => {
  if (typeof text !== 'string' || !text.trim()) return null;
  const isoMatches = text.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g);
  for (const match of isoMatches) {
    const parsed = Date.parse(match[0]);
    if (Number.isFinite(parsed) && parsed > now && parsed - now <= MAX_NL_RESET_MS) {
      return parsed;
    }
  }
  const compoundMatch = text.match(/(?<![a-z0-9-])(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)(?:\s*(?:and|,)?\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|m))?(?:\s*(?:and|,)?\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s))?\b/i);
  if (compoundMatch) {
    const ms = Number(compoundMatch[1]) * 3_600_000
      + (compoundMatch[3] ? Number(compoundMatch[3]) * 60_000 : 0)
      + (compoundMatch[5] ? Number(compoundMatch[5]) * 1_000 : 0);
    if (ms > 0 && ms <= MAX_NL_RESET_MS) return now + Math.round(ms);
  }
  const minSecMatch = text.match(/(?<![a-z0-9-])(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\s*(?:(?:and|,)?\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s))?\b/i);
  if (minSecMatch) {
    const ms = Number(minSecMatch[1]) * 60_000 + (minSecMatch[3] ? Number(minSecMatch[3]) * 1_000 : 0);
    if (ms > 0 && ms <= MAX_NL_RESET_MS) return now + Math.round(ms);
  }
  const singleMatch = text.match(/(?:^|\b(?:in|after|wait|for|approx\.?|about)\s+|[,:(\s])(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/i);
  if (singleMatch) {
    const mult = UNIT_MS[singleMatch[2].toLowerCase()];
    const ms = Number(singleMatch[1]) * mult;
    if (ms > 0 && ms <= MAX_NL_RESET_MS) return now + Math.round(ms);
  }
  return null;
};

export const parseLimitResetAt = (error, now) => {
  if (error?.retryAfterMs > 0) return now + error.retryAfterMs;
  for (const candidate of [error?.body, error?.data, error?.response?.body]) {
    if (candidate === undefined || candidate === null) continue;
    const parsed = limitBodySchema.safeParse(candidate);
    if (!parsed.success) continue;
    const fromHints = resetFromHints(parsed.data, now) ?? (parsed.data.error ? resetFromHints(parsed.data.error, now) : null);
    if (fromHints !== null) return fromHints;
  }
  for (const text of [
    error?.message,
    typeof error?.body === 'string' ? error.body : null,
    typeof error?.data?.message === 'string' ? error.data.message : null,
    typeof error?.data?.error?.message === 'string' ? error.data.error.message : null,
    typeof error?.data?.responseBody === 'string' ? error.data.responseBody : null,
    typeof error?.cause?.message === 'string' ? error.cause.message : null,
    typeof error?.response?.body === 'string' ? error.response.body : null,
  ]) {
    const parsed = parseNaturalLanguageResetAt(text, now);
    if (parsed !== null) return parsed;
  }
  return null;
};

export const classifyLimitFailure = (report, now) => {
  const error = report.error;
  if (!isLimitError(error)) return null;
  const resetAt = parseLimitResetAt(error, now);
  const proposedDelay = report.proposed.retry ? report.proposed.delay : 0;
  if (error.type === 'provider.rate-limit' || (!LIMIT_ERROR_TYPES.has(error.type) && report.proposed.retry)) {
    const wait = Math.max(proposedDelay, resetAt === null ? 0 : resetAt - now);
    if (wait < LONG_WAIT_MS) return null;
  }
  if (resetAt !== null) return { resetAt };
  return { resetAt: now + (proposedDelay >= LONG_WAIT_MS ? proposedDelay : DEFAULT_EXHAUSTION_MS) };
};

export const isLimitFailoverConfigured = (settings) => (
  parseModelSetting(settings?.fallbackModel) !== null
  || (Array.isArray(settings?.accountSwitchProviders) && settings.accountSwitchProviders.length > 0)
);

export const parseModelSetting = (value, variantValue) => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  const slash = text.indexOf('/');
  if (slash <= 0 || slash === text.length - 1) return null;
  const model = { providerID: text.slice(0, slash), id: text.slice(slash + 1) };
  const variant = asNonEmptyString(variantValue);
  return variant ? { ...model, variant } : model;
};

const credentialSchema = z
  .object({ id: z.string().min(1), label: z.string().optional().catch(undefined) })
  .transform((credential) => ({ id: credential.id, label: credential.label || credential.id }));

const reportSchema = z.object({
  sessionID: z.string().min(1),
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  error: z.object({
    type: z.string().min(1).catch('provider.error').default('provider.error'),
    name: z.string().optional().catch(undefined),
    code: z.string().optional().catch(undefined),
    status: z.number().int().optional().catch(undefined),
    statusCode: z.number().int().optional().catch(undefined),
    message: z.string().catch(''),
    body: z.string().nullable().catch(null).default(null),
    data: z.record(z.string(), z.unknown()).optional().catch(undefined),
    retryAfterMs: z.number().finite().nonnegative().optional().catch(undefined),
  }),
  proposed: z
    .union([
      z.object({ retry: z.literal(true), delay: z.number().finite().nonnegative() }),
      z.object({ retry: z.literal(false) }),
    ])
    .catch({ retry: false }),
  credentials: z
    .array(z.unknown())
    .catch([])
    .transform((items) => items.flatMap((item) => {
      const credential = credentialSchema.safeParse(item);
      return credential.success ? [credential.data] : [];
    })),
  activeCredentialID: z.string().min(1).optional().catch(undefined),
});

export const parseLimitReport = (body) => {
  const report = reportSchema.safeParse(body);
  return report.success ? report.data : null;
};
