import { asNonEmptyString, isBoolean } from '../shared/guards.js';
import path from 'node:path';
import nodeFsPromises from 'node:fs/promises';
import { OpenCode } from '@opencode/client';
import { SpleenControlError, asControlError } from './error.js';
import { SPLEEN_ALL_ACTIONS, SPLEEN_KNOWLEDGE_ACTIONS } from './actions.js';
import { handleDiscordControlAction } from './discord-actions.js';
import { writeScreenshot } from './screenshots.js';
import { createProjectKnowledgeActions } from './project-knowledge.js';
import { createPageAnswers, createRenderPageAction, isAgentPrompt } from './render-page.js';
import { completeFormAnswer } from './form-answer.js';
import { createImageGenerationAction } from './generate-image.js';
import { createSecretRequests } from './secret-request.js';
import { createUsageReadAction } from './usage-read.js';
import { createTerminalReadAction } from './terminal-read.js';
import { runWaitAction } from './waits.js';
import { createWorkNamer } from '../spleen-sessions/work-naming.js';
import { CHATS_SCOPE_PUBLIC_ID } from '../scheduled-tasks/chats-scope.js';
import { createWorkMembership } from '../session-work/membership.js';
import { isListedAsChild, listedSession } from './listed-session.js';
import { isPinnedMetadata, userStatePatch } from '../session-work/state.js';
import { z } from 'zod';
import { resolveUploadFiles, UploadRefusedError } from '../browser-control/uploads.js';
import settingsRegistry from '../opencode/settings-registry.json' with { type: 'json' };

const UI_CONTROL_COMMANDS = new Set([
  'open_surface',
  'close_surface',
  'open_settings',
  'close_settings',
  'focus_session',
  'toggle_sidebar',
  'set_theme',
  'notify',
]);

const isSecretRegistryKey = (key, spec) => Boolean(spec?.secret || /password|token/i.test(key));

const dialogAnswerSchema = z.object({ accept: z.boolean(), value: z.string().optional() });

const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const MAX_WAIT_TIMEOUT_SECONDS = 86_400;
const WAIT_POLL_INTERVAL_MS = 500;
const CONTROL_ACTIONS = new Set(SPLEEN_ALL_ACTIONS);
const PREFERENCE_BY_RANK = { 2: 'favorite', 1: 'recent' };
const SCHEDULE_TASK_ID_ACTIONS = new Set([
  'schedule.update',
  'schedule.run',
  'schedule.delete',
  'schedule.toggle',
]);

const positiveInteger = (value, fallback, field) => {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new SpleenControlError(`${field} must be a positive integer`, 400);
  }
  return number;
};

const normalizeWaitTimeoutMs = (value) => {
  const seconds = value === undefined || value === null ? DEFAULT_WAIT_TIMEOUT_SECONDS : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_WAIT_TIMEOUT_SECONDS) {
    throw new SpleenControlError(`timeout must be from 1 to ${MAX_WAIT_TIMEOUT_SECONDS} seconds`, 400);
  }
  return seconds * 1000;
};

const messageText = (record) => {
  if (record.type === 'user') return typeof record.text === 'string' ? record.text.trim() : '';
  return (Array.isArray(record.content) ? record.content : [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('')
    .trim();
};

const extractTextMessages = (messages, role = 'all') => {
  const result = [];
  for (const record of Array.isArray(messages) ? messages : []) {
    const messageRole = record?.type;
    if ((messageRole !== 'user' && messageRole !== 'assistant') || (role !== 'all' && role !== messageRole)) continue;
    const text = messageText(record);
    if (!text) continue;
    const providerID = asNonEmptyString(record.model?.providerID);
    const modelID = asNonEmptyString(record.model?.id);
    result.push({
      id: asNonEmptyString(record.id) || '',
      role: messageRole,
      createdAt: Number.isFinite(record?.time?.created) ? record.time.created : null,
      completedAt: Number.isFinite(record?.time?.completed) ? record.time.completed : null,
      model: providerID && modelID ? `${providerID}/${modelID}` : null,
      text,
    });
  }
  return result.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
};

const parseModel = (value) => {
  const model = asNonEmptyString(value);
  if (!model) throw new SpleenControlError('model is required', 400);
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex === model.length - 1) {
    throw new SpleenControlError('model must be in provider/model format', 400);
  }
  return { providerID: model.slice(0, slashIndex), modelID: model.slice(slashIndex + 1) };
};

const parseWeekdays = (value) => {
  const raw = asNonEmptyString(value);
  if (!raw) throw new SpleenControlError('weekly is required', 400);
  const weekdays = raw.split(',').map((entry) => Number.parseInt(entry.trim(), 10));
  if (weekdays.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 6)) {
    throw new SpleenControlError('weekly must contain weekdays from 0 to 6', 400);
  }
  return Array.from(new Set(weekdays)).sort((a, b) => a - b);
};

const buildSchedule = (input) => {
  const daily = asNonEmptyString(input.daily);
  const weekly = asNonEmptyString(input.weekly);
  const once = asNonEmptyString(input.once);
  const cron = asNonEmptyString(input.cron);
  const selectors = [daily, weekly, once, cron].filter(Boolean);
  if (selectors.length !== 1) {
    throw new SpleenControlError('Provide exactly one of daily, weekly, once, or cron', 400);
  }
  const timezone = asNonEmptyString(input.timezone);
  if (daily) return { kind: 'daily', times: [daily], ...(timezone ? { timezone } : {}) };
  if (weekly) {
    const time = asNonEmptyString(input.time);
    if (!time) throw new SpleenControlError('time is required with weekly', 400);
    return { kind: 'weekly', weekdays: parseWeekdays(weekly), times: [time], ...(timezone ? { timezone } : {}) };
  }
  if (once) {
    const time = asNonEmptyString(input.time);
    if (!time) throw new SpleenControlError('time is required with once', 400);
    return { kind: 'once', date: once, time, ...(timezone ? { timezone } : {}) };
  }
  return { kind: 'cron', cron, ...(timezone ? { timezone } : {}) };
};

const assertWorktreeIsolation = (input, targetSessionId) => {
  for (const field of ['runInWorktree', 'cleanupWorktree']) {
    if (input[field] !== undefined && !isBoolean(input[field])) {
      throw new SpleenControlError(`${field} must be a boolean`, 400);
    }
  }
  const { baseBranch } = input;
  if (baseBranch !== undefined && baseBranch !== null && baseBranch !== '' && !asNonEmptyString(baseBranch)) {
    throw new SpleenControlError('baseBranch must be a branch name, or empty to clear it', 400);
  }
  const isolationNamed = ['runInWorktree', 'baseBranch', 'cleanupWorktree'].some((field) => input[field] !== undefined);
  if (isolationNamed && asNonEmptyString(targetSessionId)) {
    throw new SpleenControlError('runInWorktree, baseBranch and cleanupWorktree are not compatible with an existing session', 400);
  }
};

const buildScheduledTask = (input) => {
  const name = asNonEmptyString(input.name);
  const prompt = asNonEmptyString(input.prompt);
  if (!name) throw new SpleenControlError('name is required', 400);
  if (!prompt) throw new SpleenControlError('prompt is required', 400);
  const targetSessionId = asNonEmptyString(input.targetSessionId);
  const model = targetSessionId && input.model === undefined ? { useDefaults: !asNonEmptyString(input.agent) } : parseModel(input.model);
  const goalTokenBudget = input.goalTokenBudget;
  if (goalTokenBudget !== undefined && input.goal !== true) {
    throw new SpleenControlError('goalTokenBudget requires goal', 400);
  }
  if (goalTokenBudget !== undefined && (!Number.isSafeInteger(goalTokenBudget) || goalTokenBudget < 1000 || goalTokenBudget > 100_000_000)) {
    throw new SpleenControlError('goalTokenBudget must be from 1000 to 100000000', 400);
  }
  assertWorktreeIsolation(input, targetSessionId);
  const baseBranch = asNonEmptyString(input.baseBranch);
  const task = {
    name,
    enabled: input.disabled !== true,
    schedule: buildSchedule(input),
    execution: {
      prompt,
      ...model,
      ...(asNonEmptyString(input.agent) ? { agent: input.agent.trim() } : {}),
      ...(asNonEmptyString(input.variant) ? { variant: input.variant.trim() } : {}),
      ...(input.goal === true ? { goalEnabled: true } : {}),
      ...(goalTokenBudget !== undefined ? { goalTokenBudget } : {}),
    },
  };
  if (input.targetSessionId !== undefined) task.targetSessionId = targetSessionId ?? input.targetSessionId;
  if (input.runInWorktree === true) task.runInWorktree = true;
  if (input.cleanupWorktree === false) task.cleanupWorktree = false;
  if (baseBranch) task.baseBranch = baseBranch;
  return task;
};

const patchScheduledTask = (existing, input) => {
  if (existing.loopFile) {
    throw new SpleenControlError(`This task comes from ${existing.loopFile}; change that file instead`, 409);
  }
  const execution = { ...existing.execution };
  if (input.prompt !== undefined) {
    const prompt = asNonEmptyString(input.prompt);
    if (!prompt) throw new SpleenControlError('prompt cannot be empty', 400);
    execution.prompt = prompt;
  }
  if (input.model !== undefined) {
    Object.assign(execution, parseModel(input.model));
    delete execution.variant;
    delete execution.useDefaults;
  }
  for (const field of ['variant', 'agent']) {
    if (input[field] === undefined) continue;
    const value = asNonEmptyString(input[field]);
    if (value) execution[field] = value;
    else delete execution[field];
    if (field === 'agent' && value && (input.targetSessionId || existing.targetSessionId)) delete execution.useDefaults;
  }
  if (typeof input.goal === 'boolean') {
    if (input.goal) execution.goalEnabled = true;
    else {
      delete execution.goalEnabled;
      delete execution.goalTokenBudget;
    }
  }
  if (input.goalTokenBudget !== undefined) {
    if (!execution.goalEnabled) throw new SpleenControlError('goalTokenBudget requires goal', 400);
    if (!Number.isSafeInteger(input.goalTokenBudget) || input.goalTokenBudget < 1000 || input.goalTokenBudget > 100_000_000) {
      throw new SpleenControlError('goalTokenBudget must be from 1000 to 100000000', 400);
    }
    execution.goalTokenBudget = input.goalTokenBudget;
  }
  let name = existing.name;
  if (input.name !== undefined) {
    name = asNonEmptyString(input.name);
    if (!name) throw new SpleenControlError('name cannot be empty', 400);
  }
  const selectors = ['daily', 'weekly', 'once', 'cron'].filter((key) => input[key] !== undefined);
  if (selectors.length > 1 || (selectors.length === 1 && !asNonEmptyString(input[selectors[0]]))) {
    throw new SpleenControlError('Provide exactly one nonempty daily, weekly, once, or cron selector', 400);
  }
  const timezone = asNonEmptyString(input.timezone);
  let schedule = selectors.length === 1
    ? buildSchedule(input)
    : (timezone ? { ...existing.schedule, timezone } : existing.schedule);
  if (input.time !== undefined) {
    const time = asNonEmptyString(input.time);
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new SpleenControlError('time must be HH:mm', 400);
    }
    if (schedule.kind === 'once') {
      schedule = { ...schedule, time };
    } else if (schedule.kind === 'weekly' && schedule.times.length === 1) {
      schedule = { ...schedule, times: [time] };
    } else {
      throw new SpleenControlError('time requires a once or single-time weekly schedule; provide an explicit schedule to replace other schedules', 400);
    }
  }

  assertWorktreeIsolation(
    input,
    input.targetSessionId === undefined ? existing.targetSessionId : input.targetSessionId,
  );
  const patch = {
    id: existing.id,
    targetSessionId: input.targetSessionId === undefined ? existing.targetSessionId : input.targetSessionId,
    name,
    enabled: typeof input.disabled === 'boolean' ? !input.disabled : existing.enabled,
    schedule,
    execution,
  };
  if (input.runInWorktree !== undefined) patch.runInWorktree = input.runInWorktree;
  if (input.cleanupWorktree !== undefined) patch.cleanupWorktree = input.cleanupWorktree;
  if (input.baseBranch !== undefined) patch.baseBranch = asNonEmptyString(input.baseBranch);
  return patch;
};

export const createSpleenControlService = (dependencies) => {
  const {
    readSettingsFromDiskMigrated,
    sanitizeProjects,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    waitForOpenCodeReady,
    sessionService,
    chatsScope = null,
    chatRoots = [],
    updateSessionMetadata = null,
    isWorktreePinned = async () => false,
    scheduledTaskService,
    browserControl = null,
    browserUploads = null,
    fileOpen = null,
    notifyUser = null,
    agentMemoryActions = null,
    sessionLinks = null,
    workNaming = null,
    projectContextRuntime = null,
    resolveProjectContextId = null,
    isKnowledgeToolEnabled = async () => true,
    isRenderToolEnabled = async () => true,
    isSecretToolEnabled = async () => true,
    getTerminalRuntime = null,
    secretFiles = null,
    onPageWaitChange = () => {},
    readPendingRequests = () => ({}),
    isPermissionAutoAnswered = async () => false,
    showPlan = null,
    dispatchResults = null,
    prWatch = null,
    extensionWaits = null,
    laterPages = null,
    workflowRuntime = null,
    sharePages = null,
    archiveStore = null,
    isOpenCodeDirectoryTrusted = null,
    createClient = OpenCode.make,
    imageFsPromises = nodeFsPromises,
    loadQuota = null,
    sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    now = Date.now,
    isHiddenSession = () => false,
    persistSettings = null,
    broadcastUiEvent = () => {},
    teamsService = null,
    sessionRecoveryRuntime = null,
    getSessionRecoveryRuntime = null,
    getDiscordClient = () => null,
    getUnknownCheatsClient = () => null,
    getUnknownCheatsStore = () => null,
    agentConfigApi = null,
  } = dependencies;

  const wait = (duration, signal) => {
    if (!signal) return sleep(duration);
    if (signal.aborted) return Promise.reject(new SpleenControlError('Spleen action was cancelled', 499));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(new SpleenControlError('Spleen action was cancelled', 499));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      sleep(duration).then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
    });
  };

  const getClient = async (directory = '') => {
    if (directory && isOpenCodeDirectoryTrusted && !(await isOpenCodeDirectoryTrusted(directory))) {
      throw new SpleenControlError(
        `OpenCode is paused for ${directory}: its configuration runs plugins or commands the user has not trusted. Ask the user to open the folder in Spleen and trust it.`,
        403,
      );
    }
    if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);
    return createClient({
      baseUrl: new URL(buildOpenCodeUrl('/api/info', '')).origin,
      headers: {
        ...getOpenCodeAuthHeaders(),
        ...(directory ? { 'x-opencode-directory': encodeURIComponent(directory) } : {}),
      },
      fetch,
    });
  };

  const workNamer = workNaming ? createWorkNamer({
    ...workNaming,
    getSession: async (sessionID) => {
      const client = await getClient();
      return client.session.get({ sessionID }).catch(() => null);
    },
    createError: (message, status) => new SpleenControlError(message, status),
  }) : null;

  const withArchiveEntry = async (session) => {
    if (!archiveStore || !session?.id) return session;
    const entry = await archiveStore.entry(session.id);
    if (entry === undefined) return session;
    if (entry !== null) return { ...session, time: { ...session.time, archived: entry } };
    const { archived: _archived, ...time } = session.time ?? {};
    return { ...session, time };
  };

  const projects = async () => {
    const settings = await readSettingsFromDiskMigrated();
    const configured = sanitizeProjects(settings?.projects || []).map((project) => ({
      id: project.id,
      path: path.resolve(project.path),
      label: asNonEmptyString(project.label) || path.basename(project.path) || project.path,
    }));
    return chatsScope
      ? [...configured, { id: CHATS_SCOPE_PUBLIC_ID, path: chatsScope.root, label: 'Chats' }]
      : configured;
  };

  const assertSingleScope = (input) => {
    if (asNonEmptyString(input.projectId) && asNonEmptyString(input.directory)) {
      throw new SpleenControlError('Provide only one of projectId or directory', 400);
    }
  };

  const resolveReadDirectory = async (input, contextDirectory) => {
    assertSingleScope(input);
    const projectID = asNonEmptyString(input.projectId);
    if (!projectID) return asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory);
    return sessionService.resolveDirectory({ projectId: projectID });
  };

  const knowledgeActions = createProjectKnowledgeActions({
    projectContextRuntime,
    resolveProjectContextId,
    isEnabled: isKnowledgeToolEnabled,
    showPlan,
    resolveDirectory: (input) => sessionService.resolveDirectory(input),
  });

  const hasUnreadChat = async (sessionID) => {
    try {
      const client = await getClient();
      const items = await client.session.inbox.list({ sessionID });
      return items.some((item) => item.type === 'user' && item.delivery === 'steer' && !isAgentPrompt(item.payload?.metadata));
    } catch (error) {
      console.warn('[render.page] could not read the session inbox:', error?.message ?? error);
      return false;
    }
  };
  const pageAnswers = createPageAnswers({ onWaitChange: onPageWaitChange });
  const readSession = async (sessionID) => (await getClient()).session.get({ sessionID });
  const renderPage = createRenderPageAction({ isEnabled: isRenderToolEnabled, pageAnswers, hasUnreadChat, readSession, laterPages, sharePages });
  const secretRequests = createSecretRequests({ isEnabled: isSecretToolEnabled, files: secretFiles, onWaitChange: onPageWaitChange, hasUnreadChat });
  const generateImage = createImageGenerationAction({
    getClient,
    readSettings: readSettingsFromDiskMigrated,
    fsPromises: imageFsPromises,
  });
  const readUsage = loadQuota ? createUsageReadAction({ readSettings: readSettingsFromDiskMigrated, loadQuota }) : null;
  const readTerminal = createTerminalReadAction({ readSettings: readSettingsFromDiskMigrated, getTerminalRuntime });

  const models = async () => {
    const settings = await readSettingsFromDiskMigrated();
    return {
      defaultModel: asNonEmptyString(settings?.defaultModel),
      defaultVariant: asNonEmptyString(settings?.defaultVariant),
      defaultAgent: asNonEmptyString(settings?.defaultAgent),
      favoriteModels: Array.isArray(settings?.favoriteModels) ? settings.favoriteModels : [],
      recentModels: Array.isArray(settings?.recentModels) ? settings.recentModels : [],
    };
  };

  const searchModels = async (input, contextDirectory) => {
    const client = await getClient(asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory) || '');
    const [settings, catalog, providerList] = await Promise.all([
      readSettingsFromDiskMigrated(),
      client.model.list(),
      client.provider.list(),
    ]);
    const providerNames = new Map(providerList.data.map((provider) => [provider.id, provider.name]));
    const refKey = (ref) => `${ref?.providerID}/${ref?.modelID}`;
    const modelKey = (model) => `${model.providerID}/${model.id}`;
    const refs = (value) => new Set((Array.isArray(value) ? value : []).map(refKey));
    const hidden = refs(settings?.hiddenModels);
    const rank = new Map([
      ...[...refs(settings?.recentModels)].map((key) => [key, 1]),
      ...[...refs(settings?.favoriteModels)].map((key) => [key, 2]),
    ]);
    const provider = asNonEmptyString(input.provider)?.toLowerCase();
    const terms = (asNonEmptyString(input.query) ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const candidates = catalog.data
      .filter((model) => !hidden.has(modelKey(model)))
      .filter((model) => !provider
        || model.providerID.toLowerCase() === provider
        || providerNames.get(model.providerID)?.toLowerCase() === provider)
      .filter((model) => {
        const text = `${modelKey(model)} ${model.name}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      });
    const familyOf = (model) => `${model.providerID}/${model.family}`;
    const newestOfFamily = new Map();
    for (const model of candidates) {
      if (!model.family || rank.has(modelKey(model))) continue;
      newestOfFamily.set(familyOf(model), Math.max(newestOfFamily.get(familyOf(model)) ?? 0, model.time.released));
    }
    const matching = candidates
      .toSorted((left, right) => (rank.get(modelKey(right)) ?? 0) - (rank.get(modelKey(left)) ?? 0)
        || left.providerID.localeCompare(right.providerID)
        || right.time.released - left.time.released)
      .filter((model) => input.all === true || !model.family || rank.has(modelKey(model))
        || model.time.released >= newestOfFamily.get(familyOf(model)));
    const offset = Number.isSafeInteger(input.offset) && input.offset > 0 ? input.offset : 0;
    const limit = Number.isSafeInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 100) : 10;
    const page = matching.slice(offset, offset + limit);
    return {
      models: page.map((model) => ({
        id: modelKey(model),
        name: model.name,
        provider: providerNames.get(model.providerID) ?? model.providerID,
        preference: PREFERENCE_BY_RANK[rank.get(modelKey(model))],
        released: model.time.released,
        variants: model.variants.map((variant) => variant.id),
        cost: model.cost,
        status: model.status,
      })),
      total: matching.length,
      next: offset + limit < matching.length ? offset + limit : null,
    };
  };

  const activeSessions = async (client) => {
    const statuses = await client.session.active();
    if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
      throw new SpleenControlError('Invalid session status response', 500);
    }
    return Object.fromEntries(Object.entries(statuses).filter(([id]) => !isHiddenSession(id)));
  };

  const isWaitingForUser = async (sessionID) => {
    const pending = readPendingRequests()[sessionID];
    if (!pending) return false;
    if (pending.forms.length > 0 || pending.pages.length > 0) return true;
    const answered = await Promise.all(pending.permissions.map((permission) =>
      isPermissionAutoAnswered(sessionID, permission.directory, permission.id)));
    return answered.includes(false);
  };

  const asPublicStatus = async (statuses, sessionID) => {
    if (!statuses[sessionID]) return { type: 'idle' };
    return await isWaitingForUser(sessionID) ? { type: 'waiting' } : { type: 'busy' };
  };

  const sessionStatus = async (client, sessionID) => asPublicStatus(await activeSessions(client), sessionID);

  const assertSessionExists = async (client, sessionID) => {
    try {
      return await client.session.get({ sessionID });
    } catch (error) {
      if (error?._tag === 'SessionNotFoundError' || error?._tag === 'InvalidRequestError') {
        throw new SpleenControlError(`Session not found: ${sessionID}`, 404);
      }
      throw new SpleenControlError(
        `Could not check whether session ${sessionID} exists: ${error instanceof Error ? error.message : String(error)}`,
        503,
      );
    }
  };

  const workMembership = createWorkMembership({ chatRoots });
  const isSessionWorkEnabled = async () => {
    const settings = await readSettingsFromDiskMigrated().catch(() => null);
    return settings?.sessionWorkEnabled !== false;
  };

  const FILTERED_PAGE_SIZE = 200;

  const listSessions = async (input, contextDirectory) => {
    assertSingleScope(input);
    const inWork = input.inWork === true;
    const busy = input.busy === true;
    const terms = (asNonEmptyString(input.query) ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const scoped = Boolean(asNonEmptyString(input.projectId) || asNonEmptyString(input.directory));
    const everywhere = (inWork || busy) && !scoped;
    const directory = everywhere ? null : await resolveReadDirectory(input, contextDirectory);
    const limit = positiveInteger(input.limit, inWork || busy ? null : 10, 'limit');
    const workEnabled = await isSessionWorkEnabled();
    if (inWork && !workEnabled) throw new SpleenControlError('In work is turned off in Settings', 409);

    const client = await getClient(directory ?? '');
    const wantStatus = busy || input.withStatus === true;
    const statuses = wantStatus ? await activeSessions(client).catch(() => null) : null;
    if (busy && !statuses) throw new SpleenControlError('Could not read which sessions are running', 503);
    const runningCount = busy ? Object.keys(statuses).length : 0;

    const collected = [];
    const full = () => limit !== null && collected.length >= limit;
    const seenCursors = new Set();
    const seenSessionIds = new Set();
    let runningSeen = 0;
    let cursor;
    while (!(busy && runningSeen >= runningCount)) {
      const listInput = {};
      if (directory) listInput.directory = directory;
      if (input.children !== true) listInput.parentID = null;
      if (inWork || busy || terms.length > 0) listInput.limit = FILTERED_PAGE_SIZE;
      if (cursor) listInput.cursor = cursor;
      const response = await client.session.list(listInput);
      const page = await Promise.all((Array.isArray(response?.data) ? response.data : []).map(withArchiveEntry));
      for (const record of page) {
        const id = asNonEmptyString(record?.id);
        if (isHiddenSession(id, record)) continue;
        if (input.children !== true && isListedAsChild(record)) continue;
        if (id) {
          if (seenSessionIds.has(id)) continue;
          seenSessionIds.add(id);
        }
        const running = Boolean(id && statuses?.[id]);
        if (running) runningSeen += 1;
        if (input.all !== true && record?.time?.archived) continue;
        if (busy && !running) continue;
        if (terms.length > 0) {
          const title = (asNonEmptyString(record?.title) ?? '').toLowerCase();
          if (!terms.every((term) => title.includes(term))) continue;
        }
        const session = listedSession(record, workEnabled ? workMembership : null);
        if (inWork && !session.inWork) continue;
        collected.push(session);
        if (full()) break;
      }
      if (full()) break;
      const next = asNonEmptyString(response?.cursor?.next);
      if (!next || page.length === 0 || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
    }

    const sessions = wantStatus
      ? await Promise.all(collected.map(async (session) => ({
        ...session,
        status: statuses ? await asPublicStatus(statuses, session.id) : { type: 'unknown' },
      })))
      : collected;
    return { sessions, limit, directory, archived: input.all === true ? 'included' : 'excluded' };
  };

  const setWorkState = async (input, contextSessionId, state) => {
    if (!updateSessionMetadata) throw new SpleenControlError('Changing In work is not available on this server', 503);
    if (!(await isSessionWorkEnabled())) throw new SpleenControlError('In work is turned off in Settings', 409);
    const sessionID = asNonEmptyString(input.sessionId) || asNonEmptyString(contextSessionId);
    if (!sessionID) throw new SpleenControlError('sessionId is required', 400);
    const session = await withArchiveEntry(await assertSessionExists(await getClient(), sessionID));
    if (state === 'open' && !workMembership.canBeInWork(session)) {
      throw new SpleenControlError(`${sessionID} cannot be in work: subsessions, Chats, reviews, /btw questions and scheduled runs never are`, 400);
    }
    if (state === 'open' && session?.time?.archived) {
      throw new SpleenControlError(`${sessionID} is archived; In work shows no archived sessions`, 409);
    }
    const directory = asNonEmptyString(session?.location?.directory) || '';
    if (state === 'open' && (isPinnedMetadata(session?.metadata) || (directory && await isWorktreePinned(directory)))) {
      throw new SpleenControlError(`${sessionID} is pinned, or its worktree is; a pinned session is never in work`, 409);
    }
    const { changed } = await updateSessionMetadata(sessionID, (metadata) => userStatePatch(metadata, { state, now: now() }), { directory });
    return { sessionId: sessionID, directory, title: asNonEmptyString(session?.title), inWork: state === 'open', changed };
  };

  const MESSAGE_PAGE_LIMIT = 200;
  const sessionMessages = async (client, sessionID, role, limit) => {
    const fetchLimit = limit === undefined ? undefined : Math.max(100, limit * 4);
    const collected = [];
    const seenCursors = new Set();
    let cursor;
    for (;;) {
      const response = await client.message.list({
        sessionID,
        limit: fetchLimit ?? MESSAGE_PAGE_LIMIT,
        ...(cursor ? { cursor } : fetchLimit ? { order: 'desc' } : {}),
      });
      const raw = Array.isArray(response?.data) ? response.data : [];
      collected.push(...raw);
      const next = asNonEmptyString(response?.cursor?.next);
      if (!next || raw.length === 0 || seenCursors.has(next)) break;
      if (limit !== undefined && extractTextMessages(collected, role).length >= limit) break;
      seenCursors.add(next);
      cursor = next;
    }
    const messages = extractTextMessages(collected, role);
    return limit === undefined ? messages : messages.slice(-limit);
  };

  const waitForIdle = async ({ client, sessionID, directory, timeoutMs, requireActivity, baselineMessageID, startedAt, signal }) => {
    const deadline = now() + timeoutMs;
    let observedActivity = false;
    while (true) {
      if (signal?.aborted) throw new SpleenControlError('Spleen action was cancelled', 499);
      const status = await sessionStatus(client, sessionID);
      if (status.type === 'waiting') return status;
      if (status.type === 'busy') {
        observedActivity = true;
      } else if (!requireActivity || observedActivity) {
        return status;
      } else {
        const messages = await sessionMessages(client, sessionID, 'assistant', 1);
        const message = messages[0];
        if (message?.completedAt && (baselineMessageID ? message.id !== baselineMessageID : message.completedAt >= startedAt)) {
          return status;
        }
      }
      const remaining = deadline - now();
      if (remaining <= 0) {
        throw new SpleenControlError(`Session did not become idle within ${Math.ceil(timeoutMs / 1000)} seconds`, 500);
      }
      await wait(Math.min(WAIT_POLL_INTERVAL_MS, remaining), signal);
    }
  };

  const resolveSessionDirectory = async (sessionID) => {
    try {
      const client = await getClient();
      let detail = null;
      try {
        detail = await client.session.get({ sessionID }).catch(() => null);
      } catch {
        // A client without the by-id read falls through to the list.
      }
      const direct = asNonEmptyString(detail?.location?.directory) || asNonEmptyString(detail?.directory);
      if (direct) return direct;

      const seenCursors = new Set();
      let cursor;
      for (;;) {
        const response = await client.session.list(cursor ? { cursor } : {});
        const sessions = Array.isArray(response?.data) ? response.data : [];
        const session = sessions.find((item) => item?.id === sessionID);
        if (session) return asNonEmptyString(session?.location?.directory) || null;
        const next = asNonEmptyString(response?.cursor?.next);
        if (!next || seenCursors.has(next)) return null;
        seenCursors.add(next);
        cursor = next;
      }
    } catch {
      return null;
    }
  };

  const sessionClient = async (sessionID) => {
    const directory = await resolveSessionDirectory(sessionID);
    if (!directory) throw new SpleenControlError(`Session not found: ${sessionID}`, 404);
    return getClient(directory);
  };

  const GONE_TAGS = new Set(['SessionNotFoundError', 'PermissionNotFoundError', 'FormNotFoundError', 'FormAlreadySettledError']);
  const asAnswerError = (error) => {
    if (GONE_TAGS.has(error?._tag)) return new SpleenControlError('This request is no longer waiting for an answer', 404);
    if (error?._tag === 'FormInvalidAnswerError' || error?._tag === 'InvalidRequestError') {
      return new SpleenControlError(`OpenCode refused the answer: ${error.message || error._tag}`, 400);
    }
    return asControlError(error, 'OpenCode did not take the answer');
  };

  const stopSession = async (sessionID) => {
    const client = await sessionClient(sessionID);
    try {
      const result = await client.session.interrupt({ sessionID });
      return result?.interrupted === true;
    } catch (error) {
      throw asAnswerError(error);
    }
  };

  const answerPermission = async ({ sessionID, requestID, decision, message }) => {
    const client = await sessionClient(sessionID);
    try {
      const reply = { sessionID, requestID, decision };
      if (message) reply.message = message;
      await client.permission.reply(reply);
    } catch (error) {
      throw asAnswerError(error);
    }
  };

  const answerForm = async ({ sessionID, formID, answer, message }) => {
    const client = await sessionClient(sessionID);
    try {
      if (!answer) {
        const cancellation = { sessionID, formID };
        if (message) cancellation.message = message;
        await client.session.form.cancel(cancellation);
        return;
      }
      const form = await client.session.form.get({ sessionID, formID });
      await client.session.form.reply({ sessionID, formID, answer: completeFormAnswer(form?.fields, answer) });
    } catch (error) {
      throw asAnswerError(error);
    }
  };

  const dismissOpenForms = async (sessionID) => {
    const client = await sessionClient(sessionID);
    let forms;
    try {
      forms = await client.session.form.list({ sessionID });
    } catch (error) {
      throw asAnswerError(error);
    }
    for (const form of Array.isArray(forms) ? forms : []) {
      if (!asNonEmptyString(form?.id) || (form.state && form.state.status !== 'pending')) continue;
      try {
        await client.session.form.cancel({ sessionID, formID: form.id });
      } catch (error) {
        if (!GONE_TAGS.has(error?._tag)) throw asAnswerError(error);
      }
    }
  };

  const assertReturnResult = (action, input, parentSessionID) => {
    if (input.wait === true) throw new SpleenControlError('returnResult cannot be combined with wait', 400);
    if (!dispatchResults) throw new SpleenControlError('Returning a session result is not available on this server', 503);
    if (!parentSessionID) throw new SpleenControlError('returnResult needs a calling session to deliver the result to', 400);
    if (!asNonEmptyString(input.prompt)) throw new SpleenControlError('returnResult requires prompt', 400);
    if (action === 'session.send' && asNonEmptyString(input.sessionId) === parentSessionID) {
      throw new SpleenControlError('returnResult cannot deliver a session\'s result to itself', 400);
    }
  };

  const RESULT_PENDING_NOTE = 'The session runs in the background. Its final answer will be delivered to you automatically as a message when it finishes, and you will continue from there. Do not poll, sleep, or call session.messages to wait for it; carry on with other work or end your turn.';

  const scheduleResultDelivery = async (result, parentSessionID, dispatchedAt) => {
    const afterIdleId = result.baselineIdleRecordId;
    if (result.promptDispatched !== true) {
      return { status: 'not-scheduled', reason: 'The prompt was not dispatched, so there is no result to return.' };
    }
    try {
      await dispatchResults.register({
        parentSessionId: parentSessionID,
        sessionId: result.sessionId,
        dispatchedAt,
        ...(afterIdleId !== undefined ? { afterIdleId } : {}),
      });
      return { status: 'pending', note: RESULT_PENDING_NOTE };
    } catch (error) {
      return {
        status: 'not-scheduled',
        reason: `The session runs, but its result will not be delivered: ${error instanceof Error ? error.message : String(error)}. Read it later with session.messages if the user asks.`,
      };
    }
  };

  const executeSessionAction = async (action, input, contextDirectory, signal, contextSessionId, startedByExtension) => {
    for (const name of ['wait', 'returnResult', 'ownWork']) {
      if (input[name] !== undefined && !isBoolean(input[name])) throw new SpleenControlError(`${name} must be a boolean`, 400);
    }
    if (input.timeout !== undefined && input.wait !== true) throw new SpleenControlError('timeout requires wait', 400);
    if (input.lastAssistant === true && input.wait !== true) throw new SpleenControlError('lastAssistant requires wait', 400);
    assertSingleScope(input);
    if (input.pullRequest !== undefined && action !== 'session.create') {
      throw new SpleenControlError('pullRequest applies only to session.create', 400);
    }
    const sessionID = asNonEmptyString(input.sessionId);
    const parentSessionID = asNonEmptyString(contextSessionId);
    const ownWork = input.ownWork === true;
    if (ownWork && action !== 'session.create') throw new SpleenControlError('ownWork applies only to session.create', 400);
    if (ownWork && !parentSessionID) throw new SpleenControlError('ownWork needs a calling session to nest the new session under', 400);
    const returnResult = input.returnResult === true
      || (ownWork && input.returnResult === undefined && input.wait !== true && Boolean(dispatchResults) && Boolean(asNonEmptyString(input.prompt)));
    if (returnResult) assertReturnResult(action, input, parentSessionID);
    let directory = asNonEmptyString(input.directory) || (!input.projectId ? asNonEmptyString(contextDirectory) : null);
    if (sessionID && action !== 'session.create' && !asNonEmptyString(input.directory) && !input.projectId) {
      const resolvedSessionDirectory = await resolveSessionDirectory(sessionID);
      if (resolvedSessionDirectory) directory = resolvedSessionDirectory;
    }
    const payload = {
      ...(directory ? { directory } : {}),
      ...(asNonEmptyString(input.projectId) ? { projectId: input.projectId.trim() } : {}),
      ...(asNonEmptyString(input.title) ? { title: input.title.trim() } : {}),
      ...(asNonEmptyString(input.prompt) ? { prompt: input.prompt.trim() } : {}),
      ...(asNonEmptyString(input.model) ? { model: input.model.trim() } : {}),
      ...(asNonEmptyString(input.agent) ? { agent: input.agent.trim() } : {}),
      ...(asNonEmptyString(input.variant) ? { variant: input.variant.trim() } : {}),
      ...(input.goal === true ? { goal: true } : {}),
      ...(input.goalTokenBudget !== undefined ? { goalTokenBudget: input.goalTokenBudget } : {}),
      ...(asNonEmptyString(input.worktree) ? { worktree: {
        name: input.worktree.trim(),
        ...(asNonEmptyString(input.branch) ? { branchName: input.branch.trim() } : {}),
        ...(asNonEmptyString(input.startRef) ? { startRef: input.startRef.trim() } : {}),
      } } : {}),
      ...(typeof input.setUpstream === 'boolean' ? { setUpstream: input.setUpstream } : {}),
      ...(asNonEmptyString(input.messageId) ? { messageId: input.messageId.trim() } : {}),
    };
    if (input.pullRequest !== undefined) {
      payload.pullRequest = input.pullRequest;
      if (!payload.worktree) {
        payload.worktree = {};
        if (asNonEmptyString(input.branch)) payload.worktree.branchName = input.branch.trim();
        if (asNonEmptyString(input.startRef)) payload.worktree.startRef = input.startRef.trim();
      }
    }
    if (parentSessionID && !(action === 'session.send' && sessionID === parentSessionID)) {
      payload.promptedBySessionId = parentSessionID;
    }
    const startedAt = now();
    let result;
    if (action === 'session.create') {
      const createOptions = {};
      if (startedByExtension) createOptions.startedByExtension = startedByExtension;
      if (ownWork) createOptions.operatorParentId = parentSessionID;
      result = await sessionService.create(payload, ...(Object.keys(createOptions).length > 0 ? [createOptions] : []));
    } else {
      if (!sessionID) throw new SpleenControlError('sessionId is required', 400);
      if (action === 'session.send') {
        result = await sessionService.send(sessionID, payload);
      } else {
        result = await sessionService.fork(sessionID, payload);
      }
    }
    if (returnResult) {
      const publicResult = { ...result, resultDelivery: await scheduleResultDelivery(result, parentSessionID, startedAt) };
      delete publicResult.baselineAssistantMessageId;
      delete publicResult.baselineIdleRecordId;
      return publicResult;
    }
    if (input.wait !== true) {
      const publicResult = { ...result };
      delete publicResult.baselineAssistantMessageId;
      delete publicResult.baselineIdleRecordId;
      return publicResult;
    }
    const client = await getClient(result.directory);
    const status = await waitForIdle({
      client,
      sessionID: result.sessionId,
      directory: result.directory,
      timeoutMs: normalizeWaitTimeoutMs(input.timeout),
      requireActivity: result.promptDispatched === true,
      baselineMessageID: result.baselineAssistantMessageId,
      startedAt,
      signal,
    });
    const publicResult = { ...result, sessionStatus: status };
    delete publicResult.baselineAssistantMessageId;
    delete publicResult.baselineIdleRecordId;
    if (input.lastAssistant === true) {
      publicResult.lastAssistantMessage = (await sessionMessages(client, result.sessionId, 'assistant', 1))[0] || null;
    }
    return publicResult;
  };

  const browserAction = async (action, input, signal, contextDirectory, contextSessionId) => {
    const parameters = {};
    const tabId = asNonEmptyString(input.tabId);
    if (tabId) {
      if (tabId.length > 128) throw new SpleenControlError('tabId must be an id from browser.snapshot tabs', 400);
      parameters.tabId = tabId;
    }

    const readViewport = (required) => {
      const viewport = asNonEmptyString(input.viewport);
      if (!viewport) {
        if (required) throw new SpleenControlError('viewport is required for browser.resize', 400);
        return;
      }
      if (!['mobile', 'tablet', 'desktop', 'fill'].includes(viewport)) {
        throw new SpleenControlError('viewport must be mobile, tablet, desktop, or fill', 400);
      }
      parameters.viewport = viewport;
    };

    if (action === 'browser.resize') readViewport(true);

    if (action === 'browser.capture') {
      const label = asNonEmptyString(input.label);
      if (label) parameters.label = label;
    }

    if (action === 'browser.open') {
      readViewport(false);
      const url = asNonEmptyString(input.url);
      if (!url) throw new SpleenControlError('url is required for browser.open', 400);
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new SpleenControlError('url must be an absolute http(s) URL', 400);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new SpleenControlError('url must use http or https', 400);
      }
      parameters.url = parsed.toString();
    }

    const readTarget = ({ required, allowText = false, refKey = 'ref', selectorKey = 'selector' }) => {
      const ref = asNonEmptyString(input[refKey]);
      const selector = asNonEmptyString(input[selectorKey]);
      const text = allowText ? asNonEmptyString(input.text) : '';
      if (ref) {
        if (!/^e\d{1,6}$/.test(ref)) throw new SpleenControlError(`${refKey} must be a ref from browser.snapshot, such as e12`, 400);
        parameters[refKey] = ref;
      }
      if (selector) parameters[selectorKey] = selector;
      if (text) parameters.text = text;
      if (required && !ref && !selector && !text) {
        const names = allowText ? `${refKey}, ${selectorKey} or text` : `${refKey} or ${selectorKey}`;
        throw new SpleenControlError(`${action} requires ${names}`, 400);
      }
    };

    if (input.dialog !== undefined && action !== 'browser.dialog') {
      if (input.dialog !== 'accept' && input.dialog !== 'dismiss') {
        throw new SpleenControlError('dialog must be accept or dismiss', 400);
      }
      parameters.dialog = input.dialog;
    }

    if (action === 'browser.click' || action === 'browser.hover') readTarget({ required: true, allowText: true });

    if (action === 'browser.snapshot') {
      const selector = asNonEmptyString(input.selector);
      if (selector) parameters.selector = selector;
    }

    if (action === 'browser.inspect') readTarget({ required: true });

    if (action === 'browser.type') {
      readTarget({ required: true });
      if (typeof input.value !== 'string') {
        throw new SpleenControlError('value is required for browser.type', 400);
      }
      parameters.value = input.value;
      parameters.submit = input.submit === true;
    }

    if (action === 'browser.select') {
      readTarget({ required: true });
      const hasLabel = typeof input.label === 'string';
      const hasValue = typeof input.value === 'string';
      if (hasLabel === hasValue) {
        throw new SpleenControlError('browser.select requires exactly one of label or value', 400);
      }
      if (hasLabel) parameters.label = input.label;
      else parameters.value = input.value;
    }

    if (action === 'browser.scroll') {
      const direction = asNonEmptyString(input.direction);
      readTarget({ required: !direction });
      if (direction && !['up', 'down', 'top', 'bottom'].includes(direction)) {
        throw new SpleenControlError('direction must be up, down, top, or bottom', 400);
      }
      if (direction) parameters.direction = direction;
    }

    if (action === 'browser.drag') {
      readTarget({ required: true });
      readTarget({ required: true, refKey: 'to', selectorKey: 'toSelector' });
    }

    if (action === 'browser.press') {
      const key = asNonEmptyString(input.key);
      if (!key || key.length > 40) throw new SpleenControlError('key is required, such as Enter, Escape, Tab or Meta+a', 400);
      parameters.key = key;
      readTarget({ required: false });
    }

    if (action === 'browser.dialog') {
      const answer = dialogAnswerSchema.safeParse(input);
      if (!answer.success) {
        throw new SpleenControlError('accept is required for browser.dialog: true to accept, false to dismiss', 400);
      }
      parameters.accept = answer.data.accept;
      if (answer.data.value !== undefined) parameters.value = answer.data.value;
    }

    if (action === 'browser.wait') {
      const text = asNonEmptyString(input.text);
      if (text) parameters.text = text;
      else readTarget({ required: true });
      if (input.gone === true) parameters.gone = true;
      if (input.timeoutMs !== undefined) {
        const timeout = Number(input.timeoutMs);
        if (!Number.isFinite(timeout) || timeout < 0) throw new SpleenControlError('timeoutMs must be a number of milliseconds', 400);
        parameters.timeoutMs = Math.min(15_000, Math.round(timeout));
      }
    }

    if (action === 'browser.upload') {
      readTarget({ required: true });
      if (!browserUploads) throw new SpleenControlError('Uploads are not available on this server', 503);
      let files;
      try {
        files = await resolveUploadFiles({ paths: input.paths, directory: asNonEmptyString(contextDirectory) });
      } catch (error) {
        if (error instanceof UploadRefusedError) throw new SpleenControlError(error.message, 400);
        throw error;
      }
      parameters.upload = browserUploads.put(files);
    }

    const timeoutMs = action === 'browser.open' || action === 'browser.upload' ? 45_000 : 20_000;
    const context = {
      directory: asNonEmptyString(contextDirectory),
      sessionId: asNonEmptyString(contextSessionId),
    };
    const result = await browserControl.request(action, parameters, { signal, timeoutMs, context });

    if (action === 'browser.capture') {
      const directory = asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory);
      if (!directory) {
        throw new SpleenControlError('directory is required to save a screenshot', 400);
      }
      const capture = result && typeof result === 'object' ? result : {};
      const saved = await writeScreenshot({
        directory,
        base64: capture.base64,
        mime: capture.mime,
        label: input.label,
      });
      return {
        path: saved.path,
        hint: `Write ![](${saved.path}) in your reply to show this image to the user; it is rendered under your message.`,
        url: capture.url ?? null,
        title: capture.title ?? null,
        viewport: capture.viewport ?? null,
        width: capture.width ?? null,
        height: capture.height ?? null,
      };
    }

    return result;
  };

  const execute = async (action, input = {}, contextDirectory, options = {}) => {
    try {
      if (!CONTROL_ACTIONS.has(action)) {
        throw new SpleenControlError(`Unsupported Spleen action: ${action || 'missing'}`, 400);
      }
      if (SPLEEN_KNOWLEDGE_ACTIONS.includes(action)) {
        return await knowledgeActions.execute(action, input, contextDirectory, options.contextSessionId);
      }
      if (action.startsWith('memory.')) {
        if (!agentMemoryActions) {
          throw new SpleenControlError('Agent memory is not available on this server', 503);
        }
        return agentMemoryActions.execute(action, input, contextDirectory);
      }
      if (action.startsWith('browser.')) {
        if (!browserControl) {
          throw new SpleenControlError('The in-app browser is not available on this server', 503);
        }
        return browserAction(action, input, options.signal, contextDirectory, options.contextSessionId);
      }
      if (action === 'notify.send') {
        if (!notifyUser) {
          throw new SpleenControlError('Notifications are not available on this server', 503);
        }
        const result = await notifyUser({
          title: input.title,
          body: input.body,
          showWhenFocused: input.showWhenFocused,
          sessionId: asNonEmptyString(options.contextSessionId) || undefined,
          directory: asNonEmptyString(contextDirectory) || undefined,
        });
        if (result.status !== 200) {
          throw new SpleenControlError(result.body.error, result.status);
        }
        return result.body;
      }
      if (action.startsWith('workflow.')) {
        if (!workflowRuntime) throw new SpleenControlError('Workflows are not available on this server', 503);
        return await workflowRuntime.executeAction(action, input, {
          sessionId: asNonEmptyString(options.contextSessionId),
          directory: asNonEmptyString(contextDirectory),
        });
      }
      if (action === 'render.page') {
        return await renderPage(input, {
          sessionId: asNonEmptyString(options.contextSessionId),
          callId: asNonEmptyString(options.contextCallId),
          directory: asNonEmptyString(contextDirectory),
          signal: options.signal,
        });
      }
      if (action === 'image.generate') {
        return await generateImage(input, { directory: asNonEmptyString(contextDirectory), signal: options.signal });
      }
      if (action === 'usage.read') {
        if (!readUsage) throw new SpleenControlError('Usage is not available on this server', 503);
        return await readUsage(input, { signal: options.signal });
      }
      if (action.startsWith('terminal.')) {
        return await readTerminal(action, input, contextDirectory);
      }
      if (action === 'secret.request') {
        return await secretRequests.request(input, {
          sessionId: asNonEmptyString(options.contextSessionId),
          callId: asNonEmptyString(options.contextCallId),
          directory: asNonEmptyString(contextDirectory),
          signal: options.signal,
        });
      }
      if (action === 'secret.run') {
        return await secretRequests.run(input, {
          sessionId: asNonEmptyString(options.contextSessionId),
          callId: asNonEmptyString(options.contextCallId),
          directory: asNonEmptyString(contextDirectory),
          signal: options.signal,
          authorized: options.secretRunAuthorized === true,
        });
      }
      if (action === 'secret.forget') {
        return await secretRequests.forget(asNonEmptyString(options.contextSessionId));
      }
      if (action === 'file.open') {
        if (!fileOpen) {
          throw new SpleenControlError('The file viewer is not available on this server', 503);
        }
        return fileOpen.request({
          path: asNonEmptyString(input.path),
          directory: asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory),
          sessionId: asNonEmptyString(options.contextSessionId),
        });
      }
      if (action === 'session.stop') {
        const explicitSessionID = asNonEmptyString(input.sessionId);
        const targetSessionID = explicitSessionID || asNonEmptyString(options.contextSessionId);
        if (!targetSessionID) throw new SpleenControlError('sessionId is required', 400);
        await stopSession(targetSessionID);
        return { stopped: true, sessionId: targetSessionID };
      }
      if (action === 'settings.list') {
        const current = (await Promise.resolve(readSettingsFromDiskMigrated()).catch(() => ({}))) ?? {};
        const fields = settingsRegistry?.fields ?? {};
        const entries = Object.entries(fields)
          .filter(([key, spec]) => !isSecretRegistryKey(key, spec))
          .map(([key, spec]) => ({
            key,
            scope: spec.scope,
            perSurface: spec.perSurface === true,
            computed: spec.computed === true,
            derived: spec.derived === true,
            value: Object.hasOwn(current, key) ? current[key] : undefined,
          }));
        return { count: entries.length, settings: entries };
      }
      if (action === 'settings.read') {
        const current = (await Promise.resolve(readSettingsFromDiskMigrated()).catch(() => ({}))) ?? {};
        const fields = settingsRegistry?.fields ?? {};
        const requested = Array.isArray(input.keys) ? input.keys.map((k) => asNonEmptyString(k)).filter(Boolean) : null;
        const result = {};
        if (requested && requested.length > 0) {
          for (const key of requested) {
            if (isSecretRegistryKey(key, fields[key])) continue;
            if (Object.hasOwn(current, key)) result[key] = current[key];
          }
        } else {
          for (const [key, value] of Object.entries(current)) {
            if (isSecretRegistryKey(key, fields[key])) continue;
            result[key] = value;
          }
        }
        return { settings: result };
      }
      if (action === 'settings.update') {
        if (!persistSettings) throw new SpleenControlError('Settings persistence is unavailable on this server', 503);
        const changes = input.changes && typeof input.changes === 'object' && !Array.isArray(input.changes) ? input.changes : null;
        if (!changes || Object.keys(changes).length === 0) {
          throw new SpleenControlError('changes object with at least one setting key is required', 400);
        }
        const fields = settingsRegistry?.fields ?? {};
        for (const key of Object.keys(changes)) {
          const spec = fields[key];
          if (!spec) throw new SpleenControlError(`Unknown setting: ${key}`, 400);
          if (isSecretRegistryKey(key, spec) || spec.computed === true || spec.derived === true) {
            throw new SpleenControlError(`Setting "${key}" cannot be modified by an agent`, 403);
          }
        }
        const saved = await persistSettings(changes);
        const sanitized = {};
        for (const key of Object.keys(changes)) {
          if (!isSecretRegistryKey(key, fields[key]) && saved && Object.hasOwn(saved, key)) {
            sanitized[key] = saved[key];
          }
        }
        broadcastUiEvent({ type: 'spleen:settings-changed', properties: { keys: Object.keys(changes) } });
        return { updated: Object.keys(changes), settings: sanitized };
      }
      if (action === 'ui.control') {
        const command = asNonEmptyString(input.command);
        if (!command || !UI_CONTROL_COMMANDS.has(command)) {
          throw new SpleenControlError(`command must be one of: ${Array.from(UI_CONTROL_COMMANDS).join(', ')}`, 400);
        }
        const payload = {
          command,
          ...(asNonEmptyString(input.surface) ? { surface: input.surface.trim() } : {}),
          ...(asNonEmptyString(input.section) ? { section: input.section.trim() } : {}),
          ...(asNonEmptyString(input.sessionId) ? { sessionId: input.sessionId.trim() } : {}),
          ...(asNonEmptyString(input.themeId) ? { themeId: input.themeId.trim() } : {}),
          ...(asNonEmptyString(input.title) ? { title: input.title.trim() } : {}),
          ...(asNonEmptyString(input.message) ? { message: input.message.trim() } : {}),
          ...(asNonEmptyString(input.level) ? { level: input.level.trim() } : {}),
        };
        broadcastUiEvent({ type: 'spleen:ui-control', properties: payload });
        return { dispatched: true, ...payload };
      }
      if (action.startsWith('recovery.')) {
        const recovery = getSessionRecoveryRuntime?.() ?? sessionRecoveryRuntime;
        if (!recovery) throw new SpleenControlError('Session recovery runtime is unavailable', 503);
        if (action === 'recovery.status') return recovery.status();
        if (action === 'recovery.wake') return recovery.wakeWaitingProvider();
        const sid = asNonEmptyString(input.sessionId) || asNonEmptyString(options.contextSessionId);
        if (!sid) throw new SpleenControlError('sessionId is required', 400);
        if (action === 'recovery.resume') return recovery.resumeNow(sid);
        if (action === 'recovery.dismiss') return recovery.dismiss(sid);
      }
      if (action.startsWith('chat.')) {
        if (!teamsService) throw new SpleenControlError('Connected chats service is unavailable', 503);
        if (action === 'chat.link') {
          const sourceSessionId = asNonEmptyString(input.sourceSessionId) || asNonEmptyString(options.contextSessionId);
          return await teamsService.linkSessions({
            sourceSessionId,
            targetSessionId: asNonEmptyString(input.targetSessionId) || asNonEmptyString(input.sessionId),
            relation: asNonEmptyString(input.relation) || 'reference',
            note: asNonEmptyString(input.note) || '',
          });
        }
        if (action === 'chat.links') {
          return { links: await teamsService.listLinks(asNonEmptyString(input.sessionId) || asNonEmptyString(options.contextSessionId)) };
        }
        if (action === 'chat.unlink') {
          return await teamsService.unlinkSessions(asNonEmptyString(input.linkId));
        }
      }
      if (action.startsWith('team.')) {
        if (!teamsService) throw new SpleenControlError('AI Teams service is unavailable', 503);
        if (action === 'team.list') return { teams: await teamsService.listTeams(), presets: Object.keys(teamsService.presets) };
        if (action === 'team.create') {
          const directory = asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory);
          const goal = asNonEmptyString(input.teamGoal) || asNonEmptyString(input.goal) || '';
          return await teamsService.createTeam({ ...input, goal, directory });
        }
        const teamId = asNonEmptyString(input.teamId);
        if (!teamId) throw new SpleenControlError('teamId is required', 400);
        if (action === 'team.get') return await teamsService.getTeam(teamId);
        if (action === 'team.stop') return await teamsService.stopTeam(teamId);
        if (action === 'team.addMember') return await teamsService.addMember(teamId, { ...input, role: asNonEmptyString(input.memberRole) || asNonEmptyString(input.role) || 'worker' });
        if (action === 'team.removeMember') {
          const memberId = asNonEmptyString(input.memberId);
          if (!memberId) throw new SpleenControlError('memberId is required', 400);
          return await teamsService.removeMember(teamId, memberId);
        }
        if (action === 'team.post') {
          return await teamsService.postBoardMessage({
            teamId,
            author: asNonEmptyString(input.author) || asNonEmptyString(options.contextSessionId) || 'orchestrator',
            body: asNonEmptyString(input.body) || asNonEmptyString(input.message),
            mentions: Array.isArray(input.mentions) ? input.mentions : undefined,
          });
        }
        if (action === 'team.addTask') return await teamsService.addTask(teamId, input);
        const taskId = asNonEmptyString(input.taskId);
        if (!taskId) throw new SpleenControlError('taskId is required', 400);
        if (action === 'team.updateTask') return await teamsService.updateTask(teamId, taskId, input);
        if (action === 'team.retryTask') return await teamsService.retryTask(teamId, taskId);
        if (action === 'team.cancelTask') return await teamsService.cancelTask(teamId, taskId);
      }
      if (action.startsWith('agent.')) {
        if (!agentConfigApi) throw new SpleenControlError('Agent configuration service is unavailable', 503);
        const targetDir = asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory) || undefined;
        if (action === 'agent.list') {
          return { directory: targetDir ?? null, agents: agentConfigApi.listConfiguredAgents(targetDir) };
        }
        const agentName = asNonEmptyString(input.agentName) || asNonEmptyString(input.name);
        if (!agentName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(agentName)) {
          throw new SpleenControlError('A valid agentName (letters, numbers, ., _, -) is required', 400);
        }
        if (action === 'agent.delete') {
          agentConfigApi.deleteAgent(agentName, targetDir);
          return { deleted: true, name: agentName, directory: targetDir ?? null };
        }
        const configPatch = {
          ...(typeof input.description === 'string' ? { description: input.description } : {}),
          ...(typeof input.systemPrompt === 'string'
            ? { prompt: input.systemPrompt }
            : (typeof input.prompt === 'string' ? { prompt: input.prompt } : {})),
          ...(typeof input.model === 'string' && input.model.trim() ? { model: input.model.trim() } : {}),
          ...(typeof input.agentMode === 'string' ? { mode: input.agentMode } : {}),
        };
        if (action === 'agent.create') {
          const scope = input.agentScope === 'user' ? 'user' : 'project';
          if (scope === 'project' && !targetDir) {
            throw new SpleenControlError('directory is required to create a project-scoped agent', 400);
          }
          const created = agentConfigApi.createAgent(agentName, configPatch, targetDir, scope);
          return { created: true, name: agentName, scope, agent: created };
        }
        if (action === 'agent.update') {
          const updated = agentConfigApi.updateAgent(agentName, configPatch, targetDir);
          return { updated: true, name: agentName, agent: updated };
        }
      }
      if (action.startsWith('discord.')) {
        const discord = await Promise.resolve(getDiscordClient());
        return await handleDiscordControlAction(action, input, discord);
      }
      if (action.startsWith('uc.')) {
        const uc = await Promise.resolve(getUnknownCheatsClient());
        const ucStore = await Promise.resolve(getUnknownCheatsStore());
        if (!uc) throw new SpleenControlError('UnknownCheats reader is unavailable', 503);
        if (action === 'uc.status') {
          return ucStore ? await ucStore.getPublicStatus() : { hasCookies: false };
        }
        if (action === 'uc.home') return await uc.getHome();
        if (action === 'uc.recent') return await uc.getRecent({ page: input.page });
        if (action === 'uc.forum') return await uc.getForum({ url: asNonEmptyString(input.url), fid: input.fid, page: input.page });
        if (action === 'uc.thread') return await uc.getThread({ url: asNonEmptyString(input.url), tid: input.tid, page: input.page });
        if (action === 'uc.search') return await uc.search({ query: asNonEmptyString(input.query), page: input.page });
        if (action === 'uc.bookmarks') return { bookmarks: ucStore ? await ucStore.listBookmarks() : [] };
        if (action === 'uc.addBookmark') {
          if (!ucStore) throw new SpleenControlError('UnknownCheats store is unavailable', 503);
          const url = asNonEmptyString(input.url);
          const title = asNonEmptyString(input.title) || url;
          if (!url) throw new SpleenControlError('url is required', 400);
          return { bookmarks: await ucStore.addBookmark({ id: asNonEmptyString(input.id) || url, title, url, forum: asNonEmptyString(input.forum) || null }) };
        }
        if (action === 'uc.history') return { history: ucStore ? await ucStore.listHistory() : [] };
      }
      if (action === 'projects.list') return { projects: await projects() };
      if (action === 'models.list') return models();
      if (action === 'models.search') return searchModels(input, contextDirectory);
      if (action === 'schedule.status') return scheduledTaskService.status();
      if (action.startsWith('schedule.')) {
        const taskID = asNonEmptyString(input.taskId);
        if (SCHEDULE_TASK_ID_ACTIONS.has(action) && !taskID) {
          throw new SpleenControlError('taskId is required', 400);
        }
        const explicitProjectID = asNonEmptyString(input.projectId);
        const explicitDirectory = asNonEmptyString(input.directory);
        const contextDirectoryFallback = explicitProjectID
          ? undefined
          : asNonEmptyString(contextDirectory) || undefined;
        const projectID = await scheduledTaskService.resolveProjectID({
          projectId: explicitProjectID || undefined,
          directory: explicitDirectory || contextDirectoryFallback,
        });
        switch (action) {
          case 'schedule.list':
            return { scheduler: await scheduledTaskService.status(), tasks: await scheduledTaskService.list(projectID) };
          case 'schedule.create': {
            const task = buildScheduledTask(input);
            const result = await scheduledTaskService.upsert(projectID, task);
            return { task: result.task, created: result.created };
          }
          case 'schedule.update': {
            const existing = (await scheduledTaskService.list(projectID)).find((task) => task.id === taskID);
            if (!existing) throw new SpleenControlError(`Scheduled task not found: ${taskID}`, 404);
            const task = patchScheduledTask(existing, input);
            const result = await scheduledTaskService.upsert(projectID, task);
            return { task: result.task, updated: true };
          }
          case 'schedule.run':
            return scheduledTaskService.run(projectID, taskID);
          case 'schedule.delete':
            return { deleted: true, tasks: await scheduledTaskService.remove(projectID, taskID) };
          case 'schedule.toggle': {
            if (typeof input.disabled !== 'boolean') {
              throw new SpleenControlError('disabled is required for schedule.toggle', 400);
            }
            const task = await scheduledTaskService.setEnabled(projectID, taskID, input.disabled === false);
            return { task, enabled: task?.enabled === true };
          }
        }
      }
      if (action === 'session.create' || action === 'session.send' || action === 'session.fork') {
        return executeSessionAction(action, input, contextDirectory, options.signal, options.contextSessionId, options.startedByExtension);
      }
      if (action === 'session.link' || action === 'session.unlink') {
        if (!sessionLinks) throw new SpleenControlError('Linking is not available on this server', 503);
        assertSingleScope(input);
        const explicitSessionID = asNonEmptyString(input.sessionId);
        const sessionID = explicitSessionID || asNonEmptyString(options.contextSessionId);
        const directory = asNonEmptyString(input.directory)
          || (explicitSessionID ? await resolveSessionDirectory(explicitSessionID) : null)
          || asNonEmptyString(contextDirectory);
        const link = input.link ?? { url: input.url, title: input.title, kind: input.kind, identifier: input.identifier };
        if (action === 'session.unlink') return sessionLinks.unlink({ sessionId: sessionID, directory, target: link });
        return sessionLinks.link({ sessionId: sessionID, directory, link });
      }
      if (action === 'pr.watch' || action === 'pr.unwatch') {
        if (!prWatch) throw new SpleenControlError('Waiting on a pull request is not available on this server', 503);
        const sessionID = asNonEmptyString(options.contextSessionId);
        if (!sessionID) throw new SpleenControlError(`${action} must be called from a session`, 400);
        try {
          if (action === 'pr.unwatch') return await prWatch.unwatch(sessionID, input.url);
          const directory = (await resolveSessionDirectory(sessionID)) || asNonEmptyString(contextDirectory);
          return await prWatch.watch({ sessionID, directory, url: input.url });
        } catch (error) {
          throw new SpleenControlError(error?.message ?? String(error), Number.isInteger(error?.status) ? error.status : 500);
        }
      }
      if (action === 'wait.list' || action === 'wait.start' || action === 'wait.stop') {
        if (!extensionWaits) throw new SpleenControlError('Waits are not available on this server', 503);
        const sessionID = asNonEmptyString(options.contextSessionId);
        if (!sessionID) throw new SpleenControlError(`${action} must be called from a session`, 400);
        try {
          const resolveDirectory = async () => (await resolveSessionDirectory(sessionID)) || asNonEmptyString(contextDirectory);
          return await runWaitAction({ action, input, sessionID, extensionWaits, prWatch, resolveDirectory });
        } catch (error) {
          if (error instanceof SpleenControlError) throw error;
          throw new SpleenControlError(error?.message ?? String(error), Number.isInteger(error?.status) ? error.status : 500);
        }
      }
      if (action === 'work.name') {
        if (!workNamer) throw new SpleenControlError('Naming tasks is not available on this server', 503);
        const sessionID = asNonEmptyString(input.sessionId) || asNonEmptyString(options.contextSessionId);
        return workNamer.name({ sessionId: sessionID, title: input.title, branch: input.branch });
      }
      if (action === 'session.moveToWorktree') {
        assertSingleScope(input);
        const explicitSessionID = asNonEmptyString(input.sessionId);
        const sessionID = explicitSessionID || asNonEmptyString(options.contextSessionId);
        if (!sessionID) throw new SpleenControlError('sessionId is required', 400);
        const directory = (await resolveSessionDirectory(sessionID)) || asNonEmptyString(contextDirectory);
        const worktree = { name: asNonEmptyString(input.worktree)?.trim() };
        const branch = asNonEmptyString(input.branch);
        if (branch) worktree.branchName = branch.trim();
        const startRef = asNonEmptyString(input.startRef);
        if (startRef) worktree.startRef = startRef.trim();
        const existingBranch = asNonEmptyString(input.existingBranch);
        if (existingBranch) worktree.existingBranch = existingBranch.trim();
        const payload = { worktree };
        if (directory) payload.directory = directory;
        if (input.carry !== undefined) payload.carry = input.carry;
        const moved = await sessionService.moveToWorktree(sessionID, payload);
        if (workNamer && !existingBranch && moved?.worktree?.path) {
          await workNamer.carryToWorktree({ sessionId: sessionID, worktree: moved.worktree.path })
            .catch((error) => console.warn('Failed to carry the task name into the new worktree:', error instanceof Error ? error.message : String(error)));
        }
        return moved;
      }
      if (action === 'session.markDone' || action === 'session.track') {
        return setWorkState(input, options.contextSessionId, action === 'session.track' ? 'open' : 'done');
      }
      if (action === 'session.list') return listSessions(input, contextDirectory);
      if (action.startsWith('session.')) {
        const sessionID = asNonEmptyString(input.sessionId);
        if (!sessionID) throw new SpleenControlError('sessionId is required', 400);
        const scoped = asNonEmptyString(input.projectId) || asNonEmptyString(input.directory);
        const directory = (!scoped && await resolveSessionDirectory(sessionID))
          || await resolveReadDirectory(input, contextDirectory);
        const client = await getClient(directory);
        if (!directory) throw new SpleenControlError('directory is required', 400);
        if (action === 'session.status') {
          await assertSessionExists(client, sessionID);
          return { sessionId: sessionID, directory, sessionStatus: await sessionStatus(client, sessionID) };
        }
        if (action === 'session.messages') {
          if (input.timeout !== undefined && input.wait !== true) throw new SpleenControlError('timeout requires wait', 400);
          const role = input.lastAssistant === true ? 'assistant' : (asNonEmptyString(input.role) || 'all');
          if (!['all', 'user', 'assistant'].includes(role)) throw new SpleenControlError('role must be all, user, or assistant', 400);
          const last = input.last === true || input.lastAssistant === true;
          if (input.all === true && (last || input.limit !== undefined)) throw new SpleenControlError('all cannot be combined with last or limit', 400);
          if (last && input.limit !== undefined) throw new SpleenControlError('last cannot be combined with limit', 400);
          await assertSessionExists(client, sessionID);
          const currentStatus = input.wait === true
            ? await waitForIdle({ client, sessionID, directory, timeoutMs: normalizeWaitTimeoutMs(input.timeout), requireActivity: false, startedAt: now(), signal: options.signal })
            : await sessionStatus(client, sessionID);
          const limit = input.all === true ? undefined : (last ? 1 : positiveInteger(input.limit, 10, 'limit'));
          return { sessionId: sessionID, directory, role, sessionStatus: currentStatus, messages: await sessionMessages(client, sessionID, role, limit) };
        }
      }
      throw new SpleenControlError(`Unsupported Spleen action: ${action || 'missing'}`, 400);
    } catch (error) {
      throw asControlError(error, `Failed to execute ${action || 'Spleen action'}`);
    }
  };

  const releaseAnswerWaits = (sessionId) => {
    pageAnswers.release(sessionId);
    secretRequests.release(sessionId);
  };
  const answerPage = (input) => {
    try {
      return pageAnswers.answer(input);
    } catch (error) {
      if (!laterPages || error?.statusCode !== 404) throw error;
      return laterPages.answer(input);
    }
  };
  return {
    execute,
    resolveSessionDirectory,
    answerPage,
    answerSecret: secretRequests.answer,
    secretFields: secretRequests.fields,
    releaseAnswerWaits,
    stopSession,
    answerPermission,
    answerForm,
    dismissOpenForms,
  };
};
