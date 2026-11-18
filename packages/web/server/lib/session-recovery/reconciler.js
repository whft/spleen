const PENDING_WAIT_MS = 15_000;
const RESUME_SETTLE_MS = 30_000;
const STALE_MS = 10 * 60_000;
const MAX_PROMPT_CHARS = 2_000;

const EXTERNAL_TOOL = /bash|shell|write|edit|patch|git|task|fetch|publish|deploy|push|delete|move/i;

export const isExternalTool = (name) => EXTERNAL_TOOL.test(String(name || ''));

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asText = (value) => (typeof value === 'string' ? value : '');

const contentOf = (message) => (Array.isArray(message?.content) ? message.content : []);

export const toolPartsOf = (message) => contentOf(message)
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
  return {
    pending,
    lastUser: {
      id: asText(lastUser.id),
      text: asText(lastUser.text),
      marker,
    },
    lastAssistant,
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
  const stale = startedAt > 0 && now - startedAt > staleMs;

  if (tail.lastUser?.marker && tail.assistantCount === 0) {
    if (stale) return { action: 'needs_review', state: 'needs_review', reason: 'resume delivered but no assistant turn' };
    return { action: 'wait', state: 'recovering', reason: 'resume already delivered', nextWakeAt: now + resumeSettleMs };
  }

  const attempts = Number(row?.attempts) || 0;
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

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const buildResumePrompt = ({ sessionID, executionSeq, attempt, tail, childResults = [] }) => {
  const lines = [
    '[Spleen recovery] The desktop app restarted while this turn was running. The transcript above is authoritative.',
  ];
  if (tail?.lastUser?.text) {
    lines.push(`Original request: ${clip(tail.lastUser.text.replace(/\s+/g, ' ').trim(), MAX_PROMPT_CHARS)}`);
  }
  const completed = tail?.completedTools ?? [];
  if (completed.length > 0) {
    lines.push(`Tool calls already completed, keep their results and do not run them again: ${completed.slice(-12).map((tool) => `${tool.name} (${tool.id})`).join(', ')}.`);
  }
  const unknown = tail?.unknownTools ?? [];
  if (unknown.length > 0) {
    lines.push(`Tool calls whose outcome is unknown: ${unknown.slice(-12).map((tool) => `${tool.name} (${tool.id})`).join(', ')}. Inspect the workspace, process state or remote state before repeating any of them.`);
  }
  for (const child of childResults.slice(0, 8)) {
    lines.push(`Child session ${child.sessionID} is ${child.state}: ${clip(child.summary, 400)}`);
  }
  lines.push('Continue the original work from evidence. Do not create a new subagent for work a child session already did.');
  return {
    text: lines.join('\n'),
    metadata: { spleenRecovery: { sessionID, executionSeq, attempt } },
  };
};
