import { isLimitError, isLimitErrorType, parseLimitResetAt } from '../limit-failover/policy.js';

const PENDING_WAIT_MS = 15_000;
const RESUME_SETTLE_MS = 30_000;
const STALE_MS = 10 * 60_000;
const LIMIT_WAIT_BASE_MS = 60 * 60_000;
const LIMIT_WAIT_MAX_MS = 24 * 60 * 60_000;
const LIMIT_PROBE_MS = 5 * 60_000;

const EXTERNAL_TOOL = /bash|shell|write|edit|patch|git|task|fetch|publish|deploy|push|delete|move/i;

export const isExternalTool = (name) => EXTERNAL_TOOL.test(String(name || ''));

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asText = (value) => (typeof value === 'string' ? value : '');

const contentOf = (message) => (Array.isArray(message?.content) ? message.content : []);

const limitWaitMs = (waits) => Math.min(
  LIMIT_WAIT_MAX_MS,
  LIMIT_WAIT_BASE_MS * 2 ** Math.max(0, (Number(waits) || 0) - 1),
);

export const providerLimitResetAt = (error, now, waits = 0, failedAt = now) => {
  if (!isRecord(error)) return null;
  const type = asText(error.type);
  const body = asText(error.response?.body) || asText(error.body) || null;
  const baseAt = Number(failedAt) > 0 ? Number(failedAt) : now;
  const retryAfterMs = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : undefined;
  const resetAt = parseLimitResetAt({
    retryAfterMs,
    body,
    message: asText(error.message),
    data: isRecord(error.data) ? error.data : undefined,
  }, baseAt);
  const backoffAt = baseAt + limitWaitMs(waits);
  const floor = (at) => (waits > 0 ? Math.max(at, backoffAt) : at);
  const firstCheck = (at) => (waits === 0 && at - baseAt > LIMIT_PROBE_MS ? baseAt + LIMIT_PROBE_MS : floor(at));
  if (isLimitErrorType(type)) {
    if (resetAt === null || (type === 'provider.rate-limit' && resetAt - baseAt < 60_000)) return backoffAt;
    return firstCheck(resetAt);
  }

  if (!isLimitError(error)) return null;
  return resetAt === null ? backoffAt : firstCheck(resetAt);
};

const toolPartsOf = (message) => contentOf(message)
  .filter((part) => isRecord(part) && part.type === 'tool')
  .map((part) => ({
    id: asText(part.id),
    name: asText(part.name) || 'tool',
    status: asText(part.state?.status) || 'unknown',
    executed: part.executed === true,
    input: isRecord(part.state?.input) ? part.state.input : null,
  }))
  .filter((part) => part.id.length > 0);

const assistantCompleted = (message) => (
  isRecord(message?.time) && Number.isFinite(message.time.completed)
) || (typeof message?.finish === 'string' && message.finish.length > 0);

/**
 * The turn Spleen may have to resume: the last user message and everything
 * after it. Completed tool outcomes are evidence, so a resume never repeats
 * them; a tool still running past the crash is an unknown side effect.
 */
export const summarizeTail = (messages) => {
  if (!Array.isArray(messages)) return null;
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex === -1) {
    return { pending: false, lastUser: null, completedTools: [], unknownTools: [], assistantCount: 0 };
  }
  const lastUser = messages[lastUserIndex];
  const after = messages.slice(lastUserIndex + 1);
  const assistants = after.filter((message) => message?.type === 'assistant');
  const lastAssistant = assistants[assistants.length - 1] ?? null;
  const tools = assistants.flatMap(toolPartsOf);
  const completedTools = tools.filter((tool) => tool.status === 'completed');
  const unknownTools = tools.filter((tool) => tool.status !== 'completed' && (tool.executed || tool.status === 'running'));
  const pending = assistants.length === 0 || !assistantCompleted(lastAssistant);
  const marker = isRecord(lastUser?.metadata?.spleenRecovery) ? lastUser.metadata.spleenRecovery : null;
  const idle = [...after].reverse().find((message) => message?.type === 'idle');
  const contentErrorPart = contentOf(lastAssistant).find((part) => isRecord(part) && part.type === 'error');
  const contentError = contentErrorPart ? (isRecord(contentErrorPart.error) ? contentErrorPart.error : contentErrorPart) : null;
  const error = isRecord(lastAssistant?.error)
    ? lastAssistant.error
    : (isRecord(idle?.error) ? idle.error : contentError);
  const errorAt = isRecord(lastAssistant?.error) || contentError
    ? (Number(lastAssistant?.time?.completed) || Number(lastAssistant?.time?.created) || null)
    : (Number(idle?.time?.created) || null);
  const lastAssistantCompletedAt = Number(lastAssistant?.time?.completed) || 0;
  const lastAssistantFailed = Boolean(isRecord(lastAssistant?.error) || contentError || lastAssistant?.finish === 'error');
  return {
    pending,
    lastUser: {
      id: asText(lastUser.id),
      text: asText(lastUser.text),
      marker,
    },
    lastAssistant,
    lastAssistantCompletedAt,
    lastAssistantFailed,
    error,
    errorAt,
    completedTools,
    unknownTools,
    assistantCount: assistants.length,
  };
};

/**
 * Pure decision for one durable execution after a restart. `attach` means the
 * backend already owns the turn, `wait` means its outcome is not settled yet,
 * and only `resume` is allowed to send a prompt.
 */
export const decideRecovery = ({
  row,
  active = false,
  session = null,
  messages = null,
  now = Date.now(),
  maxAttempts = 2,
  resumeSettleMs = RESUME_SETTLE_MS,
  pendingWaitMs = PENDING_WAIT_MS,
  staleMs = STALE_MS,
}) => {
  if (!session) return { action: 'needs_review', state: 'needs_review', reason: 'session missing' };
  if (active) return { action: 'attach', state: 'running', reason: 'backend owns the execution' };
  if (!Array.isArray(messages)) {
    return { action: 'wait', state: 'unknown', reason: 'message read failed', nextWakeAt: now + pendingWaitMs };
  }

  const tail = summarizeTail(messages);
  const attempts = Number(row?.attempts) || 0;
  const waits = Number(row?.provider_waits) || 0;
  const resumedAt = Number(row?.resumed_at) || 0;
  const errorAt = Number(tail?.errorAt) || 0;
  const beforeResume = resumedAt > 0 && errorAt > 0 && errorAt <= resumedAt;
  const anchoredFailedAt = tail?.errorAt ?? (Number(row?.updated_at) || Number(row?.started_at) || now);
  const limitResetAt = tail?.lastUser && !beforeResume
    ? providerLimitResetAt(tail.error, now, waits, anchoredFailedAt)
    : null;

  if (row?.state === 'waiting_provider') {
    if (Number(row.next_wake_at) > now) {
      return { action: 'wait', state: 'waiting_provider', reason: 'provider limit', nextWakeAt: Number(row.next_wake_at) };
    }
    if (limitResetAt !== null) {
      if (limitResetAt > now) {
        return { action: 'wait', state: 'waiting_provider', reason: 'provider limit', nextWakeAt: limitResetAt };
      }
      return {
        action: 'resume',
        state: 'recovering',
        reason: 'provider limit reset',
        attempt: attempts,
        afterLimit: true,
        tail,
      };
    }
    if (
      tail
      && !tail.pending
      && !beforeResume
      && !tail.lastAssistantFailed
      && asText(session.outcome) !== 'failed'
      && Number(tail.lastAssistantCompletedAt) > Number(row.updated_at || 0)
    ) {
      return {
        action: 'complete',
        state: 'completed',
        reason: 'no unfinished turn',
      };
    }
    return {
      action: 'resume',
      state: 'recovering',
      reason: 'provider limit reset',
      attempt: attempts,
      afterLimit: true,
      tail,
    };
  }

  if (limitResetAt !== null) {
    return { action: 'park', state: 'waiting_provider', reason: 'provider limit', nextWakeAt: limitResetAt };
  }

  if (beforeResume) {
    if (now - resumedAt > staleMs) {
      return { action: 'needs_review', state: 'needs_review', reason: 'resume delivered but not in transcript' };
    }
    return { action: 'wait', state: 'recovering', reason: 'resume already delivered', nextWakeAt: now + resumeSettleMs };
  }

  // The transcript is authoritative: a session-level outcome can belong to an
  // earlier turn, and an unfinished assistant turn is exactly what a crash leaves.
  if (!tail || !tail.pending) {
    return {
      action: 'complete',
      state: asText(session.outcome) === 'failed' ? 'failed' : 'completed',
      reason: 'no unfinished turn',
    };
  }

  const startedAt = Number(row?.started_at) || 0;
  const staleFrom = resumedAt > 0 ? resumedAt : startedAt;
  const stale = staleFrom > 0 && now - staleFrom > staleMs;

  if (tail.lastUser?.marker && tail.assistantCount === 0) {
    if (stale) {
      if (waits > 0 && waits < 12) {
        return {
          action: 'wait',
          state: 'waiting_provider',
          reason: 'provider limit retry',
          nextWakeAt: now + limitWaitMs(waits),
        };
      }
      return { action: 'needs_review', state: 'needs_review', reason: 'resume delivered but no assistant turn' };
    }
    return { action: 'wait', state: 'recovering', reason: 'resume already delivered', nextWakeAt: now + resumeSettleMs };
  }

  if (attempts >= maxAttempts) {
    return { action: 'needs_review', state: 'needs_review', reason: 'resume budget exhausted' };
  }
  if (Number(row?.next_wake_at) > now) {
    return { action: 'wait', state: row?.state || 'recovering', reason: 'backoff', nextWakeAt: Number(row.next_wake_at) };
  }

  return {
    action: 'resume',
    state: 'recovering',
    reason: 'interrupted turn',
    attempt: attempts + 1,
    tail,
  };
};

// The transcript already carries the request, every tool call and whatever ran
// before the crash, so the resume is the plain word a person would send.
export const buildResumePrompt = ({ sessionID, executionSeq, attempt }) => ({
  text: 'Continue.',
  metadata: { spleenRecovery: { sessionID, executionSeq, attempt } },
});
